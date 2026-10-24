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
from app.models.user import User
from app.services.user import UserService

# Test database URL (in-memory SQLite for testing)
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"


def get_test_settings() -> Settings:
    """Override settings for testing."""
    return Settings(
        app_env="testing",
        app_debug=True,
        database_url=TEST_DATABASE_URL,
        secret_key="test-secret-key-for-testing-only",
        google_client_id="test-google-client-id",
        google_client_secret="test-google-client-secret",
    )


@pytest.fixture(scope="session")
def event_loop() -> Generator[asyncio.AbstractEventLoop]:
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
async def db_session(test_engine) -> AsyncGenerator[AsyncSession]:
    """Create test database session."""
    async_session = async_sessionmaker(
        test_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    async with async_session() as session:
        yield session


@pytest_asyncio.fixture(scope="function")
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient]:
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


@pytest_asyncio.fixture(scope="function")
async def test_user(db_session: AsyncSession, test_user_data) -> User:
    """Create a test user in the database."""
    service = UserService(db_session)
    user = await service.create_oauth_user(
        email=test_user_data["email"],
        display_name=test_user_data["display_name"],
        google_id=test_user_data["google_id"],
    )
    await db_session.flush()
    return user


@pytest.fixture
def test_user_data() -> dict[str, Any]:
    """Sample user data for testing."""
    return {
        "email": "test@example.com",
        "display_name": "Test User",
        "google_id": "google-test-user-123",
    }


@pytest.fixture
def test_credential_data() -> dict[str, Any]:
    """Sample credential data for testing.

    All metadata (name, description, etc.) is inside encrypted_data blob.
    The server only sees the opaque encrypted data.
    """
    return {
        # E2EE: encrypted_data is an opaque blob from the client
        # Contains name, description, fields, etc. all encrypted
        "encrypted_data": "dGVzdC1lbmNyeXB0ZWQtZGF0YQ==",  # base64 test data
    }


@pytest.fixture
def test_template_data() -> dict[str, Any]:
    """Sample template data for testing."""
    return {
        "name": "Test Template",
        "description": "A test template",
        "icon": "key",
        "category": "testing",
        "fields": [
            {"key": "username", "isSecret": False, "required": True},
            {"key": "password", "isSecret": True, "required": True},
            {"key": "notes", "isSecret": False},
        ],
    }
