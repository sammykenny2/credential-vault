"""Credential health analysis service.

With E2EE, the server cannot decrypt credential data. Health analysis is limited to:
- Credential count
- Expired/expiring credentials
- Basic metadata-based scoring

Password strength analysis must be done client-side.
"""

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.credential import Credential

logger = logging.getLogger(__name__)


class CredentialHealthService:
    """Analyzes the health/security of a user's credentials (metadata only)."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_health_summary(self, owner_id: str) -> dict:
        """Get health summary based on credential metadata.

        Note: With E2EE, password strength/duplicate analysis must be done client-side.
        Server can only analyze non-encrypted metadata (expiration, counts).
        Credential name is encrypted and not available server-side.
        """
        result = await self.db.execute(
            select(Credential).where(
                Credential.owner_id == owner_id,
                Credential.is_active == True,  # noqa: E712
            )
        )
        credentials = list(result.scalars().all())

        total = len(credentials)
        if total == 0:
            return {
                "total_credentials": 0,
                "overall_score": 100,
                "strength_distribution": {
                    "very_strong": 0,
                    "strong": 0,
                    "fair": 0,
                    "weak": 0,
                    "very_weak": 0,
                },
                "duplicate_groups": [],
                "duplicate_count": 0,
                "expiring_soon": [],
                "expired": [],
                "weak_credentials": [],
                "reused_passwords": 0,
                "avg_strength_score": 0,
                "issues": [],
            }

        now = datetime.now(UTC)
        expiring_soon = []
        expired_list = []

        for cred in credentials:
            if cred.expires_at:
                if cred.expires_at < now:
                    expired_list.append(
                        {
                            "id": cred.id,
                            "expired_at": cred.expires_at.isoformat(),
                        }
                    )
                elif cred.expires_at < now + timedelta(days=30):
                    expiring_soon.append(
                        {
                            "id": cred.id,
                            "expires_at": cred.expires_at.isoformat(),
                            "days_left": (cred.expires_at - now).days,
                        }
                    )

        # Issues summary
        issues = []
        if expired_list:
            issues.append(f"{len(expired_list)} credential(s) have expired")
        if expiring_soon:
            issues.append(f"{len(expiring_soon)} credential(s) expiring within 30 days")

        # Score based on metadata only (expiration)
        expire_penalty = min(40, (len(expired_list) * 10 + len(expiring_soon) * 5))
        overall_score = max(0, min(100, 100 - expire_penalty))

        return {
            "total_credentials": total,
            "overall_score": overall_score,
            # Password analysis not available server-side with E2EE
            "strength_distribution": {
                "very_strong": 0,
                "strong": 0,
                "fair": 0,
                "weak": 0,
                "very_weak": 0,
            },
            "duplicate_groups": [],
            "duplicate_count": 0,
            "expiring_soon": expiring_soon[:10],
            "expired": expired_list[:10],
            "weak_credentials": [],
            "reused_passwords": 0,
            "avg_strength_score": 0,
            "issues": issues,
        }
