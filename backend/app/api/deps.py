"""FastAPI dependencies: current user from JWT, premium, usage limits."""

from datetime import date
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.auth import decode_token
from app.db.session import get_db
from app.models.daily_usage import DailyUsage
from app.models.user import User


async def get_current_user(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = auth_header[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = decode_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user_id_str = payload.get("sub")
    if not user_id_str:
        raise HTTPException(status_code=401, detail="Invalid token")
    try:
        user_id = int(user_id_str)
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid token")
    r = await session.execute(select(User).where(User.id == user_id))
    user = r.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


SUPPORTED_LOCALES = frozenset({"ru", "en"})


def _normalize_locale(value: str | None) -> str:
    if not value or not value.strip():
        return "ru"
    code = value.strip().lower()[:10]
    if code in SUPPORTED_LOCALES:
        return code
    return "ru"


async def get_request_locale(
    request: Request,
    user: Annotated[User, Depends(get_current_user)],
) -> str:
    """Locale for this request: Accept-Language or X-App-Language header, else user.locale from DB, else 'ru'."""
    header = request.headers.get("X-App-Language") or request.headers.get("Accept-Language")
    if header:
        # Accept-Language can be "en-US,en;q=0.9,ru;q=0.8" — take first tag
        first = (header.split(",")[0] or "").strip().split("-")[0].lower()
        if first in SUPPORTED_LOCALES:
            return first
    return _normalize_locale(user.locale)


async def require_premium(
    user: Annotated[User, Depends(get_current_user)],
) -> User:
    """Require premium subscription. Raises 403 otherwise."""
    if not user.is_premium:
        raise HTTPException(
            status_code=403,
            detail="Premium subscription required",
            headers={"X-Upgrade-Required": "true"},
        )
    return user


async def _check_usage(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    limit: int,
    counter_column: str,
) -> None:
    """Check daily usage limit for free users; increment counter. Premium always passes. Raises 429 when limit exceeded."""
    if user.is_premium:
        return
    today = date.today()
    r = await session.execute(
        select(DailyUsage).where(
            DailyUsage.user_id == user.id,
            DailyUsage.date == today,
        )
    )
    row = r.scalar_one_or_none()
    if not row:
        row = DailyUsage(user_id=user.id, date=today, photo_analyses=0, chat_messages=0)
        session.add(row)
        await session.flush()
    current = getattr(row, counter_column)
    if current >= limit:
        raise HTTPException(
            status_code=429,
            detail=f"Daily limit of {limit} reached. Upgrade to Pro for unlimited access.",
            headers={"X-Upgrade-Required": "true", "X-Usage-Limit": str(limit)},
        )
    setattr(row, counter_column, current + 1)
    await session.flush()


async def check_photo_usage(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> None:
    """Check photo analysis daily limit for free users; increment. Premium passes."""
    await _check_usage(session, user, settings.free_daily_photo_limit, "photo_analyses")


async def check_chat_usage(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> None:
    """Check chat message daily limit for free users; increment. Premium passes."""
    await _check_usage(session, user, settings.free_daily_chat_limit, "chat_messages")
