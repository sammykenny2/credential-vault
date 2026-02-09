"""Backup and restore endpoints."""

from fastapi import APIRouter, HTTPException, status

from app.api.deps import CurrentUser, DbSession
from app.schemas.backup import BackupCreate, RestoreRequest
from app.services.backup import BackupService

router = APIRouter()


@router.post("/create")
async def create_backup(
    data: BackupCreate,
    current_user: CurrentUser,
    db: DbSession,
):
    """Create an encrypted backup of all user data."""
    service = BackupService(db)
    result = await service.create_backup(
        user_id=current_user.id,
        password=data.encryption_password,
        include_credentials=data.include_credentials,
        include_templates=data.include_templates,
        include_totp=data.include_totp_accounts,
    )
    return result


@router.post("/restore")
async def restore_backup(
    data: RestoreRequest,
    current_user: CurrentUser,
    db: DbSession,
):
    """Restore from an encrypted backup."""
    service = BackupService(db)
    try:
        result = await service.restore_backup(
            user_id=current_user.id,
            encrypted_data=data.encrypted_data,
            password=data.encryption_password,
            overwrite_existing=data.overwrite_existing,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    return result
