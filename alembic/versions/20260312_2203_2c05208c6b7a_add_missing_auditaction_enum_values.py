"""add missing auditaction enum values

Revision ID: 2c05208c6b7a
Revises: 004_encrypt_metadata
Create Date: 2026-03-12 22:03:55.707963+00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "2c05208c6b7a"
down_revision: Union[str, None] = "004_encrypt_metadata"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add OAUTH_LOGIN, VAULT_SETUP, VAULT_UNLOCK to auditaction enum."""
    op.execute("ALTER TYPE auditaction ADD VALUE IF NOT EXISTS 'OAUTH_LOGIN'")
    op.execute("ALTER TYPE auditaction ADD VALUE IF NOT EXISTS 'VAULT_SETUP'")
    op.execute("ALTER TYPE auditaction ADD VALUE IF NOT EXISTS 'VAULT_UNLOCK'")


def downgrade() -> None:
    """PostgreSQL does not support removing enum values directly."""
    pass
