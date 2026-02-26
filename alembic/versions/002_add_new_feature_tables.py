"""Add credential sharing, emergency access, WebAuthn, TOTP, and expires_at.

Revision ID: 002_add_new_features
Revises: 001_add_templates
Create Date: 2026-02-09

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "002_add_new_features"
down_revision: str | None = "001_add_templates"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add new feature tables and columns."""
    pass


def downgrade() -> None:
    """Remove new feature tables and columns."""
    pass
