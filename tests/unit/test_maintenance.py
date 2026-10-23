"""Tests for the database backup / restore commands used by the deploy script."""

import sqlite3
from pathlib import Path

import pytest

from app import maintenance
from app.maintenance import (
    EXIT_NO_DATABASE,
    MaintenanceError,
    NoDatabaseError,
    backup,
    check_database,
    database_path,
    restore,
    schema_revision,
)


def _make_vault_db(path: Path, email: str = "owner@example.com") -> Path:
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)")
    conn.execute("CREATE TABLE alembic_version (version_num TEXT)")
    conn.execute("INSERT INTO users (email) VALUES (?)", (email,))
    conn.execute("INSERT INTO alembic_version VALUES ('6d8f2b0c3e55')")
    conn.commit()
    conn.close()
    return path


def _emails(path: Path) -> list[str]:
    conn = sqlite3.connect(path)
    try:
        return [row[0] for row in conn.execute("SELECT email FROM users")]
    finally:
        conn.close()


class TestDatabasePath:
    def test_relative_sqlite_url(self):
        assert database_path("sqlite+aiosqlite:///data/credential_vault.db") == Path(
            "data/credential_vault.db"
        )

    def test_reads_database_url_from_environment(self, monkeypatch):
        monkeypatch.setenv("DATABASE_URL", "sqlite+aiosqlite:///other/vault.db")
        assert database_path() == Path("other/vault.db")

    def test_rejects_non_sqlite_url(self):
        with pytest.raises(MaintenanceError):
            database_path("postgresql+asyncpg://localhost/vault")


class TestCheckDatabase:
    def test_accepts_vault_database(self, tmp_path):
        check_database(_make_vault_db(tmp_path / "vault.db"))

    def test_rejects_non_sqlite_file(self, tmp_path):
        bogus = tmp_path / "notes.db"
        bogus.write_text("not a database")
        with pytest.raises(MaintenanceError, match="not a SQLite database"):
            check_database(bogus)

    def test_rejects_sqlite_without_users_table(self, tmp_path):
        other = tmp_path / "other.db"
        conn = sqlite3.connect(other)
        conn.execute("CREATE TABLE things (id INTEGER)")
        conn.commit()
        conn.close()
        with pytest.raises(MaintenanceError, match="no users table"):
            check_database(other)


class TestBackup:
    def test_copies_database_and_records_schema(self, tmp_path):
        source = _make_vault_db(tmp_path / "vault.db")
        destination = tmp_path / "backups" / "pre-deploy.db"

        backup(source, destination)

        assert _emails(destination) == ["owner@example.com"]
        assert schema_revision(destination) == "6d8f2b0c3e55"

    def test_missing_database_is_reported_separately(self, tmp_path):
        with pytest.raises(NoDatabaseError):
            backup(tmp_path / "missing.db", tmp_path / "out.db")

    def test_refuses_to_overwrite_an_existing_backup(self, tmp_path):
        source = _make_vault_db(tmp_path / "vault.db")
        destination = _make_vault_db(tmp_path / "existing.db", email="keep@example.com")

        with pytest.raises(MaintenanceError, match="already exists"):
            backup(source, destination)
        assert _emails(destination) == ["keep@example.com"]


class TestRestore:
    def test_replaces_database_and_drops_stale_journal(self, tmp_path):
        target = _make_vault_db(tmp_path / "vault.db")
        stale_journal = Path(f"{target}-journal")
        stale_journal.write_bytes(b"old journal")
        source = _make_vault_db(tmp_path / "backup.db", email="restored@example.com")

        restore(source, target)

        assert _emails(target) == ["restored@example.com"]
        assert not stale_journal.exists()
        assert not Path(f"{target}.restoring").exists()

    def test_creates_target_directory_on_empty_volume(self, tmp_path):
        source = _make_vault_db(tmp_path / "backup.db")
        target = tmp_path / "fresh-volume" / "vault.db"

        restore(source, target)

        assert _emails(target) == ["owner@example.com"]

    def test_invalid_source_leaves_current_database_untouched(self, tmp_path):
        target = _make_vault_db(tmp_path / "vault.db")
        bogus = tmp_path / "bogus.db"
        bogus.write_text("not a database")

        with pytest.raises(MaintenanceError):
            restore(bogus, target)
        assert _emails(target) == ["owner@example.com"]

    def test_missing_source(self, tmp_path):
        with pytest.raises(MaintenanceError, match="does not exist"):
            restore(tmp_path / "missing.db", tmp_path / "vault.db")


class TestMain:
    def test_backup_then_restore_round_trip(self, tmp_path, capsys):
        database = _make_vault_db(tmp_path / "vault.db")
        saved = tmp_path / "saved.db"

        assert maintenance.main(["--database", str(database), "backup", str(saved)]) == 0
        database.unlink()
        assert maintenance.main(["--database", str(database), "restore", str(saved)]) == 0

        assert _emails(database) == ["owner@example.com"]
        assert "schema 6d8f2b0c3e55" in capsys.readouterr().out

    def test_backup_without_database_uses_dedicated_exit_code(self, tmp_path):
        missing = tmp_path / "missing.db"
        out = tmp_path / "out.db"
        exit_code = maintenance.main(["--database", str(missing), "backup", str(out)])
        assert exit_code == EXIT_NO_DATABASE

    def test_failed_restore_returns_error(self, tmp_path, capsys):
        bogus = tmp_path / "bogus.db"
        bogus.write_text("nope")
        exit_code = maintenance.main(
            ["--database", str(tmp_path / "vault.db"), "restore", str(bogus)]
        )
        assert exit_code == 1
        assert "error:" in capsys.readouterr().err
