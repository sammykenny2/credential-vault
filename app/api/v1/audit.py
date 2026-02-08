"""Audit log endpoints (admin only)."""

from fastapi import APIRouter, Query

from app.api.deps import AdminUser, DbSession
from app.models.audit_log import AuditAction
from app.schemas.audit_log import AuditLogRead
from app.services.audit_log import AuditLogService

router = APIRouter()


@router.get("/", response_model=list[AuditLogRead])
async def list_audit_logs(
    admin_user: AdminUser,
    db: DbSession,
    user_id: str | None = Query(None, description="Filter by user ID"),
    action: AuditAction | None = Query(None, description="Filter by action type"),
    resource_type: str | None = Query(None, description="Filter by resource type"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
):
    """List audit log entries (admin only)."""
    service = AuditLogService(db)
    logs = await service.list_logs(
        user_id=user_id,
        action=action,
        resource_type=resource_type,
        skip=skip,
        limit=limit,
    )
    return logs
