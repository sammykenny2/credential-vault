"""Integration tests for PUT /users/me/password (password for admin sign-in)."""

import pytest
from httpx import AsyncClient

from app.core.security import SecurityService
from app.core.vault_proof import VAULT_PROOF_HEADER
from app.models.user import UserRole
from tests.integration.test_api_vault_proof import _obtain_proof, _user_with_vault

PASSWORD = "a-long-admin-password"


async def _admin_with_vault(db_session, email="admin@example.com"):
    user, private_key, headers = await _user_with_vault(db_session, email)
    user.role = UserRole.ADMIN
    await db_session.commit()
    return user, private_key, headers


async def _set_password(client: AsyncClient, headers: dict, password: str = PASSWORD):
    return await client.put(
        "/api/v1/users/me/password", headers=headers, json={"password": password}
    )


class TestSetPassword:
    @pytest.mark.asyncio
    async def test_admin_without_password_can_add_one_and_sign_in_with_it(
        self, client: AsyncClient, db_session
    ):
        user, private_key, headers = await _admin_with_vault(db_session)
        me = await client.get("/api/v1/users/me", headers=headers)
        assert me.json()["has_password"] is False

        proof = await _obtain_proof(client, headers, private_key)
        response = await _set_password(client, {**headers, VAULT_PROOF_HEADER: proof})

        assert response.status_code == 200
        assert response.json()["has_password"] is True
        login = await client.post(
            "/api/v1/auth/login", json={"email": user.email, "password": PASSWORD}
        )
        assert login.status_code == 200
        assert "access_token" in login.json()

    @pytest.mark.asyncio
    async def test_requires_vault_proof(self, client: AsyncClient, db_session):
        user, _, headers = await _admin_with_vault(db_session)

        response = await _set_password(client, headers)

        assert response.status_code == 403
        assert "Vault proof" in response.json()["detail"]
        await db_session.refresh(user)
        assert user.hashed_password is None

    @pytest.mark.asyncio
    async def test_regular_users_cannot_add_a_password(self, client: AsyncClient, db_session):
        # POST /auth/login only accepts admins, so a password would be useless
        user, private_key, headers = await _user_with_vault(db_session, "user@example.com")
        proof = await _obtain_proof(client, headers, private_key)

        response = await _set_password(client, {**headers, VAULT_PROOF_HEADER: proof})

        assert response.status_code == 403
        await db_session.refresh(user)
        assert user.hashed_password is None

    @pytest.mark.asyncio
    async def test_does_not_replace_an_existing_password(self, client: AsyncClient, db_session):
        user, private_key, headers = await _admin_with_vault(db_session)
        user.hashed_password = SecurityService.hash_password("the-original-password")
        await db_session.commit()
        proof = await _obtain_proof(client, headers, private_key)

        response = await _set_password(client, {**headers, VAULT_PROOF_HEADER: proof})

        assert response.status_code == 409
        assert SecurityService.verify_password("the-original-password", user.hashed_password)

    @pytest.mark.asyncio
    @pytest.mark.parametrize("password", ["short", "x" * 73])
    async def test_rejects_passwords_bcrypt_cannot_hold(
        self, client: AsyncClient, db_session, password
    ):
        _, private_key, headers = await _admin_with_vault(db_session)
        proof = await _obtain_proof(client, headers, private_key)

        response = await _set_password(client, {**headers, VAULT_PROOF_HEADER: proof}, password)

        assert response.status_code == 422
