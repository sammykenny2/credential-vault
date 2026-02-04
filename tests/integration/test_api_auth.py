"""Integration tests for authentication API endpoints."""

import pytest
from httpx import AsyncClient

from src.models.user import UserRole
from src.schemas.user import UserCreate
from src.services.user import UserService


class TestAuthAPI:
    """Test authentication endpoints."""

    @pytest.mark.asyncio
    async def test_login_success(self, client: AsyncClient, db_session, test_user_data):
        """Test successful login."""
        # Create user first
        service = UserService(db_session)
        user_create = UserCreate(**test_user_data)
        await service.create(user_create)
        await db_session.commit()

        # Login
        response = await client.post(
            "/api/v1/auth/login",
            data={
                "username": test_user_data["email"],
                "password": test_user_data["password"],
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert "refresh_token" in data
        assert data["token_type"] == "bearer"

    @pytest.mark.asyncio
    async def test_login_invalid_credentials(self, client: AsyncClient):
        """Test login with invalid credentials."""
        response = await client.post(
            "/api/v1/auth/login",
            data={
                "username": "nonexistent@example.com",
                "password": "wrongpassword",
            },
        )

        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_get_me_authenticated(self, client: AsyncClient, db_session, test_user_data):
        """Test getting current user info when authenticated."""
        # Create user and login
        service = UserService(db_session)
        user_create = UserCreate(**test_user_data)
        await service.create(user_create)
        await db_session.commit()

        login_response = await client.post(
            "/api/v1/auth/login",
            data={
                "username": test_user_data["email"],
                "password": test_user_data["password"],
            },
        )
        token = login_response.json()["access_token"]

        # Get current user
        response = await client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["email"] == test_user_data["email"]
        assert data["display_name"] == test_user_data["display_name"]

    @pytest.mark.asyncio
    async def test_get_me_unauthenticated(self, client: AsyncClient):
        """Test getting current user info without authentication."""
        response = await client.get("/api/v1/auth/me")

        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_refresh_token(self, client: AsyncClient, db_session, test_user_data):
        """Test refreshing access token."""
        # Create user and login
        service = UserService(db_session)
        user_create = UserCreate(**test_user_data)
        await service.create(user_create)
        await db_session.commit()

        login_response = await client.post(
            "/api/v1/auth/login",
            data={
                "username": test_user_data["email"],
                "password": test_user_data["password"],
            },
        )
        refresh_token = login_response.json()["refresh_token"]

        # Refresh
        response = await client.post(
            "/api/v1/auth/refresh",
            params={"refresh_token": refresh_token},
        )

        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert "refresh_token" in data

    @pytest.mark.asyncio
    async def test_change_password(self, client: AsyncClient, db_session, test_user_data):
        """Test changing password."""
        # Create user and login
        service = UserService(db_session)
        user_create = UserCreate(**test_user_data)
        await service.create(user_create)
        await db_session.commit()

        login_response = await client.post(
            "/api/v1/auth/login",
            data={
                "username": test_user_data["email"],
                "password": test_user_data["password"],
            },
        )
        token = login_response.json()["access_token"]

        # Change password
        new_password = "NewPassword456!"
        response = await client.post(
            "/api/v1/auth/password/change",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "current_password": test_user_data["password"],
                "new_password": new_password,
            },
        )

        assert response.status_code == 200

        # Verify new password works
        login_response = await client.post(
            "/api/v1/auth/login",
            data={
                "username": test_user_data["email"],
                "password": new_password,
            },
        )
        assert login_response.status_code == 200
