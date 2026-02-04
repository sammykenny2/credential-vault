"""API v1 router aggregating all endpoints."""

from fastapi import APIRouter

from src.api.v1 import auth, credentials, users

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(credentials.router, prefix="/credentials", tags=["credentials"])
