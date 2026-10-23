"""Add users.kdf_version so vault key derivation parameters can evolve.

Revision ID: 6d8f2b0c3e55
Revises: 5c7e1a9b2d44
Create Date: 2026-10-23 11:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "6d8f2b0c3e55"
down_revision: str | None = "5c7e1a9b2d44"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Existing vaults were all created with Argon2id v2 parameters."""
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("kdf_version", sa.Integer(), nullable=False, server_default="2")
        )


def downgrade() -> None:
    """Drop the kdf_version column."""
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("kdf_version")
