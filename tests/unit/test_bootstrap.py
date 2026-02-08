"""Tests for bootstrap service."""

import pytest
from unittest.mock import patch, AsyncMock

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
async def test_create_initial_admin_skips_when_admin_exists(db_session, test_user):
    """Test create_initial_admin skips when admin already exists."""
    test_user.role = UserRole.ADMIN
    await db_session.flush()

    bootstrap = BootstrapService(db_session)
    result = await bootstrap.create_initial_admin()
    assert result is None


@pytest.mark.asyncio
async def test_create_initial_admin_skips_when_env_not_set(db_session):
    """Test create_initial_admin skips when env vars not set."""
    bootstrap = BootstrapService(db_session)

    with patch.object(bootstrap.settings, 'admin_email', None):
        with patch.object(bootstrap.settings, 'admin_password', None):
            result = await bootstrap.create_initial_admin()
            assert result is None


@pytest.mark.asyncio
async def test_create_initial_admin_creates_admin(db_session):
    """Test create_initial_admin creates admin from env vars."""
    bootstrap = BootstrapService(db_session)

    with patch.object(bootstrap.settings, 'admin_email', 'newadmin@example.com'):
        with patch.object(bootstrap.settings, 'admin_password', 'S3cure@Pass!23'):
            with patch.object(bootstrap.settings, 'admin_display_name', 'Test Admin'):
                result = await bootstrap.create_initial_admin()

                assert result is not None
                assert result.email == 'newadmin@example.com'
                assert result.role == UserRole.ADMIN
                assert result.display_name == 'Test Admin'


@pytest.mark.asyncio
async def test_create_initial_admin_promotes_existing_user(db_session, test_user):
    """Test create_initial_admin promotes existing user to admin."""
    bootstrap = BootstrapService(db_session)

    with patch.object(bootstrap.settings, 'admin_email', test_user.email):
        with patch.object(bootstrap.settings, 'admin_password', 'anypassword'):
            result = await bootstrap.create_initial_admin()

            assert result is not None
            assert result.id == test_user.id
            assert result.role == UserRole.ADMIN
