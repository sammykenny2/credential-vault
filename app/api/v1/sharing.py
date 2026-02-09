"""Credential sharing endpoints."""

from fastapi import APIRouter, HTTPException, Request, status

from app.api.deps import CurrentUser, DbSession
from app.models.audit_log import AuditAction
from app.schemas.sharing import ShareCreate, ShareUpdate
from app.services.audit_log import AuditLogService
from app.services.sharing import SharingService

router = APIRouter()


@router.post("/", status_code=status.HTTP_201_CREATED)
async def share_credential(
    request: Request,
    data: ShareCreate,
    current_user: CurrentUser,
    db: DbSession,
):
    """Share a credential with another user."""
    service = SharingService(db)
    try:
        share = await service.share_credential(current_user.id, data)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )

    audit_service = AuditLogService(db)
    await audit_service.log_from_request(
        request,
        action=AuditAction.CREDENTIAL_UPDATED,
        user_id=current_user.id,
        resource_type="credential_share",
        resource_id=share.id,
        details={"credential_id": data.credential_id, "action": "shared"},
    )

    return {
        "id": share.id,
        "credential_id": share.credential_id,
        "shared_with_id": share.shared_with_id,
        "permission": share.permission.value,
        "created_at": share.created_at.isoformat(),
    }


@router.get("/by-me")
async def list_shared_by_me(
    current_user: CurrentUser,
    db: DbSession,
):
    """List credentials I've shared with others."""
    service = SharingService(db)
    return await service.list_shared_by_me(current_user.id)


@router.get("/with-me")
async def list_shared_with_me(
    current_user: CurrentUser,
    db: DbSession,
):
    """List credentials shared with me."""
    service = SharingService(db)
    return await service.list_shared_with_me(current_user.id)


@router.patch("/{share_id}")
async def update_share(
    share_id: str,
    data: ShareUpdate,
    current_user: CurrentUser,
    db: DbSession,
):
    """Update sharing permissions."""
    service = SharingService(db)
    share = await service.update_share(share_id, current_user.id, data)
    if not share:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Share not found",
        )
    return {
        "id": share.id,
        "permission": share.permission.value,
        "is_active": share.is_active,
    }


@router.delete("/{share_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_share(
    request: Request,
    share_id: str,
    current_user: CurrentUser,
    db: DbSession,
):
    """Revoke a shared credential."""
    service = SharingService(db)
    success = await service.revoke_share(share_id, current_user.id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Share not found",
        )

    audit_service = AuditLogService(db)
    await audit_service.log_from_request(
        request,
        action=AuditAction.CREDENTIAL_UPDATED,
        user_id=current_user.id,
        resource_type="credential_share",
        resource_id=share_id,
        details={"action": "revoked"},
    )
