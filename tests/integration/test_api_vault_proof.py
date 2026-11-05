"""Integration tests for proof of vault unlock.

Proof v2 (signed vaults) guards every write; proof v1 (RSA with a dedicated OAEP
label) only remains so a vault that has not been upgraded can authorize the upgrade.
"""

import base64
import json
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa
from httpx import AsyncClient

from app.config import get_settings
from app.core import vault_proof
from app.core.security import SecurityService
from app.core.vault_proof import (
    VAULT_PROOF_HEADER,
    VAULT_PROOF_OAEP_LABEL,
    signed_proof_message,
    verify_proof_signature,
)
from app.services.user import UserService
from tests.vault_helpers import (
    create_record,
    new_signing_public_key,
    proven_headers,
    sign_proof,
    signed_vault_user,
)

# Lives under frontend/ so the frontend image build can type-check its test.
VECTORS = json.loads(
    (
        Path(__file__).parents[2] / "frontend/src/__tests__/fixtures/vault_signature_vectors.json"
    ).read_text(encoding="utf-8")
)

OAEP = padding.OAEP(
    mgf=padding.MGF1(algorithm=hashes.SHA256()),
    algorithm=hashes.SHA256(),
    label=VAULT_PROOF_OAEP_LABEL,
)


async def _user_with_vault(db_session, email="vault@example.com"):
    """A vault that has not been upgraded: RSA only, so it answers proof v1."""
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
    assert body["version"] == 1
    assert body["expires_in"] > 0
    secret = private_key.decrypt(base64.b64decode(body["challenge"]), OAEP)
    encoded = base64.urlsafe_b64encode(secret).rstrip(b"=").decode()
    return f"v1.{body['ticket']}.{encoded}"


class TestProofV1:
    @pytest.mark.asyncio
    async def test_challenge_requires_its_oaep_domain(self, client: AsyncClient, db_session):
        _, private_key, headers = await _user_with_vault(db_session)
        response = await client.post("/api/v1/auth/vault/challenge", headers=headers)
        assert response.status_code == 200
        unlabeled = padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None,
        )
        with pytest.raises(ValueError):
            private_key.decrypt(base64.b64decode(response.json()["challenge"]), unlabeled)

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
        assert proof.startswith("v1.")

    @pytest.mark.asyncio
    async def test_new_challenges_do_not_invalidate_an_upgrade_proof(
        self, client: AsyncClient, db_session
    ):
        """An RSA-only vault must upgrade to unlock, so a stolen token must not block that."""
        _, private_key, headers = await _user_with_vault(db_session)
        proof = await _obtain_proof(client, headers, private_key)

        for _ in range(5):
            response = await client.post("/api/v1/auth/vault/challenge", headers=headers)
            assert response.status_code == 200

        response = await client.post(
            "/api/v1/auth/vault/upgrade",
            headers={**headers, VAULT_PROOF_HEADER: proof},
            json={
                "encrypted_private_key": "bundle",
                "signing_public_key": new_signing_public_key(),
                "adoptions": [],
            },
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "bogus",
        [
            "not a proof",
            "v1.only-two",
            "v2.AAAA.AAAA",
            "v1.AAAA.AAAA",
            "v1." + "A" * 400,
        ],
    )
    async def test_malformed_upgrade_proofs_are_refused(
        self, client: AsyncClient, db_session, bogus
    ):
        _, _, headers = await _user_with_vault(db_session)
        response = await client.post(
            "/api/v1/auth/vault/upgrade",
            headers={**headers, VAULT_PROOF_HEADER: bogus},
            json={
                "encrypted_private_key": "bundle",
                "signing_public_key": new_signing_public_key(),
                "adoptions": [],
            },
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_upgrade_proof_is_bound_to_user_and_session_version(
        self, client: AsyncClient, db_session
    ):
        user, private_key, headers = await _user_with_vault(db_session)
        _, _, other_headers = await _user_with_vault(db_session, "other@example.com")
        proof = await _obtain_proof(client, headers, private_key)
        body = {
            "encrypted_private_key": "bundle",
            "signing_public_key": new_signing_public_key(),
            "adoptions": [],
        }

        other = await client.post(
            "/api/v1/auth/vault/upgrade",
            headers={**other_headers, VAULT_PROOF_HEADER: proof},
            json=body,
        )
        assert other.status_code == 403

        user.token_version += 1
        await db_session.commit()
        fresh = SecurityService.create_access_token(user.id, user.token_version)
        revoked = await client.post(
            "/api/v1/auth/vault/upgrade",
            headers={"Authorization": f"Bearer {fresh}", VAULT_PROOF_HEADER: proof},
            json=body,
        )
        assert revoked.status_code == 403

    @pytest.mark.asyncio
    async def test_upgrade_proof_expires(self, client: AsyncClient, db_session, monkeypatch):
        _, private_key, headers = await _user_with_vault(db_session)
        proof = await _obtain_proof(client, headers, private_key)
        real_time = vault_proof.time.time
        monkeypatch.setattr(
            vault_proof.time, "time", lambda: real_time() + vault_proof.PROOF_TTL_SECONDS + 1
        )
        response = await client.post(
            "/api/v1/auth/vault/upgrade",
            headers={**headers, VAULT_PROOF_HEADER: proof},
            json={
                "encrypted_private_key": "bundle",
                "signing_public_key": new_signing_public_key(),
                "adoptions": [],
            },
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_secret_key_alone_cannot_forge_an_upgrade_proof(
        self, client: AsyncClient, db_session
    ):
        """Without the per-user key, a leaked SECRET_KEY cannot replace a vault's keys."""
        user, private_key, headers = await _user_with_vault(db_session)
        await _obtain_proof(client, headers, private_key)
        ticket = vault_proof._new_expiring_payload()
        encode = vault_proof._b64url_encode
        body = {
            "encrypted_private_key": "attacker-bundle",
            "signing_public_key": new_signing_public_key(),
            "adoptions": [],
        }

        for guess in ("", "a" * 64):
            secret = vault_proof._upgrade_secret(
                get_settings().secret_key, user.id, user.token_version, guess, ticket
            )
            response = await client.post(
                "/api/v1/auth/vault/upgrade",
                headers={**headers, VAULT_PROOF_HEADER: f"v1.{encode(ticket)}.{encode(secret)}"},
                json=body,
            )
            assert response.status_code == 403

        keys = await client.get("/api/v1/auth/vault/keys", headers=headers)
        assert keys.json()["encrypted_private_key"] == "client-side-blob"

    @pytest.mark.asyncio
    async def test_proof_key_is_stable_and_never_returned(self, client: AsyncClient, db_session):
        user, private_key, headers = await _user_with_vault(db_session)
        await _obtain_proof(client, headers, private_key)
        await db_session.refresh(user)
        key = user.vault_proof_key
        assert key

        await _obtain_proof(client, headers, private_key)
        await db_session.refresh(user)
        assert user.vault_proof_key == key

        for url in ("/api/v1/auth/me", "/api/v1/users/me", "/api/v1/auth/vault/keys"):
            response = await client.get(url, headers=headers)
            assert response.status_code == 200
            assert key not in response.text

    @pytest.mark.asyncio
    async def test_proof_v1_authorizes_nothing_but_the_upgrade(
        self, client: AsyncClient, db_session
    ):
        """An RSA-only vault upgrades first; a v1 proof cannot rekey or delete."""
        _, private_key, headers = await _user_with_vault(db_session)
        proven = {**headers, VAULT_PROOF_HEADER: await _obtain_proof(client, headers, private_key)}

        rekey = await client.put(
            "/api/v1/auth/vault/keys",
            headers=proven,
            json={"encrypted_private_key": "new-blob", "key_salt": "new-salt", "kdf_version": 2},
        )
        assert rekey.status_code == 403
        keys = await client.get("/api/v1/auth/vault/keys", headers=headers)
        assert keys.json()["encrypted_private_key"] == "client-side-blob"

        delete = await client.delete(
            "/api/v1/credentials/7a1d2c3b-5e6f-4a7b-8c9d-0e1f2a3b4c5d", headers=proven
        )
        assert delete.status_code == 403


class TestProofV2Vectors:
    def test_message_and_signature_from_web_crypto_verify(self):
        """A signature made by the browser's Web Crypto verifies in Python, and vice versa."""
        vector = VECTORS["proof"]
        assert signed_proof_message(vector["nonce"]).decode() == vector["message"]
        signature = base64.urlsafe_b64decode(vector["signature"] + "==")
        assert verify_proof_signature(vector["nonce"], signature, vector["spki"])
        assert not verify_proof_signature(vector["nonce"] + "x", signature, vector["spki"])

    def test_shared_constants_match_the_frontend(self):
        assert VECTORS["proof_v1_oaep_label"] == VAULT_PROOF_OAEP_LABEL.decode()


class TestProofV2:
    @pytest.mark.asyncio
    async def test_delete_without_proof_is_refused(self, client: AsyncClient, db_session):
        vault = await signed_vault_user(db_session)
        record = await create_record(client, await proven_headers(client, vault))

        response = await client.delete(f"/api/v1/credentials/{record['id']}", headers=vault.headers)
        assert response.status_code == 403
        assert "Vault proof" in response.json()["detail"]

        still_there = await client.get(f"/api/v1/credentials/{record['id']}", headers=vault.headers)
        assert still_there.status_code == 200

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "bogus",
        [
            "not a proof",
            "v2.only-two-parts",
            "v1.AAAA.AAAA",
            "v2.AAAA.AAAA",
            base64.b64encode(b"\x00" * 32).decode(),
            "v2." + "A" * 400,
        ],
    )
    async def test_malformed_proofs_are_refused(self, client: AsyncClient, db_session, bogus):
        vault = await signed_vault_user(db_session)
        record = await create_record(client, await proven_headers(client, vault))

        response = await client.delete(
            f"/api/v1/credentials/{record['id']}",
            headers={**vault.headers, VAULT_PROOF_HEADER: bogus},
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_signature_from_another_key_is_refused(self, client: AsyncClient, db_session):
        vault = await signed_vault_user(db_session)
        record = await create_record(client, await proven_headers(client, vault))
        nonce = (await client.post("/api/v1/auth/vault/challenge", headers=vault.headers)).json()[
            "nonce"
        ]
        forged = sign_proof(nonce, ec.generate_private_key(ec.SECP256R1()))

        response = await client.delete(
            f"/api/v1/credentials/{record['id']}",
            headers={**vault.headers, VAULT_PROOF_HEADER: forged},
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_nonce_the_server_did_not_issue_is_refused(self, client: AsyncClient, db_session):
        vault = await signed_vault_user(db_session)
        record = await create_record(client, await proven_headers(client, vault))
        invented = sign_proof(
            base64.urlsafe_b64encode(b"\x01" * 56).rstrip(b"=").decode(), vault.signing_key
        )

        response = await client.delete(
            f"/api/v1/credentials/{record['id']}",
            headers={**vault.headers, VAULT_PROOF_HEADER: invented},
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_proof_is_reusable_within_its_lifetime(self, client: AsyncClient, db_session):
        vault = await signed_vault_user(db_session)
        proven = await proven_headers(client, vault)
        first = await create_record(client, proven)
        second = await create_record(client, proven)

        for record in (first, second):
            response = await client.delete(f"/api/v1/credentials/{record['id']}", headers=proven)
            assert response.status_code == 204
        gone = await client.get(f"/api/v1/credentials/{first['id']}", headers=vault.headers)
        assert gone.status_code == 404

    @pytest.mark.asyncio
    async def test_new_challenges_do_not_invalidate_a_live_proof(
        self, client: AsyncClient, db_session
    ):
        """A stolen session token asking for challenges cannot lock the owner out."""
        vault = await signed_vault_user(db_session)
        proven = await proven_headers(client, vault)

        for _ in range(20):
            response = await client.post("/api/v1/auth/vault/challenge", headers=vault.headers)
            assert response.status_code == 200

        await create_record(client, proven)

    @pytest.mark.asyncio
    async def test_signed_vault_can_rekey_with_proof_v2(self, client: AsyncClient, db_session):
        vault = await signed_vault_user(db_session)
        rekey = {"encrypted_private_key": "new-bundle", "key_salt": "new-salt", "kdf_version": 2}

        refused = await client.put("/api/v1/auth/vault/keys", headers=vault.headers, json=rekey)
        assert refused.status_code == 403

        response = await client.put(
            "/api/v1/auth/vault/keys", headers=await proven_headers(client, vault), json=rekey
        )
        assert response.status_code == 200
        body = (await client.get("/api/v1/auth/vault/keys", headers=vault.headers)).json()
        assert body["encrypted_private_key"] == "new-bundle"
        assert body["public_key"] == vault.user.public_key

    @pytest.mark.asyncio
    async def test_expired_proof_is_refused(self, client: AsyncClient, db_session, monkeypatch):
        vault = await signed_vault_user(db_session)
        proven = await proven_headers(client, vault)
        real_time = vault_proof.time.time
        monkeypatch.setattr(
            vault_proof.time, "time", lambda: real_time() + vault_proof.PROOF_TTL_SECONDS + 1
        )

        response = await client.post(
            "/api/v1/credentials",
            headers=proven,
            json={},
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_logout_revokes_outstanding_proofs(self, client: AsyncClient, db_session):
        vault = await signed_vault_user(db_session)
        proven = await proven_headers(client, vault)
        vault.user.token_version += 1
        await db_session.commit()

        fresh_token = SecurityService.create_access_token(vault.user.id, vault.user.token_version)
        response = await client.post(
            "/api/v1/credentials",
            headers={
                "Authorization": f"Bearer {fresh_token}",
                VAULT_PROOF_HEADER: proven[VAULT_PROOF_HEADER],
            },
            json={},
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_proof_is_per_user(self, client: AsyncClient, db_session):
        one = await signed_vault_user(db_session, "one@example.com")
        two = await signed_vault_user(db_session, "two@example.com")
        record = await create_record(client, await proven_headers(client, two))
        proof_of_one = (await proven_headers(client, one))[VAULT_PROOF_HEADER]

        response = await client.delete(
            f"/api/v1/credentials/{record['id']}",
            headers={**two.headers, VAULT_PROOF_HEADER: proof_of_one},
        )
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_signed_vault_rejects_proof_v1(self, client: AsyncClient, db_session):
        """An upgraded vault can never fall back to returning an RSA decryption."""
        vault = await signed_vault_user(db_session)
        record = await create_record(client, await proven_headers(client, vault))
        ticket = vault_proof._new_expiring_payload()
        secret = vault_proof._upgrade_secret(
            get_settings().secret_key,
            vault.user.id,
            vault.user.token_version,
            "a" * 64,
            ticket,
        )
        encode = vault_proof._b64url_encode

        response = await client.delete(
            f"/api/v1/credentials/{record['id']}",
            headers={
                **vault.headers,
                VAULT_PROOF_HEADER: f"v1.{encode(ticket)}.{encode(secret)}",
            },
        )
        assert response.status_code == 403
