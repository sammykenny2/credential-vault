"""Integration tests for credentials API endpoints."""

import pytest
from httpx import AsyncClient

from src.core.crypto import CredentialCrypto
from src.schemas.user import UserCreate
from src.services.user import UserService


class TestCredentialsAPI:
    """Test credentials endpoints."""

    async def _create_user_and_login(self, client: AsyncClient, db_session, test_user_data):
        """Helper to create user and get auth token."""
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
        return login_response.json()["access_token"]

    @pytest.mark.asyncio
    async def test_create_credential(
        self,
        client: AsyncClient,
        db_session,
        test_user_data,
        test_credential_data,
    ):
        """Test creating a credential."""
        token = await self._create_user_and_login(client, db_session, test_user_data)

        encrypted_data = CredentialCrypto.encrypt_credential(
            username=test_credential_data["username"],
            password=test_credential_data["password"],
        )

        response = await client.post(
            "/api/v1/credentials",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "name": test_credential_data["name"],
                "description": test_credential_data["description"],
                "website_url": test_credential_data["website_url"],
                "category": test_credential_data["category"],
                "encrypted_data": encrypted_data,
            },
        )

        assert response.status_code == 201
        data = response.json()
        assert data["name"] == test_credential_data["name"]
        assert data["description"] == test_credential_data["description"]
        assert data["is_active"] is True

    @pytest.mark.asyncio
    async def test_list_credentials(
        self,
        client: AsyncClient,
        db_session,
        test_user_data,
    ):
        """Test listing credentials."""
        token = await self._create_user_and_login(client, db_session, test_user_data)

        # Create some credentials
        for i in range(3):
            encrypted_data = CredentialCrypto.encrypt_credential(
                username=f"user{i}",
                password=f"pass{i}",
            )
            await client.post(
                "/api/v1/credentials",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "name": f"Credential {i}",
                    "encrypted_data": encrypted_data,
                },
            )

        # List credentials
        response = await client.get(
            "/api/v1/credentials",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 3

    @pytest.mark.asyncio
    async def test_get_credential(
        self,
        client: AsyncClient,
        db_session,
        test_user_data,
        test_credential_data,
    ):
        """Test getting a specific credential."""
        token = await self._create_user_and_login(client, db_session, test_user_data)

        encrypted_data = CredentialCrypto.encrypt_credential(
            username=test_credential_data["username"],
            password=test_credential_data["password"],
        )

        create_response = await client.post(
            "/api/v1/credentials",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "name": test_credential_data["name"],
                "encrypted_data": encrypted_data,
            },
        )
        credential_id = create_response.json()["id"]

        # Get credential
        response = await client.get(
            f"/api/v1/credentials/{credential_id}",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == credential_id
        assert data["name"] == test_credential_data["name"]

        # Verify encrypted data can be decrypted
        decrypted = CredentialCrypto.decrypt_credential(data["encrypted_data"])
        assert decrypted["username"] == test_credential_data["username"]
        assert decrypted["password"] == test_credential_data["password"]

    @pytest.mark.asyncio
    async def test_search_credentials(
        self,
        client: AsyncClient,
        db_session,
        test_user_data,
    ):
        """Test searching credentials."""
        token = await self._create_user_and_login(client, db_session, test_user_data)

        # Create credentials
        for name in ["GitHub Account", "GitLab Account", "Email Account"]:
            encrypted_data = CredentialCrypto.encrypt_credential(
                username="test",
                password="test",
            )
            await client.post(
                "/api/v1/credentials",
                headers={"Authorization": f"Bearer {token}"},
                json={"name": name, "encrypted_data": encrypted_data},
            )

        # Search
        response = await client.get(
            "/api/v1/credentials/search",
            headers={"Authorization": f"Bearer {token}"},
            params={"q": "Git"},
        )

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2

    @pytest.mark.asyncio
    async def test_revoke_credential(
        self,
        client: AsyncClient,
        db_session,
        test_user_data,
        test_credential_data,
    ):
        """Test revoking a credential."""
        token = await self._create_user_and_login(client, db_session, test_user_data)

        encrypted_data = CredentialCrypto.encrypt_credential(
            username="test",
            password="test",
        )

        create_response = await client.post(
            "/api/v1/credentials",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "name": test_credential_data["name"],
                "encrypted_data": encrypted_data,
            },
        )
        credential_id = create_response.json()["id"]

        # Revoke
        response = await client.post(
            f"/api/v1/credentials/{credential_id}/revoke",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["is_active"] is False
        assert data["revoked_at"] is not None

    @pytest.mark.asyncio
    async def test_delete_credential(
        self,
        client: AsyncClient,
        db_session,
        test_user_data,
        test_credential_data,
    ):
        """Test deleting a credential."""
        token = await self._create_user_and_login(client, db_session, test_user_data)

        encrypted_data = CredentialCrypto.encrypt_credential(
            username="test",
            password="test",
        )

        create_response = await client.post(
            "/api/v1/credentials",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "name": test_credential_data["name"],
                "encrypted_data": encrypted_data,
            },
        )
        credential_id = create_response.json()["id"]

        # Delete
        response = await client.delete(
            f"/api/v1/credentials/{credential_id}",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 204

        # Verify deleted
        get_response = await client.get(
            f"/api/v1/credentials/{credential_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert get_response.status_code == 404

    @pytest.mark.asyncio
    async def test_credential_isolation(
        self,
        client: AsyncClient,
        db_session,
        test_user_data,
    ):
        """Test that users cannot access each other's credentials."""
        # Create first user and credential
        token1 = await self._create_user_and_login(client, db_session, test_user_data)

        encrypted_data = CredentialCrypto.encrypt_credential(
            username="secret",
            password="secret",
        )

        create_response = await client.post(
            "/api/v1/credentials",
            headers={"Authorization": f"Bearer {token1}"},
            json={"name": "User1 Secret", "encrypted_data": encrypted_data},
        )
        credential_id = create_response.json()["id"]

        # Create second user
        user2_data = {
            "email": "user2@example.com",
            "display_name": "User 2",
            "password": "Password123!",
        }
        service = UserService(db_session)
        user_create = UserCreate(**user2_data)
        await service.create(user_create)
        await db_session.commit()

        login2_response = await client.post(
            "/api/v1/auth/login",
            data={"username": user2_data["email"], "password": user2_data["password"]},
        )
        token2 = login2_response.json()["access_token"]

        # User 2 should not be able to access User 1's credential
        response = await client.get(
            f"/api/v1/credentials/{credential_id}",
            headers={"Authorization": f"Bearer {token2}"},
        )

        assert response.status_code == 404
