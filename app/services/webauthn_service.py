"""WebAuthn/Passkey service.

Provides registration and authentication using FIDO2/WebAuthn credentials.
Supports security keys (YubiKey) and platform authenticators (Touch ID, Windows Hello).
"""

import base64
import logging
import secrets
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.webauthn_credential import WebAuthnCredential

logger = logging.getLogger(__name__)
settings = get_settings()


def _b64url_decode(data: str) -> bytes:
    """Decode base64url string."""
    padding = 4 - len(data) % 4
    if padding != 4:
        data += "=" * padding
    return base64.urlsafe_b64decode(data)


def _b64url_encode(data: bytes) -> str:
    """Encode bytes to base64url string."""
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


class WebAuthnService:
    """Service for WebAuthn operations."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def generate_registration_options(self, user_id: str, user_email: str) -> dict:
        """Generate WebAuthn registration options for the client."""
        # Generate a challenge
        challenge = secrets.token_bytes(32)

        # Get existing credentials for this user (to exclude)
        result = await self.db.execute(
            select(WebAuthnCredential).where(
                WebAuthnCredential.user_id == user_id,
                WebAuthnCredential.is_active == True,  # noqa: E712
            )
        )
        existing_creds = result.scalars().all()

        exclude_credentials = [
            {
                "type": "public-key",
                "id": _b64url_encode(cred.credential_id),
            }
            for cred in existing_creds
        ]

        options = {
            "challenge": _b64url_encode(challenge),
            "rp": {
                "name": settings.app_name,
                "id": settings.ts_cert_domain or "localhost",
            },
            "user": {
                "id": _b64url_encode(user_id.encode()),
                "name": user_email,
                "displayName": user_email,
            },
            "pubKeyCredParams": [
                {"type": "public-key", "alg": -7},  # ES256
                {"type": "public-key", "alg": -257},  # RS256
            ],
            "timeout": 60000,
            "attestation": "none",
            "authenticatorSelection": {
                "residentKey": "preferred",
                "userVerification": "preferred",
            },
            "excludeCredentials": exclude_credentials,
        }

        return {
            "options": options,
            "challenge": _b64url_encode(challenge),
        }

    async def register_credential(
        self,
        user_id: str,
        device_name: str,
        credential_id_b64: str,
        public_key_b64: str,
        transports: list[str] | None = None,
    ) -> WebAuthnCredential:
        """Register a new WebAuthn credential.

        Note: In a production system, you would verify the attestation object
        and client data JSON. This simplified version stores the credential
        data for later authentication verification.
        """
        credential_id = _b64url_decode(credential_id_b64)
        public_key = _b64url_decode(public_key_b64)

        # Check for duplicate
        result = await self.db.execute(
            select(WebAuthnCredential).where(
                WebAuthnCredential.credential_id == credential_id,
            )
        )
        existing = result.scalar_one_or_none()
        if existing:
            raise ValueError("Credential already registered")

        webauthn_cred = WebAuthnCredential(
            user_id=user_id,
            credential_id=credential_id,
            public_key=public_key,
            device_name=device_name,
            transports=",".join(transports) if transports else None,
        )
        self.db.add(webauthn_cred)
        await self.db.flush()
        await self.db.refresh(webauthn_cred)

        logger.info("WebAuthn credential registered: %s for user %s", device_name, user_id)
        return webauthn_cred

    async def generate_authentication_options(self, user_id: str) -> dict:
        """Generate WebAuthn authentication options."""
        challenge = secrets.token_bytes(32)

        result = await self.db.execute(
            select(WebAuthnCredential).where(
                WebAuthnCredential.user_id == user_id,
                WebAuthnCredential.is_active == True,  # noqa: E712
            )
        )
        credentials = result.scalars().all()

        if not credentials:
            raise ValueError("No WebAuthn credentials registered")

        allow_credentials = [
            {
                "type": "public-key",
                "id": _b64url_encode(cred.credential_id),
                "transports": cred.transports.split(",") if cred.transports else [],
            }
            for cred in credentials
        ]

        return {
            "challenge": _b64url_encode(challenge),
            "timeout": 60000,
            "rpId": settings.ts_cert_domain or "localhost",
            "allowCredentials": allow_credentials,
            "userVerification": "preferred",
        }

    async def verify_authentication(
        self, credential_id_b64: str, user_id: str
    ) -> WebAuthnCredential | None:
        """Verify a WebAuthn authentication response.

        Note: Full verification requires checking the signature against
        the stored public key. This simplified version validates that
        the credential exists and belongs to the user.
        """
        credential_id = _b64url_decode(credential_id_b64)

        result = await self.db.execute(
            select(WebAuthnCredential).where(
                WebAuthnCredential.credential_id == credential_id,
                WebAuthnCredential.user_id == user_id,
                WebAuthnCredential.is_active == True,  # noqa: E712
            )
        )
        cred = result.scalar_one_or_none()

        if cred:
            cred.sign_count += 1
            cred.last_used_at = datetime.now(UTC)
            await self.db.flush()
            logger.info("WebAuthn authentication successful: %s", cred.device_name)

        return cred

    async def list_credentials(self, user_id: str) -> list[WebAuthnCredential]:
        """List all WebAuthn credentials for a user."""
        result = await self.db.execute(
            select(WebAuthnCredential)
            .where(
                WebAuthnCredential.user_id == user_id,
                WebAuthnCredential.is_active == True,  # noqa: E712
            )
            .order_by(WebAuthnCredential.created_at.desc())
        )
        return list(result.scalars().all())

    async def delete_credential(self, credential_db_id: str, user_id: str) -> bool:
        """Delete (deactivate) a WebAuthn credential."""
        result = await self.db.execute(
            select(WebAuthnCredential).where(
                WebAuthnCredential.id == credential_db_id,
                WebAuthnCredential.user_id == user_id,
            )
        )
        cred = result.scalar_one_or_none()
        if not cred:
            return False

        cred.is_active = False
        await self.db.flush()
        logger.info("WebAuthn credential deactivated: %s", cred.device_name)
        return True
