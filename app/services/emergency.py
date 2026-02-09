"""Emergency access service."""

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.emergency_access import EmergencyAccess, EmergencyStatus
from app.models.user import User

logger = logging.getLogger(__name__)


class EmergencyAccessService:
    """Service for emergency access operations."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create_grant(
        self, grantor_id: str, grantee_email: str, wait_time_days: int = 7
    ) -> EmergencyAccess:
        """Create an emergency access grant."""
        # Find grantee by email
        result = await self.db.execute(select(User).where(User.email == grantee_email))
        grantee = result.scalar_one_or_none()
        if not grantee:
            raise ValueError("User not found")

        if grantee.id == grantor_id:
            raise ValueError("Cannot grant emergency access to yourself")

        # Check for existing grant
        result = await self.db.execute(
            select(EmergencyAccess).where(
                EmergencyAccess.grantor_id == grantor_id,
                EmergencyAccess.grantee_id == grantee.id,
                EmergencyAccess.status.in_(
                    [
                        EmergencyStatus.INVITED,
                        EmergencyStatus.ACCEPTED,
                    ]
                ),
            )
        )
        existing = result.scalar_one_or_none()
        if existing:
            raise ValueError("Emergency access already configured for this user")

        grant = EmergencyAccess(
            grantor_id=grantor_id,
            grantee_id=grantee.id,
            wait_time_days=wait_time_days,
            status=EmergencyStatus.ACCEPTED,  # Auto-accept since grantor is creating
        )
        self.db.add(grant)
        await self.db.flush()
        await self.db.refresh(grant)

        logger.info(
            "Emergency access created: %s -> %s (wait=%d days)",
            grantor_id,
            grantee.email,
            wait_time_days,
        )
        return grant

    async def list_my_grants(self, user_id: str) -> list[dict]:
        """List emergency access I've granted to others."""
        result = await self.db.execute(
            select(EmergencyAccess, User)
            .join(User, EmergencyAccess.grantee_id == User.id)
            .where(
                EmergencyAccess.grantor_id == user_id,
                EmergencyAccess.status != EmergencyStatus.REVOKED,
            )
        )
        grants = []
        for grant, user in result.all():
            grants.append(
                {
                    "id": grant.id,
                    "grantee_email": user.email,
                    "grantee_name": user.display_name,
                    "status": grant.status.value,
                    "wait_time_days": grant.wait_time_days,
                    "recovery_initiated_at": (
                        grant.recovery_initiated_at.isoformat()
                        if grant.recovery_initiated_at
                        else None
                    ),
                    "recovery_deadline": (
                        grant.recovery_deadline.isoformat() if grant.recovery_deadline else None
                    ),
                    "created_at": grant.created_at.isoformat(),
                }
            )
        return grants

    async def list_granted_to_me(self, user_id: str) -> list[dict]:
        """List emergency access others have granted to me."""
        result = await self.db.execute(
            select(EmergencyAccess, User)
            .join(User, EmergencyAccess.grantor_id == User.id)
            .where(
                EmergencyAccess.grantee_id == user_id,
                EmergencyAccess.status != EmergencyStatus.REVOKED,
            )
        )
        grants = []
        for grant, user in result.all():
            grants.append(
                {
                    "id": grant.id,
                    "grantor_email": user.email,
                    "grantor_name": user.display_name,
                    "status": grant.status.value,
                    "wait_time_days": grant.wait_time_days,
                    "recovery_initiated_at": (
                        grant.recovery_initiated_at.isoformat()
                        if grant.recovery_initiated_at
                        else None
                    ),
                    "recovery_deadline": (
                        grant.recovery_deadline.isoformat() if grant.recovery_deadline else None
                    ),
                    "created_at": grant.created_at.isoformat(),
                }
            )
        return grants

    async def initiate_recovery(self, grant_id: str, grantee_id: str) -> EmergencyAccess:
        """Initiate recovery - starts the waiting period."""
        result = await self.db.execute(
            select(EmergencyAccess).where(
                EmergencyAccess.id == grant_id,
                EmergencyAccess.grantee_id == grantee_id,
                EmergencyAccess.status == EmergencyStatus.ACCEPTED,
            )
        )
        grant = result.scalar_one_or_none()
        if not grant:
            raise ValueError("Emergency access grant not found or not in accepted state")

        now = datetime.now(UTC)
        grant.status = EmergencyStatus.RECOVERY_INITIATED
        grant.recovery_initiated_at = now
        grant.recovery_deadline = now + timedelta(days=grant.wait_time_days)
        await self.db.flush()
        await self.db.refresh(grant)

        logger.info("Recovery initiated for grant %s", grant_id)
        return grant

    async def approve_recovery(
        self, grant_id: str, grantor_id: str, encrypted_key: str
    ) -> EmergencyAccess:
        """Approve recovery early (grantor approves before deadline)."""
        result = await self.db.execute(
            select(EmergencyAccess).where(
                EmergencyAccess.id == grant_id,
                EmergencyAccess.grantor_id == grantor_id,
                EmergencyAccess.status == EmergencyStatus.RECOVERY_INITIATED,
            )
        )
        grant = result.scalar_one_or_none()
        if not grant:
            raise ValueError("Recovery not found or not in initiated state")

        grant.status = EmergencyStatus.RECOVERY_APPROVED
        grant.encrypted_key = encrypted_key
        await self.db.flush()
        await self.db.refresh(grant)

        logger.info("Recovery approved for grant %s", grant_id)
        return grant

    async def reject_recovery(self, grant_id: str, grantor_id: str) -> EmergencyAccess:
        """Reject a recovery request."""
        result = await self.db.execute(
            select(EmergencyAccess).where(
                EmergencyAccess.id == grant_id,
                EmergencyAccess.grantor_id == grantor_id,
                EmergencyAccess.status == EmergencyStatus.RECOVERY_INITIATED,
            )
        )
        grant = result.scalar_one_or_none()
        if not grant:
            raise ValueError("Recovery not found or not in initiated state")

        grant.status = EmergencyStatus.RECOVERY_REJECTED
        grant.recovery_initiated_at = None
        grant.recovery_deadline = None
        await self.db.flush()
        await self.db.refresh(grant)

        logger.info("Recovery rejected for grant %s", grant_id)
        return grant

    async def revoke_grant(self, grant_id: str, grantor_id: str) -> bool:
        """Revoke an emergency access grant."""
        result = await self.db.execute(
            select(EmergencyAccess).where(
                EmergencyAccess.id == grant_id,
                EmergencyAccess.grantor_id == grantor_id,
            )
        )
        grant = result.scalar_one_or_none()
        if not grant:
            return False

        grant.status = EmergencyStatus.REVOKED
        await self.db.flush()

        logger.info("Emergency access %s revoked", grant_id)
        return True

    async def check_auto_approvals(self) -> list[EmergencyAccess]:
        """Check for grants that should be auto-approved (deadline passed)."""
        now = datetime.now(UTC)
        result = await self.db.execute(
            select(EmergencyAccess).where(
                EmergencyAccess.status == EmergencyStatus.RECOVERY_INITIATED,
                EmergencyAccess.recovery_deadline <= now,
            )
        )
        grants = list(result.scalars().all())

        for grant in grants:
            grant.status = EmergencyStatus.RECOVERY_APPROVED
            logger.info("Auto-approved emergency access %s (deadline passed)", grant.id)

        if grants:
            await self.db.flush()

        return grants
