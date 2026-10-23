"""Authentication schemas."""

from pydantic import BaseModel, Field


class Token(BaseModel):
    """Session response body.

    Only the short-lived access token is returned here. The refresh token is
    delivered as an HttpOnly cookie and never exposed to page scripts.
    """

    access_token: str
    token_type: str = "bearer"
    expires_in: int


class TokenPayload(BaseModel):
    """JWT token payload."""

    sub: str  # user_id
    exp: int
    type: str  # "access" or "refresh"
    ver: int = 0  # users.token_version at issue time


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
    # Client-side KDF parameter set used to wrap the private key.
    kdf_version: int = Field(2, ge=1, le=100)


class VaultRekeyRequest(BaseModel):
    """Replace the wrapped private key after a vault password change.

    The public key (and therefore every stored credential) is unchanged;
    only the wrapping of the private key is replaced.
    """

    encrypted_private_key: str
    key_salt: str
    kdf_version: int = Field(2, ge=1, le=100)


class VerifyPasswordRequest(BaseModel):
    """Request to verify user's password."""

    password: str


class LocalLoginRequest(BaseModel):
    """Break-glass local login request (admin only)."""

    email: str
    password: str
