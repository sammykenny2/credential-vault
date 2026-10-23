"""Integration tests for proof-of-unlock on destructive credential operations."""

import base64
from datetime import UTC, datetime, timedelta

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from httpx import AsyncClient

from app.core.security import SecurityService
from app.core.vault_proof import VAULT_PROOF_HEADER
from app.services.user import UserService

OAEP = padding.OAEP(
    mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None
)


async def _user_with_vault(db_session, email="vault@example.com"):
    """Create a user whose vault public key we hold the private half of."""
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    spki = private_key.public_key().public_bytes(
        serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    service = UserService(db_session)
    user = await service.create_oauth_user(
        email=email, display_name="Vault User", google_id=f"google-{email}"
    )
    await service.setup_vault_keys(
        user=user,
        public_key=base64.b64encode(spki).decode(),
        encrypted_private_key="client-side-blob",
        key_salt="client-side-salt",
    )
    await db_session.commit()
    token = SecurityService.create_access_token(user.id, user.token_version)
    return user, private_key, {"Authorization": f"Bearer {token}"}


async def _obtain_proof(client: AsyncClient, headers: dict, private_key) -> str:
    response = await client.post("/api/v1/auth/vault/challenge", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["expires_in"] > 0
    secret = private_key.decrypt(base64.b64decode(body["challenge"]), OAEP)
    return base64.b64encode(secret).decode()


async def _create_credential(client: AsyncClient, headers: dict) -> str:
    response = await client.post(
        "/api/v1/credentials", headers=headers, json={"encrypted_data": "Y2lwaGVydGV4dA=="}
    )
    assert response.status_code == 201
    return response.json()["id"]


class TestVaultChallenge:
    @pytest.mark.asyncio
    async def test_requires_vault_keys(self, client: AsyncClient, db_session):
        service = UserService(db_session)
        user = await service.create_oauth_user(
            email="novault@example.com", display_name="N", google_id="google-novault"
        )
        await db_session.commit()
        token = SecurityService.create_access_token(user.id)

        response = await client.post(
            "/api/v1/auth/vault/challenge", headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_challenge_decrypts_with_private_key(self, client: AsyncClient, db_session):
        _, private_key, headers = await _user_with_vault(db_session)
        proof = await _obtain_proof(client, headers, private_key)
        assert len(base64.b64decode(proof)) == 32


class TestDeleteRequiresProof:
    @pytest.mark.asyncio
    async def test_delete_without_proof_is_refused(self, client: AsyncClient, db_session):
        _, _, headers = await _user_with_vault(db_session)
        credential_id = await _create_credential(client, headers)

        response = await client.delete(f"/api/v1/credentials/{credential_id}", headers=headers)
        assert response.status_code == 403
        assert "Vault proof" in response.json()["detail"]

        # Still there
        response = await client.get(f"/api/v1/credentials/{credential_id}", headers=headers)
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_delete_with_wrong_proof_is_refused(self, client: AsyncClient, db_session):
        _, private_key, headers = await _user_with_vault(db_session)
        credential_id = await _create_credential(client, headers)
        await _obtain_proof(client, headers, private_key)

        bogus = base64.b64encode(b"\x00" * 32).decode()
        response = await client.delete(
            f"/api/v1/credentials/{credential_id}",
            headers={**headers, VAULT_PROOF_HEADER: bogus},
        )
        assert response.status_code == 403

        response = await client.delete(
            f"/api/v1/credentials/{credential_id}",
            headers={**headers, VAULT_PROOF_HEADER: "not base64!!"},
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_delete_with_valid_proof_succeeds_and_is_reusable(
        self, client: AsyncClient, db_session
    ):
        _, private_key, headers = await _user_with_vault(db_session)
        first = await _create_credential(client, headers)
        second = await _create_credential(client, headers)
        proof = await _obtain_proof(client, headers, private_key)
        proven = {**headers, VAULT_PROOF_HEADER: proof}

        assert (
            await client.delete(f"/api/v1/credentials/{first}", headers=proven)
        ).status_code == 204
        # Same proof covers a batch within its lifetime
        assert (
            await client.delete(f"/api/v1/credentials/{second}", headers=proven)
        ).status_code == 204
        assert (
            await client.get(f"/api/v1/credentials/{first}", headers=headers)
        ).status_code == 404

    @pytest.mark.asyncio
    async def test_expired_proof_is_refused(self, client: AsyncClient, db_session):
        user, private_key, headers = await _user_with_vault(db_session)
        credential_id = await _create_credential(client, headers)
        proof = await _obtain_proof(client, headers, private_key)

        user.vault_proof_expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await db_session.commit()

        response = await client.delete(
            f"/api/v1/credentials/{credential_id}",
            headers={**headers, VAULT_PROOF_HEADER: proof},
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_proof_is_per_user(self, client: AsyncClient, db_session):
        _, private_key, headers = await _user_with_vault(db_session, "one@example.com")
        _, _, other_headers = await _user_with_vault(db_session, "two@example.com")
        other_credential = await _create_credential(client, other_headers)
        proof = await _obtain_proof(client, headers, private_key)

        # A valid proof from user one does nothing for user two's token
        response = await client.delete(
            f"/api/v1/credentials/{other_credential}",
            headers={**other_headers, VAULT_PROOF_HEADER: proof},
        )
        assert response.status_code == 403


class TestVaultRekey:
    @pytest.mark.asyncio
    async def test_rekey_requires_proof(self, client: AsyncClient, db_session):
        _, _, headers = await _user_with_vault(db_session)
        response = await client.put(
            "/api/v1/auth/vault/keys",
            headers=headers,
            json={"encrypted_private_key": "new-blob", "key_salt": "new-salt", "kdf_version": 2},
        )
        assert response.status_code == 403

        keys = await client.get("/api/v1/auth/vault/keys", headers=headers)
        assert keys.json()["encrypted_private_key"] == "client-side-blob"

    @pytest.mark.asyncio
    async def test_rekey_replaces_wrapping_only(self, client: AsyncClient, db_session):
        user, private_key, headers = await _user_with_vault(db_session)
        original_public_key = user.public_key
        proof = await _obtain_proof(client, headers, private_key)

        response = await client.put(
            "/api/v1/auth/vault/keys",
            headers={**headers, VAULT_PROOF_HEADER: proof},
            json={"encrypted_private_key": "new-blob", "key_salt": "new-salt", "kdf_version": 2},
        )
        assert response.status_code == 200

        keys = await client.get("/api/v1/auth/vault/keys", headers=headers)
        body = keys.json()
        assert body["encrypted_private_key"] == "new-blob"
        assert body["key_salt"] == "new-salt"
        assert body["kdf_version"] == 2
        assert body["public_key"] == original_public_key


class TestUpdateRequiresProofForCiphertext:
    @pytest.mark.asyncio
    async def test_overwriting_ciphertext_requires_proof(self, client: AsyncClient, db_session):
        _, private_key, headers = await _user_with_vault(db_session)
        credential_id = await _create_credential(client, headers)

        response = await client.patch(
            f"/api/v1/credentials/{credential_id}",
            headers=headers,
            json={"encrypted_data": "bmV3LWNpcGhlcnRleHQ="},
        )
        assert response.status_code == 403

        proof = await _obtain_proof(client, headers, private_key)
        response = await client.patch(
            f"/api/v1/credentials/{credential_id}",
            headers={**headers, VAULT_PROOF_HEADER: proof},
            json={"encrypted_data": "bmV3LWNpcGhlcnRleHQ="},
        )
        assert response.status_code == 200
        assert response.json()["encrypted_data"] == "bmV3LWNpcGhlcnRleHQ="

    @pytest.mark.asyncio
    async def test_metadata_only_update_needs_no_proof(self, client: AsyncClient, db_session):
        _, _, headers = await _user_with_vault(db_session)
        credential_id = await _create_credential(client, headers)

        response = await client.patch(
            f"/api/v1/credentials/{credential_id}",
            headers=headers,
            json={"expires_at": "2027-01-01T00:00:00Z"},
        )
        assert response.status_code == 200
