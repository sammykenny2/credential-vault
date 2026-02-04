"""Tests for cryptographic utilities."""

import pytest

from src.core.crypto import (
    CredentialCrypto,
    decrypt_data,
    decrypt_string,
    encrypt_data,
    encrypt_string,
)


class TestEncryptDecrypt:
    """Test basic encryption/decryption functions."""

    def test_encrypt_decrypt_data_simple(self):
        """Test encrypting and decrypting a simple dictionary."""
        original = {"key": "value", "number": 123}
        encrypted = encrypt_data(original)

        # Encrypted should be a non-empty string
        assert isinstance(encrypted, str)
        assert len(encrypted) > 0

        # Decrypted should match original
        decrypted = decrypt_data(encrypted)
        assert decrypted == original

    def test_encrypt_decrypt_data_unicode(self):
        """Test encrypting and decrypting unicode data."""
        original = {"name": "日本語", "emoji": "🔐", "mixed": "Hello 世界"}
        encrypted = encrypt_data(original)
        decrypted = decrypt_data(encrypted)
        assert decrypted == original

    def test_encrypt_decrypt_data_nested(self):
        """Test encrypting and decrypting nested data."""
        original = {
            "user": {"name": "Test", "age": 30},
            "tags": ["a", "b", "c"],
            "active": True,
        }
        encrypted = encrypt_data(original)
        decrypted = decrypt_data(encrypted)
        assert decrypted == original

    def test_encrypt_produces_different_output(self):
        """Test that encrypting the same data twice produces different ciphertext."""
        original = {"key": "value"}
        encrypted1 = encrypt_data(original)
        encrypted2 = encrypt_data(original)

        # Due to random nonce, outputs should differ
        assert encrypted1 != encrypted2

        # But both should decrypt to the same value
        assert decrypt_data(encrypted1) == decrypt_data(encrypted2) == original

    def test_decrypt_invalid_data_raises_error(self):
        """Test that decrypting invalid data raises ValueError."""
        with pytest.raises(ValueError):
            decrypt_data("not-valid-base64!!!")

        with pytest.raises(ValueError):
            decrypt_data("dGVzdA==")  # Valid base64 but not encrypted data

    def test_encrypt_decrypt_string(self):
        """Test encrypting and decrypting a single string."""
        original = "secret password"
        encrypted = encrypt_string(original)
        decrypted = decrypt_string(encrypted)
        assert decrypted == original

    def test_encrypt_decrypt_empty_dict(self):
        """Test encrypting and decrypting an empty dictionary."""
        original = {}
        encrypted = encrypt_data(original)
        decrypted = decrypt_data(encrypted)
        assert decrypted == original


class TestCredentialCrypto:
    """Test CredentialCrypto class."""

    def test_encrypt_decrypt_full_credential(self):
        """Test encrypting and decrypting a complete credential."""
        encrypted = CredentialCrypto.encrypt_credential(
            username="myuser",
            password="mypass123",
            notes="Important notes",
            custom_fields={"api_key": "abc123", "token": "xyz789"},
        )

        decrypted = CredentialCrypto.decrypt_credential(encrypted)

        assert decrypted["username"] == "myuser"
        assert decrypted["password"] == "mypass123"
        assert decrypted["notes"] == "Important notes"
        assert decrypted["custom_fields"]["api_key"] == "abc123"
        assert decrypted["custom_fields"]["token"] == "xyz789"

    def test_encrypt_decrypt_partial_credential(self):
        """Test encrypting and decrypting a credential with only some fields."""
        encrypted = CredentialCrypto.encrypt_credential(
            username="justuser",
            password="justpass",
        )

        decrypted = CredentialCrypto.decrypt_credential(encrypted)

        assert decrypted["username"] == "justuser"
        assert decrypted["password"] == "justpass"
        assert "notes" not in decrypted
        assert "custom_fields" not in decrypted

    def test_encrypt_decrypt_credential_with_special_chars(self):
        """Test encrypting credentials with special characters."""
        encrypted = CredentialCrypto.encrypt_credential(
            username="user@domain.com",
            password="P@$$w0rd!#%&*()[]{}",
            notes="Notes with\nnewlines\tand\ttabs",
        )

        decrypted = CredentialCrypto.decrypt_credential(encrypted)

        assert decrypted["username"] == "user@domain.com"
        assert decrypted["password"] == "P@$$w0rd!#%&*()[]{}",
        assert decrypted["notes"] == "Notes with\nnewlines\tand\ttabs"

    def test_re_encrypt(self):
        """Test re-encrypting data."""
        original_encrypted = CredentialCrypto.encrypt_credential(
            username="test",
            password="pass",
        )

        # Re-encrypt
        re_encrypted = CredentialCrypto.re_encrypt(original_encrypted)

        # Should be different ciphertext
        assert re_encrypted != original_encrypted

        # But same plaintext
        original_data = CredentialCrypto.decrypt_credential(original_encrypted)
        re_encrypted_data = CredentialCrypto.decrypt_credential(re_encrypted)
        assert original_data == re_encrypted_data
