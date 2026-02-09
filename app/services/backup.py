"""Backup and restore service.

Provides encrypted backup/restore for credentials, templates, and TOTP accounts.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
from datetime import UTC, datetime
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.credential import Credential
from app.models.template import Template
from app.models.totp_account import TOTPAccount

logger = logging.getLogger(__name__)
settings = get_settings()

BACKUP_VERSION = "1.0"
NONCE_SIZE = 12


def _derive_key(password: str, salt: bytes | None = None) -> tuple[bytes, bytes]:
    """Derive encryption key from password using PBKDF2."""
    import secrets

    if salt is None:
        salt = secrets.token_bytes(16)
    key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 100_000)
    return key, salt


def _encrypt_backup(data: str, password: str) -> str:
    """Encrypt backup data with password."""
    import secrets

    key, salt = _derive_key(password)
    nonce = secrets.token_bytes(NONCE_SIZE)
    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(nonce, data.encode("utf-8"), None)
    # Format: salt (16) + nonce (12) + ciphertext
    raw = salt + nonce + ciphertext
    return base64.b64encode(raw).decode("ascii")


def _decrypt_backup(encrypted: str, password: str) -> str:
    """Decrypt backup data with password."""
    raw = base64.b64decode(encrypted.encode("ascii"))
    salt = raw[:16]
    nonce = raw[16 : 16 + NONCE_SIZE]
    ciphertext = raw[16 + NONCE_SIZE :]
    key, _ = _derive_key(password, salt)
    aesgcm = AESGCM(key)
    plaintext = aesgcm.decrypt(nonce, ciphertext, None)
    return plaintext.decode("utf-8")


class BackupService:
    """Service for backup and restore operations."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create_backup(
        self,
        user_id: str,
        password: str,
        include_credentials: bool = True,
        include_templates: bool = True,
        include_totp: bool = True,
    ) -> dict:
        """Create an encrypted backup of user data."""
        backup_data: dict[str, Any] = {
            "version": BACKUP_VERSION,
            "created_at": datetime.now(UTC).isoformat(),
            "app_version": settings.app_version,
        }

        cred_count = 0
        template_count = 0
        totp_count = 0

        if include_credentials:
            cred_result = await self.db.execute(
                select(Credential).where(
                    Credential.owner_id == user_id,
                    Credential.is_active == True,  # noqa: E712
                )
            )
            credentials = cred_result.scalars().all()
            backup_data["credentials"] = [
                {
                    "name": c.name,
                    "description": c.description,
                    "website_url": c.website_url,
                    "category": c.category,
                    "encrypted_data": c.encrypted_data,
                    "expires_at": c.expires_at.isoformat() if c.expires_at else None,
                    "created_at": c.created_at.isoformat(),
                }
                for c in credentials
            ]
            cred_count = len(backup_data["credentials"])

        if include_templates:
            tmpl_result = await self.db.execute(
                select(Template).where(
                    Template.owner_id == user_id,
                    Template.is_active == True,  # noqa: E712
                )
            )
            templates = tmpl_result.scalars().all()
            backup_data["templates"] = [
                {
                    "name": t.name,
                    "description": t.description,
                    "icon": t.icon,
                    "category": t.category,
                    "fields": t.fields,
                }
                for t in templates
            ]
            template_count = len(backup_data["templates"])

        if include_totp:
            totp_result = await self.db.execute(
                select(TOTPAccount).where(TOTPAccount.user_id == user_id)
            )
            totp_accounts = totp_result.scalars().all()
            backup_data["totp_accounts"] = [
                {
                    "issuer": a.issuer,
                    "account_name": a.account_name,
                    "encrypted_secret": a.encrypted_secret,
                    "algorithm": a.algorithm,
                    "digits": a.digits,
                    "period": a.period,
                    "icon": a.icon,
                }
                for a in totp_accounts
            ]
            totp_count = len(backup_data["totp_accounts"])

        # Encrypt the backup
        encrypted = _encrypt_backup(json.dumps(backup_data), password)

        metadata = {
            "version": BACKUP_VERSION,
            "created_at": datetime.now(UTC).isoformat(),
            "app_version": settings.app_version,
            "credential_count": cred_count,
            "template_count": template_count,
            "totp_account_count": totp_count,
        }

        logger.info(
            "Backup created for user %s: %d creds, %d templates, %d TOTP",
            user_id,
            cred_count,
            template_count,
            totp_count,
        )

        return {
            "metadata": metadata,
            "encrypted_data": encrypted,
        }

    async def restore_backup(
        self,
        user_id: str,
        encrypted_data: str,
        password: str,
        overwrite_existing: bool = False,
    ) -> dict:
        """Restore from an encrypted backup."""
        try:
            decrypted = _decrypt_backup(encrypted_data, password)
            backup_data = json.loads(decrypted)
        except Exception as e:
            raise ValueError(f"Failed to decrypt backup: {e}") from e

        errors = []
        creds_restored = 0
        templates_restored = 0
        totp_restored = 0

        # Restore credentials
        if "credentials" in backup_data:
            if overwrite_existing:
                # Delete existing credentials
                from sqlalchemy import delete

                await self.db.execute(delete(Credential).where(Credential.owner_id == user_id))

            for cred_data in backup_data["credentials"]:
                try:
                    from datetime import datetime as dt

                    expires_at = None
                    if cred_data.get("expires_at"):
                        expires_at = dt.fromisoformat(cred_data["expires_at"])

                    credential = Credential(
                        owner_id=user_id,
                        name=cred_data["name"],
                        description=cred_data.get("description"),
                        website_url=cred_data.get("website_url"),
                        category=cred_data.get("category"),
                        encrypted_data=cred_data["encrypted_data"],
                        expires_at=expires_at,
                    )
                    self.db.add(credential)
                    creds_restored += 1
                except Exception as e:
                    cred_name = cred_data.get("name", "unknown")
                    errors.append(f"Failed to restore credential '{cred_name}': {e}")

        # Restore templates
        if "templates" in backup_data:
            if overwrite_existing:
                from sqlalchemy import delete

                await self.db.execute(delete(Template).where(Template.owner_id == user_id))

            for tmpl_data in backup_data["templates"]:
                try:
                    template = Template(
                        owner_id=user_id,
                        name=tmpl_data["name"],
                        description=tmpl_data.get("description"),
                        icon=tmpl_data.get("icon"),
                        category=tmpl_data.get("category"),
                        fields=tmpl_data.get("fields", []),
                    )
                    self.db.add(template)
                    templates_restored += 1
                except Exception as e:
                    tmpl_name = tmpl_data.get("name", "unknown")
                    errors.append(f"Failed to restore template '{tmpl_name}': {e}")

        # Restore TOTP accounts
        if "totp_accounts" in backup_data:
            if overwrite_existing:
                from sqlalchemy import delete

                await self.db.execute(delete(TOTPAccount).where(TOTPAccount.user_id == user_id))

            for totp_data in backup_data["totp_accounts"]:
                try:
                    account = TOTPAccount(
                        user_id=user_id,
                        issuer=totp_data["issuer"],
                        account_name=totp_data["account_name"],
                        encrypted_secret=totp_data["encrypted_secret"],
                        algorithm=totp_data.get("algorithm", "SHA1"),
                        digits=totp_data.get("digits", 6),
                        period=totp_data.get("period", 30),
                        icon=totp_data.get("icon"),
                    )
                    self.db.add(account)
                    totp_restored += 1
                except Exception as e:
                    totp_issuer = totp_data.get("issuer", "unknown")
                    errors.append(f"Failed to restore TOTP '{totp_issuer}': {e}")

        await self.db.flush()

        logger.info(
            "Backup restored for user %s: %d creds, %d templates, %d TOTP, %d errors",
            user_id,
            creds_restored,
            templates_restored,
            totp_restored,
            len(errors),
        )

        return {
            "credentials_restored": creds_restored,
            "templates_restored": templates_restored,
            "totp_accounts_restored": totp_restored,
            "errors": errors,
        }
