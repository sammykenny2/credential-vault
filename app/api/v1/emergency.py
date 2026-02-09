"""Emergency access endpoints."""

from fastapi import APIRouter, HTTPException, Request, status

from app.api.deps import CurrentUser, DbSession
from app.schemas.emergency import EmergencyAccessCreate
from app.services.emergency import EmergencyAccessService

router = APIRouter()


@router.post("/grant", status_code=status.HTTP_201_CREATED)
async def create_emergency_grant(
    data: EmergencyAccessCreate,
    current_user: CurrentUser,
    db: DbSession,
):
    """Create an emergency access grant for a trusted contact."""
    service = EmergencyAccessService(db)
    try:
        grant = await service.create_grant(
            grantor_id=current_user.id,
            grantee_email=data.grantee_email,
            wait_time_days=data.wait_time_days,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )

    return {
        "id": grant.id,
        "grantee_id": grant.grantee_id,
        "status": grant.status.value,
        "wait_time_days": grant.wait_time_days,
        "created_at": grant.created_at.isoformat(),
    }


@router.get("/granted-by-me")
async def list_my_grants(
    current_user: CurrentUser,
    db: DbSession,
):
    """List emergency access I've granted to others."""
    service = EmergencyAccessService(db)
    return await service.list_my_grants(current_user.id)


@router.get("/granted-to-me")
async def list_granted_to_me(
    current_user: CurrentUser,
    db: DbSession,
):
    """List emergency access others have granted to me."""
    service = EmergencyAccessService(db)
    return await service.list_granted_to_me(current_user.id)


@router.post("/{grant_id}/initiate-recovery")
async def initiate_recovery(
    grant_id: str,
    current_user: CurrentUser,
    db: DbSession,
):
    """Initiate emergency recovery (starts the waiting period)."""
    service = EmergencyAccessService(db)
    try:
        grant = await service.initiate_recovery(grant_id, current_user.id)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )

    return {
        "id": grant.id,
        "status": grant.status.value,
        "recovery_initiated_at": grant.recovery_initiated_at.isoformat(),
        "recovery_deadline": grant.recovery_deadline.isoformat(),
    }


@router.post("/{grant_id}/approve")
async def approve_recovery(
    grant_id: str,
    current_user: CurrentUser,
    db: DbSession,
    encrypted_key: str = "",
):
    """Approve a recovery request (grantor approves before deadline)."""
    service = EmergencyAccessService(db)
    try:
        grant = await service.approve_recovery(grant_id, current_user.id, encrypted_key)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )

    return {
        "id": grant.id,
        "status": grant.status.value,
    }


@router.post("/{grant_id}/reject")
async def reject_recovery(
    grant_id: str,
    current_user: CurrentUser,
    db: DbSession,
):
    """Reject a recovery request."""
    service = EmergencyAccessService(db)
    try:
        grant = await service.reject_recovery(grant_id, current_user.id)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )

    return {
        "id": grant.id,
        "status": grant.status.value,
    }


@router.delete("/{grant_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_grant(
    grant_id: str,
    current_user: CurrentUser,
    db: DbSession,
):
    """Revoke an emergency access grant."""
    service = EmergencyAccessService(db)
    success = await service.revoke_grant(grant_id, current_user.id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Grant not found",
        )
