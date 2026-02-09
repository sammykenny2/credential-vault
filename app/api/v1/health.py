"""Credential health dashboard endpoint."""

from fastapi import APIRouter

from app.api.deps import CurrentUser, DbSession
from app.services.credential_health import CredentialHealthService

router = APIRouter()


@router.get("/")
async def get_credential_health(
    current_user: CurrentUser,
    db: DbSession,
):
    """Get credential health summary for the current user.

    Returns overall security score, strength distribution,
    duplicate passwords, expiring credentials, and actionable issues.
    """
    service = CredentialHealthService(db)
    return await service.get_health_summary(current_user.id)
