"""Audit log schemas."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.audit_log import AuditAction


class AuditLogRead(BaseModel):
    """Audit log read schema."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str | None
    action: AuditAction
    resource_type: str | None
    resource_id: str | None
    details: str | None
    ip_address: str | None
    user_agent: str | None
    created_at: datetime


class AuditLogQuery(BaseModel):
    """Query parameters for audit log listing."""

    user_id: str | None = None
    action: AuditAction | None = None
    resource_type: str | None = None
    skip: int = 0
    limit: int = 50
