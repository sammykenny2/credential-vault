"""Integration tests for user management API endpoints."""

import pytest
from httpx import AsyncClient

from app.models.user import UserRole
from app.schemas.user import UserCreate
from app.services.user import UserService


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
    async def test_last_admin_cannot_demote_self(
        self, client: AsyncClient, admin_token
    ):
        """Test last admin cannot demote themselves."""
        token, admin = admin_token

        response = await client.patch(
            f"/api/v1/users/{admin.id}/role",
            headers={"Authorization": f"Bearer {token}"},
            json={"role": "user"},
        )

        assert response.status_code == 400
        assert "last admin" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_admin_can_demote_self_if_other_admin_exists(
        self, client: AsyncClient, db_session, admin_token
    ):
        """Test admin can demote themselves if another admin exists."""
        token, admin = admin_token

        # Create another admin
        service = UserService(db_session)
        user_data = UserCreate(
            email="admin2@example.com",
            password="Admin2Password123!",
            display_name="Admin User 2",
        )
        await service.create(user_data, role=UserRole.ADMIN)
        await db_session.commit()

        # Now the first admin can demote themselves
        response = await client.patch(
            f"/api/v1/users/{admin.id}/role",
            headers={"Authorization": f"Bearer {token}"},
            json={"role": "user"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["role"] == "user"

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


class TestUserDeactivateAPI:
    """Test user deactivation endpoints."""

    @pytest.fixture
    async def admin_token(self, client: AsyncClient, db_session):
        """Create an admin user and return their token."""
        service = UserService(db_session)
        user_data = UserCreate(
            email="deactadmin@example.com",
            password="AdminPassword123!",
            display_name="Deactivate Admin",
        )
        admin = await service.create(user_data, role=UserRole.ADMIN)
        await db_session.commit()

        login_response = await client.post(
            "/api/v1/auth/login",
            data={
                "username": "deactadmin@example.com",
                "password": "AdminPassword123!",
            },
        )
        return login_response.json()["access_token"], admin

    @pytest.fixture
    async def user_with_credentials(self, db_session):
        """Create a user with some credentials."""
        from app.models.credential import Credential

        service = UserService(db_session)
        user_data = UserCreate(
            email="userwithcreds@example.com",
            password="UserPassword123!",
            display_name="User With Creds",
        )
        user = await service.create(user_data, role=UserRole.USER)

        # Add some credentials
        for i in range(3):
            cred = Credential(
                owner_id=user.id,
                name=f"Test Credential {i}",
                encrypted_data="encrypted_test_data",
            )
            db_session.add(cred)

        await db_session.commit()
        return user

    @pytest.mark.asyncio
    async def test_deactivate_user_preserves_credentials(
        self, client: AsyncClient, db_session, admin_token, user_with_credentials
    ):
        """Test deactivating user preserves their credentials by default."""
        token, _ = admin_token

        response = await client.delete(
            f"/api/v1/users/{user_with_credentials.id}",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 204

        # Verify credentials still exist
        service = UserService(db_session)
        count = await service.get_credential_count(user_with_credentials.id)
        assert count == 3

    @pytest.mark.asyncio
    async def test_deactivate_user_with_delete_credentials(
        self, client: AsyncClient, db_session, admin_token, user_with_credentials
    ):
        """Test deactivating user with delete_credentials=true removes credentials."""
        token, _ = admin_token

        response = await client.delete(
            f"/api/v1/users/{user_with_credentials.id}?delete_credentials=true",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 204

        # Verify credentials are deleted
        service = UserService(db_session)
        count = await service.get_credential_count(user_with_credentials.id)
        assert count == 0

    @pytest.mark.asyncio
    async def test_admin_cannot_deactivate_self(
        self, client: AsyncClient, admin_token
    ):
        """Test admin cannot deactivate themselves."""
        token, admin = admin_token

        response = await client.delete(
            f"/api/v1/users/{admin.id}",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 400
        assert "Cannot delete yourself" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_hard_delete_user(
        self, client: AsyncClient, db_session, admin_token, user_with_credentials
    ):
        """Test hard deleting user removes user and credentials completely."""
        token, _ = admin_token

        response = await client.delete(
            f"/api/v1/users/{user_with_credentials.id}?hard_delete=true",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 204

        # Verify user is completely gone
        service = UserService(db_session)
        user = await service.get_by_id(user_with_credentials.id)
        assert user is None

    @pytest.mark.asyncio
    async def test_reactivate_user(
        self, client: AsyncClient, db_session, admin_token
    ):
        """Test reactivating a deactivated user."""
        token, _ = admin_token

        # Create and deactivate a user
        service = UserService(db_session)
        user_data = UserCreate(
            email="toreactivate@example.com",
            password="Password123!",
            display_name="To Reactivate",
        )
        user = await service.create(user_data)
        await service.deactivate(user)
        await db_session.commit()

        # Reactivate
        response = await client.post(
            f"/api/v1/users/{user.id}/reactivate",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["is_active"] is True

    @pytest.mark.asyncio
    async def test_reactivate_already_active_user(
        self, client: AsyncClient, db_session, admin_token
    ):
        """Test reactivating an already active user returns error."""
        token, _ = admin_token

        # Create an active user
        service = UserService(db_session)
        user_data = UserCreate(
            email="alreadyactive@example.com",
            password="Password123!",
            display_name="Already Active",
        )
        user = await service.create(user_data)
        await db_session.commit()

        response = await client.post(
            f"/api/v1/users/{user.id}/reactivate",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 400
        assert "already active" in response.json()["detail"]
