"""Security boundaries with real request transaction teardown and synthetic data."""

import asyncio
from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest
from fastapi import Response
from httpx import ASGITransport, AsyncClient
from slowapi import Limiter
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

import app.db.session as database
import app.main as application
from app.config import get_settings
from app.core.security import SecurityService
from app.core.session import issue_session
from app.models.audit_log import AuditAction, AuditLog
from app.models.auth_session import AuthSession
from app.models.base import Base
from app.models.credential import Credential
from app.models.user import User, UserRole
from tests.vault_helpers import new_signing_public_key


@pytest.fixture
async def isolated_server(tmp_path, monkeypatch):
    """Separate file connections exercise actual COMMIT/CAS, not a shared session."""
    engine = create_async_engine(f"sqlite+aiosqlite:///{(tmp_path / 'synthetic.db').as_posix()}")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(database, "AsyncSessionLocal", factory)
    monkeypatch.setattr(application, "init_db", AsyncMock())
    monkeypatch.setattr(application.app.state.limiter, "enabled", False)
    monkeypatch.setattr(get_settings(), "admin_email", None)
    monkeypatch.setattr(get_settings(), "admin_password", None)
    assert not application.app.dependency_overrides
    async with AsyncClient(
        transport=ASGITransport(app=application.app, raise_app_exceptions=False),
        base_url="http://test",
    ) as client:
        yield client, factory
    await engine.dispose()


async def make_session(factory):
    async with factory() as db:
        user = User(email="synthetic@example.com", display_name="Synthetic", google_id="subject-a")
        db.add(user)
        await db.flush()
        response = Response()
        token = await issue_session(user, response, db)
        cookie = response.headers["set-cookie"].split(";", 1)[0]
        return user.id, token.access_token, cookie


async def test_startup_admin_is_durable_and_config_blocks_public_setup(
    isolated_server, monkeypatch
):
    client, factory = isolated_server
    monkeypatch.setattr(get_settings(), "admin_email", "configured@example.com")
    monkeypatch.setattr(get_settings(), "admin_password", "synthetic-password-123")
    async with application.app.router.lifespan_context(application.app):
        async with factory() as db:
            admin = await db.scalar(select(User).where(User.role == UserRole.ADMIN))
            assert admin and admin.email == "configured@example.com"
        result = await client.post(
            "/api/v1/setup/admin",
            json={
                "email": "other@example.com",
                "password": "synthetic-password-456",
            },
        )
        assert result.status_code == 403


async def test_only_one_concurrent_first_admin_claim(isolated_server):
    client, factory = isolated_server
    results = await asyncio.gather(
        *(
            client.post(
                "/api/v1/setup/admin",
                json={
                    "email": f"setup-{number}@example.com",
                    "password": "synthetic-password-123",
                },
            )
            for number in range(2)
        )
    )
    assert sorted(r.status_code for r in results) == [200, 409]
    async with factory() as db:
        assert len((await db.scalars(select(User).where(User.role == UserRole.ADMIN))).all()) == 1


async def test_refresh_is_single_use_and_expiry_does_not_slide(isolated_server):
    client, factory = isolated_server
    _, access, cookie = await make_session(factory)
    results = await asyncio.gather(
        *(client.post("/api/v1/auth/refresh", headers={"Cookie": cookie}) for _ in range(2))
    )
    assert sorted(r.status_code for r in results) == [200, 409]
    successful = next(r for r in results if r.status_code == 200)
    old = SecurityService.decode_token(cookie.split("=", 1)[1])
    new = SecurityService.decode_token(successful.cookies["refresh_token"])
    assert old and new and old["exp"] == new["exp"] and old["jti"] != new["jti"]
    async with factory() as db:
        await db.execute(update(AuthSession).values(rotated_at=AuthSession.rotated_at - 10))
        await db.commit()
    replay = await client.post("/api/v1/auth/refresh", headers={"Cookie": cookie})
    assert replay.status_code == 401
    assert "set-cookie" not in replay.headers
    assert (
        await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {access}"})
    ).status_code == 401


async def test_logout_never_reports_success_on_failed_commit(isolated_server, monkeypatch):
    client, factory = isolated_server
    _, access, _ = await make_session(factory)
    original = AsyncSession.commit

    async def fail_commit(self):
        raise RuntimeError("synthetic commit failure")

    monkeypatch.setattr(AsyncSession, "commit", fail_commit)
    result = await client.post("/api/v1/auth/logout", headers={"Authorization": f"Bearer {access}"})
    assert result.status_code == 500
    assert "set-cookie" not in result.headers
    monkeypatch.setattr(AsyncSession, "commit", original)
    result = await client.post("/api/v1/auth/logout", headers={"Authorization": f"Bearer {access}"})
    assert result.status_code == 200
    assert (
        await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {access}"})
    ).status_code == 401


async def test_auth_failure_audit_survives_401_and_subject_conflict(isolated_server, monkeypatch):
    client, factory = isolated_server
    await make_session(factory)
    failed = await client.post(
        "/api/v1/auth/login", json={"email": "missing@example.com", "password": "synthetic"}
    )
    assert failed.status_code == 401
    monkeypatch.setattr(
        "app.api.v1.oauth.exchange_google_code",
        AsyncMock(
            return_value={
                "google_id": "different-subject",
                "email": "synthetic@example.com",
                "display_name": "Synthetic",
            }
        ),
    )
    conflict = await client.post(
        "/api/v1/oauth/google/callback",
        json={"code": "synthetic", "redirect_uri": "http://test/login"},
    )
    assert conflict.status_code == 409
    async with factory() as db:
        user = await db.scalar(select(User))
        assert user and user.google_id == "subject-a"
        events = (
            await db.scalars(select(AuditLog).where(AuditLog.action == AuditAction.LOGIN_FAILURE))
        ).all()
        assert len(events) == 2
        assert all("synthetic" not in (event.details or "") for event in events)


async def test_real_default_rate_limit_middleware(isolated_server, monkeypatch):
    client, _ = isolated_server
    limiter = Limiter(key_func=lambda: "synthetic-client")
    monkeypatch.setattr(application.app.state, "limiter", limiter)
    monkeypatch.setattr(get_settings(), "rate_limit_per_minute", 2)
    results = [await client.get("/api/v1/setup/status") for _ in range(3)]
    assert [r.status_code for r in results] == [200, 200, 429]


async def test_import_rejects_unauthenticated_before_reading_body(isolated_server):
    client, _ = isolated_server
    read = False

    async def body():
        nonlocal read
        read = True
        yield b"{}"

    response = await client.post("/api/v1/credentials/import", content=body())
    assert response.status_code == 401
    assert read is False


async def test_first_vault_needs_independent_setup_authorization(isolated_server):
    client, factory = isolated_server
    user_id, access, cookie = await make_session(factory)
    async with factory() as db:
        user = await db.get(User, user_id)
        assert user is not None
        other = await issue_session(user, Response(), db)
    data = {
        "public_key": "synthetic-public-key",
        "encrypted_private_key": "synthetic-bundle",
        "key_salt": "synthetic-salt",
        "signing_public_key": new_signing_public_key(),
    }
    for headers in (
        {"Authorization": f"Bearer {access}"},
        {"Authorization": f"Bearer {access}", "X-Vault-Setup": access},
        {"Authorization": f"Bearer {access}", "X-Vault-Setup": other.vault_setup_token},
    ):
        response = await client.post("/api/v1/auth/vault/setup", headers=headers, json=data)
        assert response.status_code == 403
    refreshed = await client.post("/api/v1/auth/refresh", headers={"Cookie": cookie})
    assert refreshed.status_code == 200
    assert refreshed.json()["vault_setup_token"] is None
    authorized = {
        "Authorization": f"bearer {other.access_token}",
        "X-Vault-Setup": other.vault_setup_token,
    }
    assert (
        await client.post("/api/v1/auth/vault/setup", headers=authorized, json=data)
    ).status_code == 200
    assert (
        await client.post("/api/v1/auth/vault/setup", headers=authorized, json=data)
    ).status_code == 400


@pytest.mark.parametrize(
    "existing_state,authority,expected",
    [
        ({}, True, 200),
        ({}, False, 409),
        ({"google_id": "original-subject"}, True, 409),
        ({"hashed_password": "synthetic-hash"}, True, 409),
        ({"role": UserRole.ADMIN}, True, 409),
        ({"is_active": False}, True, 409),
        ({"last_login_at": datetime(2026, 1, 1, tzinfo=UTC)}, True, 409),
        ({"encrypted_private_key": "synthetic-bundle"}, True, 409),
        ({"public_key": "synthetic-public-key"}, True, 409),
        ({"key_salt": "synthetic-salt"}, True, 409),
        ({"signing_public_key": "synthetic-signing-key"}, True, 409),
        ({"vault_proof_key": "a" * 64}, True, 409),
        ({"token_version": 1}, True, 409),
    ],
)
async def test_email_can_only_claim_an_unused_invitation(
    isolated_server, monkeypatch, existing_state, authority, expected
):
    client, factory = isolated_server
    monkeypatch.setattr(get_settings(), "admin_email", "operator@example.com")
    async with factory() as db:
        invited = User(email="invited@example.com", display_name="Invited", **existing_state)
        db.add(invited)
        await db.commit()
        user_id = invited.id
    monkeypatch.setattr(
        "app.api.v1.oauth.exchange_google_code",
        AsyncMock(
            return_value={
                "google_id": "new-subject",
                "email": "invited@example.com",
                "display_name": "Invited",
                "authoritative_email": authority,
            }
        ),
    )
    response = await client.post(
        "/api/v1/oauth/google/callback",
        json={"code": "synthetic", "redirect_uri": "http://test/login"},
    )
    assert response.status_code == expected
    async with factory() as db:
        user = await db.get(User, user_id)
        assert user is not None
        assert user.google_id == (
            "new-subject" if expected == 200 else existing_state.get("google_id")
        )


async def test_invitation_claim_refuses_existing_ciphertext(isolated_server):
    _, factory = isolated_server
    from app.services.user import UserService

    async with factory() as db:
        user = User(email="invited@example.com", display_name="Invited")
        db.add(user)
        await db.flush()
        db.add(Credential(owner_id=user.id, encrypted_data="synthetic-ciphertext"))
        await db.commit()
        assert not await UserService(db).claim_empty_oauth_invitation(user, "new-subject")


async def test_invitation_claim_has_one_winner(isolated_server):
    _, factory = isolated_server
    from app.services.user import UserService

    async with factory() as db:
        user = User(email="invited@example.com", display_name="Invited")
        db.add(user)
        await db.commit()
        user_id = user.id

    async def claim(subject):
        async with factory() as db:
            existing = await db.get(User, user_id)
            assert existing is not None
            won = await UserService(db).claim_empty_oauth_invitation(existing, subject)
            await db.commit()
            return won

    assert sorted(await asyncio.gather(claim("subject-a"), claim("subject-b"))) == [False, True]


async def test_ciphertext_export_includes_revocation_and_durable_audit(isolated_server):
    client, factory = isolated_server
    user_id, access, _ = await make_session(factory)
    async with factory() as db:
        db.add(
            Credential(
                owner_id=user_id,
                encrypted_data="synthetic-ciphertext",
                is_active=False,
                revoked_at=datetime(2026, 1, 1, tzinfo=UTC),
            )
        )
        await db.commit()
    response = await client.get(
        "/api/v1/credentials/export", headers={"Authorization": f"Bearer {access}"}
    )
    assert response.status_code == 200
    row = response.json()["credentials"][0]
    assert row["is_active"] is False and row["revoked_at"] is not None
    async with factory() as db:
        event = await db.scalar(
            select(AuditLog).where(AuditLog.action == AuditAction.CREDENTIAL_EXPORTED)
        )
        assert event and "synthetic-ciphertext" not in event.details
