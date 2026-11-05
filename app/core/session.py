"""Durable, single-use refresh tokens with an absolute family expiry."""

import hashlib
import secrets
import time
from uuid import uuid4

from fastapi import HTTPException, Response
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.security import SecurityService
from app.models.auth_session import AuthSession
from app.models.user import User
from app.schemas.auth import Token

REFRESH_RACE_SECONDS = 5


def _digest(token_id: str) -> str:
    return hashlib.sha256(token_id.encode("ascii")).hexdigest()


def _tokens(user: User, response: Response, session: AuthSession, token_id: str) -> Token:
    SecurityService.set_refresh_cookie(
        response,
        SecurityService.create_refresh_token(
            user.id,
            user.token_version,
            session_id=session.id,
            token_id=token_id,
            expires_at=session.expires_at,
        ),
    )
    return Token(
        access_token=SecurityService.create_access_token(user.id, user.token_version, session.id),
        expires_in=get_settings().access_token_expire_minutes * 60,
        user_id=user.id,
    )


async def issue_session(user: User, response: Response, db: AsyncSession) -> Token:
    """Persist a new family before exposing tokens. Called only after authentication."""
    now = int(time.time())
    await db.execute(delete(AuthSession).where(AuthSession.expires_at <= now))
    token_id = secrets.token_hex(32)
    session = AuthSession(
        id=str(uuid4()),
        user_id=user.id,
        refresh_hash=_digest(token_id),
        expires_at=now + get_settings().refresh_token_expire_days * 86400,
        rotated_at=now,
    )
    db.add(session)
    await db.commit()
    token = _tokens(user, response, session, token_id)
    if not user.has_vault_keys:
        token.vault_setup_token = SecurityService.create_vault_setup_token(
            user.id, user.token_version, session.id
        )
    return token


async def rotate_session(user: User, response: Response, db: AsyncSession, payload: dict) -> Token:
    """Consume exactly one refresh identifier; never issue tokens on replay."""
    sid, token_id = payload.get("sid"), payload.get("jti")
    if not isinstance(sid, str) or not isinstance(token_id, str) or len(token_id) != 64:
        raise HTTPException(401, "Sign in again to establish a refresh session")
    now = int(time.time())
    next_id = secrets.token_hex(32)
    result = await db.execute(
        update(AuthSession)
        .where(
            AuthSession.id == sid,
            AuthSession.user_id == user.id,
            AuthSession.refresh_hash == _digest(token_id),
            AuthSession.revoked_at.is_(None),
            AuthSession.expires_at > now,
            AuthSession.user_id.in_(
                select(User.id).where(
                    User.id == user.id,
                    User.token_version == payload.get("ver"),
                    User.is_active.is_(True),
                )
            ),
        )
        .values(refresh_hash=_digest(next_id), rotated_at=now)
    )
    if result.rowcount != 1:  # type: ignore[attr-defined]
        session = await db.get(AuthSession, sid, populate_existing=True)
        if (
            session
            and session.user_id == user.id
            and session.revoked_at is None
            and session.expires_at > now
        ):
            if now - session.rotated_at <= REFRESH_RACE_SECONDS:
                raise HTTPException(409, "Refresh already consumed; retry with the current cookie")
            await db.execute(
                update(AuthSession).where(AuthSession.id == sid).values(revoked_at=now)
            )
            await db.commit()
        raise HTTPException(401, "Refresh session expired or revoked")
    session = await db.get(AuthSession, sid, populate_existing=True)
    assert session is not None
    await db.commit()
    return _tokens(user, response, session, next_id)
