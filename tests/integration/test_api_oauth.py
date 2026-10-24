"""Integration tests for the Google OAuth endpoints."""

import json
from unittest.mock import AsyncMock, MagicMock, patch
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import HTTPException
from httpx import AsyncClient
from sqlalchemy import select

from app.api.v1.oauth import exchange_google_code
from app.config import Settings
from app.models.audit_log import AuditAction, AuditLog
from app.models.user import User, UserRole
from app.services.user import UserService

STATE = "a-sufficiently-long-random-state-value"


def _oauth_settings(**overrides) -> Settings:
    return Settings(
        _env_file=None,
        app_env="testing",
        google_client_id="test-client-id",
        google_client_secret="test-client-secret",
        **overrides,
    )


async def _google_sign_in(client: AsyncClient, email: str, settings: Settings | None = None):
    google_info = {"google_id": f"g-{email}", "email": email, "display_name": "Someone"}
    with (
        patch("app.api.v1.oauth.get_settings", return_value=settings or _oauth_settings()),
        patch(
            "app.api.v1.oauth.exchange_google_code",
            new_callable=AsyncMock,
            return_value=google_info,
        ),
    ):
        response = await client.post(
            "/api/v1/oauth/google/callback",
            json={"code": "fake-code", "redirect_uri": "http://test/login"},
        )
    assert response.status_code == 200
    return response


async def _role_of(db_session, email: str) -> UserRole:
    user = (await db_session.execute(select(User).where(User.email == email))).scalar_one()
    return user.role


def _fake_google_client(userinfo: dict) -> AsyncMock:
    """Fake httpx.AsyncClient whose token exchange and userinfo calls succeed."""
    client = AsyncMock()
    client.__aenter__.return_value = client
    client.post.return_value = MagicMock(
        status_code=200, json=lambda: {"access_token": "google-access-token"}
    )
    client.get.return_value = MagicMock(status_code=200, json=lambda: userinfo)
    return client


class TestGoogleAuthorize:
    """GET /oauth/google/authorize"""

    @pytest.mark.asyncio
    async def test_requires_state(self, client: AsyncClient):
        with patch("app.api.v1.oauth.get_settings", return_value=_oauth_settings()):
            response = await client.get(
                "/api/v1/oauth/google/authorize",
                params={"redirect_uri": "http://test/login"},
            )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_rejects_short_state(self, client: AsyncClient):
        with patch("app.api.v1.oauth.get_settings", return_value=_oauth_settings()):
            response = await client.get(
                "/api/v1/oauth/google/authorize",
                params={"redirect_uri": "http://test/login", "state": "short"},
            )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_includes_state_and_minimal_scope(self, client: AsyncClient):
        with patch("app.api.v1.oauth.get_settings", return_value=_oauth_settings()):
            response = await client.get(
                "/api/v1/oauth/google/authorize",
                params={"redirect_uri": "http://test/login", "state": STATE},
            )
        assert response.status_code == 200
        url = response.json()["authorization_url"]
        query = parse_qs(urlparse(url).query)
        assert query["state"] == [STATE]
        assert query["client_id"] == ["test-client-id"]
        assert query["redirect_uri"] == ["http://test/login"]
        assert query["prompt"] == ["select_account"]
        # No offline access: the backend never needs a Google refresh token
        assert "access_type" not in query


class TestExchangeGoogleCode:
    """exchange_google_code() trusts only verified addresses."""

    @pytest.mark.asyncio
    async def test_rejects_unverified_email(self):
        fake = _fake_google_client(
            {"id": "g-1", "email": "someone@example.com", "name": "S", "verified_email": False}
        )
        with (
            patch("app.api.v1.oauth.get_settings", return_value=_oauth_settings()),
            patch("app.api.v1.oauth.httpx.AsyncClient", return_value=fake),
        ):
            with pytest.raises(HTTPException) as exc:
                await exchange_google_code("code", "http://test/login")
        assert exc.value.status_code == 401
        assert "not verified" in exc.value.detail

    @pytest.mark.asyncio
    async def test_rejects_missing_verified_flag(self):
        fake = _fake_google_client({"id": "g-1", "email": "someone@example.com", "name": "S"})
        with (
            patch("app.api.v1.oauth.get_settings", return_value=_oauth_settings()),
            patch("app.api.v1.oauth.httpx.AsyncClient", return_value=fake),
        ):
            with pytest.raises(HTTPException) as exc:
                await exchange_google_code("code", "http://test/login")
        assert exc.value.status_code == 401

    @pytest.mark.asyncio
    async def test_accepts_verified_email(self):
        fake = _fake_google_client(
            {"id": "g-1", "email": "someone@example.com", "name": "S", "verified_email": True}
        )
        with (
            patch("app.api.v1.oauth.get_settings", return_value=_oauth_settings()),
            patch("app.api.v1.oauth.httpx.AsyncClient", return_value=fake),
        ):
            info = await exchange_google_code("code", "http://test/login")
        assert info == {"google_id": "g-1", "email": "someone@example.com", "display_name": "S"}


class TestGoogleCallback:
    """POST /oauth/google/callback"""

    @pytest.mark.asyncio
    async def test_creates_user_and_sets_cookie_session(self, client: AsyncClient):
        google_info = {"google_id": "g-new", "email": "new@example.com", "display_name": "New"}
        with (
            patch("app.api.v1.oauth.get_settings", return_value=_oauth_settings()),
            patch(
                "app.api.v1.oauth.exchange_google_code",
                new_callable=AsyncMock,
                return_value=google_info,
            ),
        ):
            response = await client.post(
                "/api/v1/oauth/google/callback",
                json={"code": "fake-code", "redirect_uri": "http://test/login"},
            )

        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert "refresh_token" not in data
        set_cookie = response.headers.get("set-cookie", "")
        assert "refresh_token=" in set_cookie
        assert "HttpOnly" in set_cookie

        me = await client.get(
            "/api/v1/auth/me", headers={"Authorization": f"Bearer {data['access_token']}"}
        )
        assert me.status_code == 200
        assert me.json()["email"] == "new@example.com"


class TestFirstAdminBySignIn:
    """With no admin yet, the Google account that signs in becomes the admin."""

    @pytest.mark.asyncio
    async def test_first_sign_in_becomes_admin_and_is_audited(
        self, client: AsyncClient, db_session
    ):
        await _google_sign_in(client, "first@example.com")

        assert await _role_of(db_session, "first@example.com") == UserRole.ADMIN
        entries = (
            (
                await db_session.execute(
                    select(AuditLog).where(AuditLog.action == AuditAction.USER_ROLE_CHANGED)
                )
            )
            .scalars()
            .all()
        )
        assert len(entries) == 1
        assert json.loads(entries[0].details)["new_role"] == "admin"

    @pytest.mark.asyncio
    async def test_later_sign_ins_are_regular_users(self, client: AsyncClient, db_session):
        await _google_sign_in(client, "first@example.com")
        await _google_sign_in(client, "second@example.com")

        assert await _role_of(db_session, "second@example.com") == UserRole.USER

    @pytest.mark.asyncio
    async def test_admin_created_on_setup_page_closes_the_window(
        self, client: AsyncClient, db_session
    ):
        await UserService(db_session).create_oauth_user(
            email="admin@example.com",
            display_name="Admin",
            google_id="setup-admin@example.com",
            role=UserRole.ADMIN,
        )
        await db_session.commit()

        await _google_sign_in(client, "someone@example.com")

        assert await _role_of(db_session, "someone@example.com") == UserRole.USER

    @pytest.mark.asyncio
    async def test_admin_email_limits_promotion_to_that_account(
        self, client: AsyncClient, db_session
    ):
        pinned = _oauth_settings(admin_email="owner@example.com")

        await _google_sign_in(client, "someone@example.com", pinned)
        assert await _role_of(db_session, "someone@example.com") == UserRole.USER

        await _google_sign_in(client, "owner@example.com", pinned)
        assert await _role_of(db_session, "owner@example.com") == UserRole.ADMIN

    @pytest.mark.asyncio
    async def test_existing_user_is_promoted_when_no_admin_exists(
        self, client: AsyncClient, db_session
    ):
        # A user who signed in while no admin existed (before this rule) is
        # promoted on the next sign-in instead of leaving /admin/setup open.
        await UserService(db_session).create_oauth_user(
            email="early@example.com",
            display_name="Early",
            google_id="g-early@example.com",
        )
        await db_session.commit()

        await _google_sign_in(client, "early@example.com")

        assert await _role_of(db_session, "early@example.com") == UserRole.ADMIN
