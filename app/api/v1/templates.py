"""Template management endpoints."""

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import JSONResponse

from app.api.deps import CurrentUser, DbSession
from app.schemas.template import (
    RecordUsageRequest,
    RecordUsageResponse,
    SyncRequest,
    SyncResponse,
    TemplateCreate,
    TemplateListItem,
    TemplateListResponse,
    TemplateRead,
    TemplateUpdate,
    TemplateUsageResponse,
    VersionConflictResponse,
)
from app.services.template import TemplateService, VersionConflictError

router = APIRouter()


# ==================== Template CRUD ====================


@router.get("/", response_model=TemplateListResponse)
async def list_templates(
    current_user: CurrentUser,
    db: DbSession,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    category: str | None = None,
    include_inactive: bool = False,
):
    """List all templates for current user."""
    service = TemplateService(db)
    templates = await service.list_by_owner(
        owner_id=current_user.id,
        skip=skip,
        limit=limit,
        category=category,
        include_inactive=include_inactive,
    )
    total = await service.count_by_owner(
        owner_id=current_user.id,
        include_inactive=include_inactive,
    )
    return TemplateListResponse(
        templates=[TemplateListItem.model_validate(t) for t in templates],
        total=total,
    )


@router.post("/", response_model=TemplateRead, status_code=status.HTTP_201_CREATED)
async def create_template(
    data: TemplateCreate,
    current_user: CurrentUser,
    db: DbSession,
):
    """Create a new template."""
    service = TemplateService(db)

    # Check for duplicate name
    existing = await service.get_by_name(data.name, current_user.id)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Template with name '{data.name}' already exists",
        )

    template = await service.create(owner_id=current_user.id, data=data)
    return template


@router.get("/{template_id}", response_model=TemplateRead)
async def get_template(
    template_id: str,
    current_user: CurrentUser,
    db: DbSession,
):
    """Get template by ID."""
    service = TemplateService(db)
    template = await service.get_by_id(template_id, owner_id=current_user.id)

    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Template not found",
        )

    return template


@router.patch(
    "/{template_id}",
    response_model=TemplateRead,
    responses={409: {"model": VersionConflictResponse}},
)
async def update_template(
    template_id: str,
    data: TemplateUpdate,
    current_user: CurrentUser,
    db: DbSession,
):
    """Update a template.

    Requires sync_version for optimistic locking.
    Returns 409 Conflict if version mismatch.
    """
    service = TemplateService(db)
    template = await service.get_by_id(template_id, owner_id=current_user.id)

    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Template not found",
        )

    # Check for duplicate name if name is being changed
    if data.name and data.name != template.name:
        existing = await service.get_by_name(data.name, current_user.id)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Template with name '{data.name}' already exists",
            )

    try:
        updated = await service.update(template, data)
        return updated
    except VersionConflictError as e:
        # Return 409 with server data for conflict resolution
        conflict_response = VersionConflictResponse(
            detail="Version conflict",
            server_version=e.server_version,
            client_version=e.client_version,
            server_data=TemplateRead.model_validate(e.template),
        )
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content=conflict_response.model_dump(mode="json"),
        )


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template(
    template_id: str,
    current_user: CurrentUser,
    db: DbSession,
    hard_delete: bool = Query(False, description="Permanently delete instead of soft delete"),
):
    """Delete a template.

    By default, performs soft delete (sets is_active=False).
    Use hard_delete=true to permanently remove.
    """
    service = TemplateService(db)
    template = await service.get_by_id(template_id, owner_id=current_user.id)

    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Template not found",
        )

    if hard_delete:
        await service.hard_delete(template)
    else:
        if not template.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Template is already deleted",
            )
        await service.soft_delete(template)


# ==================== Usage Tracking ====================


@router.post("/{template_id}/use", response_model=RecordUsageResponse)
async def record_template_usage(
    template_id: str,
    current_user: CurrentUser,
    db: DbSession,
    data: RecordUsageRequest | None = None,
):
    """Record template usage.

    Optionally link to a credential that was created from this template.
    """
    service = TemplateService(db)
    template = await service.get_by_id(template_id, owner_id=current_user.id)

    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Template not found",
        )

    credential_id = data.credential_id if data else None
    use_count = await service.record_usage(
        template_id=template_id,
        user_id=current_user.id,
        credential_id=credential_id,
    )

    return RecordUsageResponse(template_id=template_id, use_count=use_count)


@router.get("/usage/stats", response_model=TemplateUsageResponse)
async def get_usage_stats(
    current_user: CurrentUser,
    db: DbSession,
):
    """Get usage statistics for all templates."""
    service = TemplateService(db)
    stats = await service.get_usage_stats(owner_id=current_user.id)
    return TemplateUsageResponse(usage=stats)


# ==================== Sync/Migration ====================


@router.post("/sync", response_model=SyncResponse)
async def sync_templates(
    data: SyncRequest,
    current_user: CurrentUser,
    db: DbSession,
):
    """Sync templates from localStorage to backend.

    Used for migrating existing templates when user enables backend sync.
    Templates with duplicate names will be skipped.
    """
    service = TemplateService(db)
    result = await service.batch_sync(owner_id=current_user.id, data=data)
    return result
