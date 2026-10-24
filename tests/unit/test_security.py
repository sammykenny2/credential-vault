"""Tests for security utilities."""

from argon2 import PasswordHasher

from app.core.security import SecurityService


class TestJWT:
    """Test JWT token functions."""

    def test_create_access_token(self):
        """Test creating an access token."""
        user_id = "test-user-id-123"
        token = SecurityService.create_access_token(user_id)

        assert isinstance(token, str)
        assert len(token) > 0

    def test_create_refresh_token(self):
        """Test creating a refresh token."""
        user_id = "test-user-id-123"
        token = SecurityService.create_refresh_token(user_id)

        assert isinstance(token, str)
        assert len(token) > 0

    def test_decode_access_token(self):
        """Test decoding an access token."""
        user_id = "test-user-id-123"
        token = SecurityService.create_access_token(user_id)

        payload = SecurityService.decode_token(token)

        assert payload is not None
        assert payload["sub"] == user_id
        assert payload["type"] == "access"
        assert "exp" in payload

    def test_decode_refresh_token(self):
        """Test decoding a refresh token."""
        user_id = "test-user-id-123"
        token = SecurityService.create_refresh_token(user_id)

        payload = SecurityService.decode_token(token)

        assert payload is not None
        assert payload["sub"] == user_id
        assert payload["type"] == "refresh"
        assert "exp" in payload

    def test_decode_invalid_token(self):
        """Test that decoding an invalid token returns None."""
        invalid_token = "not.a.valid.token"
        payload = SecurityService.decode_token(invalid_token)

        assert payload is None

    def test_create_tokens(self):
        """Test creating both tokens at once."""
        user_id = "test-user-id-123"
        access_token, refresh_token = SecurityService.create_tokens(user_id)

        assert isinstance(access_token, str)
        assert isinstance(refresh_token, str)
        assert access_token != refresh_token

        access_payload = SecurityService.decode_token(access_token)
        refresh_payload = SecurityService.decode_token(refresh_token)

        assert access_payload["type"] == "access"
        assert refresh_payload["type"] == "refresh"


class TestPasswordHashing:
    """Test password hashing functions."""

    def test_hash_password(self):
        """Test password hashing produces a valid hash."""
        hashed = SecurityService.hash_password("test-password-123")

        assert isinstance(hashed, str)
        assert hashed != "test-password-123"
        assert hashed.startswith("$argon2id$")

    def test_verify_password_correct(self):
        """Test verifying correct password returns True."""
        password = "my-secure-password"
        hashed = SecurityService.hash_password(password)

        assert SecurityService.verify_password(password, hashed) is True

    def test_verify_password_incorrect(self):
        """Test verifying incorrect password returns False."""
        hashed = SecurityService.hash_password("correct-password")

        assert SecurityService.verify_password("wrong-password", hashed) is False

    def test_hash_uniqueness(self):
        """Test that hashing the same password produces different hashes (salting)."""
        password = "same-password"
        hash1 = SecurityService.hash_password(password)
        hash2 = SecurityService.hash_password(password)

        assert hash1 != hash2
        # Both should still verify
        assert SecurityService.verify_password(password, hash1) is True
        assert SecurityService.verify_password(password, hash2) is True

    def test_hash_from_before_the_switch_does_not_verify(self):
        """A bcrypt hash (passlib era) fails closed instead of raising."""
        bcrypt_hash = "$2b$12$C6UzMDM.H6dfI/f/IKcEeO5zBN6sR4w2gU6oR2l5bq3lB9W8y0Ewm"

        assert SecurityService.verify_password("anything", bcrypt_hash) is False
        assert SecurityService.verify_password("anything", "not a hash") is False

    def test_long_password_is_not_truncated(self):
        """Argon2 uses the whole password; bcrypt ignored everything past 72 bytes."""
        hashed = SecurityService.hash_password("x" * 100)

        assert SecurityService.verify_password("x" * 100, hashed) is True
        assert SecurityService.verify_password("x" * 72, hashed) is False

    def test_needs_rehash_only_for_weaker_parameters(self):
        weak = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1).hash("pw")

        assert SecurityService.password_needs_rehash(weak) is True
        assert SecurityService.password_needs_rehash(SecurityService.hash_password("pw")) is False
