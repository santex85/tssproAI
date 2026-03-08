import logging
import sys
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.sessions import SessionMiddleware
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address

from app.api.v1 import analytics, auth, athlete_profile, billing, chat, intervals, nutrition, photo, users, wellness, workouts
from app.core.scheduler_lock import try_acquire_cron_lock
from app.services.retention import (
    run_ctl_drop_reminder_job,
    run_nutrition_after_long_reminder_job,
    run_recovery_reminder_job,
)
from app.services.weekly_summary import run_weekly_summary_job

# Ensure app loggers (Intervals, sync, etc.) print to stdout so you see them in the terminal
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stdout,
)
logging.getLogger("app").setLevel(logging.DEBUG)
logger = logging.getLogger(__name__)
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
        send_default_pii=False,
    )

scheduler = AsyncIOScheduler()

# Distributed lock names: with multiple workers only one process runs each job.
LOCK_ORCHESTRATOR = "orchestrator_run"
LOCK_SLEEP_REMINDER = "sleep_reminder"
LOCK_RECOVERY_REMINDER = "recovery_reminder"
LOCK_CTL_DROP = "ctl_drop_reminder"
LOCK_NUTRITION_AFTER_LONG = "nutrition_after_long_reminder"
LOCK_WEEKLY_SUMMARY = "weekly_summary"


ORCHESTRATOR_PUSH_TITLE_BY_LOCALE = {
    "ru": "Решение на день",
    "en": "Daily decision",
    "de": "Tagesentscheidung",
    "fr": "Décision du jour",
    "es": "Decisión del día",
    "it": "Decisione del giorno",
    "pt": "Decisão do dia",
    "th": "การตัดสินใจประจำวัน",
}


async def scheduled_orchestrator_run(cron_hour: int | None = None):
    """Run orchestrator (daily decision) for every user at configured hours (parallel with semaphore).
    cron_hour: when run from cron, the hour that triggered the job (0-23) is passed so orchestrator uses morning/day/evening logic."""
    if not await try_acquire_cron_lock(LOCK_ORCHESTRATOR, ttl_seconds=600):
        logger.info("Scheduler: orchestrator_run skipped (another worker holds the lock)")
        return
    import asyncio
    from datetime import date
    from sqlalchemy import select
    from app.db.session import async_session_maker
    from app.models.user import User
    from app.services.orchestrator import run_daily_decision
    from app.services.push_notifications import send_push_to_user

    async with async_session_maker() as session:
        r = await session.execute(
            select(User.id, User.locale, User.is_premium)
        )
        user_rows = [(row[0], (row[1] or "ru"), bool(row[2])) for row in r.all()]
    if not user_rows:
        return

    sem = asyncio.Semaphore(5)

    async def run_for_user(uid: int, locale: str, is_premium: bool) -> None:
        async with sem:
            async with async_session_maker() as session:
                result = await run_daily_decision(
                    session, uid, date.today(), locale=locale, client_local_hour=cron_hour
                )
                await session.commit()
                if is_premium:
                    summary = f"{result.decision.value}: {(result.reason or '')[:80]}"
                    if result.reason and len(result.reason or '') > 80:
                        summary += "..."
                else:
                    summary = result.decision.value
                title = ORCHESTRATOR_PUSH_TITLE_BY_LOCALE.get(locale, ORCHESTRATOR_PUSH_TITLE_BY_LOCALE["en"])
                await send_push_to_user(session, uid, title, summary)

    await asyncio.gather(*[run_for_user(uid, loc, is_prem) for uid, loc, is_prem in user_rows])


SLEEP_REMINDER_BY_LOCALE = {
    "ru": ("Сон", "Укажите данные сна за сегодня или загрузите скриншот."),
    "en": ("Sleep", "Enter today's sleep data or upload a screenshot."),
    "de": ("Schlaf", "Gib deine Schlafdaten für heute ein oder lade einen Screenshot hoch."),
    "fr": ("Sommeil", "Entrez vos données de sommeil d'aujourd'hui ou téléchargez une capture d'écran."),
    "es": ("Sueño", "Introduce los datos de sueño de hoy o sube una captura de pantalla."),
    "it": ("Sonno", "Inserisci i dati del sonno di oggi o carica uno screenshot."),
    "pt": ("Sono", "Informe os dados de sono de hoje ou envie uma captura de tela."),
    "th": ("การนอน", "กรอกข้อมูลการนอนวันนี้หรืออัปโหลดภาพหน้าจอ"),
}


async def scheduled_sleep_reminder():
    """Send push reminder to users who have not entered sleep for today (runs at 9:00)."""
    if not await try_acquire_cron_lock(LOCK_SLEEP_REMINDER, ttl_seconds=180):
        logger.info("Scheduler: sleep_reminder skipped (another worker holds the lock)")
        return
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


async def scheduled_recovery_reminder():
    """Wrapper: acquire distributed lock then run retention recovery reminder job."""
    if not await try_acquire_cron_lock(LOCK_RECOVERY_REMINDER, ttl_seconds=300):
        logger.info("Scheduler: recovery_reminder skipped (another worker holds the lock)")
        return
    await run_recovery_reminder_job()


async def scheduled_ctl_drop_reminder():
    """Wrapper: acquire distributed lock then run CTL drop retention job."""
    if not await try_acquire_cron_lock(LOCK_CTL_DROP, ttl_seconds=300):
        logger.info("Scheduler: ctl_drop_reminder skipped (another worker holds the lock)")
        return
    await run_ctl_drop_reminder_job()


async def scheduled_nutrition_after_long_reminder():
    """Wrapper: acquire distributed lock then run nutrition-after-long retention job."""
    if not await try_acquire_cron_lock(LOCK_NUTRITION_AFTER_LONG, ttl_seconds=300):
        logger.info("Scheduler: nutrition_after_long_reminder skipped (another worker holds the lock)")
        return
    await run_nutrition_after_long_reminder_job()


async def scheduled_weekly_summary():
    """Generate weekly AI summaries for premium users (RAG coach memory)."""
    if not await try_acquire_cron_lock(LOCK_WEEKLY_SUMMARY, ttl_seconds=3600):
        logger.info("Scheduler: weekly_summary skipped (another worker holds the lock)")
        return
    await run_weekly_summary_job()


@asynccontextmanager
async def lifespan(app: FastAPI):
    app_env = getattr(settings, "app_env", "development")
    if app_env == "production":
        if not settings.encryption_key or len(settings.encryption_key) < 32:
            raise RuntimeError(
                "ENCRYPTION_KEY must be set in production (min 32 chars). "
                'Generate with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"'
            )
        if not settings.secret_key or settings.secret_key == "change-me-in-production":
            raise RuntimeError(
                "SECRET_KEY must be set in production (do not use default 'change-me-in-production')"
            )
        settings.validate_jwt_config()
    await init_db()
    init_http_client(timeout=30.0)
    if settings.google_gemini_api_key:
        import google.generativeai as genai
        genai.configure(api_key=settings.google_gemini_api_key)
    elif settings.enable_scheduler:
        logger.warning(
            "GOOGLE_GEMINI_API_KEY is not set; orchestrator will return SKIP for all users. "
            "Set GOOGLE_GEMINI_API_KEY in .env to enable AI decisions."
        )

    # Scheduled jobs use a Redis distributed lock so that with multiple Uvicorn/Gunicorn
    # workers only one process runs each job (no duplicate push notifications or DB load).
    # Set enable_scheduler=False on API workers when cron runs in a separate container.
    if settings.enable_scheduler:
        try:
            hours = [int(h.strip()) for h in settings.orchestrator_cron_hours.split(",") if h.strip()]
        except ValueError:
            hours = [7, 16]
        for hour in hours:
            if 0 <= hour <= 23:

                def _make_orchestrator_job(h: int):
                    async def _job() -> None:
                        await scheduled_orchestrator_run(cron_hour=h)

                    return _job

                scheduler.add_job(_make_orchestrator_job(hour), "cron", hour=hour, minute=0)

        scheduler.add_job(scheduled_sleep_reminder, "cron", hour=9, minute=0)

        # Retention: recovery reminder for users with heavy workout yesterday who didn't open chat today
        retention_hour = getattr(settings, "retention_recovery_reminder_hour", 18)
        if 0 <= retention_hour <= 23:
            scheduler.add_job(scheduled_recovery_reminder, "cron", hour=retention_hour, minute=0)

        # Retention: CTL drop reminder (e.g. 10:00)
        scheduler.add_job(scheduled_ctl_drop_reminder, "cron", hour=10, minute=0)

        # Retention: nutrition after long workout (e.g. 20:00)
        scheduler.add_job(scheduled_nutrition_after_long_reminder, "cron", hour=20, minute=0)

        # Weekly summary (RAG): one summary per premium user per week
        ws_day = getattr(settings, "weekly_summary_cron_day_of_week", 6)
        ws_hour = getattr(settings, "weekly_summary_cron_hour", 21)
        if 0 <= ws_day <= 6 and 0 <= ws_hour <= 23:
            scheduler.add_job(scheduled_weekly_summary, "cron", day_of_week=ws_day, hour=ws_hour, minute=0)

        scheduler.start()
    yield
    if settings.enable_scheduler:
        scheduler.shutdown()
    await close_http_client()
    await close_redis()


limiter = Limiter(key_func=get_remote_address, default_limits=["200/minute"])

app = FastAPI(
    title="tss.ai API",
    description="AI Trainer backend: nutrition, Intervals.icu, orchestrator",
    version="0.1.0-alpha.2",
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


_origins_raw = [o.strip() for o in settings.cors_origins.split(",") if o.strip()] if settings.cors_origins else []
_origins = _origins_raw if _origins_raw else ["*"]
if getattr(settings, "app_env", "development") == "production" and _origins == ["*"]:
    raise RuntimeError(
        "CORS_ORIGINS must be set in production (explicit allowlist). "
        "Do not use empty or wildcard origins with allow_credentials=True."
    )
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

# Admin panel at /admin (session auth, superuser only)
app.add_middleware(SessionMiddleware, secret_key=settings.secret_key)
from app.admin import setup_admin

setup_admin(app)

metrics_app = make_asgi_app()
app.mount("/metrics", metrics_app)
# Prometheus may scrape /metrics/metrics/ (base URL + metrics_path); mount so path becomes "/" and a response is returned
app.mount("/metrics/metrics", metrics_app)


@app.get("/health")
@limiter.exempt
def health(request: Request):
    return {"status": "ok"}


@app.get("/sentry-debug")
@limiter.exempt
async def sentry_debug():
    """Trigger an error for Sentry verification."""
    _ = 1 / 0  # noqa: F841
