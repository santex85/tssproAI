"""Auth: register, login, me, refresh, Intervals OAuth login."""

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Annotated
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.config import settings
from app.core.auth import (
    create_access_token,
    create_oauth_state_token_login,
    create_password_reset_token,
    create_refresh_token,
    hash_password,
    hash_password_reset_token,
    hash_refresh_token,
    verify_password,
)
from app.core.rate_limit import get_redis
from app.db.session import get_db
from app.models.intervals_credentials import IntervalsCredentials
from app.models.password_reset_token import PasswordResetToken
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.services.audit import log_action
from app.services.email import send_password_reset
from app.services.intervals_pending import get_and_delete_pending, get_pending
from sqlalchemy.exc import ProgrammingError

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])

ACCESS_TOKEN_EXPIRE_SECONDS = settings.access_token_expire_minutes * 60

# Simplified email format: local@domain.tld (reject obviously invalid to avoid DB junk)
EMAIL_FORMAT_RE = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")


def _issue_tokens(session: AsyncSession, user: User) -> tuple[str, str, int]:
    """Create access token, refresh token (stored in DB), return (access_token, refresh_token, expires_in)."""
    access = create_access_token(user.id, user.email)
    access_str = access if isinstance(access, str) else access.decode("utf-8")
    refresh_plain = create_refresh_token()
    expires_at = datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days)
    session.add(
        RefreshToken(
            user_id=user.id,
            token_hash=hash_refresh_token(refresh_plain),
            expires_at=expires_at,
        )
    )
    return access_str, refresh_plain, ACCESS_TOKEN_EXPIRE_SECONDS


class RegisterBody(BaseModel):
    email: str
    password: str


class LoginBody(BaseModel):
    email: str
    password: str


class UserOut(BaseModel):
    id: int
    email: str
    is_premium: bool = False


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds until access token expires
    user: UserOut


class RefreshBody(BaseModel):
    refresh_token: str


class ForgotPasswordBody(BaseModel):
    email: str


class ResetPasswordBody(BaseModel):
    token: str
    new_password: str


@router.post(
    "/register",
    response_model=TokenResponse,
    summary="Register a new user",
    responses={
        400: {"description": "Email and password required, invalid email format, or email already registered"},
        500: {"description": "Registration failed or database error"},
    },
)
async def register(
    session: Annotated[AsyncSession, Depends(get_db)],
    request: Request,
    body: RegisterBody,
) -> TokenResponse:
    email = (body.email or "").strip().lower()
    password = body.password or ""
    if not email or not password:
        raise HTTPException(status_code=400, detail="Email and password required")
    if not EMAIL_FORMAT_RE.match(email):
        raise HTTPException(status_code=400, detail="Invalid email format")
    r = await session.execute(select(User).where(User.email == email))
    if r.scalar_one_or_none() is not None:
        raise HTTPException(status_code=400, detail="Email already registered")
    try:
        user = User(email=email, password_hash=hash_password(password))
        session.add(user)
        await session.flush()
        await session.refresh(user)
    except IntegrityError as e:
        logger.warning("Register IntegrityError: %s", e)
        raise HTTPException(status_code=400, detail="Email already registered") from e
    except ProgrammingError as e:
        logger.exception("Register DB schema error: %s", e)
        detail = "Database schema error. Run: alembic upgrade head"
        if settings.debug:
            detail += f" ({str(e)})"
        raise HTTPException(status_code=500, detail=detail) from e
    except Exception as e:
        logger.exception("Register failed: %s", e)
        detail = "Registration failed"
        if settings.debug:
            detail += f": {type(e).__name__}: {e}"
        raise HTTPException(status_code=500, detail=detail) from e
    access_str, refresh_str, expires_in = _issue_tokens(session, user)
    await log_action(
        session,
        user_id=user.id,
        action="register",
        resource="auth",
        resource_id=str(user.id),
        ip_address=request.client.host if request.client else None,
    )
    await session.flush()
    return TokenResponse(
        access_token=access_str,
        refresh_token=refresh_str,
        expires_in=expires_in,
        user=UserOut(id=user.id, email=user.email, is_premium=user.is_premium),
    )


@router.post(
    "/login",
    response_model=TokenResponse,
    summary="Login with email and password",
    responses={
        401: {"description": "Invalid email or password"},
    },
)
async def login(
    session: Annotated[AsyncSession, Depends(get_db)],
    request: Request,
    body: LoginBody,
) -> TokenResponse:
    email = (body.email or "").strip().lower()
    password = body.password or ""
    if not email or not password:
        raise HTTPException(status_code=401, detail="Email and password required")
    r = await session.execute(select(User).where(User.email == email))
    user = r.scalar_one_or_none()
    if not user or not user.password_hash:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not verify_password(password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    access_str, refresh_str, expires_in = _issue_tokens(session, user)
    await log_action(
        session,
        user_id=user.id,
        action="login",
        resource="auth",
        resource_id=str(user.id),
        ip_address=request.client.host if request.client else None,
    )
    await session.flush()
    return TokenResponse(
        access_token=access_str,
        refresh_token=refresh_str,
        expires_in=expires_in,
        user=UserOut(id=user.id, email=user.email, is_premium=user.is_premium),
    )


@router.post(
    "/refresh",
    response_model=TokenResponse,
    summary="Exchange refresh token for new access and refresh tokens",
    responses={
        401: {"description": "Refresh token required, invalid or expired"},
    },
)
async def refresh_tokens(
    session: Annotated[AsyncSession, Depends(get_db)],
    request: Request,
    body: RefreshBody,
) -> TokenResponse:
    """Exchange refresh_token for new access_token and refresh_token (rotation)."""
    if not body.refresh_token or not body.refresh_token.strip():
        raise HTTPException(status_code=401, detail="Refresh token required")
    token_hash = hash_refresh_token(body.refresh_token.strip())
    r = await session.execute(
        select(RefreshToken).where(
            RefreshToken.token_hash == token_hash,
            RefreshToken.expires_at > datetime.now(timezone.utc),
        )
    )
    row = r.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")
    user_id = row.user_id
    await session.delete(row)
    await session.flush()
    r_user = await session.execute(select(User).where(User.id == user_id))
    user = r_user.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    access_str, refresh_str, expires_in = _issue_tokens(session, user)
    await log_action(
        session,
        user_id=user.id,
        action="refresh",
        resource="auth",
        resource_id=str(user.id),
        ip_address=request.client.host if request.client else None,
    )
    await session.flush()
    return TokenResponse(
        access_token=access_str,
        refresh_token=refresh_str,
        expires_in=expires_in,
        user=UserOut(id=user.id, email=user.email, is_premium=user.is_premium),
    )


@router.get(
    "/me",
    response_model=UserOut,
    summary="Get current authenticated user",
    responses={
        401: {"description": "Not authenticated or invalid token"},
    },
)
async def me(user: Annotated[User, Depends(get_current_user)]) -> UserOut:
    return UserOut(id=user.id, email=user.email, is_premium=user.is_premium)


FORGOT_PASSWORD_RATE_LIMIT_SECONDS = 5 * 60  # 5 minutes


@router.post(
    "/forgot-password",
    summary="Request password reset email",
    responses={
        200: {"description": "If email is valid format, always return 200 (do not reveal if account exists)"},
        400: {"description": "Invalid email format"},
        429: {"description": "Too many requests for this email, try again later"},
    },
)
async def forgot_password(
    session: Annotated[AsyncSession, Depends(get_db)],
    body: ForgotPasswordBody,
) -> dict:
    """Send password reset link to email. Always returns 200 for valid email format (security)."""
    email = (body.email or "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Email required")
    if not EMAIL_FORMAT_RE.match(email):
        raise HTTPException(status_code=400, detail="Invalid email format")

    redis_client = get_redis()
    if redis_client:
        rate_key = f"rate_limit:forgot_password:{email}"
        try:
            if await redis_client.exists(rate_key):
                raise HTTPException(
                    status_code=429,
                    detail="Too many requests. Please try again later.",
                    headers={"Retry-After": str(FORGOT_PASSWORD_RATE_LIMIT_SECONDS)},
                )
        except HTTPException:
            raise
        except Exception as e:
            logger.warning("Forgot-password rate limit check failed: %s", e)

    r = await session.execute(select(User).where(User.email == email))
    user = r.scalar_one_or_none()
    if user and user.password_hash:
        expires_at = datetime.now(timezone.utc) + timedelta(
            minutes=settings.password_reset_token_expire_minutes
        )
        token_plain = create_password_reset_token()
        token_hash = hash_password_reset_token(token_plain)
        session.add(
            PasswordResetToken(
                user_id=user.id,
                token_hash=token_hash,
                expires_at=expires_at,
            )
        )
        await session.flush()
        reset_link = f"{settings.frontend_base_url.rstrip('/')}/reset-password?token={token_plain}"
        await send_password_reset(email, reset_link)

        if redis_client:
            try:
                await redis_client.setex(rate_key, FORGOT_PASSWORD_RATE_LIMIT_SECONDS, "1")
            except Exception as e:
                logger.warning("Forgot-password rate limit set failed: %s", e)

    return {"message": "If an account exists with this email, you will receive a reset link."}


@router.post(
    "/reset-password",
    response_model=TokenResponse,
    summary="Reset password with token from email",
    responses={
        400: {"description": "Token or password invalid, token expired"},
    },
)
async def reset_password(
    session: Annotated[AsyncSession, Depends(get_db)],
    request: Request,
    body: ResetPasswordBody,
) -> TokenResponse:
    """Reset password using token from forgot-password email. Returns tokens on success."""
    token = (body.token or "").strip()
    new_password = body.new_password or ""
    if not token:
        raise HTTPException(status_code=400, detail="Token required")
    if not new_password or len(new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    token_hash = hash_password_reset_token(token)
    r = await session.execute(
        select(PasswordResetToken).where(
            PasswordResetToken.token_hash == token_hash,
            PasswordResetToken.expires_at > datetime.now(timezone.utc),
        )
    )
    row = r.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=400, detail="Invalid or expired token")

    user_id = row.user_id
    await session.delete(row)
    await session.flush()

    r_user = await session.execute(select(User).where(User.id == user_id))
    user = r_user.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=400, detail="User not found")

    user.password_hash = hash_password(new_password)
    await session.flush()

    await log_action(
        session,
        user_id=user.id,
        action="reset_password",
        resource="auth",
        resource_id=str(user.id),
        ip_address=request.client.host if request.client else None,
    )

    access_str, refresh_str, expires_in = _issue_tokens(session, user)
    await session.flush()
    return TokenResponse(
        access_token=access_str,
        refresh_token=refresh_str,
        expires_in=expires_in,
        user=UserOut(id=user.id, email=user.email, is_premium=user.is_premium),
    )


INTERVALS_OAUTH_SCOPES = "ACTIVITY:READ,WELLNESS:READ,CALENDAR:READ,CALENDAR:WRITE"


@router.get(
    "/intervals/authorize",
    summary="Get Intervals.icu OAuth redirect URL for login/register (no auth)",
    responses={503: {"description": "OAuth not configured"}},
)
async def auth_intervals_authorize(return_app: bool = False) -> dict:
    """Return redirect_url for Intervals.icu OAuth login/register flow.
    No auth required. Frontend opens this URL in browser.
    return_app: when True, callback redirects to smarttrainer:// for mobile deep link."""
    if not settings.intervals_client_id or not settings.intervals_oauth_redirect_uri:
        raise HTTPException(
            status_code=503,
            detail="Intervals.icu OAuth is not configured. Set INTERVALS_CLIENT_ID and INTERVALS_OAUTH_REDIRECT_URI.",
        )
    state = create_oauth_state_token_login(return_app=return_app)
    params = {
        "client_id": settings.intervals_client_id,
        "redirect_uri": settings.intervals_oauth_redirect_uri,
        "scope": INTERVALS_OAUTH_SCOPES,
        "state": state,
    }
    redirect_url = f"https://intervals.icu/oauth/authorize?{urlencode(params)}"
    return {"redirect_url": redirect_url}


class IntervalsPendingOut(BaseModel):
    athlete_id: str
    athlete_name: str
    has_user: bool


class IntervalsCompleteBody(BaseModel):
    pending_key: str
    email: str | None = None


@router.get(
    "/intervals/pending",
    response_model=IntervalsPendingOut,
    summary="Get Intervals OAuth pending data (for login/register completion)",
    responses={404: {"description": "Pending key not found or expired"}},
)
async def auth_intervals_pending(key: str) -> IntervalsPendingOut:
    """Return athlete_id, athlete_name, has_user for the given pending key.
    Frontend uses this to decide: if has_user, call complete immediately; else show email form then complete."""
    data = await get_pending(key)
    if not data:
        raise HTTPException(status_code=404, detail="Pending key not found or expired")
    return IntervalsPendingOut(
        athlete_id=data["athlete_id"],
        athlete_name=data["athlete_name"],
        has_user=data["has_user"],
    )


@router.post(
    "/intervals/complete",
    response_model=TokenResponse,
    summary="Complete Intervals OAuth login/register",
    responses={
        400: {"description": "Email required for new user"},
        404: {"description": "Pending key not found or expired"},
    },
)
async def auth_intervals_complete(
    session: Annotated[AsyncSession, Depends(get_db)],
    request: Request,
    body: IntervalsCompleteBody,
) -> TokenResponse:
    """Complete Intervals login: consume pending key, create User if new, return tokens."""
    data = await get_and_delete_pending(body.pending_key)
    if not data:
        raise HTTPException(status_code=404, detail="Pending key not found or expired")
    has_user = data["has_user"]
    encrypted_token = data["encrypted_token"]
    athlete_id = data["athlete_id"]

    if has_user:
        user_id = data["user_id"]
        if not user_id:
            raise HTTPException(status_code=400, detail="Invalid pending data")
        r = await session.execute(select(User).where(User.id == user_id))
        user = r.scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        r_creds = await session.execute(
            select(IntervalsCredentials).where(IntervalsCredentials.user_id == user_id)
        )
        creds = r_creds.scalar_one_or_none()
        if creds:
            creds.encrypted_token_or_key = encrypted_token
            creds.athlete_id = athlete_id
            creds.auth_type = "oauth"
        else:
            session.add(
                IntervalsCredentials(
                    user_id=user_id,
                    encrypted_token_or_key=encrypted_token,
                    athlete_id=athlete_id,
                    auth_type="oauth",
                )
            )
        await log_action(
            session,
            user_id=user.id,
            action="login",
            resource="auth",
            resource_id=str(user.id),
            ip_address=request.client.host if request.client else None,
            details={"method": "intervals_oauth"},
        )
    else:
        email = (body.email or "").strip().lower()
        if not email:
            raise HTTPException(status_code=400, detail="Email required for new user registration")
        if not EMAIL_FORMAT_RE.match(email):
            raise HTTPException(status_code=400, detail="Invalid email format")
        r = await session.execute(select(User).where(User.email == email))
        if r.scalar_one_or_none() is not None:
            raise HTTPException(status_code=400, detail="Email already registered")
        try:
            user = User(email=email, password_hash=None)
            session.add(user)
            await session.flush()
            await session.refresh(user)
            session.add(
                IntervalsCredentials(
                    user_id=user.id,
                    encrypted_token_or_key=encrypted_token,
                    athlete_id=athlete_id,
                    auth_type="oauth",
                )
            )
            await log_action(
                session,
                user_id=user.id,
                action="register",
                resource="auth",
                resource_id=str(user.id),
                ip_address=request.client.host if request.client else None,
                details={"method": "intervals_oauth"},
            )
        except IntegrityError as e:
            logger.warning("Intervals complete register IntegrityError: %s", e)
            raise HTTPException(status_code=400, detail="Email already registered") from e

    await session.commit()
    access_str, refresh_str, expires_in = _issue_tokens(session, user)
    await session.flush()
    return TokenResponse(
        access_token=access_str,
        refresh_token=refresh_str,
        expires_in=expires_in,
        user=UserOut(id=user.id, email=user.email, is_premium=user.is_premium),
    )
