"""Utility tool endpoints: password generator, strength analysis, breach check."""

from fastapi import APIRouter

from app.api.deps import CurrentUser
from app.core.hibp import check_password_breach
from app.core.password_generator import generate_passphrase, generate_password
from app.core.password_strength import analyze_password
from app.schemas.tools import (
    BreachCheckRequest,
    BreachCheckResponse,
    PassphraseGenerateRequest,
    PassphraseGenerateResponse,
    PasswordGenerateRequest,
    PasswordGenerateResponse,
    PasswordStrengthRequest,
    PasswordStrengthResponse,
)

router = APIRouter()


@router.post("/generate-password", response_model=PasswordGenerateResponse)
async def api_generate_password(
    data: PasswordGenerateRequest,
    current_user: CurrentUser,
):
    """Generate a cryptographically secure random password."""
    password = generate_password(
        length=data.length,
        uppercase=data.uppercase,
        lowercase=data.lowercase,
        digits=data.digits,
        symbols=data.symbols,
        exclude_ambiguous=data.exclude_ambiguous,
    )
    strength = analyze_password(password)
    return PasswordGenerateResponse(
        password=password,
        length=len(password),
        strength=strength,
    )


@router.post("/generate-passphrase", response_model=PassphraseGenerateResponse)
async def api_generate_passphrase(
    data: PassphraseGenerateRequest,
    current_user: CurrentUser,
):
    """Generate a random passphrase."""
    passphrase = generate_passphrase(
        word_count=data.word_count,
        separator=data.separator,
        capitalize=data.capitalize,
        include_number=data.include_number,
    )
    strength = analyze_password(passphrase)
    return PassphraseGenerateResponse(
        passphrase=passphrase,
        word_count=data.word_count,
        strength=strength,
    )


@router.post("/check-strength", response_model=PasswordStrengthResponse)
async def api_check_strength(
    data: PasswordStrengthRequest,
    current_user: CurrentUser,
):
    """Analyze password strength."""
    result = analyze_password(data.password)
    return PasswordStrengthResponse(**result)


@router.post("/check-breach", response_model=BreachCheckResponse)
async def api_check_breach(
    data: BreachCheckRequest,
    current_user: CurrentUser,
):
    """Check if a password has appeared in known data breaches."""
    result = await check_password_breach(data.password)
    return BreachCheckResponse(**result)
