"""Integration tests for authentication API endpoints."""

import pytest
from argon2 import PasswordHasher
from httpx import AsyncClient

from app.core.security import SecurityService
from app.models.user import UserRole
from app.services.user import UserService


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

        access_token = SecurityService.create_access_token(user.id)
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
    async def test_vault_setup_duplicate(self, client: AsyncClient, db_session, test_user_data):
        """Test that vault setup fails if keys already exist."""
        token, _ = await self._create_user_and_get_token(db_session, email=test_user_data["email"])

        vault_data = {
            "public_key": "test-public-key-base64",
            "encrypted_private_key": "test-encrypted-private-key-base64",
            "key_salt": "test-salt-base64",
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
