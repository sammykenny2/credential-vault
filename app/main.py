"""FastAPI application entry point."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.api.v1.router import api_router
from app.config import get_settings
from app.core.logging_config import setup_logging
from app.core.rate_limit import limiter
from app.core.request_logging import RequestLoggingMiddleware
from app.core.security_headers import SecurityHeadersMiddleware
from app.core.tailscale import TailscaleMiddleware
from app.db.session import init_db

settings = get_settings()

# Initialize structured logging
setup_logging()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    # Startup
    await init_db()

    # Bootstrap: create initial admin if needed
    from app.db.session import AsyncSessionLocal
    from app.services.bootstrap import run_bootstrap

    async with AsyncSessionLocal() as db:
        await run_bootstrap(db)

    yield
    # Shutdown
    pass


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Self-hosted credential management system with E2EE and Google OAuth",
    docs_url="/docs" if settings.is_development else None,
    redoc_url="/redoc" if settings.is_development else None,
    lifespan=lifespan,
)

# Rate limiting
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]

# Request logging
app.add_middleware(RequestLoggingMiddleware)

# Security headers
app.add_middleware(SecurityHeadersMiddleware)

# Tailscale middleware (production only)
if settings.require_tailscale:
    app.add_middleware(TailscaleMiddleware)

# CORS middleware (restrict in production)
if settings.is_development:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    # Production: only allow same-origin requests
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[f"https://{settings.ts_cert_domain}"] if settings.ts_cert_domain else [],
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )

# Include API router
app.include_router(api_router, prefix="/api/v1")


@app.get("/health")
async def health_check():
    """Health check endpoint for Docker."""
    import time

    from sqlalchemy import text

    from app.db.session import AsyncSessionLocal

    result = {
        "status": "healthy",
        "version": settings.app_version,
        "revision": settings.app_revision,
        "environment": settings.app_env,
        "database": "unknown",
    }

    # Check database connectivity
    try:
        async with AsyncSessionLocal() as session:
            start = time.monotonic()
            await session.execute(text("SELECT 1"))
            db_latency_ms = (time.monotonic() - start) * 1000
            result["database"] = "connected"
            result["database_latency_ms"] = round(db_latency_ms, 1)
    except Exception:
        result["status"] = "degraded"
        result["database"] = "disconnected"

    return result


def main():
    """Run application with uvicorn."""
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.is_development,
    )


if __name__ == "__main__":
    main()
