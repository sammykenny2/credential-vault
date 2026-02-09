"""Schemas for emergency access."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.emergency_access import EmergencyStatus


class EmergencyAccessCreate(BaseModel):
    """Create an emergency access grant."""

    grantee_email: str
    wait_time_days: int = Field(7, ge=1, le=90)


class EmergencyAccessRead(BaseModel):
    """Emergency access read schema."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    grantor_id: str
    grantee_id: str
    status: EmergencyStatus
    wait_time_days: int
    recovery_initiated_at: datetime | None
    recovery_deadline: datetime | None
    created_at: datetime
    updated_at: datetime

    # Display fields
    grantor_email: str = ""
    grantee_email: str = ""


class EmergencyAccessUpdate(BaseModel):
    """Update emergency access settings."""

    wait_time_days: int | None = Field(None, ge=1, le=90)


class RecoveryInitiate(BaseModel):
    """Initiate recovery request."""

    emergency_access_id: str
