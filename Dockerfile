# Credential Vault - Backend Dockerfile
# Multi-stage build: dependencies are installed into a virtualenv in the
# builder and copied to a location the non-root runtime user can read.

# ============================================
# Build Stage
# ============================================
FROM python:3.11-slim AS builder

WORKDIR /build

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Self-contained virtualenv; /root/.local would be unreadable by the runtime user
RUN python -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH

# Install the application and its dependencies
COPY pyproject.toml README.md ./
COPY app/ ./app/
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir .

# ============================================
# Production Stage
# ============================================
FROM python:3.11-slim

WORKDIR /app

# Runtime dependencies only (curl for the health check)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Non-root runtime user
RUN useradd --create-home --shell /usr/sbin/nologin appuser

# Virtualenv from the builder (world-readable, owned by root)
COPY --from=builder /opt/venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Application source and migrations
COPY --chown=appuser:appuser app/ ./app/
COPY --chown=appuser:appuser alembic.ini ./alembic.ini
COPY --chown=appuser:appuser alembic/ ./alembic/

# SQLite lives here; docker-compose mounts the vault_data volume over it, and a
# new named volume copies this directory's appuser ownership on first use
RUN mkdir -p /app/data && chown appuser:appuser /app/data

USER appuser

# Expose port (internal only - not mapped to host in production)
EXPOSE 8000

# Health check using curl (lighter than httpx)
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Apply pending migrations, then serve. Single worker: the rate limiter keeps
# its counters in process memory, and a personal vault behind Tailscale does
# not need more than one async worker.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1 --loop uvloop --http httptools --no-access-log"]
