"""Helpers for tests of signed vaults.

The server treats record signatures as opaque, so backend tests can use a fixed
value for them. Proof v2 is checked by the server, so those tests sign for real.
All keys here are generated per test; nothing is real or persisted.
"""

import base64
import uuid
from dataclasses import dataclass

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from httpx import AsyncClient

from app.core.security import SecurityService
from app.core.vault_proof import VAULT_PROOF_HEADER, signed_proof_message
from app.models.user import User
from app.services.user import UserService

OPAQUE_SIGNATURE = "A" * 86 + "=="


def spki_b64(public_key) -> str:
    return base64.b64encode(
        public_key.public_bytes(
            serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo
        )
    ).decode()


def new_signing_public_key() -> str:
    return spki_b64(ec.generate_private_key(ec.SECP256R1()).public_key())


def sign_proof(nonce: str, key: ec.EllipticCurvePrivateKey) -> str:
    der = key.sign(signed_proof_message(nonce), ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der)
    raw = r.to_bytes(32, "big") + s.to_bytes(32, "big")
    signature = base64.urlsafe_b64encode(raw).rstrip(b"=").decode()
    return f"v2.{nonce}.{signature}"


@dataclass
class SignedVault:
    user: User
    signing_key: ec.EllipticCurvePrivateKey
    headers: dict[str, str]


async def signed_vault_user(db_session, email: str = "signed@example.com") -> SignedVault:
    """A user whose vault is signed, with the signing key held by the test."""
    rsa_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    signing_key = ec.generate_private_key(ec.SECP256R1())
    service = UserService(db_session)
    user = await service.create_oauth_user(
        email=email, display_name="Signed", google_id=f"google-{email}"
    )
    await service.setup_vault_keys(
        user=user,
        public_key=spki_b64(rsa_key.public_key()),
        encrypted_private_key="client-side-bundle",
        key_salt="client-side-salt",
        signing_public_key=spki_b64(signing_key.public_key()),
    )
    await db_session.commit()
    token = SecurityService.create_access_token(user.id, user.token_version)
    return SignedVault(user, signing_key, {"Authorization": f"Bearer {token}"})


async def proven_headers(client: AsyncClient, vault: SignedVault) -> dict[str, str]:
    """Session headers plus a fresh proof v2."""
    response = await client.post("/api/v1/auth/vault/challenge", headers=vault.headers)
    assert response.status_code == 200
    body = response.json()
    assert body["version"] == 2
    assert 60 <= body["expires_in"] <= 300
    assert "challenge" not in body
    return {**vault.headers, VAULT_PROOF_HEADER: sign_proof(body["nonce"], vault.signing_key)}


async def user_with_signed_vault(db_session, email: str = "vault@example.com"):
    """Same shape as test_api_vault_proof._user_with_vault, for tests of proven routes."""
    vault = await signed_vault_user(db_session, email)
    return vault.user, vault.signing_key, vault.headers


async def obtain_signed_proof(client: AsyncClient, headers: dict, signing_key) -> str:
    response = await client.post("/api/v1/auth/vault/challenge", headers=headers)
    assert response.status_code == 200
    return sign_proof(response.json()["nonce"], signing_key)


def signed_fields(revision: int = 1, origin: str = "authored") -> dict:
    return {
        "revision": revision,
        "signature": OPAQUE_SIGNATURE,
        "signature_version": 1,
        "origin": origin,
    }


def new_record(encrypted_data: str = "Y2lwaGVydGV4dA==", **overrides) -> dict:
    """Body for POST /credentials."""
    return {
        "id": str(uuid.uuid4()),
        "encrypted_data": encrypted_data,
        **signed_fields(),
        **overrides,
    }


async def create_record(client: AsyncClient, headers: dict, **overrides) -> dict:
    response = await client.post(
        "/api/v1/credentials", headers=headers, json=new_record(**overrides)
    )
    assert response.status_code == 201, response.text
    return response.json()
