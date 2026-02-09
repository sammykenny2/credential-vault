"""Credential sharing service."""

import logging
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.credential import Credential
from app.models.credential_share import CredentialShare, SharePermission
from app.models.user import User
from app.schemas.sharing import ShareCreate, ShareUpdate

logger = logging.getLogger(__name__)


class SharingService:
    """Service for credential sharing operations."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def share_credential(self, shared_by_id: str, data: ShareCreate) -> CredentialShare:
        """Share a credential with another user."""
        # Find the target user by email
        result = await self.db.execute(
            select(User).where(User.email == data.shared_with_email)
        )
        target_user = result.scalar_one_or_none()
        if not target_user:
            raise ValueError("User not found")

        if target_user.id == shared_by_id:
            raise ValueError("Cannot share with yourself")

        # Check credential ownership
        result = await self.db.execute(
            select(Credential).where(
                Credential.id == data.credential_id,
                Credential.owner_id == shared_by_id,
                Credential.is_active == True,  # noqa: E712
            )
        )
        credential = result.scalar_one_or_none()
        if not credential:
            raise ValueError("Credential not found or not owned by you")

        # Check if already shared
        result = await self.db.execute(
            select(CredentialShare).where(
                CredentialShare.credential_id == data.credential_id,
                CredentialShare.shared_with_id == target_user.id,
                CredentialShare.is_active == True,  # noqa: E712
            )
        )
        existing = result.scalar_one_or_none()
        if existing:
            raise ValueError("Already shared with this user")

        share = CredentialShare(
            credential_id=data.credential_id,
            shared_by_id=shared_by_id,
            shared_with_id=target_user.id,
            encrypted_data=data.encrypted_data,
            permission=data.permission,
            accepted_at=datetime.now(UTC),
        )
        self.db.add(share)
        await self.db.flush()
        await self.db.refresh(share)

        logger.info(
            "Credential %s shared with %s by %s",
            data.credential_id, target_user.email, shared_by_id,
        )
        return share

    async def list_shared_by_me(self, user_id: str) -> list[dict]:
        """List credentials I've shared with others."""
        result = await self.db.execute(
            select(CredentialShare, Credential, User)
            .join(Credential, CredentialShare.credential_id == Credential.id)
            .join(User, CredentialShare.shared_with_id == User.id)
            .where(
                CredentialShare.shared_by_id == user_id,
                CredentialShare.is_active == True,  # noqa: E712
            )
        )
        shares = []
        for share, credential, user in result.all():
            shares.append({
                "id": share.id,
                "credential_id": share.credential_id,
                "credential_name": credential.name,
                "shared_with_email": user.email,
                "shared_with_name": user.display_name,
                "permission": share.permission.value,
                "created_at": share.created_at.isoformat(),
            })
        return shares

    async def list_shared_with_me(self, user_id: str) -> list[dict]:
        """List credentials shared with me."""
        result = await self.db.execute(
            select(CredentialShare, Credential, User)
            .join(Credential, CredentialShare.credential_id == Credential.id)
            .join(User, CredentialShare.shared_by_id == User.id)
            .where(
                CredentialShare.shared_with_id == user_id,
                CredentialShare.is_active == True,  # noqa: E712
            )
        )
        shares = []
        for share, credential, user in result.all():
            shares.append({
                "id": share.id,
                "credential_id": share.credential_id,
                "credential_name": credential.name,
                "description": credential.description,
                "category": credential.category,
                "encrypted_data": share.encrypted_data,
                "permission": share.permission.value,
                "shared_by_email": user.email,
                "shared_by_name": user.display_name,
                "shared_at": share.created_at.isoformat(),
            })
        return shares

    async def revoke_share(self, share_id: str, user_id: str) -> bool:
        """Revoke a shared credential."""
        result = await self.db.execute(
            select(CredentialShare).where(
                CredentialShare.id == share_id,
                CredentialShare.shared_by_id == user_id,
            )
        )
        share = result.scalar_one_or_none()
        if not share:
            return False

        share.is_active = False
        share.revoked_at = datetime.now(UTC)
        await self.db.flush()
        logger.info("Share %s revoked by %s", share_id, user_id)
        return True

    async def update_share(
        self, share_id: str, user_id: str, data: ShareUpdate
    ) -> CredentialShare | None:
        """Update sharing permissions."""
        result = await self.db.execute(
            select(CredentialShare).where(
                CredentialShare.id == share_id,
                CredentialShare.shared_by_id == user_id,
            )
        )
        share = result.scalar_one_or_none()
        if not share:
            return None

        if data.permission is not None:
            share.permission = data.permission
        if data.is_active is not None:
            share.is_active = data.is_active
            if not data.is_active:
                share.revoked_at = datetime.now(UTC)

        await self.db.flush()
        await self.db.refresh(share)
        return share
