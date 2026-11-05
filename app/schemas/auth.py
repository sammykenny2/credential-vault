"""Authentication schemas."""

from pydantic import BaseModel, Field, field_validator

from app.core.security import MAX_PASSWORD_LENGTH
from app.core.vault_proof import parse_signing_public_key
from app.schemas.credential import RecordAdoption


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
    # KEK-protected key bundle (RSA private key and ECDSA signing key).
    encrypted_private_key: str
    key_salt: str
    # Client-side KDF parameter set used to wrap the bundle.
    kdf_version: int = Field(2, ge=1, le=100)
    signing_public_key: str

    @field_validator("signing_public_key")
    @classmethod
    def _valid_signing_key(cls, value: str) -> str:
        parse_signing_public_key(value)
        return value


class VaultRekeyRequest(BaseModel):
    """Replace the wrapped key bundle after a vault password change.

    The public keys (and therefore every stored credential and signature) are
    unchanged; only the wrapping is replaced.
    """

    encrypted_private_key: str
    key_salt: str
    kdf_version: int = Field(2, ge=1, le=100)


class VaultUpgradeRequest(BaseModel):
    """One-time upgrade of an RSA-only vault to a signed one.

    Atomic: the key bundle, the signing key and a signature over every existing
    record are stored together, so no state exists with some records unsigned.
    """

    encrypted_private_key: str
    signing_public_key: str
    adoptions: list[RecordAdoption] = Field(max_length=10_000)

    @field_validator("signing_public_key")
    @classmethod
    def _valid_signing_key(cls, value: str) -> str:
        parse_signing_public_key(value)
        return value


class VerifyPasswordRequest(BaseModel):
    """Request to verify user's password."""

    password: str = Field(max_length=MAX_PASSWORD_LENGTH)


class LocalLoginRequest(BaseModel):
    """Break-glass local login request (admin only)."""

    email: str
    password: str = Field(max_length=MAX_PASSWORD_LENGTH)
