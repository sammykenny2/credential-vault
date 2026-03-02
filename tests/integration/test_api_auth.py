"""Integration tests for authentication API endpoints."""

import pytest
from httpx import AsyncClient

from app.core.security import SecurityService
from app.models.user import UserRole
from app.services.user import UserService


class TestAuthAPI:
    """Test authentication endpoints."""

    async def _create_user_and_get_token(self, db_session, email="test@example.com") -> tuple[str, str]:
        """Helper to create an OAuth user and get a JWT token directly.

        Returns (access_token, user_id).
        """
        service = UserService(db_session)
        user = await service.create_oauth_user(
            email=email,
            display_name="Test User",
            google_id=f"google-{email}",
        )
        await db_session.commit()

        access_token = SecurityService.create_access_token(user.id)
        return access_token, user.id

    @pytest.mark.asyncio
    async def test_get_me_authenticated(self, client: AsyncClient, db_session, test_user_data):
        """Test getting current user info when authenticated."""
        token, _ = await self._create_user_and_get_token(
            db_session, email=test_user_data["email"]
        )

        response = await client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["email"] == test_user_data["email"]
        assert data["display_name"] == "Test User"
        assert "has_vault_keys" in data

    @pytest.mark.asyncio
    async def test_get_me_unauthenticated(self, client: AsyncClient):
        """Test getting current user info without authentication."""
        response = await client.get("/api/v1/auth/me")

        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_refresh_token(self, client: AsyncClient, db_session, test_user_data):
        """Test refreshing access token."""
        service = UserService(db_session)
        user = await service.create_oauth_user(
            email=test_user_data["email"],
            display_name=test_user_data["display_name"],
            google_id=test_user_data["google_id"],
        )
        await db_session.commit()

        refresh_token = SecurityService.create_refresh_token(user.id)

        response = await client.post(
            "/api/v1/auth/refresh",
            params={"refresh_token": refresh_token},
        )

        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert "refresh_token" in data

    @pytest.mark.asyncio
    async def test_refresh_token_invalid(self, client: AsyncClient):
        """Test refresh with invalid token fails."""
        response = await client.post(
            "/api/v1/auth/refresh",
            params={"refresh_token": "invalid-token"},
        )

        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_vault_setup(self, client: AsyncClient, db_session, test_user_data):
        """Test setting up E2EE vault keys."""
        token, _ = await self._create_user_and_get_token(
            db_session, email=test_user_data["email"]
        )

        response = await client.post(
            "/api/v1/auth/vault/setup",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "public_key": "test-public-key-base64",
                "encrypted_private_key": "test-encrypted-private-key-base64",
                "key_salt": "test-salt-base64",
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["message"] == "Vault keys configured successfully"

    @pytest.mark.asyncio
    async def test_vault_setup_duplicate(self, client: AsyncClient, db_session, test_user_data):
        """Test that vault setup fails if keys already exist."""
        token, _ = await self._create_user_and_get_token(
            db_session, email=test_user_data["email"]
        )

        vault_data = {
            "public_key": "test-public-key-base64",
            "encrypted_private_key": "test-encrypted-private-key-base64",
            "key_salt": "test-salt-base64",
        }

        # First setup should succeed
        response = await client.post(
            "/api/v1/auth/vault/setup",
            headers={"Authorization": f"Bearer {token}"},
            json=vault_data,
        )
        assert response.status_code == 200

        # Second setup should fail
        response = await client.post(
            "/api/v1/auth/vault/setup",
            headers={"Authorization": f"Bearer {token}"},
            json=vault_data,
        )
        assert response.status_code == 400
        assert "already configured" in response.json()["detail"]


class TestBreakGlassLogin:
    """Test break-glass local admin login."""

    @pytest.mark.asyncio
    async def test_local_login_success(self, client: AsyncClient, db_session):
        """Test that admin with hashed password can log in locally."""
        service = UserService(db_session)
        user = await service.create_oauth_user(
            email="admin@example.com",
            display_name="Admin",
            google_id="google-admin",
            role=UserRole.ADMIN,
        )
        user.hashed_password = SecurityService.hash_password("admin-secret-123")
        await db_session.commit()

        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "admin@example.com", "password": "admin-secret-123"},
        )

        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert "refresh_token" in data
        assert data["token_type"] == "bearer"

    @pytest.mark.asyncio
    async def test_local_login_wrong_password(self, client: AsyncClient, db_session):
        """Test that wrong password returns 401."""
        service = UserService(db_session)
        user = await service.create_oauth_user(
            email="admin@example.com",
            display_name="Admin",
            google_id="google-admin",
            role=UserRole.ADMIN,
        )
        user.hashed_password = SecurityService.hash_password("correct-password")
        await db_session.commit()

        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "admin@example.com", "password": "wrong-password"},
        )

        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_local_login_non_admin(self, client: AsyncClient, db_session):
        """Test that non-admin users cannot use local login."""
        service = UserService(db_session)
        user = await service.create_oauth_user(
            email="user@example.com",
            display_name="User",
            google_id="google-user",
            role=UserRole.USER,
        )
        user.hashed_password = SecurityService.hash_password("user-password")
        await db_session.commit()

        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "user@example.com", "password": "user-password"},
        )

        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_local_login_no_password(self, client: AsyncClient, db_session):
        """Test that admin without hashed_password cannot use local login."""
        service = UserService(db_session)
        await service.create_oauth_user(
            email="admin@example.com",
            display_name="Admin",
            google_id="google-admin",
            role=UserRole.ADMIN,
        )
        await db_session.commit()

        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "admin@example.com", "password": "any-password"},
        )

        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_local_login_nonexistent_user(self, client: AsyncClient):
        """Test that nonexistent email returns 401."""
        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "nobody@example.com", "password": "password"},
        )

        assert response.status_code == 401
