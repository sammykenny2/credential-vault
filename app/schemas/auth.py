"""Authentication schemas."""

from pydantic import BaseModel


class Token(BaseModel):
    """JWT token response."""

    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class TokenPayload(BaseModel):
    """JWT token payload."""

    sub: str  # user_id
    exp: int
    type: str  # "access" or "refresh"


class GoogleOAuthCallback(BaseModel):
    """Google OAuth callback payload."""

    code: str
    redirect_uri: str


class GoogleUserInfo(BaseModel):
    """User info returned from Google OAuth."""

    google_id: str
    email: str
    display_name: str
    picture: str | None = None


class VaultSetupRequest(BaseModel):
    """Request to set up E2EE vault keys after initial login."""

    public_key: str
    encrypted_private_key: str
    key_salt: str


class VerifyPasswordRequest(BaseModel):
    """Request to verify user's password."""

    password: str


class LocalLoginRequest(BaseModel):
    """Break-glass local login request (admin only)."""

    email: str
    password: str
