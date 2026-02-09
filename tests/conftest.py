"""Pytest configuration and fixtures."""

import asyncio
from collections.abc import AsyncGenerator, Generator
from typing import Any

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import Settings, get_settings
from app.db.session import get_db
from app.main import app
from app.models.base import Base

# Test database URL (in-memory SQLite for testing)
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"


def get_test_settings() -> Settings:
    """Override settings for testing."""
    return Settings(
        app_env="testing",
        app_debug=True,
        database_url=TEST_DATABASE_URL,
        secret_key="test-secret-key-for-testing-only",
        encryption_key="test-encryption-key-32-bytes!!",
        mfa_required=False,
    )


@pytest.fixture(scope="session")
def event_loop() -> Generator[asyncio.AbstractEventLoop, None, None]:
    """Create event loop for async tests."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="function")
async def test_engine():
    """Create test database engine."""
    engine = create_async_engine(
        TEST_DATABASE_URL,
        echo=False,
    )

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield engine

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

    await engine.dispose()


@pytest_asyncio.fixture(scope="function")
async def db_session(test_engine) -> AsyncGenerator[AsyncSession, None]:
    """Create test database session."""
    async_session = async_sessionmaker(
        test_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    async with async_session() as session:
        yield session


@pytest_asyncio.fixture(scope="function")
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """Create test HTTP client."""

    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_settings] = get_test_settings

    # Disable rate limiting for tests
    if hasattr(app.state, "limiter"):
        app.state.limiter.enabled = False

    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport, base_url="http://test", follow_redirects=True
    ) as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest.fixture
def test_user_data() -> dict[str, Any]:
    """Sample user data for testing."""
    return {
        "email": "test@example.com",
        "display_name": "Test User",
        "password": "TestP@ssw0rd!",
    }


@pytest.fixture
def test_credential_data() -> dict[str, Any]:
    """Sample credential data for testing."""
    return {
        "name": "Test Credential",
        "description": "A test credential",
        "website_url": "https://example.com",
        "category": "testing",
        # Pure key-value fields
        "fields": {
            "Username": "testuser",
            "Password": "testpass123",
        },
        "notes": "Some notes",
    }


@pytest.fixture
def test_template_data() -> dict[str, Any]:
    """Sample template data for testing."""
    return {
        "name": "Test Template",
        "description": "A test template",
        "icon": "🔑",
        "category": "testing",
        "fields": [
            {"key": "username", "isSecret": False, "required": True},
            {"key": "password", "isSecret": True, "required": True},
            {"key": "notes", "isSecret": False},
        ],
    }
