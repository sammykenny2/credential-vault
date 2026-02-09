"""Schemas for utility tools (password generator, strength, HIBP)."""

from pydantic import BaseModel, Field


class PasswordGenerateRequest(BaseModel):
    """Request for password generation."""

    length: int = Field(20, ge=8, le=128)
    uppercase: bool = True
    lowercase: bool = True
    digits: bool = True
    symbols: bool = True
    exclude_ambiguous: bool = False


class PasswordGenerateResponse(BaseModel):
    """Response from password generation."""

    password: str
    length: int
    strength: dict


class PassphraseGenerateRequest(BaseModel):
    """Request for passphrase generation."""

    word_count: int = Field(5, ge=3, le=10)
    separator: str = "-"
    capitalize: bool = False
    include_number: bool = False


class PassphraseGenerateResponse(BaseModel):
    """Response from passphrase generation."""

    passphrase: str
    word_count: int
    strength: dict


class PasswordStrengthRequest(BaseModel):
    """Request for password strength analysis."""

    password: str = Field(min_length=1)


class PasswordStrengthResponse(BaseModel):
    """Response from password strength analysis."""

    score: int
    level: str
    feedback: list[str]
    details: dict
    crack_time_display: str


class BreachCheckRequest(BaseModel):
    """Request for HIBP breach check."""

    password: str = Field(min_length=1)


class BreachCheckResponse(BaseModel):
    """Response from HIBP breach check."""

    breached: bool
    count: int
    error: str | None = None
