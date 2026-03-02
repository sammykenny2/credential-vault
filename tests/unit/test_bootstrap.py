"""Tests for bootstrap service."""

from unittest.mock import patch

import pytest

from app.models.user import UserRole
from app.services.bootstrap import BootstrapService


@pytest.mark.asyncio
async def test_has_any_admin_returns_false_when_no_admin(db_session):
    """Test has_any_admin returns False when no admin exists."""
    bootstrap = BootstrapService(db_session)
    result = await bootstrap.has_any_admin()
    assert result is False


@pytest.mark.asyncio
async def test_has_any_admin_returns_true_when_admin_exists(db_session, test_user):
    """Test has_any_admin returns True when admin exists."""
    # Promote test user to admin
    test_user.role = UserRole.ADMIN
    await db_session.flush()

    bootstrap = BootstrapService(db_session)
    result = await bootstrap.has_any_admin()
    assert result is True


@pytest.mark.asyncio
async def test_check_admin_bootstrap_with_existing_admin(db_session, test_user):
    """Test check_admin_bootstrap logs debug when admin exists."""
    test_user.role = UserRole.ADMIN
    await db_session.flush()

    bootstrap = BootstrapService(db_session)
    # Should not raise — just logs "Admin user already exists"
    await bootstrap.check_admin_bootstrap()


@pytest.mark.asyncio
async def test_check_admin_bootstrap_with_admin_email_no_password(db_session):
    """Test check_admin_bootstrap logs info when ADMIN_EMAIL is set but no password."""
    bootstrap = BootstrapService(db_session)

    with (
        patch.object(bootstrap.settings, "admin_email", "admin@example.com"),
        patch.object(bootstrap.settings, "admin_password", None),
    ):
        # Should not raise — logs auto-promotion message
        await bootstrap.check_admin_bootstrap()


@pytest.mark.asyncio
async def test_check_admin_bootstrap_with_admin_password(db_session):
    """Test check_admin_bootstrap creates admin when ADMIN_EMAIL and ADMIN_PASSWORD are set."""
    from sqlalchemy import select

    from app.models.user import User

    bootstrap = BootstrapService(db_session)

    with (
        patch.object(bootstrap.settings, "admin_email", "admin@example.com"),
        patch.object(bootstrap.settings, "admin_password", "test-password-123"),
        patch.object(bootstrap.settings, "admin_display_name", "Test Admin"),
    ):
        await bootstrap.check_admin_bootstrap()

    # Verify admin was created with hashed password
    result = await db_session.execute(
        select(User).where(User.email == "admin@example.com")
    )
    admin = result.scalar_one_or_none()
    assert admin is not None
    assert admin.role == UserRole.ADMIN
    assert admin.hashed_password is not None


@pytest.mark.asyncio
async def test_check_admin_bootstrap_without_admin_email(db_session):
    """Test check_admin_bootstrap logs warning when ADMIN_EMAIL not set."""
    bootstrap = BootstrapService(db_session)

    with patch.object(bootstrap.settings, "admin_email", None):
        # Should not raise — logs warning about missing ADMIN_EMAIL
        await bootstrap.check_admin_bootstrap()
