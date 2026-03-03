"""Retention module: recovery reminders for users with heavy workouts who haven't checked in today."""

import logging
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.chat_message import ChatMessage
from app.models.retention_reminder_sent import RetentionReminderSent
from app.models.user import User
from app.models.workout import Workout
from app.services.push_notifications import send_push_to_user

logger = logging.getLogger(__name__)

REMINDER_TYPE_RECOVERY_HEAVY = "recovery_heavy_workout"

RECOVERY_PUSH_BY_LOCALE = {
    "ru": ("Восстановление", "Вчера была тяжёлая тренировка. Открой приложение — там советы по восстановлению."),
    "en": ("Recovery", "You had a heavy workout yesterday. Open the app for recovery advice."),
}


async def get_users_for_recovery_reminder(
    session: AsyncSession,
    today_date: date,
    *,
    tss_threshold: float | None = None,
) -> list[int]:
    """
    Return user_ids who: had total TSS > threshold yesterday, have no chat activity today,
    have push_token set, and have not already received this reminder today.
    """
    threshold = tss_threshold if tss_threshold is not None else float(getattr(settings, "retention_tss_threshold", 100))
    yesterday = today_date - timedelta(days=1)
    yesterday_start = datetime.combine(yesterday, datetime.min.time()).replace(tzinfo=timezone.utc)
    today_start = datetime.combine(today_date, datetime.min.time()).replace(tzinfo=timezone.utc)
    today_end = datetime.combine(today_date + timedelta(days=1), datetime.min.time()).replace(tzinfo=timezone.utc)

    # User IDs with sum(workout.tss) for yesterday > threshold
    heavy_subq = (
        select(Workout.user_id)
        .where(
            Workout.start_date >= yesterday_start,
            Workout.start_date < today_start,
        )
        .group_by(Workout.user_id)
        .having(func.coalesce(func.sum(Workout.tss), 0) > threshold)
    )
    r_heavy = await session.execute(heavy_subq)
    heavy_user_ids = {row[0] for row in r_heavy.all()}
    if not heavy_user_ids:
        return []

    # User IDs who had at least one chat message today (we exclude them)
    r_chat = await session.execute(
        select(ChatMessage.user_id)
        .where(
            ChatMessage.timestamp >= today_start,
            ChatMessage.timestamp < today_end,
        )
        .distinct()
    )
    users_with_chat_today = {row[0] for row in r_chat.all()}
    candidate_ids = heavy_user_ids - users_with_chat_today
    if not candidate_ids:
        return []

    # Users who already received this reminder today
    r_sent = await session.execute(
        select(RetentionReminderSent.user_id).where(
            RetentionReminderSent.date == today_date,
            RetentionReminderSent.reminder_type == REMINDER_TYPE_RECOVERY_HEAVY,
        )
    )
    already_sent_ids = {row[0] for row in r_sent.all()}
    candidate_ids -= already_sent_ids
    if not candidate_ids:
        return []

    # Only users with non-empty push_token
    r_users = await session.execute(
        select(User.id).where(
            User.id.in_(candidate_ids),
            User.push_token.isnot(None),
            User.push_token != "",
        )
    )
    return [row[0] for row in r_users.all()]


async def send_recovery_reminder_pushes(
    session: AsyncSession,
    user_ids: list[int],
    today_date: date,
) -> None:
    """Send recovery reminder push to each user and record in retention_reminders_sent."""
    r = await session.execute(
        select(User.id, User.locale).where(User.id.in_(user_ids))
    )
    user_locales = {row[0]: (row[1] or "ru") for row in r.all()}
    for user_id in user_ids:
        locale = user_locales.get(user_id, "ru")
        if locale not in RECOVERY_PUSH_BY_LOCALE:
            locale = "ru"
        title, body = RECOVERY_PUSH_BY_LOCALE[locale]
        try:
            await send_push_to_user(session, user_id, title, body)
            session.add(
                RetentionReminderSent(
                    user_id=user_id,
                    date=today_date,
                    reminder_type=REMINDER_TYPE_RECOVERY_HEAVY,
                )
            )
            await session.flush()
            logger.info("Retention: sent recovery reminder to user_id=%s", user_id)
        except Exception as e:
            logger.warning("Retention: failed to send recovery reminder to user_id=%s: %s", user_id, e)


async def run_recovery_reminder_job() -> None:
    """
    Scheduled job: find users with heavy workout yesterday and no chat today,
    send recovery reminder push and record to avoid duplicate sends.
    """
    from app.db.session import async_session_maker

    today_date = date.today()
    async with async_session_maker() as session:
        try:
            user_ids = await get_users_for_recovery_reminder(session, today_date)
            if not user_ids:
                logger.debug("Retention: no users eligible for recovery reminder today")
                return
            await send_recovery_reminder_pushes(session, user_ids, today_date)
            await session.commit()
        except Exception as e:
            logger.exception("Retention: recovery reminder job failed: %s", e)
            await session.rollback()
