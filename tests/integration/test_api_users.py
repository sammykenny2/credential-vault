"""Integration tests for user management API endpoints."""

import pytest
from httpx import AsyncClient

from src.models.user import UserRole
from src.schemas.user import UserCreate
from src.services.user import UserService


class TestUserRoleAPI:
    """Test user role management endpoints."""

    @pytest.fixture
    async def admin_token(self, client: AsyncClient, db_session):
        """Create an admin user and return their token."""
        service = UserService(db_session)
        user_data = UserCreate(
            email="admin@example.com",
            password="AdminPassword123!",
            display_name="Admin User",
        )
        admin = await service.create(user_data, role=UserRole.ADMIN)
        await db_session.commit()

        login_response = await client.post(
            "/api/v1/auth/login",
            data={
                "username": "admin@example.com",
                "password": "AdminPassword123!",
            },
        )
        return login_response.json()["access_token"], admin

    @pytest.fixture
    async def regular_user(self, db_session):
        """Create a regular user."""
        service = UserService(db_session)
        user_data = UserCreate(
            email="user@example.com",
            password="UserPassword123!",
            display_name="Regular User",
        )
        user = await service.create(user_data, role=UserRole.USER)
        await db_session.commit()
        return user

    @pytest.mark.asyncio
    async def test_admin_can_promote_user(
        self, client: AsyncClient, admin_token, regular_user
    ):
        """Test admin can promote user to admin."""
        token, _ = admin_token

        response = await client.patch(
            f"/api/v1/users/{regular_user.id}/role",
            headers={"Authorization": f"Bearer {token}"},
            json={"role": "admin"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["role"] == "admin"

    @pytest.mark.asyncio
    async def test_admin_can_demote_admin(
        self, client: AsyncClient, db_session, admin_token
    ):
        """Test admin can demote another admin to user."""
        token, _ = admin_token

        # Create another admin
        service = UserService(db_session)
        user_data = UserCreate(
            email="admin2@example.com",
            password="Admin2Password123!",
            display_name="Admin User 2",
        )
        admin2 = await service.create(user_data, role=UserRole.ADMIN)
        await db_session.commit()

        response = await client.patch(
            f"/api/v1/users/{admin2.id}/role",
            headers={"Authorization": f"Bearer {token}"},
            json={"role": "user"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["role"] == "user"

    @pytest.mark.asyncio
    async def test_admin_cannot_change_own_role(
        self, client: AsyncClient, admin_token
    ):
        """Test admin cannot change their own role."""
        token, admin = admin_token

        response = await client.patch(
            f"/api/v1/users/{admin.id}/role",
            headers={"Authorization": f"Bearer {token}"},
            json={"role": "user"},
        )

        assert response.status_code == 400
        assert "Cannot change your own role" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_regular_user_cannot_change_roles(
        self, client: AsyncClient, db_session, regular_user
    ):
        """Test regular user cannot change roles."""
        # Login as regular user
        login_response = await client.post(
            "/api/v1/auth/login",
            data={
                "username": "user@example.com",
                "password": "UserPassword123!",
            },
        )
        token = login_response.json()["access_token"]

        # Create another user to try to promote
        service = UserService(db_session)
        user_data = UserCreate(
            email="user2@example.com",
            password="User2Password123!",
            display_name="User 2",
        )
        user2 = await service.create(user_data)
        await db_session.commit()

        response = await client.patch(
            f"/api/v1/users/{user2.id}/role",
            headers={"Authorization": f"Bearer {token}"},
            json={"role": "admin"},
        )

        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_change_role_nonexistent_user(
        self, client: AsyncClient, admin_token
    ):
        """Test changing role of nonexistent user returns 404."""
        token, _ = admin_token

        response = await client.patch(
            "/api/v1/users/nonexistent-user-id/role",
            headers={"Authorization": f"Bearer {token}"},
            json={"role": "admin"},
        )

        assert response.status_code == 404


class TestUserListAPI:
    """Test user listing endpoints."""

    @pytest.fixture
    async def admin_token(self, client: AsyncClient, db_session):
        """Create an admin user and return their token."""
        service = UserService(db_session)
        user_data = UserCreate(
            email="listadmin@example.com",
            password="AdminPassword123!",
            display_name="List Admin",
        )
        await service.create(user_data, role=UserRole.ADMIN)
        await db_session.commit()

        login_response = await client.post(
            "/api/v1/auth/login",
            data={
                "username": "listadmin@example.com",
                "password": "AdminPassword123!",
            },
        )
        return login_response.json()["access_token"]

    @pytest.mark.asyncio
    async def test_admin_can_list_users(
        self, client: AsyncClient, admin_token, db_session
    ):
        """Test admin can list all users."""
        # Create some users
        service = UserService(db_session)
        for i in range(3):
            user_data = UserCreate(
                email=f"listuser{i}@example.com",
                password="Password123!",
                display_name=f"List User {i}",
            )
            await service.create(user_data)
        await db_session.commit()

        response = await client.get(
            "/api/v1/users/",
            headers={"Authorization": f"Bearer {admin_token}"},
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data) >= 4  # 3 users + 1 admin

    @pytest.mark.asyncio
    async def test_regular_user_cannot_list_users(
        self, client: AsyncClient, db_session
    ):
        """Test regular user cannot list all users."""
        service = UserService(db_session)
        user_data = UserCreate(
            email="regularlist@example.com",
            password="Password123!",
            display_name="Regular List User",
        )
        await service.create(user_data)
        await db_session.commit()

        login_response = await client.post(
            "/api/v1/auth/login",
            data={
                "username": "regularlist@example.com",
                "password": "Password123!",
            },
        )
        token = login_response.json()["access_token"]

        response = await client.get(
            "/api/v1/users/",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 403
