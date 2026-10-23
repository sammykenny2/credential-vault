"""Proof of vault unlock for destructive operations.

Holding a session token is not enough to delete or overwrite ciphertext: the
client must prove it currently holds the unlocked private key. The server
encrypts a random challenge with the user's RSA-OAEP public key (the same key
the browser generated at vault setup); only the decrypted private key can
recover it. The client sends the plaintext back in the ``X-Vault-Proof``
header. A proof stays valid for a few minutes so batch operations need a
single round trip, and the server stores only a hash of the expected value.
"""

import base64
import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

VAULT_PROOF_HEADER = "X-Vault-Proof"
PROOF_TTL_SECONDS = 300
CHALLENGE_BYTES = 32

_OAEP = padding.OAEP(
    mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None
)


def create_challenge(public_key_spki_b64: str) -> tuple[str, str, datetime]:
    """Encrypt a fresh random secret for the given SPKI public key.

    Returns ``(challenge_b64, secret_sha256_hex, expires_at)``. Only the hash
    is persisted; the plaintext secret never leaves this function.

    Raises:
        ValueError: the stored public key is not a usable RSA key.
    """
    try:
        public_key = serialization.load_der_public_key(base64.b64decode(public_key_spki_b64))
    except (ValueError, TypeError) as exc:
        raise ValueError("Stored vault public key is not valid SPKI DER") from exc
    if not isinstance(public_key, rsa.RSAPublicKey):
        raise ValueError("Stored vault public key is not an RSA key")

    secret = secrets.token_bytes(CHALLENGE_BYTES)
    ciphertext = public_key.encrypt(secret, _OAEP)
    expires_at = datetime.now(UTC) + timedelta(seconds=PROOF_TTL_SECONDS)
    return (
        base64.b64encode(ciphertext).decode("ascii"),
        hashlib.sha256(secret).hexdigest(),
        expires_at,
    )


def verify_proof(
    proof_b64: str | None,
    stored_hash: str | None,
    expires_at: datetime | None,
) -> bool:
    """True when ``proof_b64`` is the secret behind ``stored_hash`` and it has not expired."""
    if not proof_b64 or not stored_hash or expires_at is None:
        return False

    # SQLite hands back naive datetimes; treat them as UTC.
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    if expires_at < datetime.now(UTC):
        return False

    try:
        secret = base64.b64decode(proof_b64, validate=True)
    except (ValueError, TypeError):
        return False
    if len(secret) != CHALLENGE_BYTES:
        return False

    return hmac.compare_digest(hashlib.sha256(secret).hexdigest(), stored_hash)
