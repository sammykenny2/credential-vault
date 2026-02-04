"""Credential service for business logic."""

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.credential import Credential
from src.schemas.credential import CredentialCreate, CredentialUpdate


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

    async def create(self, owner_id: str, data: CredentialCreate) -> Credential:
        """Create a new credential."""
        credential = Credential(
            owner_id=owner_id,
            name=data.name,
            description=data.description,
            website_url=data.website_url,
            category=data.category,
            encrypted_data=data.encrypted_data,
        )
        self.db.add(credential)
        await self.db.flush()
        await self.db.refresh(credential)
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
        return credential

    async def delete(self, credential: Credential) -> None:
        """Permanently delete a credential."""
        await self.db.delete(credential)
        await self.db.flush()

    async def search(
        self,
        owner_id: str,
        query: str,
        skip: int = 0,
        limit: int = 100,
    ) -> list[Credential]:
        """Search credentials by name or description."""
        search_term = f"%{query}%"
        result = await self.db.execute(
            select(Credential)
            .where(
                Credential.owner_id == owner_id,
                Credential.is_active == True,  # noqa: E712
                (Credential.name.ilike(search_term) | Credential.description.ilike(search_term)),
            )
            .offset(skip)
            .limit(limit)
            .order_by(Credential.name)
        )
        return list(result.scalars().all())
