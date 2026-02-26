"""Application configuration using Pydantic settings."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


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
    app_version: str = "0.1.0"

    # Database
    database_url: str = "postgresql+asyncpg://vault:password@localhost:5432/credential_vault"

    # Security
    secret_key: str = "change-this-secret-key-in-production"
    encryption_key: str = "change-this-encryption-key-in-production"

    # JWT
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7

    # MFA
    mfa_issuer: str = "CredentialVault"
    mfa_required: bool = True

    # Session
    session_expire_minutes: int = 30

    # Rate Limiting
    rate_limit_per_minute: int = 60

    # Initial Admin (for bootstrap)
    admin_email: str | None = None
    admin_password: str | None = None
    admin_display_name: str = "Administrator"

    # Tailscale
    ts_hostname: str = "credential-vault"
    ts_cert_domain: str = ""
    require_tailscale: bool = False  # Set to True in production

    @property
    def is_development(self) -> bool:
        return self.app_env == "development"

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
