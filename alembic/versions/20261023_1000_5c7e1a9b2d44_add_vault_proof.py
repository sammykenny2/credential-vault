"""Add users.vault_proof_hash / vault_proof_expires_at for proof-of-unlock.

Revision ID: 5c7e1a9b2d44
Revises: 3f9c2d1e7b40
Create Date: 2026-10-23 10:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5c7e1a9b2d44"
down_revision: str | None = "3f9c2d1e7b40"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Store the hash and expiry of the last vault challenge the client must answer."""
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(sa.Column("vault_proof_hash", sa.String(length=64), nullable=True))
        batch_op.add_column(
            sa.Column("vault_proof_expires_at", sa.DateTime(timezone=True), nullable=True)
        )


def downgrade() -> None:
    """Drop the vault proof columns."""
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("vault_proof_expires_at")
        batch_op.drop_column("vault_proof_hash")
