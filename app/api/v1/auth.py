"""Authentication endpoints."""

from fastapi import APIRouter, HTTPException, Request, Response, status

from app.api.deps import CurrentUser, DbSession
from app.core.rate_limit import AUTH_RATE_LIMIT, limiter
from app.core.security import REFRESH_COOKIE_NAME, SecurityService
from app.core.session import issue_session
from app.models.audit_log import AuditAction
from app.models.user import UserRole
from app.schemas.auth import LocalLoginRequest, Token, VaultSetupRequest, VerifyPasswordRequest
from app.services.audit_log import AuditLogService
from app.services.user import UserService

router = APIRouter()


@router.post("/login", response_model=Token)
@limiter.limit(AUTH_RATE_LIMIT)
async def local_login(
    request: Request,
    response: Response,
    data: LocalLoginRequest,
    db: DbSession,
):
    """Break-glass local login for admin users only.

    Used when Google OAuth is unavailable. Only admin users with
    a hashed_password set can use this endpoint.
    """
    user_service = UserService(db)
    user = await user_service.get_by_email(data.email)

    if not user or not user.hashed_password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    if user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Local login is restricted to admin users",
        )

    if not SecurityService.verify_password(data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is deactivated",
        )

    # Update last login
    await user_service.update_last_login(user)

    token = issue_session(user, response)

    audit_service = AuditLogService(db)
    await audit_service.log_from_request(
        request,
        action=AuditAction.LOGIN_SUCCESS,
        user_id=user.id,
        details={"method": "local_breakglass"},
    )

    return token


@router.post("/refresh", response_model=Token)
@limiter.limit(AUTH_RATE_LIMIT)
async def refresh_session(
    request: Request,
    response: Response,
    db: DbSession,
):
    """Rotate the session using the HttpOnly refresh cookie.

    The refresh token is never accepted from the query string or body, so it
    cannot end up in access logs or be read by page scripts.
    """
    refresh_token = request.cookies.get(REFRESH_COOKIE_NAME)
    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing refresh token",
        )

    payload = SecurityService.decode_token(refresh_token)

    if not payload or payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
        )

    user_id: str | None = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
        )
    user_service = UserService(db)
    user = await user_service.get_by_id(user_id)

    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )

    if payload.get("ver", 0) != user.token_version:
        SecurityService.clear_refresh_cookie(response)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session has been revoked",
        )

    token = issue_session(user, response)

    audit_service = AuditLogService(db)
    await audit_service.log_from_request(
        request,
        action=AuditAction.TOKEN_REFRESH,
        user_id=user.id,
    )

    return token


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    current_user: CurrentUser,
    db: DbSession,
):
    """Sign out everywhere: revoke every token issued to the user and clear the cookie.

    Bumping `token_version` invalidates all outstanding access and refresh
    tokens for this account, including those on other devices.
    """
    current_user.token_version += 1
    await db.flush()

    audit_service = AuditLogService(db)
    await audit_service.log_from_request(
        request,
        action=AuditAction.LOGOUT,
        user_id=current_user.id,
    )

    SecurityService.clear_refresh_cookie(response)
    return {"message": "Logged out"}


@router.get("/me")
async def get_current_user_info(current_user: CurrentUser):
    """Get current user information."""
    return {
        "id": current_user.id,
        "email": current_user.email,
        "display_name": current_user.display_name,
        "role": current_user.role,
        "has_vault_keys": current_user.has_vault_keys,
        "has_google_linked": current_user.has_google_linked,
    }


@router.post("/verify-password")
async def verify_password(
    data: VerifyPasswordRequest,
    current_user: CurrentUser,
    db: DbSession,
):
    """Verify user's password (for sensitive operations like linking Google account)."""
    if not current_user.hashed_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No password set for this account",
        )

    if not SecurityService.verify_password(data.password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid password",
        )

    return {"verified": True}


@router.get("/vault/keys")
async def get_vault_keys(current_user: CurrentUser):
    """Get vault key material for unlocking the vault client-side."""
    if not current_user.has_vault_keys:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vault keys not configured",
        )
    return {
        "public_key": current_user.public_key,
        "encrypted_private_key": current_user.encrypted_private_key,
        "key_salt": current_user.key_salt,
    }


@router.post("/vault/setup")
async def setup_vault(
    request: Request,
    data: VaultSetupRequest,
    current_user: CurrentUser,
    db: DbSession,
):
    """Set up E2EE vault keys for user.

    Called after first login to establish the user's keypair.
    The private key is encrypted with the user's vault password (client-side).
    """
    if current_user.has_vault_keys:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Vault keys already configured",
        )

    user_service = UserService(db)
    await user_service.setup_vault_keys(
        user=current_user,
        public_key=data.public_key,
        encrypted_private_key=data.encrypted_private_key,
        key_salt=data.key_salt,
    )

    audit_service = AuditLogService(db)
    await audit_service.log_from_request(
        request,
        action=AuditAction.VAULT_SETUP,
        user_id=current_user.id,
    )

    return {"message": "Vault keys configured successfully"}
