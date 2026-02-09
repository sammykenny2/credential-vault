"""Authentication endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm

from app.api.deps import CurrentUser, DbSession
from app.core.mfa import MFAService
from app.core.rate_limit import AUTH_RATE_LIMIT, MFA_RATE_LIMIT, limiter
from app.core.security import SecurityService
from app.models.audit_log import AuditAction
from app.schemas.auth import MFASetup, MFAVerify, PasswordChange, Token
from app.services.audit_log import AuditLogService
from app.services.user import UserService

router = APIRouter()


@router.post("/login", response_model=Token)
@limiter.limit(AUTH_RATE_LIMIT)
async def login(
    request: Request,
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    db: DbSession,
):
    """Authenticate user and return JWT tokens."""
    user_service = UserService(db)
    audit_service = AuditLogService(db)
    user = await user_service.authenticate(form_data.username, form_data.password)

    if not user:
        await audit_service.log_from_request(
            request,
            action=AuditAction.LOGIN_FAILURE,
            details={"email": form_data.username},
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Update last login
    await user_service.update_last_login(user)

    # Create tokens
    access_token, refresh_token = SecurityService.create_tokens(user.id)

    await audit_service.log_from_request(
        request,
        action=AuditAction.LOGIN_SUCCESS,
        user_id=user.id,
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
        "mfa_enabled": current_user.mfa_enabled,
    }


@router.post("/mfa/setup", response_model=MFASetup)
async def setup_mfa(request: Request, current_user: CurrentUser, db: DbSession):
    """Initialize MFA setup - returns secret and QR code."""
    if current_user.mfa_enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="MFA is already enabled",
        )

    mfa_data = MFAService.setup_mfa(current_user.email)

    audit_service = AuditLogService(db)
    await audit_service.log_from_request(
        request,
        action=AuditAction.MFA_SETUP,
        user_id=current_user.id,
    )

    return MFASetup(**mfa_data)


@router.post("/mfa/enable")
async def enable_mfa(
    request: Request,
    data: MFAVerify,
    secret: str,
    current_user: CurrentUser,
    db: DbSession,
):
    """Verify MFA code and enable MFA for user."""
    if current_user.mfa_enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="MFA is already enabled",
        )

    if not MFAService.verify_code(secret, data.code):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid MFA code",
        )

    user_service = UserService(db)
    await user_service.enable_mfa(current_user, secret)

    audit_service = AuditLogService(db)
    await audit_service.log_from_request(
        request,
        action=AuditAction.MFA_ENABLED,
        user_id=current_user.id,
    )

    return {"message": "MFA enabled successfully"}


@router.post("/mfa/verify")
@limiter.limit(MFA_RATE_LIMIT)
async def verify_mfa(
    request: Request,
    data: MFAVerify,
    current_user: CurrentUser,
    db: DbSession,
):
    """Verify MFA code during login."""
    audit_service = AuditLogService(db)

    if not current_user.mfa_enabled or not current_user.mfa_secret:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="MFA is not enabled",
        )

    if not MFAService.verify_code(current_user.mfa_secret, data.code):
        await audit_service.log_from_request(
            request,
            action=AuditAction.MFA_VERIFY_FAILURE,
            user_id=current_user.id,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid MFA code",
        )

    await audit_service.log_from_request(
        request,
        action=AuditAction.MFA_VERIFY_SUCCESS,
        user_id=current_user.id,
    )

    return {"message": "MFA verified successfully"}


@router.post("/mfa/disable")
async def disable_mfa(
    request: Request,
    data: MFAVerify,
    current_user: CurrentUser,
    db: DbSession,
):
    """Disable MFA for user (requires current MFA code)."""
    if not current_user.mfa_enabled or not current_user.mfa_secret:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="MFA is not enabled",
        )

    if not MFAService.verify_code(current_user.mfa_secret, data.code):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid MFA code",
        )

    user_service = UserService(db)
    await user_service.disable_mfa(current_user)

    audit_service = AuditLogService(db)
    await audit_service.log_from_request(
        request,
        action=AuditAction.MFA_DISABLED,
        user_id=current_user.id,
    )

    return {"message": "MFA disabled successfully"}


@router.post("/password/change")
@limiter.limit(AUTH_RATE_LIMIT)
async def change_password(
    request: Request,
    data: PasswordChange,
    current_user: CurrentUser,
    db: DbSession,
):
    """Change user password."""
    if not SecurityService.verify_password(data.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )

    user_service = UserService(db)
    await user_service.update_password(current_user, data.new_password)

    audit_service = AuditLogService(db)
    await audit_service.log_from_request(
        request,
        action=AuditAction.PASSWORD_CHANGED,
        user_id=current_user.id,
    )

    return {"message": "Password changed successfully"}
