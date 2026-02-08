"""Tests for audit log service."""

import json
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit_log import AuditAction
from app.services.audit_log import AuditLogService

# Use valid UUIDs for testing (SQLite doesn't enforce FK constraints by default)
USER_ID_1 = str(uuid4())
USER_ID_2 = str(uuid4())


class TestAuditLogService:
    """Test AuditLogService functions."""

    @pytest.mark.asyncio
    async def test_log_creates_entry(self, db_session: AsyncSession):
        """Test that log() creates an audit log entry."""
        service = AuditLogService(db_session)

        entry = await service.log(
            action=AuditAction.LOGIN_SUCCESS,
            user_id=USER_ID_1,
            ip_address="100.64.1.1",
        )

        assert entry.id is not None
        assert entry.action == AuditAction.LOGIN_SUCCESS
        assert entry.user_id == USER_ID_1
        assert entry.ip_address == "100.64.1.1"

    @pytest.mark.asyncio
    async def test_log_with_details(self, db_session: AsyncSession):
        """Test that log() stores JSON details."""
        service = AuditLogService(db_session)

        details = {"email": "test@example.com", "method": "password"}
        entry = await service.log(
            action=AuditAction.LOGIN_FAILURE,
            details=details,
        )

        assert entry.details is not None
        parsed = json.loads(entry.details)
        assert parsed["email"] == "test@example.com"

    @pytest.mark.asyncio
    async def test_log_with_resource(self, db_session: AsyncSession):
        """Test that log() stores resource info."""
        service = AuditLogService(db_session)

        entry = await service.log(
            action=AuditAction.CREDENTIAL_CREATED,
            user_id=USER_ID_1,
            resource_type="credential",
            resource_id="cred-123",
            details={"name": "My Credential"},
        )

        assert entry.resource_type == "credential"
        assert entry.resource_id == "cred-123"

    @pytest.mark.asyncio
    async def test_list_logs_empty(self, db_session: AsyncSession):
        """Test listing logs when empty."""
        service = AuditLogService(db_session)

        logs = await service.list_logs()
        assert logs == []

    @pytest.mark.asyncio
    async def test_list_logs_returns_entries(self, db_session: AsyncSession):
        """Test listing logs returns created entries."""
        service = AuditLogService(db_session)

        await service.log(action=AuditAction.LOGIN_SUCCESS, user_id=USER_ID_1)
        await service.log(action=AuditAction.LOGIN_FAILURE, user_id=USER_ID_2)
        await service.log(action=AuditAction.CREDENTIAL_CREATED, user_id=USER_ID_1)

        logs = await service.list_logs()
        assert len(logs) == 3

    @pytest.mark.asyncio
    async def test_list_logs_filter_by_user(self, db_session: AsyncSession):
        """Test filtering logs by user_id."""
        service = AuditLogService(db_session)

        await service.log(action=AuditAction.LOGIN_SUCCESS, user_id=USER_ID_1)
        await service.log(action=AuditAction.LOGIN_SUCCESS, user_id=USER_ID_2)
        await service.log(action=AuditAction.CREDENTIAL_CREATED, user_id=USER_ID_1)

        logs = await service.list_logs(user_id=USER_ID_1)
        assert len(logs) == 2
        assert all(log.user_id == USER_ID_1 for log in logs)

    @pytest.mark.asyncio
    async def test_list_logs_filter_by_action(self, db_session: AsyncSession):
        """Test filtering logs by action type."""
        service = AuditLogService(db_session)

        await service.log(action=AuditAction.LOGIN_SUCCESS, user_id=USER_ID_1)
        await service.log(action=AuditAction.LOGIN_FAILURE)
        await service.log(action=AuditAction.LOGIN_SUCCESS, user_id=USER_ID_2)

        logs = await service.list_logs(action=AuditAction.LOGIN_SUCCESS)
        assert len(logs) == 2

    @pytest.mark.asyncio
    async def test_list_logs_filter_by_resource_type(self, db_session: AsyncSession):
        """Test filtering logs by resource type."""
        service = AuditLogService(db_session)

        await service.log(
            action=AuditAction.CREDENTIAL_CREATED,
            resource_type="credential",
            resource_id="c-1",
        )
        await service.log(
            action=AuditAction.USER_CREATED,
            resource_type="user",
            resource_id="u-1",
        )

        logs = await service.list_logs(resource_type="credential")
        assert len(logs) == 1
        assert logs[0].resource_type == "credential"

    @pytest.mark.asyncio
    async def test_list_logs_pagination(self, db_session: AsyncSession):
        """Test log listing respects skip and limit."""
        service = AuditLogService(db_session)

        for i in range(5):
            await service.log(action=AuditAction.LOGIN_FAILURE)

        logs = await service.list_logs(skip=0, limit=2)
        assert len(logs) == 2

        logs = await service.list_logs(skip=3, limit=10)
        assert len(logs) == 2

    @pytest.mark.asyncio
    async def test_log_nullable_user_id(self, db_session: AsyncSession):
        """Test that log works with null user_id (e.g., failed login)."""
        service = AuditLogService(db_session)

        entry = await service.log(
            action=AuditAction.LOGIN_FAILURE,
            details={"email": "unknown@example.com"},
        )

        assert entry.user_id is None
        assert entry.action == AuditAction.LOGIN_FAILURE
