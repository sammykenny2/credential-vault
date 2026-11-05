"""Concurrency on a real SQLite file with separate connections.

The usual fixture shares one session between requests, so it cannot show two
writers racing. These use the services directly, each on its own connection.
"""

import asyncio

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.models.base import Base
from app.models.credential import Credential
from app.models.user import User, UserRole
from app.schemas.credential import CredentialRevoke, RecordAdoption
from app.services.credential import CredentialService
from app.services.user import UserService
from tests.vault_helpers import OPAQUE_SIGNATURE, new_signing_public_key, signed_fields

CREDENTIAL_ID = "7a1d2c3b-5e6f-4a7b-8c9d-0e1f2a3b4c5d"


@pytest.fixture
async def sessions(tmp_path):
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'transactions.db'}", connect_args={"timeout": 30}
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    await engine.dispose()


async def _seed_user(sessions, **fields) -> str:
    async with sessions() as session:
        user = User(
            email="race@example.com",
            display_name="Race",
            google_id="google-race",
            role=UserRole.USER,
            **fields,
        )
        session.add(user)
        await session.commit()
        return user.id


async def _seed_credential(sessions, user_id: str) -> None:
    async with sessions() as session:
        session.add(Credential(id=CREDENTIAL_ID, owner_id=user_id, encrypted_data="Yg=="))
        await session.commit()


@pytest.mark.asyncio
async def test_only_one_writer_holding_a_revision_succeeds(sessions):
    user_id = await _seed_user(sessions)
    await _seed_credential(sessions, user_id)

    async def revoke() -> bool:
        async with sessions() as session:
            service = CredentialService(session)
            credential = await service.get_by_id(CREDENTIAL_ID, user_id)
            applied = await service.revoke(
                credential,
                CredentialRevoke(revoked_at="2026-11-05T00:00:00Z", **signed_fields(2)),
            )
            await session.commit()
            return applied

    results = await asyncio.gather(*(revoke() for _ in range(5)))

    assert sorted(results) == [False, False, False, False, True]
    async with sessions() as session:
        credential = await CredentialService(session).get_by_id(CREDENTIAL_ID, user_id)
        assert credential.revision == 2


@pytest.mark.asyncio
async def test_only_one_upgrade_can_register_a_signing_key(sessions):
    """Empty vaults matter most: no record revision would catch the second upgrade."""
    user_id = await _seed_user(sessions, public_key="rsa", encrypted_private_key="blob")

    async def upgrade(key: str) -> bool:
        async with sessions() as session:
            user = await session.get(User, user_id)
            claimed = await UserService(session).complete_vault_upgrade(
                user=user, encrypted_private_key=f"bundle-{key}", signing_public_key=key
            )
            await session.commit()
            return claimed

    keys = [new_signing_public_key() for _ in range(4)]
    results = await asyncio.gather(*(upgrade(key) for key in keys))

    assert sum(results) == 1
    winner = keys[results.index(True)]
    async with sessions() as session:
        user = await session.get(User, user_id)
        assert user.signing_public_key == winner
        assert user.encrypted_private_key == f"bundle-{winner}"


@pytest.mark.asyncio
async def test_a_second_setup_cannot_replace_vault_keys(sessions):
    user_id = await _seed_user(sessions)

    async def setup(name: str) -> bool:
        async with sessions() as session:
            user = await session.get(User, user_id)
            configured = await UserService(session).setup_vault_keys(
                user=user,
                public_key=name,
                encrypted_private_key=f"bundle-{name}",
                key_salt="salt",
                signing_public_key=name,
            )
            await session.commit()
            return configured is not None

    names = ["first", "second", "third"]
    results = await asyncio.gather(*(setup(name) for name in names))

    assert sum(results) == 1
    winner = names[results.index(True)]
    async with sessions() as session:
        user = await session.get(User, user_id)
        assert user.public_key == winner
        assert user.encrypted_private_key == f"bundle-{winner}"


@pytest.mark.asyncio
async def test_a_refused_adoption_stores_nothing_after_a_partial_write(sessions):
    """adopt_all reports a row that moved on, and the caller's rollback undoes earlier rows.

    The row moves on the same connection, partway through: this covers the revision
    check and the rollback, not a second writer, which would wait for the write lock.
    """
    user_id = await _seed_user(sessions)
    await _seed_credential(sessions, user_id)
    second_id = "8b2e3d4c-6f70-4b8c-9dae-1f203b4c5d6e"
    async with sessions() as session:
        session.add(Credential(id=second_id, owner_id=user_id, encrypted_data="Yw=="))
        await session.commit()

    async with sessions() as session:
        service = CredentialService(session)
        original_execute = session.execute
        calls = {"count": 0}

        async def interfering_execute(statement, *args, **kwargs):
            # After the first row is written, the second row's revision changes.
            result = await original_execute(statement, *args, **kwargs)
            if statement.is_dml:
                calls["count"] += 1
                if calls["count"] == 1:
                    await original_execute(
                        Credential.__table__.update()
                        .where(Credential.id == second_id)
                        .values(revision=9)
                    )
            return result

        session.execute = interfering_execute  # type: ignore[method-assign]
        adopted = await service.adopt_all(
            user_id,
            [
                RecordAdoption(id=CREDENTIAL_ID, revision=2, signature=OPAQUE_SIGNATURE),
                RecordAdoption(id=second_id, revision=2, signature=OPAQUE_SIGNATURE),
            ],
        )
        assert adopted is False
        await session.rollback()

    async with sessions() as session:
        first = await CredentialService(session).get_by_id(CREDENTIAL_ID, user_id)
        assert first.signature is None
        assert first.revision == 1
