"""Integration tests for user management API endpoints."""

import pytest
from httpx import AsyncClient

from app.core.security import SecurityService
from app.models.user import UserRole
from app.services.user import UserService


class TestUserRoleAPI:
    """Test user role management endpoints."""

    @pytest.fixture
    async def admin_token(self, db_session):
        """Create an admin user and return their token + user."""
        service = UserService(db_session)
        admin = await service.create_oauth_user(
            email="admin@example.com",
            display_name="Admin User",
            google_id="google-admin-1",
            role=UserRole.ADMIN,
        )
        await db_session.commit()

        token = SecurityService.create_access_token(admin.id)
        return token, admin

    @pytest.fixture
    async def regular_user(self, db_session):
        """Create a regular user."""
        service = UserService(db_session)
        user = await service.create_oauth_user(
            email="user@example.com",
            display_name="Regular User",
            google_id="google-user-1",
            role=UserRole.USER,
        )
        await db_session.commit()
        return user

    @pytest.mark.asyncio
    async def test_admin_can_promote_user(self, client: AsyncClient, admin_token, regular_user):
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
    async def test_admin_can_demote_admin(self, client: AsyncClient, db_session, admin_token):
        """Test admin can demote another admin to user."""
        token, _ = admin_token

        # Create another admin
        service = UserService(db_session)
        admin2 = await service.create_oauth_user(
            email="admin2@example.com",
            display_name="Admin User 2",
            google_id="google-admin-2",
            role=UserRole.ADMIN,
        )
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
    async def test_last_admin_cannot_demote_self(self, client: AsyncClient, admin_token):
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
        await service.create_oauth_user(
            email="admin2@example.com",
            display_name="Admin User 2",
            google_id="google-admin-2",
            role=UserRole.ADMIN,
        )
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
        token = SecurityService.create_access_token(regular_user.id)

        # Create another user to try to promote
        service = UserService(db_session)
        user2 = await service.create_oauth_user(
            email="user2@example.com",
            display_name="User 2",
            google_id="google-user-2",
        )
        await db_session.commit()

        response = await client.patch(
            f"/api/v1/users/{user2.id}/role",
            headers={"Authorization": f"Bearer {token}"},
            json={"role": "admin"},
        )

        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_change_role_nonexistent_user(self, client: AsyncClient, admin_token):
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
    async def admin_token(self, db_session):
        """Create an admin user and return their token."""
        service = UserService(db_session)
        admin = await service.create_oauth_user(
            email="listadmin@example.com",
            display_name="List Admin",
            google_id="google-listadmin",
            role=UserRole.ADMIN,
        )
        await db_session.commit()

        return SecurityService.create_access_token(admin.id)

    @pytest.mark.asyncio
    async def test_admin_can_list_users(self, client: AsyncClient, admin_token, db_session):
        """Test admin can list all users."""
        # Create some users
        service = UserService(db_session)
        for i in range(3):
            await service.create_oauth_user(
                email=f"listuser{i}@example.com",
                display_name=f"List User {i}",
                google_id=f"google-listuser-{i}",
            )
        await db_session.commit()

        response = await client.get(
            "/api/v1/users/",
            headers={"Authorization": f"Bearer {admin_token}"},
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data) >= 4  # 3 users + 1 admin

    @pytest.mark.asyncio
    async def test_regular_user_cannot_list_users(self, client: AsyncClient, db_session):
        """Test regular user cannot list all users."""
        service = UserService(db_session)
        user = await service.create_oauth_user(
            email="regularlist@example.com",
            display_name="Regular List User",
            google_id="google-regularlist",
        )
        await db_session.commit()

        token = SecurityService.create_access_token(user.id)

        response = await client.get(
            "/api/v1/users/",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 403


class TestUserDeactivateAPI:
    """Test user deactivation endpoints."""

    @pytest.fixture
    async def admin_token(self, db_session):
        """Create an admin user and return their token + user."""
        service = UserService(db_session)
        admin = await service.create_oauth_user(
            email="deactadmin@example.com",
            display_name="Deactivate Admin",
            google_id="google-deactadmin",
            role=UserRole.ADMIN,
        )
        await db_session.commit()

        token = SecurityService.create_access_token(admin.id)
        return token, admin

    @pytest.fixture
    async def user_with_credentials(self, db_session):
        """Create a user with some credentials."""
        from app.models.credential import Credential

        service = UserService(db_session)
        user = await service.create_oauth_user(
            email="userwithcreds@example.com",
            display_name="User With Creds",
            google_id="google-userwithcreds",
            role=UserRole.USER,
        )

        # Add some credentials (no plaintext metadata with E2EE)
        for i in range(3):
            cred = Credential(
                owner_id=user.id,
                encrypted_data=f"encrypted_test_data_{i}",
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
    async def test_admin_cannot_deactivate_self(self, client: AsyncClient, admin_token):
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
    async def test_reactivate_user(self, client: AsyncClient, db_session, admin_token):
        """Test reactivating a deactivated user."""
        token, _ = admin_token

        # Create and deactivate a user
        service = UserService(db_session)
        user = await service.create_oauth_user(
            email="toreactivate@example.com",
            display_name="To Reactivate",
            google_id="google-toreactivate",
        )
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
        user = await service.create_oauth_user(
            email="alreadyactive@example.com",
            display_name="Already Active",
            google_id="google-alreadyactive",
        )
        await db_session.commit()

        response = await client.post(
            f"/api/v1/users/{user.id}/reactivate",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 400
        assert "already active" in response.json()["detail"]
