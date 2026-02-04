"""Authentication endpoints."""

from fastapi import APIRouter, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm

from src.api.deps import CurrentUser, DbSession
from src.core.mfa import MFAService
from src.core.security import SecurityService
from src.schemas.auth import LoginRequest, MFASetup, MFAVerify, PasswordChange, Token
from src.services.user import UserService

router = APIRouter()


@router.post("/login", response_model=Token)
async def login(
    form_data: OAuth2PasswordRequestForm,
    db: DbSession,
):
    """Authenticate user and return JWT tokens."""
    user_service = UserService(db)
    user = await user_service.authenticate(form_data.username, form_data.password)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Update last login
    await user_service.update_last_login(user)

    # Create tokens
    access_token, refresh_token = SecurityService.create_tokens(user.id)

    return Token(
        access_token=access_token,
        refresh_token=refresh_token,
    )


@router.post("/refresh", response_model=Token)
async def refresh_token(
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

    user_id = payload.get("sub")
    user_service = UserService(db)
    user = await user_service.get_by_id(user_id)

    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )

    access_token, new_refresh_token = SecurityService.create_tokens(user.id)

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
async def setup_mfa(current_user: CurrentUser, db: DbSession):
    """Initialize MFA setup - returns secret and QR code."""
    if current_user.mfa_enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="MFA is already enabled",
        )

    mfa_data = MFAService.setup_mfa(current_user.email)

    # Store secret temporarily (user must verify before it's saved)
    # In production, use a temporary storage mechanism
    return MFASetup(**mfa_data)


@router.post("/mfa/enable")
async def enable_mfa(
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

    return {"message": "MFA enabled successfully"}


@router.post("/mfa/verify")
async def verify_mfa(data: MFAVerify, current_user: CurrentUser):
    """Verify MFA code during login."""
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

    return {"message": "MFA verified successfully"}


@router.post("/mfa/disable")
async def disable_mfa(
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

    return {"message": "MFA disabled successfully"}


@router.post("/password/change")
async def change_password(
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

    return {"message": "Password changed successfully"}
