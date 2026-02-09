"""Schemas for built-in TOTP authenticator."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class TOTPAccountCreate(BaseModel):
    """Create a TOTP account."""

    encrypted_secret: str
    issuer: str = Field(min_length=1, max_length=255)
    account_name: str = Field(min_length=1, max_length=255)
    algorithm: str = "SHA1"
    digits: int = Field(6, ge=6, le=8)
    period: int = Field(30, ge=15, le=60)
    credential_id: str | None = None
    icon: str | None = None


class TOTPAccountRead(BaseModel):
    """TOTP account read schema."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str
    issuer: str
    account_name: str
    algorithm: str
    digits: int
    period: int
    credential_id: str | None
    icon: str | None
    created_at: datetime
    updated_at: datetime


class TOTPAccountUpdate(BaseModel):
    """Update TOTP account."""

    issuer: str | None = Field(None, min_length=1, max_length=255)
    account_name: str | None = Field(None, min_length=1, max_length=255)
    icon: str | None = None
    credential_id: str | None = None


class TOTPGenerateCode(BaseModel):
    """Generate a TOTP code - includes the encrypted secret for server-side generation."""

    encrypted_secret: str


class TOTPCodeResponse(BaseModel):
    """Response containing a TOTP code."""

    code: str
    remaining_seconds: int
    period: int
