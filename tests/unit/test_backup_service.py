"""Tests for backup encryption/decryption."""

import json

import pytest

from app.services.backup import _decrypt_backup, _encrypt_backup


class TestBackupEncryption:
    """Tests for backup encryption/decryption functions."""

    def test_encrypt_decrypt_roundtrip(self):
        """Test that data survives encrypt/decrypt cycle."""
        data = json.dumps({"test": "data", "number": 42})
        password = "test-password-123"

        encrypted = _encrypt_backup(data, password)
        decrypted = _decrypt_backup(encrypted, password)

        assert decrypted == data
        result = json.loads(decrypted)
        assert result["test"] == "data"
        assert result["number"] == 42

    def test_different_passwords_produce_different_output(self):
        """Test that different passwords produce different ciphertext."""
        data = "same data"
        enc1 = _encrypt_backup(data, "password1")
        enc2 = _encrypt_backup(data, "password2")
        assert enc1 != enc2

    def test_wrong_password_fails(self):
        """Test that wrong password raises error."""
        data = "secret data"
        encrypted = _encrypt_backup(data, "correct-password")

        with pytest.raises(Exception):
            _decrypt_backup(encrypted, "wrong-password")

    def test_large_data(self):
        """Test encryption of large data."""
        data = json.dumps({"items": [f"item_{i}" for i in range(1000)]})
        password = "test-password"

        encrypted = _encrypt_backup(data, password)
        decrypted = _decrypt_backup(encrypted, password)

        assert decrypted == data

    def test_unicode_data(self):
        """Test encryption of unicode data."""
        data = json.dumps({"text": "Hello 你好 こんにちは"})
        password = "test-password"

        encrypted = _encrypt_backup(data, password)
        decrypted = _decrypt_backup(encrypted, password)

        assert decrypted == data

    def test_empty_data(self):
        """Test encryption of empty string."""
        encrypted = _encrypt_backup("", "password")
        decrypted = _decrypt_backup(encrypted, "password")
        assert decrypted == ""
