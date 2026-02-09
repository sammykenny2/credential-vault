"""Credential health analysis service.

Provides a dashboard view of credential security posture:
- Password strength distribution
- Duplicate password detection
- Expired/expiring credentials
- Overall security score
"""

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import decrypt_data
from app.core.password_strength import analyze_password
from app.models.credential import Credential

logger = logging.getLogger(__name__)


class CredentialHealthService:
    """Analyzes the health/security of a user's credentials."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_health_summary(self, owner_id: str) -> dict:
        """Get comprehensive health summary for a user's credentials.

        Returns:
            Dictionary with health metrics and overall score.
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

        # Analyze each credential
        password_hashes: dict[str, list[str]] = {}
        strength_dist = {"very_strong": 0, "strong": 0, "fair": 0, "weak": 0, "very_weak": 0}
        weak_creds = []
        strength_scores = []
        now = datetime.now(UTC)
        expiring_soon = []
        expired_list = []

        for cred in credentials:
            try:
                decrypted = decrypt_data(cred.encrypted_data)
                fields = decrypted.get("fields", {})

                # Find password-like fields
                password_value = None
                for key, value in fields.items():
                    key_lower = key.lower()
                    pw_terms = ["password", "secret", "key", "token", "pass"]
                    if any(term in key_lower for term in pw_terms):
                        password_value = value
                        break

                if password_value:
                    # Strength analysis
                    analysis = analyze_password(password_value)
                    level = analysis["level"]
                    strength_dist[level] += 1
                    strength_scores.append(analysis["score"])

                    if level in ("weak", "very_weak"):
                        weak_creds.append(
                            {
                                "id": cred.id,
                                "name": cred.name,
                                "score": analysis["score"],
                                "level": level,
                            }
                        )

                    # Duplicate detection (using hash for privacy)
                    import hashlib

                    pw_hash = hashlib.sha256(password_value.encode()).hexdigest()
                    if pw_hash not in password_hashes:
                        password_hashes[pw_hash] = []
                    password_hashes[pw_hash].append(cred.name)

                # Check expiration
                expires_at = cred.expires_at if hasattr(cred, "expires_at") else None
                if expires_at:
                    if expires_at < now:
                        expired_list.append(
                            {
                                "id": cred.id,
                                "name": cred.name,
                                "expired_at": expires_at.isoformat(),
                            }
                        )
                    elif expires_at < now + timedelta(days=30):
                        expiring_soon.append(
                            {
                                "id": cred.id,
                                "name": cred.name,
                                "expires_at": expires_at.isoformat(),
                                "days_left": (expires_at - now).days,
                            }
                        )

            except Exception as e:
                logger.warning("Failed to analyze credential %s: %s", cred.id, str(e))
                continue

        # Duplicate groups (only groups with 2+ credentials)
        duplicate_groups = [
            {"password_hash": h[:8] + "...", "credentials": names}
            for h, names in password_hashes.items()
            if len(names) > 1
        ]
        reused_count = sum(len(g["credentials"]) for g in duplicate_groups)

        # Issues summary
        issues = []
        if weak_creds:
            issues.append(f"{len(weak_creds)} credential(s) have weak passwords")
        if duplicate_groups:
            issues.append(f"{len(duplicate_groups)} group(s) of reused passwords")
        if expired_list:
            issues.append(f"{len(expired_list)} credential(s) have expired")
        if expiring_soon:
            issues.append(f"{len(expiring_soon)} credential(s) expiring within 30 days")

        # Overall score calculation
        avg_strength = sum(strength_scores) / len(strength_scores) if strength_scores else 50
        reuse_penalty = min(30, len(duplicate_groups) * 10)
        expire_penalty = min(20, (len(expired_list) * 5 + len(expiring_soon) * 2))
        overall_score = max(0, min(100, int(avg_strength - reuse_penalty - expire_penalty)))

        return {
            "total_credentials": total,
            "overall_score": overall_score,
            "strength_distribution": strength_dist,
            "duplicate_groups": duplicate_groups[:10],  # Limit to 10 groups
            "duplicate_count": reused_count,
            "expiring_soon": expiring_soon[:10],
            "expired": expired_list[:10],
            "weak_credentials": weak_creds[:20],
            "reused_passwords": reused_count,
            "avg_strength_score": round(avg_strength, 1),
            "issues": issues,
        }
