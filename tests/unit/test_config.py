"""Tests for the settings guard that refuses unsafe production configuration."""

import pytest
from pydantic import ValidationError

from app.config import DEFAULT_SECRET_KEY, MIN_SECRET_KEY_LENGTH, Settings

STRONG_SECRET = "f" * 64


def _settings(**overrides) -> Settings:
    # _env_file=None keeps the developer's local .env out of these tests.
    return Settings(_env_file=None, **overrides)


def test_production_rejects_default_secret_key():
    with pytest.raises(ValidationError, match="SECRET_KEY"):
        _settings(app_env="production", app_debug=False, secret_key=DEFAULT_SECRET_KEY)


def test_production_rejects_short_secret_key():
    with pytest.raises(ValidationError, match="SECRET_KEY"):
        _settings(
            app_env="production",
            app_debug=False,
            secret_key="x" * (MIN_SECRET_KEY_LENGTH - 1),
        )


def test_production_rejects_debug_mode():
    with pytest.raises(ValidationError, match="APP_DEBUG"):
        _settings(app_env="production", app_debug=True, secret_key=STRONG_SECRET)


def test_production_accepts_strong_secret_key():
    settings = _settings(app_env="production", app_debug=False, secret_key=STRONG_SECRET)
    assert settings.is_production
    assert settings.secret_key == STRONG_SECRET


def test_development_allows_placeholder_secret_key():
    settings = _settings(app_env="development", app_debug=True, secret_key=DEFAULT_SECRET_KEY)
    assert settings.is_development
