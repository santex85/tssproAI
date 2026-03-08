"""User endpoints: seed (dev), push token (Expo notifications), premium toggle (dev)."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.config import settings
from app.core.auth import hash_password
from app.db.session import get_db
from app.models.user import User

router = APIRouter(prefix="/users", tags=["users"])

DEV_SEED_EMAIL = "default@smarttrainer.local"
DEV_SEED_PASSWORD = "dev"


class PushTokenBody(BaseModel):
    token: str
    platform: str | None = None  # "ios" | "android" | "web"


class PremiumToggleBody(BaseModel):
    is_premium: bool


@router.post(
    "/push-token",
    summary="Save Expo push token",
    responses={401: {"description": "Not authenticated"}},
)
async def save_push_token(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    body: PushTokenBody,
):
    """Store Expo push token for the current user (for notifications)."""
    user.push_token = body.token.strip() or None
    user.push_platform = (body.platform or "").strip() or None
    await session.flush()
    return {"ok": True}


@router.patch(
    "/me/premium",
    summary="Toggle premium (development only)",
    responses={
        401: {"description": "Not authenticated"},
        403: {"description": "Only available in development"},
    },
)
async def update_my_premium(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    body: PremiumToggleBody,
) -> dict:
    """Set is_premium for current user. Allowed when app_env != production or dev_premium_toggle_enabled (e.g. dev/stripe testing)."""
    if settings.app_env == "production" and not settings.dev_premium_toggle_enabled:
        raise HTTPException(status_code=403, detail="Premium toggle only available in development.")
    user.is_premium = body.is_premium
    await session.flush()
    return {"is_premium": user.is_premium}


@router.post(
    "/seed",
    summary="Seed default user (debug only)",
    responses={404: {"description": "Only when debug=True"}},
)
async def seed_default_user(session: Annotated[AsyncSession, Depends(get_db)]):
    """Create default@smarttrainer.local with password 'dev' only when debug=True and DB has no users."""
    if not settings.debug:
        raise HTTPException(status_code=404, detail="Not found")
    r = await session.execute(select(User).where(User.email == DEV_SEED_EMAIL))
    if r.scalar_one_or_none() is not None:
        return {"message": "User already exists", "status": "ok"}
    session.add(
        User(email=DEV_SEED_EMAIL, password_hash=hash_password(DEV_SEED_PASSWORD))
    )
    return {
        "message": "Default user created",
        "email": DEV_SEED_EMAIL,
        "password": DEV_SEED_PASSWORD,
    }
