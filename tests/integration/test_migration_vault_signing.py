"""The signing migration against a real SQLite file with existing rows."""

import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parents[2]
PREVIOUS = "6d8f2b0c3e55"
SIGNING_REVISION = "7a4e1c9d2b60"
CREDENTIAL_ID = "7a1d2c3b-5e6f-4a7b-8c9d-0e1f2a3b4c5d"
USER_ID = "2f9c1b7e-4a5d-4c3e-9b8a-1d2e3f4a5b6c"


def _alembic(db_path: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=REPO_ROOT,
        env={
            **os.environ,
            "PYTHONPATH": str(REPO_ROOT),
            "DATABASE_URL": f"sqlite+aiosqlite:///{db_path.as_posix()}",
            "APP_ENV": "development",
        },
        capture_output=True,
        text=True,
    )


@pytest.fixture
def database(tmp_path: Path) -> Path:
    """A database at the previous revision, holding a user and a credential."""
    db_path = tmp_path / "migration.db"
    assert _alembic(db_path, "upgrade", PREVIOUS).returncode == 0
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            "INSERT INTO users (id, email, display_name, role, is_active, public_key,"
            " encrypted_private_key, key_salt, vault_proof_hash) VALUES (?,?,?,?,?,?,?,?,?)",
            (USER_ID, "m@example.com", "M", "USER", 1, "rsa", "blob", "salt", "ab" * 32),
        )
        connection.execute(
            "INSERT INTO credentials (id, owner_id, encrypted_data, is_active) VALUES (?,?,?,1)",
            (CREDENTIAL_ID, USER_ID, "Y2lwaGVy"),
        )
    return db_path


def _query(db_path: Path, statement: str) -> list[tuple]:
    with sqlite3.connect(db_path) as connection:
        return connection.execute(statement).fetchall()


def test_upgrade_keeps_rows_and_does_not_rebuild_tables(database: Path):
    """A rebuild runs DROP TABLE, which would cascade to children with foreign keys on."""
    rootpages = "SELECT name, rootpage FROM sqlite_master WHERE name IN ('users', 'credentials')"
    before = sorted(_query(database, rootpages))

    result = _alembic(database, "upgrade", "head")

    assert result.returncode == 0, result.stderr
    assert sorted(_query(database, rootpages)) == before
    assert _query(
        database,
        "SELECT encrypted_data, revision, signature, signature_version, origin FROM credentials",
    ) == [("Y2lwaGVy", 1, None, None, None)]
    assert _query(database, "SELECT signing_public_key, vault_proof_hash FROM users") == [
        (None, "ab" * 32)
    ]


def test_models_match_the_migrated_schema(database: Path):
    assert _alembic(database, "upgrade", "head").returncode == 0
    result = _alembic(database, "check")
    assert result.returncode == 0, result.stdout + result.stderr


def test_downgrade_keeps_rows_when_no_vault_is_signed(database: Path):
    assert _alembic(database, "upgrade", SIGNING_REVISION).returncode == 0

    result = _alembic(database, "downgrade", PREVIOUS)

    assert result.returncode == 0, result.stderr
    assert _query(database, "SELECT encrypted_data FROM credentials") == [("Y2lwaGVy",)]
    assert _query(database, "SELECT vault_proof_hash FROM users") == [("ab" * 32,)]
    columns = [row[1] for row in _query(database, "PRAGMA table_info(credentials)")]
    assert "signature" not in columns


def test_downgrade_refuses_when_a_vault_is_signed(database: Path):
    assert _alembic(database, "upgrade", SIGNING_REVISION).returncode == 0
    with sqlite3.connect(database) as connection:
        connection.execute("UPDATE users SET signing_public_key = 'key'")

    result = _alembic(database, "downgrade", PREVIOUS)

    assert result.returncode != 0
    assert "signed vaults exist" in result.stderr
    assert _query(database, "SELECT signing_public_key FROM users") == [("key",)]


def test_session_migration_closes_bootstrap_for_existing_admin(database: Path):
    with sqlite3.connect(database) as connection:
        connection.execute("UPDATE users SET role = 'ADMIN'")
    assert _alembic(database, "upgrade", "head").returncode == 0
    assert _query(database, "SELECT id FROM admin_bootstrap_claim") == [(1,)]
    assert _query(database, "SELECT COUNT(*) FROM auth_sessions") == [(0,)]
    assert _query(database, "SELECT encrypted_data FROM credentials") == [("Y2lwaGVy",)]


def test_session_migration_refuses_unsafe_downgrade(database: Path):
    assert _alembic(database, "upgrade", "head").returncode == 0
    result = _alembic(database, "downgrade", SIGNING_REVISION)
    assert result.returncode != 0
    assert "Auth sessions cannot be downgraded safely" in result.stderr
    assert _query(database, "SELECT encrypted_data FROM credentials") == [("Y2lwaGVy",)]
