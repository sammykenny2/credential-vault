"""Database backup and restore, run inside the backend container.

    python -m app.maintenance backup /backups/vault.db
    python -m app.maintenance restore /restore/vault.db

The deploy scripts call these through one-off ``docker compose run``
containers, so a backup taken on one Docker host restores the same way on
another. The database holds ciphertext, wrapped keys and password hashes only;
nothing here decrypts or inspects credential data.
"""

from __future__ import annotations

import argparse
import os
import shutil
import sqlite3
import sys
from pathlib import Path

DEFAULT_DATABASE_URL = "sqlite+aiosqlite:///data/credential_vault.db"
SQLITE_URL_PREFIX = "sqlite+aiosqlite:///"
SQLITE_HEADER = b"SQLite format 3\x00"
APP_USER = "appuser"

# Exit code for "there is no database yet", so a first deploy can tell that
# apart from a failed backup.
EXIT_NO_DATABASE = 3


class MaintenanceError(Exception):
    """A backup or restore could not be completed."""


class NoDatabaseError(MaintenanceError):
    """The database file does not exist yet."""


def database_path(url: str | None = None) -> Path:
    """Resolve the SQLite file behind DATABASE_URL (relative to the working dir)."""
    url = url or os.environ.get("DATABASE_URL") or DEFAULT_DATABASE_URL
    if not url.startswith(SQLITE_URL_PREFIX):
        raise MaintenanceError(f"only {SQLITE_URL_PREFIX} databases are supported")
    return Path(url[len(SQLITE_URL_PREFIX) :])


def _connect_read_only(path: Path) -> sqlite3.Connection:
    return sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)


def schema_revision(path: Path) -> str | None:
    """Return the Alembic revision recorded in the database, if any."""
    conn = _connect_read_only(path)
    try:
        row = conn.execute("SELECT version_num FROM alembic_version").fetchone()
    except sqlite3.Error:
        return None
    finally:
        conn.close()
    return str(row[0]) if row else None


def check_database(path: Path) -> None:
    """Refuse files that are not an intact Credential Vault SQLite database."""
    with path.open("rb") as handle:
        if handle.read(len(SQLITE_HEADER)) != SQLITE_HEADER:
            raise MaintenanceError(f"{path} is not a SQLite database")
    conn = _connect_read_only(path)
    try:
        result = conn.execute("PRAGMA integrity_check").fetchone()[0]
        has_users = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'"
        ).fetchone()
    except sqlite3.DatabaseError as exc:
        raise MaintenanceError(f"{path} is not readable: {exc}") from exc
    finally:
        conn.close()
    if result != "ok":
        raise MaintenanceError(f"{path} failed the integrity check: {result}")
    if not has_users:
        raise MaintenanceError(f"{path} is not a Credential Vault database (no users table)")


def backup(source: Path, destination: Path) -> None:
    """Copy the live database with SQLite's online backup API, then verify it."""
    if not source.exists():
        raise NoDatabaseError(f"no database at {source}")
    if destination.exists():
        raise MaintenanceError(f"{destination} already exists")
    destination.parent.mkdir(parents=True, exist_ok=True)
    src = _connect_read_only(source)
    try:
        dst = sqlite3.connect(destination)
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()
    check_database(destination)


def _hand_to_app_user(path: Path) -> None:
    # Restores run as root so they can write into the volume; the backend
    # runs as appuser and needs to own the file it opens read-write.
    if sys.platform == "win32" or os.geteuid() != 0:
        return
    import pwd

    try:
        user = pwd.getpwnam(APP_USER)
    except KeyError:
        return
    os.chown(path, user.pw_uid, user.pw_gid)


def restore(source: Path, target: Path) -> None:
    """Replace the database with a verified copy of ``source``."""
    if not source.exists():
        raise MaintenanceError(f"{source} does not exist")
    check_database(source)
    target.parent.mkdir(parents=True, exist_ok=True)
    staging = target.with_name(target.name + ".restoring")
    shutil.copyfile(source, staging)
    try:
        check_database(staging)
        _hand_to_app_user(staging)
        os.chmod(staging, 0o600)
        # A journal left by the old database would be replayed onto the new one.
        for suffix in ("-journal", "-wal", "-shm"):
            Path(f"{target}{suffix}").unlink(missing_ok=True)
        os.replace(staging, target)
    finally:
        staging.unlink(missing_ok=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m app.maintenance",
        description="Back up or restore the Credential Vault database.",
    )
    parser.add_argument(
        "--database",
        type=Path,
        default=None,
        help="database file (default: from DATABASE_URL)",
    )
    commands = parser.add_subparsers(dest="command", required=True)
    backup_cmd = commands.add_parser("backup", help="copy the database to a new file")
    backup_cmd.add_argument("destination", type=Path)
    restore_cmd = commands.add_parser("restore", help="replace the database with a backup")
    restore_cmd.add_argument("source", type=Path)
    args = parser.parse_args(argv)

    try:
        database = args.database or database_path()
        if args.command == "backup":
            backup(database, args.destination)
            revision = schema_revision(args.destination)
            print(f"backed up {database} -> {args.destination} (schema {revision})")
        else:
            restore(args.source, database)
            revision = schema_revision(database)
            print(f"restored {args.source} -> {database} (schema {revision})")
    except NoDatabaseError as exc:
        print(f"no database: {exc}", file=sys.stderr)
        return EXIT_NO_DATABASE
    except MaintenanceError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
