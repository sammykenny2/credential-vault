"""Application configuration using Pydantic settings."""

from functools import lru_cache
from pathlib import Path

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Placeholder shipped in .env.example; production refuses to start with it.
DEFAULT_SECRET_KEY = "change-this-secret-key-in-production"
MIN_SECRET_KEY_LENGTH = 32

# The release version: VERSION at the repository root, copied to /app/VERSION
# in the backend image. Not a setting, so the environment cannot misreport it.
VERSION_FILE = Path(__file__).resolve().parent.parent / "VERSION"


def read_version(path: Path = VERSION_FILE) -> str:
    """Return the release version from the VERSION file, or "unknown"."""
    try:
        return path.read_text(encoding="utf-8").strip() or "unknown"
    except OSError:
        return "unknown"


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Application
    app_env: str = "development"
    app_debug: bool = False
    app_name: str = "Credential Vault"
    # Commit the image was built from (APP_REVISION, set by the image build)
    app_revision: str = "dev"

    # Database
    database_url: str = "sqlite+aiosqlite:///data/credential_vault.db"

    # Security
    secret_key: str = DEFAULT_SECRET_KEY

    # JWT
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7

    # Google OAuth
    google_client_id: str = ""
    google_client_secret: str = ""

    # Session
    session_expire_minutes: int = 30

    # Rate Limiting
    rate_limit_per_minute: int = 60

    # Initial Admin (for bootstrap via Google OAuth)
    admin_email: str | None = None
    admin_display_name: str = "Administrator"
    admin_password: str | None = None  # Break-glass admin password (optional)

    # Tailscale
    ts_hostname: str = "credential-vault"
    ts_cert_domain: str = ""
    require_tailscale: bool = False  # Set to True in production

    # Reverse proxies whose X-Forwarded-For chain is trusted (comma-separated
    # CIDRs). Defaults cover loopback and the Docker bridge networks used by
    # the compose stack (nginx and the tailscale sidecar).
    trusted_proxies: str = "127.0.0.1/32,::1/128,172.16.0.0/12"

    @property
    def app_version(self) -> str:
        return read_version()

    @property
    def is_development(self) -> bool:
        return self.app_env == "development"

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @model_validator(mode="after")
    def _refuse_unsafe_production_config(self) -> Settings:
        """Fail fast instead of signing sessions with a well-known key."""
        if not self.is_production:
            return self
        if self.secret_key == DEFAULT_SECRET_KEY or len(self.secret_key) < MIN_SECRET_KEY_LENGTH:
            raise ValueError(
                "SECRET_KEY must be a random value of at least "
                f"{MIN_SECRET_KEY_LENGTH} characters when APP_ENV=production "
                "(generate one with: openssl rand -hex 32)"
            )
        if self.app_debug:
            raise ValueError("APP_DEBUG must be false when APP_ENV=production")
        return self


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
