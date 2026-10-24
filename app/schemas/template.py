"""Template schemas for API request/response validation."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class TemplateField(BaseModel):
    """Single field definition within a template.

    This is stored as JSONB in the database.
    """

    key: str = Field(min_length=1, max_length=100)
    placeholder: str | None = Field(None, max_length=255)
    isSecret: bool = False
    required: bool | None = None
    defaultValue: str | None = Field(None, max_length=1000)

    @model_validator(mode="after")
    def _no_default_for_secret_fields(self) -> TemplateField:
        """Templates are stored unencrypted; a secret default would be plaintext on the server."""
        if self.isSecret and self.defaultValue:
            raise ValueError(
                "Secret fields cannot have a default value: templates are stored unencrypted"
            )
        return self


class TemplateBase(BaseModel):
    """Base template schema (metadata)."""

    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(None, max_length=1000)
    icon: str | None = Field(None, max_length=50)
    category: str | None = Field(None, max_length=50)


class TemplateCreate(TemplateBase):
    """Template creation schema."""

    fields: list[TemplateField] = Field(min_length=1, max_length=50)

    @field_validator("fields")
    @classmethod
    def validate_unique_keys(cls, v: list[TemplateField]) -> list[TemplateField]:
        """Ensure all field keys are unique."""
        keys = [f.key for f in v]
        if len(keys) != len(set(keys)):
            raise ValueError("Field keys must be unique")
        return v


class TemplateUpdate(BaseModel):
    """Template update schema.

    Requires sync_version for optimistic locking.
    """

    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = Field(None, max_length=1000)
    icon: str | None = Field(None, max_length=50)
    category: str | None = Field(None, max_length=50)
    fields: list[TemplateField] | None = Field(None, min_length=1, max_length=50)
    sync_version: int = Field(..., ge=1, description="Current version for optimistic locking")

    @field_validator("fields")
    @classmethod
    def validate_unique_keys(cls, v: list[TemplateField] | None) -> list[TemplateField] | None:
        """Ensure all field keys are unique."""
        if v is None:
            return v
        keys = [f.key for f in v]
        if len(keys) != len(set(keys)):
            raise ValueError("Field keys must be unique")
        return v


class TemplateRead(TemplateBase):
    """Full template response schema."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    owner_id: str
    fields: list[TemplateField]
    sync_version: int
    is_active: bool
    created_at: datetime
    updated_at: datetime


class TemplateListItem(BaseModel):
    """Template list item (lightweight, for listing)."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    description: str | None
    icon: str | None
    category: str | None
    sync_version: int
    is_active: bool
    created_at: datetime
    updated_at: datetime


class TemplateListResponse(BaseModel):
    """Response for listing templates."""

    templates: list[TemplateListItem]
    total: int


# Usage tracking schemas


class TemplateUsageRecord(BaseModel):
    """Single usage record."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    template_id: str
    credential_id: str | None
    used_at: datetime


class TemplateUsageStats(BaseModel):
    """Aggregated usage statistics for a template."""

    template_id: str
    template_name: str
    use_count: int
    last_used_at: datetime | None


class TemplateUsageResponse(BaseModel):
    """Response for usage statistics."""

    usage: list[TemplateUsageStats]


class RecordUsageRequest(BaseModel):
    """Request to record template usage."""

    credential_id: str | None = None


class RecordUsageResponse(BaseModel):
    """Response after recording usage."""

    template_id: str
    use_count: int


# Sync/Migration schemas


class SyncTemplateItem(BaseModel):
    """Single template in sync request (from localStorage)."""

    local_id: str = Field(description="Local ID from localStorage (e.g., 'custom-abc123')")
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(None, max_length=1000)
    icon: str | None = Field(None, max_length=50)
    category: str | None = Field(None, max_length=50)
    fields: list[TemplateField] = Field(min_length=1, max_length=50)
    created_at: datetime | None = None

    @field_validator("fields")
    @classmethod
    def validate_unique_keys(cls, v: list[TemplateField]) -> list[TemplateField]:
        """Ensure all field keys are unique."""
        keys = [f.key for f in v]
        if len(keys) != len(set(keys)):
            raise ValueError("Field keys must be unique")
        return v


class SyncUsageItem(BaseModel):
    """Single usage record in sync request."""

    local_template_id: str
    used_at: datetime


class SyncRequest(BaseModel):
    """Request to sync templates from localStorage to backend."""

    templates: list[SyncTemplateItem] = Field(default_factory=list, max_length=100)
    usage: list[SyncUsageItem] = Field(default_factory=list, max_length=1000)


class SyncResponse(BaseModel):
    """Response after syncing templates."""

    synced: int = Field(description="Number of templates successfully synced")
    skipped: int = Field(description="Number of templates skipped (already exist)")
    mapping: dict[str, str] = Field(
        default_factory=dict,
        description="Mapping from local_id to server UUID",
    )


# Version conflict response


class VersionConflictResponse(BaseModel):
    """Response when version conflict occurs (409)."""

    detail: str = "Version conflict"
    server_version: int
    client_version: int
    server_data: TemplateRead
