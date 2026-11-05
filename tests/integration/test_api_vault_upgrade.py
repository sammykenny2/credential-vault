"""Integration tests for the one-time upgrade of an RSA-only vault to a signed one."""

import uuid

import pytest
from httpx import AsyncClient

from app.core.vault_proof import VAULT_PROOF_HEADER
from app.models.credential import Credential
from app.services.credential import CredentialService
from tests.integration.test_api_vault_proof import _obtain_proof, _user_with_vault
from tests.vault_helpers import OPAQUE_SIGNATURE, new_signing_public_key


async def _legacy_record(db_session, user, encrypted_data="bGVnYWN5") -> Credential:
    record = Credential(owner_id=user.id, encrypted_data=encrypted_data)
    db_session.add(record)
    await db_session.commit()
    return record


def _adoption(record: Credential, **overrides) -> dict:
    return {
        "id": record.id,
        "revision": record.revision + 1,
        "signature": OPAQUE_SIGNATURE,
        "signature_version": 1,
        "origin": "legacy-unverified",
        **overrides,
    }


def _upgrade_body(adoptions: list[dict], **overrides) -> dict:
    return {
        "encrypted_private_key": "new-key-bundle",
        "signing_public_key": new_signing_public_key(),
        "adoptions": adoptions,
        **overrides,
    }


async def _proven(client: AsyncClient, headers: dict, private_key) -> dict:
    return {**headers, VAULT_PROOF_HEADER: await _obtain_proof(client, headers, private_key)}


class TestVaultUpgrade:
    @pytest.mark.asyncio
    async def test_upgrade_signs_every_record_without_touching_ciphertext(
        self, client: AsyncClient, db_session
    ):
        user, private_key, headers = await _user_with_vault(db_session)
        first = await _legacy_record(db_session, user, "Zmlyc3Q=")
        second = await _legacy_record(db_session, user, "c2Vjb25k")
        original_public_key = user.public_key

        response = await client.post(
            "/api/v1/auth/vault/upgrade",
            headers=await _proven(client, headers, private_key),
            json=_upgrade_body([_adoption(first), _adoption(second)]),
        )
        assert response.status_code == 200
        assert response.json()["adopted"] == 2

        rows = (
            await client.get(
                "/api/v1/credentials", params={"include_revoked": True}, headers=headers
            )
        ).json()
        assert {r["encrypted_data"] for r in rows} == {"Zmlyc3Q=", "c2Vjb25k"}
        assert all(r["revision"] == 2 for r in rows)
        assert all(r["origin"] == "legacy-unverified" for r in rows)
        assert all(r["signature"] == OPAQUE_SIGNATURE for r in rows)

        keys = (await client.get("/api/v1/auth/vault/keys", headers=headers)).json()
        assert keys["encrypted_private_key"] == "new-key-bundle"
        assert keys["public_key"] == original_public_key

        await db_session.refresh(user)
        assert user.signing_public_key is not None

    @pytest.mark.asyncio
    async def test_empty_vault_can_upgrade(self, client: AsyncClient, db_session):
        _, private_key, headers = await _user_with_vault(db_session)
        response = await client.post(
            "/api/v1/auth/vault/upgrade",
            headers=await _proven(client, headers, private_key),
            json=_upgrade_body([]),
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_after_upgrade_the_vault_needs_proof_v2(self, client: AsyncClient, db_session):
        _, private_key, headers = await _user_with_vault(db_session)
        proven = await _proven(client, headers, private_key)
        await client.post("/api/v1/auth/vault/upgrade", headers=proven, json=_upgrade_body([]))

        rekey = await client.put(
            "/api/v1/auth/vault/keys",
            headers=proven,
            json={"encrypted_private_key": "x", "key_salt": "y", "kdf_version": 2},
        )
        assert rekey.status_code == 403

        challenge = (await client.post("/api/v1/auth/vault/challenge", headers=headers)).json()
        assert challenge["version"] == 2
        assert "challenge" not in challenge

    @pytest.mark.asyncio
    async def test_upgrade_requires_proof(self, client: AsyncClient, db_session):
        _, _, headers = await _user_with_vault(db_session)
        response = await client.post(
            "/api/v1/auth/vault/upgrade", headers=headers, json=_upgrade_body([])
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_upgrade_cannot_replace_an_existing_signing_key(
        self, client: AsyncClient, db_session
    ):
        """Otherwise someone with the RSA key could swap the key the server trusts."""
        user, private_key, headers = await _user_with_vault(db_session)
        proven = await _proven(client, headers, private_key)
        first = await client.post(
            "/api/v1/auth/vault/upgrade", headers=proven, json=_upgrade_body([])
        )
        assert first.status_code == 200
        await db_session.refresh(user)
        registered = user.signing_public_key

        # The proof is still valid, so this reaches the guard rather than the proof check.
        second = await client.post(
            "/api/v1/auth/vault/upgrade", headers=proven, json=_upgrade_body([])
        )
        assert second.status_code == 409
        assert "already upgraded" in second.json()["detail"]
        await db_session.refresh(user)
        assert user.signing_public_key == registered

    @pytest.mark.asyncio
    @pytest.mark.parametrize("bad_key", ["not-base64!", "AAAA", ""])
    async def test_upgrade_refuses_invalid_signing_keys(
        self, client: AsyncClient, db_session, bad_key
    ):
        _, private_key, headers = await _user_with_vault(db_session)
        response = await client.post(
            "/api/v1/auth/vault/upgrade",
            headers=await _proven(client, headers, private_key),
            json=_upgrade_body([], signing_public_key=bad_key),
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_upgrade_refuses_a_key_that_is_not_p256(self, client: AsyncClient, db_session):
        user, private_key, headers = await _user_with_vault(db_session)
        response = await client.post(
            "/api/v1/auth/vault/upgrade",
            headers=await _proven(client, headers, private_key),
            json=_upgrade_body([], signing_public_key=user.public_key),
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_adoptions_must_cover_every_record(self, client: AsyncClient, db_session):
        """Nothing is stored unless no record would be left unsigned."""
        user, private_key, headers = await _user_with_vault(db_session)
        first = await _legacy_record(db_session, user)
        await _legacy_record(db_session, user)

        response = await client.post(
            "/api/v1/auth/vault/upgrade",
            headers=await _proven(client, headers, private_key),
            json=_upgrade_body([_adoption(first)]),
        )
        assert response.status_code == 409

        await db_session.refresh(user)
        assert user.signing_public_key is None
        await db_session.refresh(first)
        assert first.signature is None
        assert first.revision == 1

    @pytest.mark.asyncio
    async def test_adoptions_cannot_touch_other_records(self, client: AsyncClient, db_session):
        user, private_key, headers = await _user_with_vault(db_session)
        other_user, _, _ = await _user_with_vault(db_session, "other@example.com")
        mine = await _legacy_record(db_session, user)
        theirs = await _legacy_record(db_session, other_user)

        response = await client.post(
            "/api/v1/auth/vault/upgrade",
            headers=await _proven(client, headers, private_key),
            json=_upgrade_body([_adoption(mine), _adoption(theirs)]),
        )
        assert response.status_code == 409
        await db_session.refresh(theirs)
        assert theirs.signature is None

    @pytest.mark.asyncio
    async def test_duplicate_or_unknown_adoptions_are_refused(
        self, client: AsyncClient, db_session
    ):
        user, private_key, headers = await _user_with_vault(db_session)
        record = await _legacy_record(db_session, user)
        adoption = _adoption(record)
        proven = await _proven(client, headers, private_key)

        duplicate = await client.post(
            "/api/v1/auth/vault/upgrade",
            headers=proven,
            json=_upgrade_body([adoption, adoption]),
        )
        assert duplicate.status_code == 409

        unknown = await client.post(
            "/api/v1/auth/vault/upgrade",
            headers=proven,
            json=_upgrade_body([adoption, {**adoption, "id": str(uuid.uuid4())}]),
        )
        assert unknown.status_code == 409

    @pytest.mark.asyncio
    async def test_a_refused_adoption_undoes_the_key_change(
        self, client: AsyncClient, db_session, monkeypatch
    ):
        """The signing key is claimed first, so a refusal after that must roll it back."""
        user, private_key, headers = await _user_with_vault(db_session)
        await _legacy_record(db_session, user)
        proven = await _proven(client, headers, private_key)

        async def refuse(self, owner_id, adoptions):
            return False

        monkeypatch.setattr(CredentialService, "adopt_all", refuse)
        response = await client.post(
            "/api/v1/auth/vault/upgrade", headers=proven, json=_upgrade_body([])
        )
        assert response.status_code == 409

        await db_session.refresh(user)
        assert user.signing_public_key is None
        assert user.encrypted_private_key == "client-side-blob"

    @pytest.mark.asyncio
    async def test_stale_revisions_are_refused(self, client: AsyncClient, db_session):
        user, private_key, headers = await _user_with_vault(db_session)
        record = await _legacy_record(db_session, user)

        response = await client.post(
            "/api/v1/auth/vault/upgrade",
            headers=await _proven(client, headers, private_key),
            json=_upgrade_body([_adoption(record, revision=5)]),
        )
        assert response.status_code == 409

    @pytest.mark.asyncio
    async def test_adoptions_cannot_claim_authorship(self, client: AsyncClient, db_session):
        """Signing an old record stops later forgery; it does not prove who wrote it."""
        user, private_key, headers = await _user_with_vault(db_session)
        record = await _legacy_record(db_session, user)

        response = await client.post(
            "/api/v1/auth/vault/upgrade",
            headers=await _proven(client, headers, private_key),
            json=_upgrade_body([_adoption(record, origin="authored")]),
        )
        assert response.status_code == 422
