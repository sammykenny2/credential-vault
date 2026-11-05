"""Integration tests for credentials API endpoints."""

import uuid

import pytest
from httpx import AsyncClient

from app.core.security import SecurityService
from app.services.user import UserService
from tests.integration.test_api_vault_proof import _obtain_proof, _user_with_vault
from tests.vault_helpers import (
    OPAQUE_SIGNATURE,
    create_record,
    new_record,
    proven_headers,
    signed_fields,
    signed_vault_user,
)


class TestCredentialsAPI:
    """Test credentials endpoints."""

    @pytest.mark.asyncio
    async def test_create_credential(self, client: AsyncClient, db_session, test_credential_data):
        """A created record stores only ciphertext and the signed state."""
        vault = await signed_vault_user(db_session)
        headers = await proven_headers(client, vault)

        response = await client.post(
            "/api/v1/credentials",
            headers=headers,
            json=new_record(encrypted_data=test_credential_data["encrypted_data"]),
        )

        assert response.status_code == 201
        data = response.json()
        assert data["encrypted_data"] == test_credential_data["encrypted_data"]
        assert data["is_active"] is True
        assert data["revision"] == 1
        assert data["signature"] == OPAQUE_SIGNATURE
        assert data["signature_version"] == 1
        assert data["origin"] == "authored"
        # No plaintext metadata fields
        assert "name" not in data
        assert "description" not in data

    @pytest.mark.asyncio
    async def test_client_id_is_required_and_cannot_be_reused(
        self, client: AsyncClient, db_session
    ):
        vault = await signed_vault_user(db_session)
        headers = await proven_headers(client, vault)
        client_id = "2f9c1b7e-4a5d-4c3e-9b8a-1d2e3f4a5b6c"

        created = await create_record(client, headers, id=client_id)
        assert created["id"] == client_id

        duplicate = await client.post(
            "/api/v1/credentials", headers=headers, json=new_record(id=client_id)
        )
        assert duplicate.status_code == 409

        invalid = await client.post(
            "/api/v1/credentials", headers=headers, json=new_record(id="not-a-uuid")
        )
        assert invalid.status_code == 422

        body = new_record()
        del body["id"]
        missing = await client.post("/api/v1/credentials", headers=headers, json=body)
        assert missing.status_code == 422

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "change",
        [
            {"signature": None},
            {"signature": "too-short"},
            {"signature": "A" * 88},
            {"origin": "trusted-by-server"},
            {"origin": None},
            {"signature_version": 2},
            {"revision": 2},
        ],
    )
    async def test_records_without_a_valid_signed_state_are_refused(
        self, client: AsyncClient, db_session, change
    ):
        vault = await signed_vault_user(db_session)
        headers = await proven_headers(client, vault)

        response = await client.post(
            "/api/v1/credentials", headers=headers, json={**new_record(), **change}
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_every_write_requires_proof(self, client: AsyncClient, db_session):
        """A session token alone cannot create, import, update or revoke."""
        vault = await signed_vault_user(db_session)
        record = await create_record(client, await proven_headers(client, vault))
        attempts = [
            client.post("/api/v1/credentials", headers=vault.headers, json=new_record()),
            client.post(
                "/api/v1/credentials/import",
                headers=vault.headers,
                json={"credentials": [new_record()]},
            ),
            client.patch(
                f"/api/v1/credentials/{record['id']}",
                headers=vault.headers,
                json={"expires_at": "2027-01-01T00:00:00Z", **signed_fields(2)},
            ),
            client.post(
                f"/api/v1/credentials/{record['id']}/revoke",
                headers=vault.headers,
                json={"revoked_at": "2027-01-01T00:00:00Z", **signed_fields(2)},
            ),
        ]
        for attempt in attempts:
            assert (await attempt).status_code == 403

    @pytest.mark.asyncio
    async def test_vault_not_upgraded_cannot_store_records(self, client: AsyncClient, db_session):
        """Browsers refuse unsigned records, so accepting one would only hide data."""
        _, private_key, headers = await _user_with_vault(db_session)
        proof = await _obtain_proof(client, headers, private_key)

        response = await client.post(
            "/api/v1/credentials",
            headers={**headers, "X-Vault-Proof": proof},
            json=new_record(),
        )
        assert response.status_code == 409
        assert "upgrade" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_update_needs_the_next_revision(self, client: AsyncClient, db_session):
        vault = await signed_vault_user(db_session)
        headers = await proven_headers(client, vault)
        record = await create_record(client, headers)
        url = f"/api/v1/credentials/{record['id']}"

        applied = await client.patch(
            url,
            headers=headers,
            json={"encrypted_data": "bmV3LWNpcGhlcnRleHQ=", **signed_fields(2)},
        )
        assert applied.status_code == 200
        assert applied.json()["revision"] == 2
        assert applied.json()["encrypted_data"] == "bmV3LWNpcGhlcnRleHQ="

        # A second writer that read revision 1 must not overwrite revision 2.
        stale = await client.patch(
            url,
            headers=headers,
            json={"encrypted_data": "c3RhbGU=", **signed_fields(2)},
        )
        assert stale.status_code == 409
        current = await client.get(url, headers=headers)
        assert current.json()["encrypted_data"] == "bmV3LWNpcGhlcnRleHQ="
        assert current.json()["revision"] == 2

        skipped = await client.patch(
            url,
            headers=headers,
            json={"encrypted_data": "c2tpcA==", **signed_fields(9)},
        )
        assert skipped.status_code == 409

    @pytest.mark.asyncio
    async def test_explicit_null_ciphertext_keeps_the_stored_one(
        self, client: AsyncClient, db_session
    ):
        vault = await signed_vault_user(db_session)
        headers = await proven_headers(client, vault)
        record = await create_record(client, headers)

        response = await client.patch(
            f"/api/v1/credentials/{record['id']}",
            headers=headers,
            json={"encrypted_data": None, **signed_fields(2)},
        )
        assert response.status_code == 200
        assert response.json()["encrypted_data"] == record["encrypted_data"]

    @pytest.mark.asyncio
    async def test_expiry_update_keeps_ciphertext_and_replaces_signed_state(
        self, client: AsyncClient, db_session
    ):
        vault = await signed_vault_user(db_session)
        headers = await proven_headers(client, vault)
        record = await create_record(client, headers)

        response = await client.patch(
            f"/api/v1/credentials/{record['id']}",
            headers=headers,
            json={
                "expires_at": "2027-01-01T00:00:00.000Z",
                **signed_fields(2, origin="legacy-unverified"),
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["encrypted_data"] == record["encrypted_data"]
        assert data["expires_at"].startswith("2027-01-01T00:00:00")
        assert data["origin"] == "legacy-unverified"

    @pytest.mark.asyncio
    async def test_offset_timestamps_are_stored_as_the_same_instant(
        self, client: AsyncClient, db_session
    ):
        """The signature covers the instant, so an offset must not shift it."""
        vault = await signed_vault_user(db_session)
        headers = await proven_headers(client, vault)

        created = await create_record(client, headers, expires_at="2027-01-01T08:00:00+08:00")
        assert created["expires_at"].startswith("2027-01-01T00:00:00")

    @pytest.mark.asyncio
    async def test_import_is_signed_and_keeps_client_ids(self, client: AsyncClient, db_session):
        """Import keeps ids, skipping ones that already exist or repeat."""
        vault = await signed_vault_user(db_session)
        headers = await proven_headers(client, vault)
        client_id = "7a1d2c3b-5e6f-4a7b-8c9d-0e1f2a3b4c5d"

        response = await client.post(
            "/api/v1/credentials/import",
            headers=headers,
            json={
                "credentials": [
                    new_record(id=client_id, encrypted_data="Zmlyc3Q=", origin="legacy-unverified"),
                    new_record(id=client_id, encrypted_data="ZHVwbGljYXRl"),
                    new_record(encrypted_data="c2Vjb25k", expires_at="2027-01-01T00:00:00Z"),
                ]
            },
        )
        assert response.status_code == 200
        assert response.json()["imported"] == 2
        assert response.json()["skipped"] == 1

        imported = await client.get(f"/api/v1/credentials/{client_id}", headers=headers)
        assert imported.json()["origin"] == "legacy-unverified"
        assert imported.json()["signature"] == OPAQUE_SIGNATURE
        assert imported.json()["encrypted_data"] == "Zmlyc3Q="

        export = await client.get("/api/v1/credentials/export", headers=headers)
        assert export.status_code == 200
        exported = export.json()["credentials"]
        assert export.json()["count"] == 2
        assert {c["id"] for c in exported} >= {client_id}
        assert all(c["signature"] == OPAQUE_SIGNATURE for c in exported)

    @pytest.mark.asyncio
    async def test_import_refuses_unsigned_records(self, client: AsyncClient, db_session):
        vault = await signed_vault_user(db_session)
        headers = await proven_headers(client, vault)

        response = await client.post(
            "/api/v1/credentials/import",
            headers=headers,
            json={"credentials": [{"id": str(uuid.uuid4()), "encrypted_data": "Zmlyc3Q="}]},
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_list_returns_everything_needed_to_verify(self, client: AsyncClient, db_session):
        vault = await signed_vault_user(db_session)
        headers = await proven_headers(client, vault)
        for i in range(3):
            await create_record(client, headers, encrypted_data=f"opaque-encrypted-blob-{i}")

        response = await client.get("/api/v1/credentials", headers=vault.headers)

        assert response.status_code == 200
        data = response.json()
        assert len(data) == 3
        for field in (
            "encrypted_data",
            "revision",
            "signature",
            "signature_version",
            "origin",
            "is_active",
            "expires_at",
            "revoked_at",
        ):
            assert field in data[0]

    @pytest.mark.asyncio
    async def test_get_credential(self, client: AsyncClient, db_session, test_credential_data):
        vault = await signed_vault_user(db_session)
        headers = await proven_headers(client, vault)
        record = await create_record(
            client, headers, encrypted_data=test_credential_data["encrypted_data"]
        )

        response = await client.get(f"/api/v1/credentials/{record['id']}", headers=vault.headers)

        assert response.status_code == 200
        assert response.json()["id"] == record["id"]
        assert response.json()["encrypted_data"] == test_credential_data["encrypted_data"]

    @pytest.mark.asyncio
    async def test_revoke_stores_the_signed_timestamp(self, client: AsyncClient, db_session):
        """The server must keep the client's revoked_at, because the signature covers it."""
        vault = await signed_vault_user(db_session)
        headers = await proven_headers(client, vault)
        record = await create_record(client, headers)
        url = f"/api/v1/credentials/{record['id']}/revoke"

        response = await client.post(
            url,
            headers=headers,
            json={"revoked_at": "2026-11-05T01:02:03.456Z", **signed_fields(2)},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["is_active"] is False
        assert data["revoked_at"].startswith("2026-11-05T01:02:03.456")
        assert data["revision"] == 2

        again = await client.post(
            url,
            headers=headers,
            json={"revoked_at": "2026-11-05T01:02:03.456Z", **signed_fields(3)},
        )
        assert again.status_code == 400

    @pytest.mark.asyncio
    async def test_stale_revoke_is_refused(self, client: AsyncClient, db_session):
        vault = await signed_vault_user(db_session)
        headers = await proven_headers(client, vault)
        record = await create_record(client, headers)

        response = await client.post(
            f"/api/v1/credentials/{record['id']}/revoke",
            headers=headers,
            json={"revoked_at": "2026-11-05T01:02:03Z", **signed_fields(5)},
        )
        assert response.status_code == 409
        current = await client.get(f"/api/v1/credentials/{record['id']}", headers=headers)
        assert current.json()["is_active"] is True

    @pytest.mark.asyncio
    async def test_a_response_is_only_sent_after_the_commit(
        self, client: AsyncClient, db_session, monkeypatch
    ):
        """A failed commit must not reach the client as a success."""
        vault = await signed_vault_user(db_session)
        headers = await proven_headers(client, vault)

        async def failing_commit():
            raise RuntimeError("disk full")

        monkeypatch.setattr(db_session, "commit", failing_commit)
        with pytest.raises(RuntimeError, match="disk full"):
            await client.post("/api/v1/credentials", headers=headers, json=new_record())

    @pytest.mark.asyncio
    async def test_credential_isolation(self, client: AsyncClient, db_session):
        """Users cannot read or change each other's credentials."""
        owner = await signed_vault_user(db_session, "owner@example.com")
        record = await create_record(client, await proven_headers(client, owner))
        other = await signed_vault_user(db_session, "other@example.com")
        other_headers = await proven_headers(client, other)
        url = f"/api/v1/credentials/{record['id']}"

        assert (await client.get(url, headers=other.headers)).status_code == 404
        assert (await client.delete(url, headers=other_headers)).status_code == 404
        patched = await client.patch(
            url, headers=other_headers, json={"encrypted_data": "eA==", **signed_fields(2)}
        )
        assert patched.status_code == 404

    @pytest.mark.asyncio
    async def test_user_without_vault_gets_conflict_not_success(
        self, client: AsyncClient, db_session
    ):
        service = UserService(db_session)
        user = await service.create_oauth_user(
            email="novault2@example.com", display_name="N", google_id="google-novault2"
        )
        await db_session.commit()
        token = SecurityService.create_access_token(user.id)

        response = await client.post(
            "/api/v1/credentials",
            headers={"Authorization": f"Bearer {token}"},
            json=new_record(),
        )
        assert response.status_code == 409
