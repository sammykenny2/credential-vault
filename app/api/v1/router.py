"""API v1 router aggregating all endpoints."""

from fastapi import APIRouter

from app.api.v1 import (
    audit,
    auth,
    credentials,
    health,
    oauth,
    setup,
    stubs,
    templates,
    tools,
    users,
    webauthn,
)

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(oauth.router, prefix="/oauth", tags=["oauth"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(credentials.router, prefix="/credentials", tags=["credentials"])
api_router.include_router(templates.router, prefix="/templates", tags=["templates"])
api_router.include_router(audit.router, prefix="/audit-logs", tags=["audit"])
api_router.include_router(tools.router, prefix="/tools", tags=["tools"])
api_router.include_router(health.router, prefix="/credential-health", tags=["health"])
api_router.include_router(webauthn.router, prefix="/webauthn", tags=["webauthn"])
api_router.include_router(setup.router, prefix="/setup", tags=["setup"])
api_router.include_router(stubs.router, tags=["offline-features"])
