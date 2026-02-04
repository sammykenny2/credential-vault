"""Tests for MFA utilities."""

import pytest

from src.core.mfa import MFAService


class TestMFAService:
    """Test MFA service functions."""

    def test_generate_secret(self):
        """Test generating a TOTP secret."""
        secret = MFAService.generate_secret()

        assert isinstance(secret, str)
        assert len(secret) == 32  # Base32 encoded, 160 bits

    def test_generate_secret_unique(self):
        """Test that each generated secret is unique."""
        secrets = [MFAService.generate_secret() for _ in range(10)]
        assert len(set(secrets)) == 10

    def test_verify_code_correct(self):
        """Test verifying a correct TOTP code."""
        secret = MFAService.generate_secret()
        totp = MFAService.get_totp(secret)
        current_code = totp.now()

        assert MFAService.verify_code(secret, current_code) is True

    def test_verify_code_incorrect(self):
        """Test verifying an incorrect TOTP code."""
        secret = MFAService.generate_secret()

        # Invalid code (all zeros is extremely unlikely to be correct)
        assert MFAService.verify_code(secret, "000000") is False

    def test_verify_code_invalid_format(self):
        """Test verifying a code with invalid format."""
        secret = MFAService.generate_secret()

        # Non-numeric code
        assert MFAService.verify_code(secret, "abcdef") is False

        # Too short
        assert MFAService.verify_code(secret, "123") is False

    def test_get_provisioning_uri(self):
        """Test generating a provisioning URI."""
        secret = MFAService.generate_secret()
        email = "test@example.com"

        uri = MFAService.get_provisioning_uri(secret, email)

        assert isinstance(uri, str)
        assert uri.startswith("otpauth://totp/")
        assert email in uri
        assert "CredentialVault" in uri  # issuer

    def test_generate_qr_code_base64(self):
        """Test generating a QR code as base64."""
        secret = MFAService.generate_secret()
        uri = MFAService.get_provisioning_uri(secret, "test@example.com")

        qr_base64 = MFAService.generate_qr_code_base64(uri)

        assert isinstance(qr_base64, str)
        assert len(qr_base64) > 0
        # Should be valid base64 (no padding issues)
        import base64
        try:
            decoded = base64.b64decode(qr_base64)
            # PNG files start with specific bytes
            assert decoded[:4] == b'\x89PNG'
        except Exception:
            pytest.fail("QR code is not valid base64-encoded PNG")

    def test_setup_mfa(self):
        """Test the complete MFA setup flow."""
        email = "test@example.com"
        result = MFAService.setup_mfa(email)

        assert "secret" in result
        assert "provisioning_uri" in result
        assert "qr_code_base64" in result

        assert len(result["secret"]) == 32
        assert result["provisioning_uri"].startswith("otpauth://")
        assert len(result["qr_code_base64"]) > 0
