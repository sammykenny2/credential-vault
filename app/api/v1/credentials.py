"""Credential management endpoints."""

from fastapi import APIRouter, HTTPException, Query, Request, status

from app.api.deps import CurrentUser, DbSession, VaultProvenUser, ensure_vault_proof
from app.models.audit_log import AuditAction
from app.schemas.credential import (
    CredentialCreate,
    CredentialImportRequest,
    CredentialImportResult,
    CredentialListItem,
    CredentialRead,
    CredentialUpdate,
)
from app.services.audit_log import AuditLogService
from app.services.credential import CredentialService

router = APIRouter()


@router.get("/", response_model=list[CredentialListItem])
async def list_credentials(
    current_user: CurrentUser,
    db: DbSession,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    include_revoked: bool = False,
):
    """List all credentials for current user.

    Returns encrypted_data for client-side decryption and search.
    """
    service = CredentialService(db)
    credentials = await service.list_by_owner(
        owner_id=current_user.id,
        skip=skip,
        limit=limit,
        include_revoked=include_revoked,
    )
    return credentials


@router.post("/", response_model=CredentialRead, status_code=status.HTTP_201_CREATED)
async def create_credential(
    request: Request,
    data: CredentialCreate,
    current_user: CurrentUser,
    db: DbSession,
):
    """Create a new credential.

    Clients generate the id themselves and bind the ciphertext to it, so a
    reused id is refused rather than silently replaced.
    """
    service = CredentialService(db)
    if data.id is not None and await service.exists(str(data.id)):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A credential with this id already exists",
        )
    credential = await service.create(owner_id=current_user.id, data=data)

    audit_service = AuditLogService(db)
    await audit_service.log_from_request(
        request,
        action=AuditAction.CREDENTIAL_CREATED,
        user_id=current_user.id,
        resource_type="credential",
        resource_id=credential.id,
    )

    return credential


@router.get("/expiring", response_model=list[CredentialListItem])
async def get_expiring_credentials(
    current_user: CurrentUser,
    db: DbSession,
    days: int = Query(30, ge=1, le=365),
):
    """Get credentials expiring within the given number of days."""
    service = CredentialService(db)
    return await service.get_expiring(owner_id=current_user.id, days=days)


@router.get("/export")
async def export_credentials(
    current_user: CurrentUser,
    db: DbSession,
):
    """Export all credentials as JSON."""
    service = CredentialService(db)
    data = await service.export_all(current_user.id)
    return {"credentials": data, "count": len(data)}


@router.post("/import", response_model=CredentialImportResult)
async def import_credentials(
    request: Request,
    data: CredentialImportRequest,
    current_user: CurrentUser,
    db: DbSession,
):
    """Import credentials from JSON."""
    service = CredentialService(db)
    creds_data = [c.model_dump() for c in data.credentials]
    result = await service.import_credentials(current_user.id, creds_data)

    audit_service = AuditLogService(db)
    await audit_service.log_from_request(
        request,
        action=AuditAction.CREDENTIAL_CREATED,
        user_id=current_user.id,
        resource_type="credential",
        details={"action": "import", "count": result["imported"]},
    )

    return CredentialImportResult(**result)


@router.get("/{credential_id}", response_model=CredentialRead)
async def get_credential(
    request: Request,
    credential_id: str,
    current_user: CurrentUser,
    db: DbSession,
):
    """Get credential by ID (includes encrypted data)."""
    service = CredentialService(db)
    credential = await service.get_by_id(credential_id, owner_id=current_user.id)

    if not credential:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Credential not found",
        )

    audit_service = AuditLogService(db)
    await audit_service.log_from_request(
        request,
        action=AuditAction.CREDENTIAL_READ,
        user_id=current_user.id,
        resource_type="credential",
        resource_id=credential.id,
    )

    return credential


@router.patch("/{credential_id}", response_model=CredentialRead)
async def update_credential(
    request: Request,
    credential_id: str,
    data: CredentialUpdate,
    current_user: CurrentUser,
    db: DbSession,
):
    """Update a credential.

    Replacing the ciphertext is destructive (the old blob is gone), so it
    requires proof of vault unlock like a delete. Metadata-only changes such
    as the expiry date do not.
    """
    service = CredentialService(db)
    credential = await service.get_by_id(credential_id, owner_id=current_user.id)

    if not credential:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Credential not found",
        )

    if data.encrypted_data is not None:
        ensure_vault_proof(request, current_user)

    updated = await service.update(credential, data)

    audit_service = AuditLogService(db)
    await audit_service.log_from_request(
        request,
        action=AuditAction.CREDENTIAL_UPDATED,
        user_id=current_user.id,
        resource_type="credential",
        resource_id=credential.id,
    )

    return updated


@router.post("/{credential_id}/revoke", response_model=CredentialRead)
async def revoke_credential(
    request: Request,
    credential_id: str,
    current_user: CurrentUser,
    db: DbSession,
):
    """Revoke (soft delete) a credential."""
    service = CredentialService(db)
    credential = await service.get_by_id(credential_id, owner_id=current_user.id)

    if not credential:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Credential not found",
        )

    if not credential.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Credential is already revoked",
        )

    revoked = await service.revoke(credential)

    audit_service = AuditLogService(db)
    await audit_service.log_from_request(
        request,
        action=AuditAction.CREDENTIAL_REVOKED,
        user_id=current_user.id,
        resource_type="credential",
        resource_id=credential.id,
    )

    return revoked


@router.delete("/{credential_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_credential(
    request: Request,
    credential_id: str,
    current_user: VaultProvenUser,
    db: DbSession,
):
    """Permanently delete a credential (requires X-Vault-Proof, see /auth/vault/challenge)."""
    service = CredentialService(db)
    credential = await service.get_by_id(credential_id, owner_id=current_user.id)

    if not credential:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Credential not found",
        )

    await service.delete(credential)

    audit_service = AuditLogService(db)
    await audit_service.log_from_request(
        request,
        action=AuditAction.CREDENTIAL_DELETED,
        user_id=current_user.id,
        resource_type="credential",
        resource_id=credential_id,
    )
