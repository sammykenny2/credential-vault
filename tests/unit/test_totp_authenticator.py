"""Tests for built-in TOTP authenticator service."""

import pytest
import pyotp

from app.services.totp_service import TOTPService


class TestTOTPServiceStatic:
    """Tests for TOTPService static methods."""

    def test_generate_code_default(self):
        """Test TOTP code generation with default settings."""
        secret = pyotp.random_base32()
        result = TOTPService.generate_code(secret)

        assert "code" in result
        assert len(result["code"]) == 6
        assert result["code"].isdigit()
        assert 0 < result["remaining_seconds"] <= 30
        assert result["period"] == 30

    def test_generate_code_8_digits(self):
        """Test 8-digit TOTP code generation."""
        secret = pyotp.random_base32()
        result = TOTPService.generate_code(secret, digits=8)

        assert len(result["code"]) == 8
        assert result["code"].isdigit()

    def test_generate_code_custom_period(self):
        """Test custom period TOTP."""
        secret = pyotp.random_base32()
        result = TOTPService.generate_code(secret, period=60)

        assert result["period"] == 60
        assert 0 < result["remaining_seconds"] <= 60

    def test_generate_code_verifiable(self):
        """Test that generated code can be verified."""
        secret = pyotp.random_base32()
        result = TOTPService.generate_code(secret)

        totp = pyotp.TOTP(secret)
        assert totp.verify(result["code"])

    def test_generate_code_different_algorithms(self):
        """Test code generation with different hash algorithms."""
        secret = pyotp.random_base32()

        for algo in ["sha1"]:
            result = TOTPService.generate_code(secret, algorithm=algo)
            assert len(result["code"]) == 6
