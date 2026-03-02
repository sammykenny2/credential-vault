"""Credential service for business logic."""

import logging
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.credential import Credential
from app.schemas.credential import CredentialCreate, CredentialUpdate

logger = logging.getLogger(__name__)


class CredentialService:
    """Service for credential operations."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_by_id(self, credential_id: str, owner_id: str) -> Credential | None:
        """Get credential by ID (only if owned by user)."""
        result = await self.db.execute(
            select(Credential).where(
                Credential.id == credential_id,
                Credential.owner_id == owner_id,
            )
        )
        return result.scalar_one_or_none()

    async def list_by_owner(
        self,
        owner_id: str,
        skip: int = 0,
        limit: int = 100,
        include_revoked: bool = False,
    ) -> list[Credential]:
        """List all credentials for a user."""
        query = select(Credential).where(Credential.owner_id == owner_id)

        if not include_revoked:
            query = query.where(Credential.is_active == True)  # noqa: E712

        query = query.offset(skip).limit(limit).order_by(Credential.created_at.desc())
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_expiring(
        self,
        owner_id: str,
        days: int = 30,
    ) -> list[Credential]:
        """Get credentials expiring within the given number of days."""
        from datetime import timedelta

        now = datetime.now(UTC)
        deadline = now + timedelta(days=days)
        result = await self.db.execute(
            select(Credential)
            .where(
                Credential.owner_id == owner_id,
                Credential.is_active == True,  # noqa: E712
                Credential.expires_at != None,  # noqa: E711
                Credential.expires_at <= deadline,
            )
            .order_by(Credential.expires_at)
        )
        return list(result.scalars().all())

    async def export_all(self, owner_id: str) -> list[dict]:
        """Export all active credentials for a user."""
        credentials = await self.list_by_owner(owner_id, limit=10000)
        return [
            {
                "encrypted_data": c.encrypted_data,
                "expires_at": c.expires_at.isoformat() if c.expires_at else None,
            }
            for c in credentials
        ]

    async def import_credentials(self, owner_id: str, credentials_data: list[dict]) -> dict:
        """Import credentials from exported data."""
        imported = 0
        skipped = 0
        errors = []

        for cred_data in credentials_data:
            try:
                expires_at = None
                if cred_data.get("expires_at"):
                    expires_at = datetime.fromisoformat(cred_data["expires_at"])

                credential = Credential(
                    owner_id=owner_id,
                    encrypted_data=cred_data["encrypted_data"],
                    expires_at=expires_at,
                )
                self.db.add(credential)
                imported += 1
            except Exception as e:
                errors.append(f"Failed to import credential: {str(e)}")

        if imported > 0:
            await self.db.flush()

        logger.info(
            "Import complete for %s: %d imported, %d errors",
            owner_id,
            imported,
            len(errors),
        )
        return {"imported": imported, "skipped": skipped, "errors": errors}

    async def create(self, owner_id: str, data: CredentialCreate) -> Credential:
        """Create a new credential."""
        credential = Credential(
            owner_id=owner_id,
            encrypted_data=data.encrypted_data,
            expires_at=data.expires_at,
        )
        self.db.add(credential)
        await self.db.flush()
        await self.db.refresh(credential)
        logger.info("Credential created: %s (owner=%s)", credential.id, owner_id)
        return credential

    async def update(
        self,
        credential: Credential,
        data: CredentialUpdate,
    ) -> Credential:
        """Update a credential."""
        update_data = data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(credential, field, value)
        await self.db.flush()
        await self.db.refresh(credential)
        return credential

    async def revoke(self, credential: Credential) -> Credential:
        """Revoke (soft delete) a credential."""
        credential.is_active = False
        credential.revoked_at = datetime.now(UTC)
        await self.db.flush()
        await self.db.refresh(credential)
        logger.info("Credential revoked: %s", credential.id)
        return credential

    async def delete(self, credential: Credential) -> None:
        """Permanently delete a credential."""
        cred_id = credential.id
        await self.db.delete(credential)
        await self.db.flush()
        logger.info("Credential deleted: %s", cred_id)
