"""Proof of vault unlock.

Holding a session token is not enough to change vault data or accounts: the
client must prove it currently holds the unlocked vault key.

Proof v2 (signed vaults). The server hands out a nonce; the browser signs it
with the ECDSA key from the KEK-protected bundle. The nonce is stateless: an
HMAC binds it to the user, the current ``token_version`` and an expiry, so
issuing one cannot invalidate another, several tabs do not interfere, and a
stolen session token cannot lock the owner out by asking for challenges. Logout
bumps ``token_version``, which revokes outstanding proofs. A proof stays valid
for a few minutes so batch operations need a single round trip.

Proof v1 (vaults not upgraded yet). The server encrypts a secret to the RSA
public key under a dedicated OAEP label, and the client returns the plaintext.
Credential AES keys are wrapped with the same RSA key, so the label is what
stops a malicious server from using this as a decryption oracle. It is also
stateless, because an RSA-only vault must upgrade before it can unlock: a secret
rewritten per challenge would let a stolen session token block that. The secret is
derived with a per-user key as well as SECRET_KEY, so SECRET_KEY alone cannot forge
a proof and replace a vault's keys. Proof v1 only authorizes the one-time upgrade
to a signed vault, nothing else.
"""

import base64
import binascii
import hashlib
import hmac
import json
import secrets
import time

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

VAULT_PROOF_HEADER = "X-Vault-Proof"
PROOF_TTL_SECONDS = 300
VAULT_PROOF_OAEP_LABEL = b"credential-vault/vault-proof/v1"

SIGNED_PROOF_DOMAIN = "credential-vault/vault-proof"
SIGNED_PROOF_VERSION = 2
SIGNED_PROOF_PREFIX = "v2"
NONCE_MAC_DOMAIN = b"credential-vault/vault-proof-nonce/v2"
UPGRADE_PROOF_VERSION = 1
UPGRADE_PROOF_PREFIX = "v1"
UPGRADE_SECRET_DOMAIN = b"credential-vault/vault-proof-secret/v1"
ECDSA_P256_SIGNATURE_BYTES = 64
_NONCE_RANDOM_BYTES = 16
_NONCE_EXPIRY_BYTES = 8
_NONCE_MAC_BYTES = 32
_MAX_PROOF_HEADER_LENGTH = 256

_OAEP = padding.OAEP(
    mgf=padding.MGF1(algorithm=hashes.SHA256()),
    algorithm=hashes.SHA256(),
    label=VAULT_PROOF_OAEP_LABEL,
)


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(text: str) -> bytes:
    """Strict base64url without padding. Raises ValueError on anything else."""
    if not text or "=" in text:
        raise ValueError("Invalid base64url")
    raw = base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
    if _b64url_encode(raw) != text:
        raise ValueError("Non-canonical base64url")
    return raw


def parse_signing_public_key(spki_b64: str) -> ec.EllipticCurvePublicKey:
    """Parse an ECDSA P-256 SPKI public key. Raises ValueError for anything else."""
    try:
        key = serialization.load_der_public_key(base64.b64decode(spki_b64, validate=True))
    except (ValueError, TypeError, binascii.Error) as exc:
        raise ValueError("Signing public key is not valid SPKI DER") from exc
    if not isinstance(key, ec.EllipticCurvePublicKey) or not isinstance(key.curve, ec.SECP256R1):
        raise ValueError("Signing public key is not ECDSA P-256")
    return key


def signed_proof_message(nonce: str) -> bytes:
    """The exact bytes the browser signs; JSON.stringify produces the same encoding."""
    return json.dumps(
        [SIGNED_PROOF_DOMAIN, SIGNED_PROOF_VERSION, nonce], separators=(",", ":")
    ).encode("ascii")


def _bound_mac(
    domain: bytes, secret_key: str, user_id: str, token_version: int, payload: bytes
) -> bytes:
    """HMAC binding a fixed-length payload to the user and current token_version."""
    message = b"\x00".join([domain, user_id.encode(), str(token_version).encode(), payload])
    return hmac.new(secret_key.encode(), message, hashlib.sha256).digest()


def _new_expiring_payload() -> bytes:
    expires_at = int(time.time()) + PROOF_TTL_SECONDS
    return secrets.token_bytes(_NONCE_RANDOM_BYTES) + expires_at.to_bytes(
        _NONCE_EXPIRY_BYTES, "big"
    )


def _payload_expired(payload: bytes) -> bool:
    return int.from_bytes(payload[_NONCE_RANDOM_BYTES:], "big") < time.time()


def create_signed_challenge(user_id: str, token_version: int, secret_key: str) -> str:
    """Issue a nonce for proof v2. Nothing is stored server-side."""
    payload = _new_expiring_payload()
    mac = _bound_mac(NONCE_MAC_DOMAIN, secret_key, user_id, token_version, payload)
    return _b64url_encode(payload + mac)


def verify_proof_signature(nonce: str, signature: bytes, signing_public_key_b64: str) -> bool:
    """True when ``signature`` (raw r||s) signs the proof message for ``nonce``."""
    if len(signature) != ECDSA_P256_SIGNATURE_BYTES:
        return False
    half = ECDSA_P256_SIGNATURE_BYTES // 2
    der = encode_dss_signature(
        int.from_bytes(signature[:half], "big"), int.from_bytes(signature[half:], "big")
    )
    try:
        parse_signing_public_key(signing_public_key_b64).verify(
            der, signed_proof_message(nonce), ec.ECDSA(hashes.SHA256())
        )
    except InvalidSignature, ValueError:
        return False
    return True


def verify_signed_proof(
    proof: str | None,
    user_id: str,
    token_version: int,
    secret_key: str,
    signing_public_key_b64: str,
) -> bool:
    """Check an ``X-Vault-Proof`` header of the form ``v2.<nonce>.<signature>``."""
    if not proof or len(proof) > _MAX_PROOF_HEADER_LENGTH:
        return False
    parts = proof.split(".")
    if len(parts) != 3 or parts[0] != SIGNED_PROOF_PREFIX:
        return False
    nonce, encoded_signature = parts[1], parts[2]

    try:
        raw_nonce = _b64url_decode(nonce)
        signature = _b64url_decode(encoded_signature)
    except ValueError, binascii.Error:
        return False

    payload_length = _NONCE_RANDOM_BYTES + _NONCE_EXPIRY_BYTES
    if len(raw_nonce) != payload_length + _NONCE_MAC_BYTES:
        return False
    payload, mac = raw_nonce[:payload_length], raw_nonce[payload_length:]
    expected = _bound_mac(NONCE_MAC_DOMAIN, secret_key, user_id, token_version, payload)
    if not hmac.compare_digest(mac, expected) or _payload_expired(payload):
        return False

    return verify_proof_signature(nonce, signature, signing_public_key_b64)


def _upgrade_secret(
    secret_key: str, user_id: str, token_version: int, proof_key: str, ticket: bytes
) -> bytes:
    return _bound_mac(
        UPGRADE_SECRET_DOMAIN,
        secret_key,
        user_id,
        token_version,
        proof_key.encode() + b"\x00" + ticket,
    )


def create_upgrade_challenge(
    public_key_spki_b64: str, user_id: str, token_version: int, secret_key: str, proof_key: str
) -> tuple[str, str]:
    """Proof v1: encrypt a derived secret for the given SPKI public key.

    Returns ``(challenge_b64, ticket)``. The secret is derived from the ticket with
    an HMAC, so nothing per-challenge is stored and a new one invalidates nothing.

    Raises:
        ValueError: the stored public key is not a usable RSA key.
    """
    try:
        public_key = serialization.load_der_public_key(base64.b64decode(public_key_spki_b64))
    except (ValueError, TypeError) as exc:
        raise ValueError("Stored vault public key is not valid SPKI DER") from exc
    if not isinstance(public_key, rsa.RSAPublicKey):
        raise ValueError("Stored vault public key is not an RSA key")

    ticket = _new_expiring_payload()
    secret = _upgrade_secret(secret_key, user_id, token_version, proof_key, ticket)
    ciphertext = public_key.encrypt(secret, _OAEP)
    return base64.b64encode(ciphertext).decode("ascii"), _b64url_encode(ticket)


def verify_upgrade_proof(
    proof: str | None, user_id: str, token_version: int, secret_key: str, proof_key: str | None
) -> bool:
    """Check an ``X-Vault-Proof`` header of the form ``v1.<ticket>.<secret>``."""
    if not proof or not proof_key or len(proof) > _MAX_PROOF_HEADER_LENGTH:
        return False
    parts = proof.split(".")
    if len(parts) != 3 or parts[0] != UPGRADE_PROOF_PREFIX:
        return False

    try:
        ticket = _b64url_decode(parts[1])
        secret = _b64url_decode(parts[2])
    except ValueError, binascii.Error:
        return False

    if len(ticket) != _NONCE_RANDOM_BYTES + _NONCE_EXPIRY_BYTES or _payload_expired(ticket):
        return False
    expected = _upgrade_secret(secret_key, user_id, token_version, proof_key, ticket)
    return hmac.compare_digest(secret, expected)
