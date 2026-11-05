"""Durable refresh families and the single first-admin claim."""

from sqlalchemy import BigInteger, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class AuthSession(Base):
    """Only a hash of the current refresh identifier is stored."""

    __tablename__ = "auth_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    refresh_hash: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[int] = mapped_column(BigInteger, index=True)
    rotated_at: Mapped[int] = mapped_column(BigInteger)
    revoked_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)


class AdminBootstrapClaim(Base):
    """ID 1 can be claimed once; a rolled-back setup does not consume the claim."""

    __tablename__ = "admin_bootstrap_claim"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
