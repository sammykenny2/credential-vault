"""Credential management endpoints."""

from fastapi import APIRouter, HTTPException, Query, status

from app.api.deps import CurrentUser, DbSession
from app.schemas.credential import (
    CredentialCreate,
    CredentialListItem,
    CredentialRead,
    CredentialUpdate,
)
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
    """List all credentials for current user."""
    service = CredentialService(db)
    credentials = await service.list_by_owner(
        owner_id=current_user.id,
        skip=skip,
        limit=limit,
        include_revoked=include_revoked,
    )
    return credentials


@router.get("/search", response_model=list[CredentialListItem])
async def search_credentials(
    current_user: CurrentUser,
    db: DbSession,
    q: str = Query(min_length=1),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
):
    """Search credentials by name or description."""
    service = CredentialService(db)
    credentials = await service.search(
        owner_id=current_user.id,
        query=q,
        skip=skip,
        limit=limit,
    )
    return credentials


@router.post("/", response_model=CredentialRead, status_code=status.HTTP_201_CREATED)
async def create_credential(
    data: CredentialCreate,
    current_user: CurrentUser,
    db: DbSession,
):
    """Create a new credential."""
    service = CredentialService(db)
    credential = await service.create(owner_id=current_user.id, data=data)
    return credential


@router.get("/{credential_id}", response_model=CredentialRead)
async def get_credential(
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

    return credential


@router.patch("/{credential_id}", response_model=CredentialRead)
async def update_credential(
    credential_id: str,
    data: CredentialUpdate,
    current_user: CurrentUser,
    db: DbSession,
):
    """Update a credential."""
    service = CredentialService(db)
    credential = await service.get_by_id(credential_id, owner_id=current_user.id)

    if not credential:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Credential not found",
        )

    updated = await service.update(credential, data)
    return updated


@router.post("/{credential_id}/revoke", response_model=CredentialRead)
async def revoke_credential(
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
    return revoked


@router.delete("/{credential_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_credential(
    credential_id: str,
    current_user: CurrentUser,
    db: DbSession,
):
    """Permanently delete a credential."""
    service = CredentialService(db)
    credential = await service.get_by_id(credential_id, owner_id=current_user.id)

    if not credential:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Credential not found",
        )

    await service.delete(credential)
