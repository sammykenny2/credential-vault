"""Authentication schemas."""

import re

from pydantic import BaseModel, EmailStr, field_validator


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

    @field_validator("new_password")
    @classmethod
    def validate_password_strength(cls, v: str) -> str:
        """Validate new password meets complexity requirements."""
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters long")
        if not re.search(r"[A-Z]", v):
            raise ValueError("Password must contain at least one uppercase letter")
        if not re.search(r"[a-z]", v):
            raise ValueError("Password must contain at least one lowercase letter")
        if not re.search(r"\d", v):
            raise ValueError("Password must contain at least one digit")
        if not re.search(r"[!@#$%^&*()_+\-=\[\]{};':\"\\|,.<>/?]", v):
            raise ValueError("Password must contain at least one special character")
        return v
