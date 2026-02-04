"""MFA (Multi-Factor Authentication) utilities using TOTP."""

import base64
from io import BytesIO

import pyotp
import qrcode

from app.config import get_settings

settings = get_settings()


class MFAService:
    """MFA service for TOTP operations."""

    @staticmethod
    def generate_secret() -> str:
        """Generate a new TOTP secret."""
        return pyotp.random_base32()

    @staticmethod
    def get_totp(secret: str) -> pyotp.TOTP:
        """Get TOTP instance for a secret."""
        return pyotp.TOTP(secret)

    @staticmethod
    def verify_code(secret: str, code: str) -> bool:
        """Verify a TOTP code against a secret."""
        totp = MFAService.get_totp(secret)
        return totp.verify(code)

    @staticmethod
    def get_provisioning_uri(secret: str, email: str) -> str:
        """Get provisioning URI for authenticator apps."""
        totp = MFAService.get_totp(secret)
        return totp.provisioning_uri(name=email, issuer_name=settings.mfa_issuer)

    @staticmethod
    def generate_qr_code_base64(provisioning_uri: str) -> str:
        """Generate QR code as base64 string for provisioning URI."""
        qr = qrcode.QRCode(version=1, box_size=10, border=5)
        qr.add_data(provisioning_uri)
        qr.make(fit=True)

        img = qr.make_image(fill_color="black", back_color="white")

        buffer = BytesIO()
        img.save(buffer, format="PNG")
        buffer.seek(0)

        return base64.b64encode(buffer.getvalue()).decode("utf-8")

    @staticmethod
    def setup_mfa(email: str) -> dict:
        """Set up MFA for a user, returning secret and QR code."""
        secret = MFAService.generate_secret()
        provisioning_uri = MFAService.get_provisioning_uri(secret, email)
        qr_code_base64 = MFAService.generate_qr_code_base64(provisioning_uri)

        return {
            "secret": secret,
            "provisioning_uri": provisioning_uri,
            "qr_code_base64": qr_code_base64,
        }
