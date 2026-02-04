"""Cryptographic utilities for credential encryption.

This module provides symmetric encryption for storing sensitive data.
Credentials are encrypted using AES-256-GCM with per-record random nonces.

Security considerations:
- ENCRYPTION_KEY should be a 32-byte (256-bit) key
- Each encryption generates a unique nonce (never reuse)
- Authentication tag prevents tampering
"""

import base64
import json
import secrets
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from src.config import get_settings

settings = get_settings()

# Nonce size for AES-GCM (96 bits = 12 bytes is recommended)
NONCE_SIZE = 12


def _get_key() -> bytes:
    """Get encryption key from settings, properly formatted."""
    key = settings.encryption_key.encode()
    # Ensure key is 32 bytes (256 bits)
    if len(key) < 32:
        # Pad with zeros (not ideal, but ensures consistency)
        key = key.ljust(32, b'\0')
    elif len(key) > 32:
        key = key[:32]
    return key


def encrypt_data(data: dict[str, Any]) -> str:
    """
    Encrypt a dictionary to a base64-encoded string.

    Format: base64(nonce + ciphertext + tag)

    Args:
        data: Dictionary to encrypt

    Returns:
        Base64-encoded encrypted string
    """
    key = _get_key()
    aesgcm = AESGCM(key)

    # Generate random nonce
    nonce = secrets.token_bytes(NONCE_SIZE)

    # Serialize data to JSON bytes
    plaintext = json.dumps(data, ensure_ascii=False).encode('utf-8')

    # Encrypt (ciphertext includes auth tag)
    ciphertext = aesgcm.encrypt(nonce, plaintext, None)

    # Combine nonce + ciphertext and encode to base64
    encrypted = base64.b64encode(nonce + ciphertext).decode('ascii')

    return encrypted


def decrypt_data(encrypted: str) -> dict[str, Any]:
    """
    Decrypt a base64-encoded string back to a dictionary.

    Args:
        encrypted: Base64-encoded encrypted string

    Returns:
        Decrypted dictionary

    Raises:
        ValueError: If decryption fails (invalid key, tampered data, etc.)
    """
    key = _get_key()
    aesgcm = AESGCM(key)

    try:
        # Decode from base64
        raw = base64.b64decode(encrypted.encode('ascii'))

        # Extract nonce and ciphertext
        nonce = raw[:NONCE_SIZE]
        ciphertext = raw[NONCE_SIZE:]

        # Decrypt
        plaintext = aesgcm.decrypt(nonce, ciphertext, None)

        # Parse JSON
        return json.loads(plaintext.decode('utf-8'))

    except Exception as e:
        raise ValueError(f"Decryption failed: {e}") from e


def encrypt_string(value: str) -> str:
    """
    Encrypt a single string value.

    Args:
        value: String to encrypt

    Returns:
        Base64-encoded encrypted string
    """
    return encrypt_data({"v": value})


def decrypt_string(encrypted: str) -> str:
    """
    Decrypt a single string value.

    Args:
        encrypted: Base64-encoded encrypted string

    Returns:
        Decrypted string

    Raises:
        ValueError: If decryption fails
    """
    data = decrypt_data(encrypted)
    return data["v"]


class CredentialCrypto:
    """
    High-level API for credential encryption.

    This class provides methods specifically for handling credential data,
    which includes username, password, notes, and custom fields.
    """

    @staticmethod
    def encrypt_credential(
        username: str | None = None,
        password: str | None = None,
        notes: str | None = None,
        custom_fields: dict[str, str] | None = None,
    ) -> str:
        """
        Encrypt credential data.

        Args:
            username: Account username
            password: Account password
            notes: Additional notes
            custom_fields: Custom key-value pairs

        Returns:
            Encrypted credential data as base64 string
        """
        data = {}
        if username is not None:
            data["username"] = username
        if password is not None:
            data["password"] = password
        if notes is not None:
            data["notes"] = notes
        if custom_fields is not None:
            data["custom_fields"] = custom_fields

        return encrypt_data(data)

    @staticmethod
    def decrypt_credential(encrypted: str) -> dict[str, Any]:
        """
        Decrypt credential data.

        Args:
            encrypted: Encrypted credential data

        Returns:
            Dictionary with username, password, notes, custom_fields

        Raises:
            ValueError: If decryption fails
        """
        return decrypt_data(encrypted)

    @staticmethod
    def re_encrypt(encrypted: str, new_key: bytes | None = None) -> str:
        """
        Re-encrypt data (useful for key rotation).

        Args:
            encrypted: Currently encrypted data
            new_key: New encryption key (if None, uses current key)

        Returns:
            Re-encrypted data
        """
        # Decrypt with current key
        data = decrypt_data(encrypted)

        # Re-encrypt (with same or new key)
        # Note: For actual key rotation, you'd need to temporarily
        # swap the key in settings or pass it explicitly
        return encrypt_data(data)
