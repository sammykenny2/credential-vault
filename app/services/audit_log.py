"""Audit log service for recording sensitive operations."""

import json
import logging

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.client_ip import get_client_ip
from app.models.audit_log import AuditAction, AuditLog

logger = logging.getLogger(__name__)


class AuditLogService:
    """Service for audit log operations."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def log(
        self,
        action: AuditAction,
        user_id: str | None = None,
        resource_type: str | None = None,
        resource_id: str | None = None,
        details: dict | None = None,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> AuditLog:
        """Record an audit log entry."""
        entry = AuditLog(
            user_id=user_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            details=json.dumps(details) if details else None,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        self.db.add(entry)
        await self.db.flush()
        return entry

    async def log_from_request(
        self,
        request: Request,
        action: AuditAction,
        user_id: str | None = None,
        resource_type: str | None = None,
        resource_id: str | None = None,
        details: dict | None = None,
    ) -> AuditLog:
        """Record an audit log entry with request metadata."""
        ip_address = self._get_client_ip(request)
        user_agent = request.headers.get("User-Agent", "")[:500]

        return await self.log(
            action=action,
            user_id=user_id,
            resource_type=resource_type,
            resource_id=resource_id,
            details=details,
            ip_address=ip_address,
            user_agent=user_agent,
        )

    async def list_logs(
        self,
        user_id: str | None = None,
        action: AuditAction | None = None,
        resource_type: str | None = None,
        skip: int = 0,
        limit: int = 50,
    ) -> list[AuditLog]:
        """List audit log entries with optional filters."""
        query = select(AuditLog)

        if user_id:
            query = query.where(AuditLog.user_id == user_id)
        if action:
            query = query.where(AuditLog.action == action)
        if resource_type:
            query = query.where(AuditLog.resource_type == resource_type)

        query = query.order_by(AuditLog.created_at.desc()).offset(skip).limit(limit)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    @staticmethod
    def _get_client_ip(request: Request) -> str:
        """Client address resolved through the trusted proxy chain only."""
        return get_client_ip(request)[:45]
