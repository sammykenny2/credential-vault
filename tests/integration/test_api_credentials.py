"""Integration tests for credentials API endpoints."""

import pytest
from httpx import AsyncClient

from app.core.security import SecurityService
from app.services.user import UserService


class TestCredentialsAPI:
    """Test credentials endpoints."""

    async def _create_user_and_get_token(self, db_session, test_user_data) -> str:
        """Helper to create an OAuth user and get a JWT token directly."""
        service = UserService(db_session)
        user = await service.create_oauth_user(
            email=test_user_data["email"],
            display_name=test_user_data["display_name"],
            google_id=test_user_data["google_id"],
        )
        await db_session.commit()

        return SecurityService.create_access_token(user.id)

    @pytest.mark.asyncio
    async def test_create_credential(
        self,
        client: AsyncClient,
        db_session,
        test_user_data,
        test_credential_data,
    ):
        """Test creating a credential (encrypted blob only, no plaintext metadata)."""
        token = await self._create_user_and_get_token(db_session, test_user_data)

        response = await client.post(
            "/api/v1/credentials",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "encrypted_data": test_credential_data["encrypted_data"],
            },
        )

        assert response.status_code == 201
        data = response.json()
        assert data["encrypted_data"] == test_credential_data["encrypted_data"]
        assert data["is_active"] is True
        # No plaintext metadata fields
        assert "name" not in data
        assert "description" not in data

    @pytest.mark.asyncio
    async def test_list_credentials(
        self,
        client: AsyncClient,
        db_session,
        test_user_data,
    ):
        """Test listing credentials returns encrypted_data."""
        token = await self._create_user_and_get_token(db_session, test_user_data)

        # Create some credentials with opaque encrypted data
        for i in range(3):
            await client.post(
                "/api/v1/credentials",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "encrypted_data": f"opaque-encrypted-blob-{i}",
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
        # List items now include encrypted_data for client-side search
        assert "encrypted_data" in data[0]

    @pytest.mark.asyncio
    async def test_get_credential(
        self,
        client: AsyncClient,
        db_session,
        test_user_data,
        test_credential_data,
    ):
        """Test getting a specific credential."""
        token = await self._create_user_and_get_token(db_session, test_user_data)

        create_response = await client.post(
            "/api/v1/credentials",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "encrypted_data": test_credential_data["encrypted_data"],
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
        assert data["encrypted_data"] == test_credential_data["encrypted_data"]

    @pytest.mark.asyncio
    async def test_revoke_credential(
        self,
        client: AsyncClient,
        db_session,
        test_user_data,
        test_credential_data,
    ):
        """Test revoking a credential."""
        token = await self._create_user_and_get_token(db_session, test_user_data)

        create_response = await client.post(
            "/api/v1/credentials",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "encrypted_data": test_credential_data["encrypted_data"],
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
        """A session token alone cannot delete; proof of vault unlock is required.

        The successful path is covered in test_api_vault_proof.py.
        """
        token = await self._create_user_and_get_token(db_session, test_user_data)

        create_response = await client.post(
            "/api/v1/credentials",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "encrypted_data": test_credential_data["encrypted_data"],
            },
        )
        credential_id = create_response.json()["id"]

        # Delete without X-Vault-Proof is refused
        response = await client.delete(
            f"/api/v1/credentials/{credential_id}",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 403

        # Still present
        get_response = await client.get(
            f"/api/v1/credentials/{credential_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert get_response.status_code == 200

    @pytest.mark.asyncio
    async def test_credential_isolation(
        self,
        client: AsyncClient,
        db_session,
        test_user_data,
    ):
        """Test that users cannot access each other's credentials."""
        # Create first user and credential
        token1 = await self._create_user_and_get_token(db_session, test_user_data)

        create_response = await client.post(
            "/api/v1/credentials",
            headers={"Authorization": f"Bearer {token1}"},
            json={"encrypted_data": "opaque-encrypted-blob"},
        )
        credential_id = create_response.json()["id"]

        # Create second user
        service = UserService(db_session)
        user2 = await service.create_oauth_user(
            email="user2@example.com",
            display_name="User 2",
            google_id="google-user2-id",
        )
        await db_session.commit()

        token2 = SecurityService.create_access_token(user2.id)

        # User 2 should not be able to access User 1's credential
        response = await client.get(
            f"/api/v1/credentials/{credential_id}",
            headers={"Authorization": f"Bearer {token2}"},
        )

        assert response.status_code == 404
