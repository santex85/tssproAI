import logging
import sys
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address

from app.api.v1 import analytics, auth, athlete_profile, billing, chat, intervals, nutrition, photo, users, wellness, workouts
from app.services.retention import run_recovery_reminder_job

# Ensure app loggers (Intervals, sync, etc.) print to stdout so you see them in the terminal
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stdout,
)
logging.getLogger("app").setLevel(logging.DEBUG)
from app.config import settings
from app.db.session import init_db
from app.core.rate_limit import close_redis
from app.services.http_client import close_http_client, init_http_client
from prometheus_client import make_asgi_app
import sentry_sdk

if settings.sentry_dsn:
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment,
        send_default_pii=True,
    )

scheduler = AsyncIOScheduler()


ORCHESTRATOR_PUSH_TITLE_BY_LOCALE = {
    "ru": "Решение на день",
    "en": "Daily decision",
}


async def scheduled_orchestrator_run():
    """Run orchestrator (daily decision) for every user at configured hours (parallel with semaphore)."""
    import asyncio
    from datetime import date
    from sqlalchemy import select
    from app.db.session import async_session_maker
    from app.models.user import User
    from app.services.orchestrator import run_daily_decision
    from app.services.push_notifications import send_push_to_user

    async with async_session_maker() as session:
        r = await session.execute(
            select(User.id, User.locale).where(User.is_premium.is_(True))
        )
        user_rows = [(row[0], (row[1] or "ru")) for row in r.all()]
    if not user_rows:
        return

    sem = asyncio.Semaphore(5)

    async def run_for_user(uid: int, locale: str) -> None:
        async with sem:
            async with async_session_maker() as session:
                result = await run_daily_decision(session, uid, date.today(), locale=locale)
                await session.commit()
                summary = f"{result.decision.value}: {(result.reason or '')[:80]}"
                if result.reason and len(result.reason or '') > 80:
                    summary += "..."
                title = ORCHESTRATOR_PUSH_TITLE_BY_LOCALE.get(locale, ORCHESTRATOR_PUSH_TITLE_BY_LOCALE["en"])
                await send_push_to_user(session, uid, title, summary)

    await asyncio.gather(*[run_for_user(uid, loc) for uid, loc in user_rows])


SLEEP_REMINDER_BY_LOCALE = {
    "ru": ("Сон", "Укажите данные сна за сегодня или загрузите скриншот."),
    "en": ("Sleep", "Enter today's sleep data or upload a screenshot."),
}


async def scheduled_sleep_reminder():
    """Send push reminder to users who have not entered sleep for today (runs at 9:00)."""
    from datetime import date
    from sqlalchemy import select
    from app.db.session import async_session_maker
    from app.models.user import User
    from app.models.wellness_cache import WellnessCache
    from app.services.push_notifications import send_push_to_user

    today = date.today()

    async with async_session_maker() as session:
        # Users who have wellness_cache for today with sleep_hours set
        r_has_sleep = await session.execute(
            select(WellnessCache.user_id).where(
                WellnessCache.date == today,
                WellnessCache.sleep_hours.isnot(None),
            ).distinct()
        )
        users_with_sleep = {row[0] for row in r_has_sleep.all()}

        # All users (id, locale)
        r_all = await session.execute(select(User.id, User.locale))
        all_users = [(row[0], (row[1] or "ru")) for row in r_all.all()]

    for uid, locale in all_users:
        if uid in users_with_sleep:
            continue
        title, body = SLEEP_REMINDER_BY_LOCALE.get(locale, SLEEP_REMINDER_BY_LOCALE["ru"])
        async with async_session_maker() as session:
            await send_push_to_user(session, uid, title, body)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # TODO(next push): tighten production detection fallback (e.g., app_env=="production" OR debug==False)
    # to avoid silently skipping ENCRYPTION_KEY validation when APP_ENV is not set in prod.
    if getattr(settings, "app_env", "development") == "production":
        if not settings.encryption_key or len(settings.encryption_key) < 32:
            raise RuntimeError(
                "ENCRYPTION_KEY must be set in production (min 32 chars). "
                'Generate with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"'
            )
        settings.validate_jwt_config()
    await init_db()
    init_http_client(timeout=30.0)
    if settings.google_gemini_api_key:
        import google.generativeai as genai
        genai.configure(api_key=settings.google_gemini_api_key)

    # Orchestrator: run at configured hours (e.g. 07:00 and 16:00)
    try:
        hours = [int(h.strip()) for h in settings.orchestrator_cron_hours.split(",") if h.strip()]
    except ValueError:
        hours = [7, 16]
    for hour in hours:
        if 0 <= hour <= 23:
            scheduler.add_job(scheduled_orchestrator_run, "cron", hour=hour, minute=0)

    scheduler.add_job(scheduled_sleep_reminder, "cron", hour=9, minute=0)

    # Retention: recovery reminder for users with heavy workout yesterday who didn't open chat today
    retention_hour = getattr(settings, "retention_recovery_reminder_hour", 18)
    if 0 <= retention_hour <= 23:
        scheduler.add_job(run_recovery_reminder_job, "cron", hour=retention_hour, minute=0)

    scheduler.start()
    yield
    scheduler.shutdown()
    await close_http_client()
    await close_redis()


limiter = Limiter(key_func=get_remote_address, default_limits=["200/minute"])

app = FastAPI(
    title="tss.ai API",
    description="AI Trainer backend: nutrition, Intervals.icu, orchestrator",
    version="0.1.0",
    lifespan=lifespan,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)
app.add_middleware(GZipMiddleware, minimum_size=500)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(self), microphone=()"
        if getattr(settings, "enable_hsts", False):
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response


_origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()] if settings.cors_origins else ["*"]
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(auth.router, prefix="/api/v1")
app.include_router(nutrition.router, prefix="/api/v1")
app.include_router(photo.router, prefix="/api/v1")
app.include_router(intervals.router, prefix="/api/v1")
app.include_router(athlete_profile.router, prefix="/api/v1")
app.include_router(chat.router, prefix="/api/v1")
app.include_router(users.router, prefix="/api/v1")
app.include_router(wellness.router, prefix="/api/v1")
app.include_router(workouts.router, prefix="/api/v1")
app.include_router(analytics.router, prefix="/api/v1")
app.include_router(billing.router, prefix="/api/v1")

metrics_app = make_asgi_app()
app.mount("/metrics", metrics_app)


@app.get("/health")
@limiter.exempt
def health(request: Request):
    return {"status": "ok"}


@app.get("/sentry-debug")
@limiter.exempt
async def sentry_debug():
    """Trigger an error for Sentry verification."""
    _ = 1 / 0  # noqa: F841
