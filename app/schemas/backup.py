"""Schemas for backup and restore."""

from datetime import datetime

from pydantic import BaseModel, Field


class BackupCreate(BaseModel):
    """Request to create a backup."""

    include_credentials: bool = True
    include_templates: bool = True
    include_totp_accounts: bool = True
    encryption_password: str = Field(min_length=8)


class BackupMetadata(BaseModel):
    """Backup file metadata."""

    version: str = "1.0"
    created_at: datetime
    app_version: str
    credential_count: int
    template_count: int
    totp_account_count: int


class BackupResponse(BaseModel):
    """Response containing encrypted backup data."""

    metadata: BackupMetadata
    encrypted_data: str  # base64 encoded encrypted JSON


class RestoreRequest(BaseModel):
    """Request to restore from backup."""

    encrypted_data: str
    encryption_password: str
    overwrite_existing: bool = False


class RestoreResult(BaseModel):
    """Result of restore operation."""

    credentials_restored: int
    templates_restored: int
    totp_accounts_restored: int
    errors: list[str]
