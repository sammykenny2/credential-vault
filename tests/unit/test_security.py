"""Tests for security utilities."""

import time

import pytest
from argon2 import PasswordHasher
from fastapi import Response

from app.core.security import RECENT_LOGIN_SECONDS, REFRESH_COOKIE_NAME, SecurityService
from app.core.session import issue_session, rotate_session
from app.models.user import User


class TestRecentLogin:
    """The check behind creating vault keys."""

    def test_the_boundary(self):
        now = int(time.time())
        assert SecurityService.is_recent_login({"auth_time": now})
        # A second to spare, so the clock moving on during the test cannot fail it.
        assert SecurityService.is_recent_login({"auth_time": now - RECENT_LOGIN_SECONDS + 1})
        assert not SecurityService.is_recent_login({"auth_time": now - RECENT_LOGIN_SECONDS - 1})

    @pytest.mark.parametrize("claim", [None, True, "0", 1.5, [], {}])
    def test_anything_but_an_integer_is_not_recent(self, claim):
        assert not SecurityService.is_recent_login({"auth_time": claim})

    def test_no_claim_is_not_recent(self):
        assert not SecurityService.is_recent_login({})

    def test_a_time_in_the_future_is_not_recent(self):
        assert not SecurityService.is_recent_login({"auth_time": int(time.time()) + 3600})

    @staticmethod
    def _payloads(response: Response, token: str) -> tuple[dict, dict]:
        cookie = response.headers["set-cookie"].split(";")[0]
        assert cookie.startswith(f"{REFRESH_COOKIE_NAME}=")
        refresh = cookie.split("=", 1)[1]
        return SecurityService.decode_token(token), SecurityService.decode_token(refresh)

    def test_signing_in_stamps_both_tokens_with_now(self):
        response = Response()

        token = issue_session(User(id="user-1", token_version=0), response)

        for payload in self._payloads(response, token.access_token):
            assert abs(payload["auth_time"] - time.time()) < 60

    def test_rotating_keeps_the_original_sign_in_time(self):
        response = Response()

        token = rotate_session(User(id="user-1", token_version=0), response, 1234)

        for payload in self._payloads(response, token.access_token):
            assert payload["auth_time"] == 1234

    @pytest.mark.parametrize("claim", [None, "1234", True])
    def test_rotating_never_invents_a_sign_in_time(self, claim):
        response = Response()

        token = rotate_session(User(id="user-1", token_version=0), response, claim)

        for payload in self._payloads(response, token.access_token):
            assert "auth_time" not in payload


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
