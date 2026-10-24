"""The release version comes from the VERSION file, and /health reports it."""

import re

import pytest

import app.db.session as db_session
from app.config import VERSION_FILE, Settings, read_version
from app.main import health_check


def test_version_file_holds_a_release_number():
    assert re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", read_version())


def test_read_version_strips_the_file(tmp_path):
    path = tmp_path / "VERSION"
    path.write_text("1.2.3\n", encoding="utf-8")
    assert read_version(path) == "1.2.3"


def test_read_version_without_a_file_is_unknown(tmp_path):
    assert read_version(tmp_path / "missing") == "unknown"


def test_the_environment_cannot_change_the_version(monkeypatch):
    monkeypatch.setenv("APP_VERSION", "9.9.9")
    settings = Settings(_env_file=None)
    assert settings.app_version == VERSION_FILE.read_text(encoding="utf-8").strip()


def test_revision_comes_from_the_image_build(monkeypatch):
    monkeypatch.setenv("APP_REVISION", "abc1234")
    assert Settings(_env_file=None).app_revision == "abc1234"


class _NoDatabase:
    async def __aenter__(self):
        raise RuntimeError("no database in this test")

    async def __aexit__(self, *exc):
        return False


@pytest.mark.asyncio
async def test_health_reports_version_and_revision(monkeypatch):
    monkeypatch.setattr(db_session, "AsyncSessionLocal", _NoDatabase)
    result = await health_check()
    assert result["version"] == read_version()
    assert "revision" in result
