"""Built-in TOTP authenticator service.

Allows users to store TOTP secrets and generate codes,
effectively replacing the need for a separate authenticator app.
"""

import logging
import time

import pyotp
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.totp_account import TOTPAccount
from app.schemas.totp import TOTPAccountCreate, TOTPAccountUpdate

logger = logging.getLogger(__name__)


class TOTPService:
    """Service for built-in TOTP authenticator operations."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create_account(self, user_id: str, data: TOTPAccountCreate) -> TOTPAccount:
        """Add a new TOTP account."""
        account = TOTPAccount(
            user_id=user_id,
            encrypted_secret=data.encrypted_secret,
            issuer=data.issuer,
            account_name=data.account_name,
            algorithm=data.algorithm,
            digits=data.digits,
            period=data.period,
            credential_id=data.credential_id,
            icon=data.icon,
        )
        self.db.add(account)
        await self.db.flush()
        await self.db.refresh(account)

        logger.info(
            "TOTP account created: %s:%s for user %s",
            data.issuer,
            data.account_name,
            user_id,
        )
        return account

    async def list_accounts(self, user_id: str) -> list[TOTPAccount]:
        """List all TOTP accounts for a user."""
        result = await self.db.execute(
            select(TOTPAccount)
            .where(TOTPAccount.user_id == user_id)
            .order_by(TOTPAccount.issuer, TOTPAccount.account_name)
        )
        return list(result.scalars().all())

    async def get_account(self, account_id: str, user_id: str) -> TOTPAccount | None:
        """Get a specific TOTP account."""
        result = await self.db.execute(
            select(TOTPAccount).where(
                TOTPAccount.id == account_id,
                TOTPAccount.user_id == user_id,
            )
        )
        return result.scalar_one_or_none()

    async def update_account(
        self, account_id: str, user_id: str, data: TOTPAccountUpdate
    ) -> TOTPAccount | None:
        """Update a TOTP account."""
        account = await self.get_account(account_id, user_id)
        if not account:
            return None

        update_data = data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(account, field, value)

        await self.db.flush()
        await self.db.refresh(account)
        return account

    async def delete_account(self, account_id: str, user_id: str) -> bool:
        """Delete a TOTP account."""
        account = await self.get_account(account_id, user_id)
        if not account:
            return False

        await self.db.delete(account)
        await self.db.flush()
        logger.info("TOTP account deleted: %s", account_id)
        return True

    @staticmethod
    def generate_code(
        secret: str,
        algorithm: str = "SHA1",
        digits: int = 6,
        period: int = 30,
    ) -> dict:
        """Generate a TOTP code from a plaintext secret.

        Args:
            secret: Base32-encoded TOTP secret.
            algorithm: Hash algorithm (SHA1, SHA256, SHA512).
            digits: Number of digits (6 or 8).
            period: Time period in seconds.

        Returns:
            Dictionary with code, remaining seconds, and period.
        """
        totp = pyotp.TOTP(secret, digest=algorithm.lower(), digits=digits, interval=period)
        code = totp.now()

        # Calculate remaining seconds
        current_time = int(time.time())
        remaining = period - (current_time % period)

        return {
            "code": code,
            "remaining_seconds": remaining,
            "period": period,
        }
