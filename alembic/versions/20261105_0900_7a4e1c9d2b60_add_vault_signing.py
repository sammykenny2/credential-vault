"""Add the vault signing public key and signed credential state (ADR-004).

No ciphertext is rewritten. Existing credentials start at revision 1 with no
signature; the browser signs them during the one-time vault upgrade, labelled
legacy-unverified.

Upgrading only adds columns, deliberately. Dropping a column in batch mode rebuilds
the table with DROP TABLE, and with foreign keys on that would silently cascade to
every child of `users`. So the old proof columns stay: `vault_proof_hash` now holds
the per-user proof key, and `vault_proof_expires_at` is unused.

Revision ID: 7a4e1c9d2b60
Revises: 6d8f2b0c3e55
Create Date: 2026-11-05 09:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "7a4e1c9d2b60"
down_revision: str | None = "6d8f2b0c3e55"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add signing columns."""
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(sa.Column("signing_public_key", sa.Text(), nullable=True))

    with op.batch_alter_table("credentials", schema=None) as batch_op:
        batch_op.add_column(sa.Column("revision", sa.Integer(), nullable=False, server_default="1"))
        batch_op.add_column(sa.Column("signature", sa.String(length=88), nullable=True))
        batch_op.add_column(sa.Column("signature_version", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("origin", sa.String(length=32), nullable=True))


def downgrade() -> None:
    """Refuse to drop signatures: an old server would accept unsigned writes again.

    Restore a pre-upgrade snapshot instead (scripts/windows/Deploy-CredentialVault.ps1 -Restore).
    """
    bind = op.get_bind()
    # Dropping columns rebuilds these tables, which would cascade with foreign keys on.
    if bind.execute(sa.text("PRAGMA foreign_keys")).scalar_one():
        raise RuntimeError("Refusing to downgrade with foreign keys on: rows would be lost.")

    signed = bind.execute(
        sa.text("SELECT COUNT(*) FROM users WHERE signing_public_key IS NOT NULL")
    ).scalar_one()
    if signed:
        raise RuntimeError(
            "Refusing to downgrade: signed vaults exist. Restore a pre-upgrade snapshot instead."
        )

    with op.batch_alter_table("credentials", schema=None) as batch_op:
        batch_op.drop_column("origin")
        batch_op.drop_column("signature_version")
        batch_op.drop_column("signature")
        batch_op.drop_column("revision")

    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("signing_public_key")
