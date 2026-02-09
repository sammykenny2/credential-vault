"""Tests for security utilities."""

from app.core.security import SecurityService


class TestPasswordHashing:
    """Test password hashing functions."""

    def test_hash_password(self):
        """Test that password hashing produces a hash."""
        password = "testpassword123"
        hashed = SecurityService.hash_password(password)

        assert hashed != password
        assert len(hashed) > 0
        assert hashed.startswith("$2b$")  # bcrypt prefix

    def test_hash_password_different_each_time(self):
        """Test that hashing the same password produces different hashes."""
        password = "testpassword123"
        hash1 = SecurityService.hash_password(password)
        hash2 = SecurityService.hash_password(password)

        # Due to random salt, hashes should differ
        assert hash1 != hash2

    def test_verify_password_correct(self):
        """Test that correct password verifies successfully."""
        password = "testpassword123"
        hashed = SecurityService.hash_password(password)

        assert SecurityService.verify_password(password, hashed) is True

    def test_verify_password_incorrect(self):
        """Test that incorrect password fails verification."""
        password = "testpassword123"
        wrong_password = "wrongpassword"
        hashed = SecurityService.hash_password(password)

        assert SecurityService.verify_password(wrong_password, hashed) is False

    def test_verify_password_empty(self):
        """Test that empty password fails verification."""
        password = "testpassword123"
        hashed = SecurityService.hash_password(password)

        assert SecurityService.verify_password("", hashed) is False


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
