"""Credential service for business logic."""

import logging
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.credential import Credential
from app.schemas.credential import (
    CredentialCreate,
    CredentialRevoke,
    CredentialUpdate,
    RecordAdoption,
)

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

    async def exists(self, credential_id: str) -> bool:
        """True when a credential with this id exists (any owner)."""
        result = await self.db.execute(select(Credential.id).where(Credential.id == credential_id))
        return result.scalar_one_or_none() is not None

    async def export_all(self, owner_id: str) -> list[dict]:
        """Export all active credentials for a user."""
        credentials = await self.list_by_owner(owner_id, limit=10000)
        return [
            {
                "id": c.id,
                "encrypted_data": c.encrypted_data,
                "expires_at": c.expires_at.isoformat() if c.expires_at else None,
                "revision": c.revision,
                "signature": c.signature,
                "signature_version": c.signature_version,
                "origin": c.origin,
            }
            for c in credentials
        ]

    async def import_credentials(self, owner_id: str, credentials_data: list[dict]) -> dict:
        """Import signed credentials, skipping ids that already exist."""
        imported = 0
        skipped = 0
        errors = []
        seen_ids: set[str] = set()

        for cred_data in credentials_data:
            try:
                client_id = str(cred_data["id"])
                if client_id in seen_ids or await self.exists(client_id):
                    skipped += 1
                    continue
                seen_ids.add(client_id)

                self.db.add(
                    Credential(
                        id=client_id,
                        owner_id=owner_id,
                        encrypted_data=cred_data["encrypted_data"],
                        expires_at=cred_data.get("expires_at"),
                        revision=1,
                        signature=cred_data["signature"],
                        signature_version=cred_data["signature_version"],
                        origin=cred_data["origin"],
                    )
                )
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
        """Create a new signed credential at revision 1."""
        credential = Credential(
            id=str(data.id),
            owner_id=owner_id,
            encrypted_data=data.encrypted_data,
            expires_at=data.expires_at,
            revision=1,
            signature=data.signature,
            signature_version=data.signature_version,
            origin=data.origin,
        )
        self.db.add(credential)
        await self.db.flush()
        await self.db.refresh(credential)
        logger.info("Credential created: %s (owner=%s)", credential.id, owner_id)
        return credential

    async def _apply_signed_state(
        self,
        credential: Credential,
        revision: int,
        values: dict,
    ) -> bool:
        """Write a signed state if `revision` still directly follows the stored one.

        A conditional UPDATE rather than read-then-write: SQLite SELECTs run
        outside a write transaction, so two writers holding the same revision
        would both pass a check made in Python.
        """
        result = await self.db.execute(
            update(Credential)
            .where(
                Credential.id == credential.id,
                Credential.owner_id == credential.owner_id,
                Credential.revision == revision - 1,
            )
            .values(revision=revision, **values)
        )
        return bool(result.rowcount == 1)  # type: ignore[attr-defined]

    async def update(self, credential: Credential, data: CredentialUpdate) -> bool:
        """Apply a signed update. False when the revision no longer matches."""
        values = data.model_dump(exclude_unset=True, include={"encrypted_data", "expires_at"})
        # An explicit null means "keep the ciphertext"; the column cannot be empty.
        if values.get("encrypted_data") is None:
            values.pop("encrypted_data", None)
        values.update(
            signature=data.signature,
            signature_version=data.signature_version,
            origin=data.origin,
        )
        return await self._apply_signed_state(credential, data.revision, values)

    async def revoke(self, credential: Credential, data: CredentialRevoke) -> bool:
        """Apply a signed revocation. False when the revision no longer matches."""
        applied = await self._apply_signed_state(
            credential,
            data.revision,
            {
                "is_active": False,
                "revoked_at": data.revoked_at,
                "signature": data.signature,
                "signature_version": data.signature_version,
                "origin": data.origin,
            },
        )
        if applied:
            logger.info("Credential revoked: %s", credential.id)
        return applied

    async def adopt_all(self, owner_id: str, adoptions: list[RecordAdoption]) -> bool:
        """Store upgrade signatures, all or nothing.

        False when the adoptions do not cover exactly the stored records at the
        revisions the browser saw, for example because a record was added while
        the upgrade was being prepared. The caller rolls back on False.
        """
        rows = await self.db.execute(
            select(Credential.id, Credential.revision).where(Credential.owner_id == owner_id)
        )
        current = {row.id: row.revision for row in rows}
        wanted = {str(item.id): item for item in adoptions}
        if len(wanted) != len(adoptions) or set(wanted) != set(current):
            return False
        if any(item.revision != current[cred_id] + 1 for cred_id, item in wanted.items()):
            return False

        for cred_id, item in wanted.items():
            result = await self.db.execute(
                update(Credential)
                .where(
                    Credential.id == cred_id,
                    Credential.owner_id == owner_id,
                    Credential.revision == item.revision - 1,
                )
                .values(
                    revision=item.revision,
                    signature=item.signature,
                    signature_version=item.signature_version,
                    origin=item.origin,
                )
            )
            if result.rowcount != 1:  # type: ignore[attr-defined]
                return False
        return True

    async def delete(self, credential: Credential) -> None:
        """Permanently delete a credential."""
        cred_id = credential.id
        await self.db.delete(credential)
        await self.db.flush()
        logger.info("Credential deleted: %s", cred_id)
