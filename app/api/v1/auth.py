"""Authentication endpoints."""

from fastapi import APIRouter, HTTPException, Request, status

from app.api.deps import CurrentUser, DbSession
from app.core.rate_limit import AUTH_RATE_LIMIT, limiter
from app.core.security import SecurityService
from app.models.audit_log import AuditAction
from app.models.user import UserRole
from app.schemas.auth import LocalLoginRequest, Token, VaultSetupRequest
from app.services.audit_log import AuditLogService
from app.services.user import UserService

router = APIRouter()


@router.post("/login", response_model=Token)
@limiter.limit(AUTH_RATE_LIMIT)
async def local_login(
    request: Request,
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

    access_token, refresh_token = SecurityService.create_tokens(user.id)

    audit_service = AuditLogService(db)
    await audit_service.log_from_request(
        request,
        action=AuditAction.LOGIN_SUCCESS,
        user_id=user.id,
        details={"method": "local_breakglass"},
    )

    return Token(
        access_token=access_token,
        refresh_token=refresh_token,
    )


@router.post("/refresh", response_model=Token)
@limiter.limit(AUTH_RATE_LIMIT)
async def refresh_token(
    request: Request,
    refresh_token: str,
    db: DbSession,
):
    """Refresh access token using refresh token."""
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

    access_token, new_refresh_token = SecurityService.create_tokens(user.id)

    audit_service = AuditLogService(db)
    await audit_service.log_from_request(
        request,
        action=AuditAction.TOKEN_REFRESH,
        user_id=user.id,
    )

    return Token(
        access_token=access_token,
        refresh_token=new_refresh_token,
    )


@router.get("/me")
async def get_current_user_info(current_user: CurrentUser):
    """Get current user information."""
    return {
        "id": current_user.id,
        "email": current_user.email,
        "display_name": current_user.display_name,
        "role": current_user.role,
        "has_vault_keys": current_user.has_vault_keys,
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
