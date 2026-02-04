"""Authentication schemas."""

from pydantic import BaseModel, EmailStr


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


class LoginRequest(BaseModel):
    """Login request."""

    email: EmailStr
    password: str


class MFASetup(BaseModel):
    """MFA setup response."""

    secret: str
    provisioning_uri: str
    qr_code_base64: str


class MFAVerify(BaseModel):
    """MFA verification request."""

    code: str


class PasswordChange(BaseModel):
    """Password change request."""

    current_password: str
    new_password: str
