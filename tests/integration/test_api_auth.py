"""Integration tests for authentication API endpoints."""

import time
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest
from argon2 import PasswordHasher
from httpx import AsyncClient

from app.config import Settings
from app.core.security import RECENT_LOGIN_SECONDS, SecurityService
from app.main import app
from app.models.user import UserRole
from app.services.user import UserService
from tests.vault_helpers import new_signing_public_key


class TestAuthAPI:
    """Test authentication endpoints."""

    async def _create_user_and_get_token(
        self, db_session, email="test@example.com"
    ) -> tuple[str, str]:
        """Helper to create an OAuth user and get a JWT token directly.

        Returns (access_token, user_id).
        """
        service = UserService(db_session)
        user = await service.create_oauth_user(
            email=email,
            display_name="Test User",
            google_id=f"google-{email}",
        )
        await db_session.commit()

        access_token = SecurityService.create_access_token(user.id, auth_time=int(time.time()))
        return access_token, user.id

    @pytest.mark.asyncio
    async def test_get_me_authenticated(self, client: AsyncClient, db_session, test_user_data):
        """Test getting current user info when authenticated."""
        token, _ = await self._create_user_and_get_token(db_session, email=test_user_data["email"])

        response = await client.get(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["email"] == test_user_data["email"]
        assert data["display_name"] == "Test User"
        assert "has_vault_keys" in data
        assert "has_google_linked" in data

    @pytest.mark.asyncio
    async def test_get_me_unauthenticated(self, client: AsyncClient):
        """Test getting current user info without authentication."""
        response = await client.get("/api/v1/auth/me")

        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_refresh_token(self, client: AsyncClient, db_session, test_user_data):
        """Test refreshing access token."""
        service = UserService(db_session)
        user = await service.create_oauth_user(
            email=test_user_data["email"],
            display_name=test_user_data["display_name"],
            google_id=test_user_data["google_id"],
        )
        await db_session.commit()

        refresh_token = SecurityService.create_refresh_token(user.id)

        response = await client.post(
            "/api/v1/auth/refresh",
            headers={"Cookie": f"refresh_token={refresh_token}"},
        )

        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert "expires_in" in data
        # The refresh token is only ever delivered as an HttpOnly cookie
        assert "refresh_token" not in data
        set_cookie = response.headers.get("set-cookie", "")
        assert "refresh_token=" in set_cookie
        assert "HttpOnly" in set_cookie
        assert "Path=/api/v1/auth" in set_cookie
        assert "SameSite=strict" in set_cookie.lower().replace("samesite=strict", "SameSite=strict")

    @pytest.mark.asyncio
    async def test_refresh_token_invalid(self, client: AsyncClient):
        """Test refresh with invalid token fails."""
        response = await client.post(
            "/api/v1/auth/refresh",
            headers={"Cookie": "refresh_token=invalid-token"},
        )

        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_refresh_token_missing_cookie(self, client: AsyncClient):
        """Refresh tokens are not accepted from the query string or body."""
        refresh_token = SecurityService.create_refresh_token("some-user")

        response = await client.post(
            "/api/v1/auth/refresh",
            params={"refresh_token": refresh_token},
            json={"refresh_token": refresh_token},
        )

        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_refresh_token_revoked_version(self, client: AsyncClient, db_session):
        """A refresh token issued before logout is rejected."""
        service = UserService(db_session)
        user = await service.create_oauth_user(
            email="revoked@example.com",
            display_name="Revoked",
            google_id="google-revoked",
        )
        user.token_version = 3
        await db_session.commit()

        stale = SecurityService.create_refresh_token(user.id, token_version=2)
        response = await client.post(
            "/api/v1/auth/refresh",
            headers={"Cookie": f"refresh_token={stale}"},
        )
        assert response.status_code == 401

        current = SecurityService.create_refresh_token(user.id, token_version=3)
        response = await client.post(
            "/api/v1/auth/refresh",
            headers={"Cookie": f"refresh_token={current}"},
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_access_token_stale_version_rejected(self, client: AsyncClient, db_session):
        """An access token whose version no longer matches the user is rejected."""
        service = UserService(db_session)
        user = await service.create_oauth_user(
            email="stale@example.com",
            display_name="Stale",
            google_id="google-stale",
        )
        user.token_version = 1
        await db_session.commit()

        stale = SecurityService.create_access_token(user.id, token_version=0)
        response = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {stale}"})
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_logout_revokes_all_tokens(self, client: AsyncClient, db_session):
        """Logout bumps token_version so every outstanding token stops working."""
        service = UserService(db_session)
        user = await service.create_oauth_user(
            email="logout@example.com",
            display_name="Logout",
            google_id="google-logout",
        )
        await db_session.commit()

        access_token, refresh_token = SecurityService.create_tokens(user.id, user.token_version)
        headers = {"Authorization": f"Bearer {access_token}"}

        response = await client.get("/api/v1/auth/me", headers=headers)
        assert response.status_code == 200

        response = await client.post("/api/v1/auth/logout", headers=headers)
        assert response.status_code == 200
        set_cookie = response.headers.get("set-cookie", "")
        assert "refresh_token=" in set_cookie
        assert "Max-Age=0" in set_cookie or "expires=" in set_cookie.lower()

        # Same access token is now rejected ...
        response = await client.get("/api/v1/auth/me", headers=headers)
        assert response.status_code == 401

        # ... and so is the refresh token issued alongside it
        response = await client.post(
            "/api/v1/auth/refresh",
            headers={"Cookie": f"refresh_token={refresh_token}"},
        )
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_vault_setup(self, client: AsyncClient, db_session, test_user_data):
        """Test setting up E2EE vault keys."""
        token, _ = await self._create_user_and_get_token(db_session, email=test_user_data["email"])

        response = await client.post(
            "/api/v1/auth/vault/setup",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "public_key": "test-public-key-base64",
                "encrypted_private_key": "test-encrypted-private-key-base64",
                "key_salt": "test-salt-base64",
                "signing_public_key": new_signing_public_key(),
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["message"] == "Vault keys configured successfully"

        keys = await client.get(
            "/api/v1/auth/vault/keys", headers={"Authorization": f"Bearer {token}"}
        )
        assert keys.status_code == 200
        assert keys.json()["kdf_version"] == 2
        assert keys.json()["public_key"] == "test-public-key-base64"

    @pytest.mark.asyncio
    async def test_vault_setup_requires_a_signing_key(
        self, client: AsyncClient, db_session, test_user_data
    ):
        """A new vault is signed from the start, so it never has unsigned records."""
        token, _ = await self._create_user_and_get_token(db_session, email=test_user_data["email"])
        body = {
            "public_key": "test-public-key-base64",
            "encrypted_private_key": "test-encrypted-private-key-base64",
            "key_salt": "test-salt-base64",
        }

        for bad in (body, {**body, "signing_public_key": "not-a-key"}):
            response = await client.post(
                "/api/v1/auth/vault/setup",
                headers={"Authorization": f"Bearer {token}"},
                json=bad,
            )
            assert response.status_code == 422

        keys = await client.get(
            "/api/v1/auth/vault/keys", headers={"Authorization": f"Bearer {token}"}
        )
        assert keys.status_code == 404

    @pytest.mark.asyncio
    async def test_vault_setup_duplicate(self, client: AsyncClient, db_session, test_user_data):
        """Test that vault setup fails if keys already exist."""
        token, _ = await self._create_user_and_get_token(db_session, email=test_user_data["email"])

        vault_data = {
            "public_key": "test-public-key-base64",
            "encrypted_private_key": "test-encrypted-private-key-base64",
            "key_salt": "test-salt-base64",
            "signing_public_key": new_signing_public_key(),
        }

        # First setup should succeed
        response = await client.post(
            "/api/v1/auth/vault/setup",
            headers={"Authorization": f"Bearer {token}"},
            json=vault_data,
        )
        assert response.status_code == 200

        # Second setup should fail
        response = await client.post(
            "/api/v1/auth/vault/setup",
            headers={"Authorization": f"Bearer {token}"},
            json=vault_data,
        )
        assert response.status_code == 400
        assert "already configured" in response.json()["detail"]


VAULT_KEYS = {
    "public_key": "test-public-key-base64",
    "encrypted_private_key": "test-encrypted-private-key-base64",
    "key_salt": "test-salt-base64",
}


class TestVaultSetupNeedsRecentSignIn:
    """A stale token must not install keys, which would pass every later vault proof."""

    @staticmethod
    async def _new_user(db_session, email="recent@example.com"):
        user = await UserService(db_session).create_oauth_user(
            email=email, display_name="Recent", google_id=f"google-{email}"
        )
        await db_session.commit()
        return user

    @staticmethod
    async def _setup(client: AsyncClient, token: str):
        return await client.post(
            "/api/v1/auth/vault/setup",
            headers={"Authorization": f"Bearer {token}"},
            json={**VAULT_KEYS, "signing_public_key": new_signing_public_key()},
        )

    @staticmethod
    async def _assert_refused_and_nothing_stored(client: AsyncClient, token: str, response):
        assert response.status_code == 403
        assert response.json()["detail"] == "recent_login_required"
        keys = await client.get(
            "/api/v1/auth/vault/keys", headers={"Authorization": f"Bearer {token}"}
        )
        assert keys.status_code == 404

    @pytest.mark.asyncio
    async def test_within_the_window_is_allowed(self, client: AsyncClient, db_session):
        user = await self._new_user(db_session)
        token = SecurityService.create_access_token(
            user.id, auth_time=int(time.time()) - RECENT_LOGIN_SECONDS + 60
        )

        response = await self._setup(client, token)

        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_past_the_window_is_refused(self, client: AsyncClient, db_session):
        user = await self._new_user(db_session)
        token = SecurityService.create_access_token(
            user.id, auth_time=int(time.time()) - RECENT_LOGIN_SECONDS - 60
        )

        response = await self._setup(client, token)

        await self._assert_refused_and_nothing_stored(client, token, response)

    @pytest.mark.asyncio
    async def test_a_token_from_before_this_check_is_refused(self, client: AsyncClient, db_session):
        user = await self._new_user(db_session)
        token = SecurityService.create_access_token(user.id)

        response = await self._setup(client, token)

        await self._assert_refused_and_nothing_stored(client, token, response)

    @pytest.mark.asyncio
    async def test_refreshing_does_not_make_a_session_recent(self, client: AsyncClient, db_session):
        """Otherwise a stolen refresh cookie could reopen the window at any time."""
        user = await self._new_user(db_session)
        signed_in_at = int(time.time()) - RECENT_LOGIN_SECONDS - 60
        refresh = SecurityService.create_refresh_token(user.id, auth_time=signed_in_at)

        refreshed = await client.post(
            "/api/v1/auth/refresh", headers={"Cookie": f"refresh_token={refresh}"}
        )
        assert refreshed.status_code == 200
        token = refreshed.json()["access_token"]
        assert SecurityService.decode_token(token)["auth_time"] == signed_in_at

        rotated = refreshed.cookies.get("refresh_token")
        assert SecurityService.decode_token(rotated)["auth_time"] == signed_in_at

        response = await self._setup(client, token)

        await self._assert_refused_and_nothing_stored(client, token, response)

    @pytest.mark.asyncio
    async def test_refreshing_an_older_token_does_not_add_a_sign_in_time(
        self, client: AsyncClient, db_session
    ):
        user = await self._new_user(db_session)
        refresh = SecurityService.create_refresh_token(user.id)

        refreshed = await client.post(
            "/api/v1/auth/refresh", headers={"Cookie": f"refresh_token={refresh}"}
        )
        assert refreshed.status_code == 200
        token = refreshed.json()["access_token"]
        assert "auth_time" not in SecurityService.decode_token(token)

        response = await self._setup(client, token)

        await self._assert_refused_and_nothing_stored(client, token, response)

    @pytest.mark.asyncio
    async def test_refreshing_keeps_a_recent_session_able_to_set_up(
        self, client: AsyncClient, db_session
    ):
        """The app gets its access token by refreshing after a Google sign-in."""
        user = await self._new_user(db_session)
        refresh = SecurityService.create_refresh_token(user.id, auth_time=int(time.time()))

        refreshed = await client.post(
            "/api/v1/auth/refresh", headers={"Cookie": f"refresh_token={refresh}"}
        )

        response = await self._setup(client, refreshed.json()["access_token"])

        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_signing_in_elsewhere_does_not_help_a_stolen_older_token(
        self, client: AsyncClient, db_session
    ):
        """The check reads the token's own sign-in, not the account's last login."""
        user = await self._new_user(db_session)
        token = SecurityService.create_access_token(
            user.id, auth_time=int(time.time()) - RECENT_LOGIN_SECONDS - 60
        )
        user.last_login_at = datetime.now(UTC)
        await db_session.commit()

        response = await self._setup(client, token)

        await self._assert_refused_and_nothing_stored(client, token, response)

    @pytest.mark.asyncio
    async def test_a_real_sign_in_can_set_up(self, client: AsyncClient, db_session):
        password = "correct-horse-battery"
        user = await self._new_user(db_session, email="breakglass@example.com")
        user.role = UserRole.ADMIN
        user.hashed_password = SecurityService.hash_password(password)
        await db_session.commit()

        login = await client.post(
            "/api/v1/auth/login",
            json={"email": "breakglass@example.com", "password": password},
        )
        assert login.status_code == 200
        token = login.json()["access_token"]
        assert abs(SecurityService.decode_token(token)["auth_time"] - time.time()) < 60

        response = await self._setup(client, token)

        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_a_google_sign_in_can_set_up_after_the_apps_refresh(self, client: AsyncClient):
        settings = Settings(
            _env_file=None,
            app_env="testing",
            google_client_id="client-id",
            google_client_secret="client-secret",
        )
        identity = {
            "google_id": "google-new",
            "email": "new-google@example.com",
            "display_name": "New",
        }
        with (
            patch("app.api.v1.oauth.get_settings", return_value=settings),
            patch(
                "app.api.v1.oauth.exchange_google_code",
                new_callable=AsyncMock,
                return_value=identity,
            ),
        ):
            signed_in = await client.post(
                "/api/v1/oauth/google/callback",
                json={"code": "code", "redirect_uri": "http://test/login"},
            )
        assert signed_in.status_code == 200
        refresh = signed_in.cookies.get("refresh_token")
        assert abs(SecurityService.decode_token(refresh)["auth_time"] - time.time()) < 60

        refreshed = await client.post(
            "/api/v1/auth/refresh", headers={"Cookie": f"refresh_token={refresh}"}
        )

        response = await self._setup(client, refreshed.json()["access_token"])

        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_creating_the_first_admin_can_set_up(self, client: AsyncClient):
        created = await client.post(
            "/api/v1/setup/admin",
            json={"email": "first@example.com", "password": "correct-horse-battery"},
        )
        assert created.status_code == 200

        response = await self._setup(client, created.json()["access_token"])

        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_password_guessing_with_a_token_is_rate_limited(
        self, client: AsyncClient, db_session
    ):
        """It would otherwise be a way around this check for a password account."""
        user = await self._new_user(db_session)
        user.hashed_password = SecurityService.hash_password("correct-horse-battery")
        await db_session.commit()
        token = SecurityService.create_access_token(user.id)

        app.state.limiter.reset()
        app.state.limiter.enabled = True
        try:
            codes = [
                (
                    await client.post(
                        "/api/v1/auth/verify-password",
                        headers={"Authorization": f"Bearer {token}"},
                        json={"password": "wrong-guess"},
                    )
                ).status_code
                for _ in range(11)
            ]
        finally:
            app.state.limiter.enabled = False
            app.state.limiter.reset()

        assert codes == [401] * 10 + [429]


class TestBreakGlassLogin:
    """Test break-glass local admin login."""

    @pytest.mark.asyncio
    async def test_local_login_success(self, client: AsyncClient, db_session):
        """Test that admin with hashed password can log in locally."""
        service = UserService(db_session)
        user = await service.create_oauth_user(
            email="admin@example.com",
            display_name="Admin",
            google_id="google-admin",
            role=UserRole.ADMIN,
        )
        user.hashed_password = SecurityService.hash_password("admin-secret-123")
        await db_session.commit()

        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "admin@example.com", "password": "admin-secret-123"},
        )

        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"
        assert "expires_in" in data
        # Refresh token must not be in the body; it is an HttpOnly cookie
        assert "refresh_token" not in data
        set_cookie = response.headers.get("set-cookie", "")
        assert "refresh_token=" in set_cookie
        assert "HttpOnly" in set_cookie

    @pytest.mark.asyncio
    async def test_local_login_rehashes_a_weaker_hash(self, client: AsyncClient, db_session):
        """A hash made with older, weaker Argon2 parameters is upgraded at login."""
        service = UserService(db_session)
        user = await service.create_oauth_user(
            email="admin@example.com",
            display_name="Admin",
            google_id="google-admin",
            role=UserRole.ADMIN,
        )
        weak = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)
        user.hashed_password = weak.hash("admin-secret-123")
        await db_session.commit()

        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "admin@example.com", "password": "admin-secret-123"},
        )

        assert response.status_code == 200
        await db_session.refresh(user)
        assert user.hashed_password is not None
        assert not SecurityService.password_needs_rehash(user.hashed_password)
        assert SecurityService.verify_password("admin-secret-123", user.hashed_password)

    @pytest.mark.asyncio
    async def test_local_login_rejects_a_hash_from_before_argon2(
        self, client: AsyncClient, db_session
    ):
        """An admin whose stored hash is bcrypt (pre-switch) cannot sign in with it."""
        service = UserService(db_session)
        user = await service.create_oauth_user(
            email="admin@example.com",
            display_name="Admin",
            google_id="google-admin",
            role=UserRole.ADMIN,
        )
        user.hashed_password = "$2b$12$C6UzMDM.H6dfI/f/IKcEeO5zBN6sR4w2gU6oR2l5bq3lB9W8y0Ewm"
        await db_session.commit()

        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "admin@example.com", "password": "anything"},
        )

        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_local_login_wrong_password(self, client: AsyncClient, db_session):
        """Test that wrong password returns 401."""
        service = UserService(db_session)
        user = await service.create_oauth_user(
            email="admin@example.com",
            display_name="Admin",
            google_id="google-admin",
            role=UserRole.ADMIN,
        )
        user.hashed_password = SecurityService.hash_password("correct-password")
        await db_session.commit()

        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "admin@example.com", "password": "wrong-password"},
        )

        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_local_login_non_admin(self, client: AsyncClient, db_session):
        """Test that non-admin users cannot use local login."""
        service = UserService(db_session)
        user = await service.create_oauth_user(
            email="user@example.com",
            display_name="User",
            google_id="google-user",
            role=UserRole.USER,
        )
        user.hashed_password = SecurityService.hash_password("user-password")
        await db_session.commit()

        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "user@example.com", "password": "user-password"},
        )

        # Same answer as a wrong password: the response must not reveal that
        # the address exists or lacks admin rights.
        assert response.status_code == 401
        assert response.json()["detail"] == "Invalid credentials"

    @pytest.mark.asyncio
    async def test_local_login_no_password(self, client: AsyncClient, db_session):
        """Test that admin without hashed_password cannot use local login."""
        service = UserService(db_session)
        await service.create_oauth_user(
            email="admin@example.com",
            display_name="Admin",
            google_id="google-admin",
            role=UserRole.ADMIN,
        )
        await db_session.commit()

        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "admin@example.com", "password": "any-password"},
        )

        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_local_login_nonexistent_user(self, client: AsyncClient):
        """Test that nonexistent email returns 401."""
        response = await client.post(
            "/api/v1/auth/login",
            json={"email": "nobody@example.com", "password": "password"},
        )

        assert response.status_code == 401


class TestVerifyPassword:
    """Test password verification endpoint."""

    @pytest.mark.asyncio
    async def test_verify_password_correct(self, client: AsyncClient, db_session):
        """Test that correct password returns verified=true."""
        service = UserService(db_session)
        user = await service.create_oauth_user(
            email="admin@example.com",
            display_name="Admin",
            google_id="setup-admin@example.com",
            role=UserRole.ADMIN,
        )
        user.hashed_password = SecurityService.hash_password("my-password")
        await db_session.commit()

        token = SecurityService.create_access_token(user.id)

        response = await client.post(
            "/api/v1/auth/verify-password",
            headers={"Authorization": f"Bearer {token}"},
            json={"password": "my-password"},
        )

        assert response.status_code == 200
        assert response.json()["verified"] is True

    @pytest.mark.asyncio
    async def test_verify_password_wrong(self, client: AsyncClient, db_session):
        """Test that wrong password returns 401."""
        service = UserService(db_session)
        user = await service.create_oauth_user(
            email="admin@example.com",
            display_name="Admin",
            google_id="setup-admin@example.com",
            role=UserRole.ADMIN,
        )
        user.hashed_password = SecurityService.hash_password("correct-pw")
        await db_session.commit()

        token = SecurityService.create_access_token(user.id)

        response = await client.post(
            "/api/v1/auth/verify-password",
            headers={"Authorization": f"Bearer {token}"},
            json={"password": "wrong-pw"},
        )

        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_verify_password_no_password_set(self, client: AsyncClient, db_session):
        """Test that user without password returns 400."""
        service = UserService(db_session)
        user = await service.create_oauth_user(
            email="oauthuser@example.com",
            display_name="OAuth User",
            google_id="google-oauth-user",
        )
        await db_session.commit()

        token = SecurityService.create_access_token(user.id)

        response = await client.post(
            "/api/v1/auth/verify-password",
            headers={"Authorization": f"Bearer {token}"},
            json={"password": "any-password"},
        )

        assert response.status_code == 400


class TestHasGoogleLinked:
    """Test has_google_linked property on User model."""

    def test_real_google_id(self):
        """User with a real Google ID has google linked."""
        from app.models.user import User

        user = User(email="a@b.com", display_name="A", google_id="1234567890")
        assert user.has_google_linked is True

    def test_setup_placeholder(self):
        """User with setup-* placeholder does not have google linked."""
        from app.models.user import User

        user = User(email="a@b.com", display_name="A", google_id="setup-a@b.com")
        assert user.has_google_linked is False

    def test_none_google_id(self):
        """User with no google_id does not have google linked."""
        from app.models.user import User

        user = User(email="a@b.com", display_name="A", google_id=None)
        assert user.has_google_linked is False
