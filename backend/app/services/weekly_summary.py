"""Weekly AI summary of athlete state (training, sleep, nutrition) for RAG coach memory."""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.food_log import FoodLog
from app.models.sleep_extraction import SleepExtraction
from app.models.user import User
from app.models.user_weekly_summary import UserWeeklySummary
from app.models.wellness_cache import WellnessCache
from app.models.workout import Workout
from app.services.gemini_common import run_generate_content

logger = logging.getLogger(__name__)

WEEKLY_SUMMARY_MAX_CHARS = 500

SUMMARY_LANGUAGE = {"ru": "Russian", "en": "English"}


def _week_range_for_summary(today: date) -> tuple[date, date]:
    """Return (week_start, week_end) for the week ending on today. Week = Mon..Sun."""
    # Monday = 1, Sunday = 7 in isoweekday()
    weekday = today.isoweekday()
    week_end = today
    week_start = today - timedelta(days=weekday - 1)
    return week_start, week_end


async def _build_week_data_text(
    session: AsyncSession,
    user_id: int,
    week_start: date,
    week_end: date,
) -> str:
    """Build a compact text summary of workouts, food, wellness, sleep for the given week."""
    from_dt = datetime.combine(week_start, datetime.min.time()).replace(tzinfo=timezone.utc)
    to_dt = datetime.combine(week_end + timedelta(days=1), datetime.min.time()).replace(tzinfo=timezone.utc)

    r_workouts = await session.execute(
        select(Workout.start_date, Workout.name, Workout.type, Workout.duration_sec, Workout.distance_m, Workout.tss).where(
            Workout.user_id == user_id,
            Workout.start_date >= from_dt,
            Workout.start_date < to_dt,
        ).order_by(Workout.start_date.asc())
    )
    r_food = await session.execute(
        select(FoodLog.timestamp, FoodLog.calories, FoodLog.protein_g).where(
            FoodLog.user_id == user_id,
            FoodLog.timestamp >= from_dt,
            FoodLog.timestamp < to_dt,
        ).order_by(FoodLog.timestamp.asc())
    )
    r_wellness = await session.execute(
        select(WellnessCache.date, WellnessCache.sleep_hours, WellnessCache.rhr, WellnessCache.hrv, WellnessCache.ctl, WellnessCache.atl, WellnessCache.tsb).where(
            WellnessCache.user_id == user_id,
            WellnessCache.date >= week_start,
            WellnessCache.date <= week_end,
        ).order_by(WellnessCache.date.asc())
    )
    r_sleep = await session.execute(
        select(SleepExtraction.created_at, SleepExtraction.extracted_data).where(
            SleepExtraction.user_id == user_id,
            SleepExtraction.created_at >= from_dt,
            SleepExtraction.created_at < to_dt,
        ).order_by(SleepExtraction.created_at.asc())
    )

    workouts = []
    for row in r_workouts.all():
        d = row[0].date() if row[0] and hasattr(row[0], "date") else None
        workouts.append({
            "date": d.isoformat() if d else None,
            "name": row[1],
            "type": row[2],
            "duration_sec": row[3],
            "distance_km": round(row[4] / 1000, 1) if row[4] is not None else None,
            "tss": row[5],
        })

    food_by_day: dict[str, list] = {}
    for ts, cal, protein in r_food.all():
        d = ts.date() if ts and hasattr(ts, "date") else None
        key = d.isoformat() if d else ""
        if key not in food_by_day:
            food_by_day[key] = []
        food_by_day[key].append({"calories": cal, "protein_g": protein})
    food_summary = []
    for d in sorted(food_by_day.keys()):
        entries = food_by_day[d]
        total_cal = sum(e["calories"] or 0 for e in entries)
        total_protein = sum(e["protein_g"] or 0 for e in entries)
        food_summary.append(f"{d}: {total_cal:.0f} kcal, {total_protein:.0f}g protein")

    wellness = []
    for row in r_wellness.all():
        wellness.append({
            "date": row[0].isoformat() if row[0] else None,
            "sleep_hours": row[1],
            "rhr": row[2],
            "hrv": row[3],
            "ctl": row[4],
            "atl": row[5],
            "tsb": row[6],
        })

    sleep_entries = []
    for created_at, data_json in r_sleep.all():
        try:
            data = json.loads(data_json) if isinstance(data_json, str) else data_json
        except (json.JSONDecodeError, TypeError):
            continue
        sleep_entries.append({
            "date": created_at.date().isoformat() if created_at and hasattr(created_at, "date") else None,
            "sleep_hours": data.get("sleep_hours") or data.get("actual_sleep_hours"),
            "quality": data.get("quality_score"),
        })

    parts = [
        "## Workouts (date, name, type, duration_sec, distance_km, tss)",
        json.dumps(workouts, default=str)[:2000],
        "## Food per day (date: kcal, protein g)",
        "\n".join(food_summary) if food_summary else "No food data",
        "## Wellness (date, sleep_hours, rhr, hrv, ctl, atl, tsb)",
        json.dumps(wellness, default=str)[:1500],
        "## Sleep from photos (date, sleep_hours, quality)",
        json.dumps(sleep_entries, default=str)[:1000],
    ]
    return "\n".join(parts)


async def generate_and_save_weekly_summary(
    session: AsyncSession,
    user_id: int,
    week_start: date,
    week_end: date,
    locale: str,
) -> None:
    """Build week data, call Gemini for short summary, save to user_weekly_summaries."""
    text = await _build_week_data_text(session, user_id, week_start, week_end)
    if not text.strip() or text.strip() == "## Workouts (date, name, type, duration_sec, distance_km, tss)\n[]":
        logger.debug("Weekly summary: no data for user_id=%s week %s", user_id, week_start)
        return

    lang = SUMMARY_LANGUAGE.get((locale or "ru").lower(), "Russian")
    prompt = (
        f"Based on the following training, nutrition, and sleep data for one week, write a very short summary "
        f"of the athlete's state in {lang}. Maximum {WEEKLY_SUMMARY_MAX_CHARS} characters. "
        "Focus on: sleep patterns (e.g. consistently under sleeping on Wednesdays), nutrition (e.g. low protein), "
        "training load and recovery. One or two short sentences. No greetings.\n\nData:\n"
    ) + text

    try:
        import google.generativeai as genai
        model = genai.GenerativeModel(settings.gemini_model)
        response = await run_generate_content(model, prompt)
        summary = (response.text if response and response.text else "").strip()
        if not summary:
            return
        summary = summary[:WEEKLY_SUMMARY_MAX_CHARS]
    except Exception as e:
        logger.warning("Weekly summary Gemini failed for user_id=%s: %s", user_id, e)
        return

    existing = await session.execute(
        select(UserWeeklySummary).where(
            UserWeeklySummary.user_id == user_id,
            UserWeeklySummary.week_start_date == week_start,
        )
    )
    if existing.scalar_one_or_none():
        return
    session.add(
        UserWeeklySummary(
            user_id=user_id,
            week_start_date=week_start,
            summary_text=summary,
        )
    )
    await session.flush()
    logger.info("Weekly summary saved for user_id=%s week_start=%s", user_id, week_start)


async def run_weekly_summary_job() -> None:
    """
    For each premium user, collect last week's workouts/food/sleep, ask Gemini for a short summary,
    save to user_weekly_summaries. Run once per week (e.g. Sunday evening).
    """
    import asyncio
    from app.db.session import async_session_maker

    today = date.today()
    week_start, week_end = _week_range_for_summary(today)

    async with async_session_maker() as session:
        r = await session.execute(
            select(User.id, User.locale).where(User.is_premium.is_(True))
        )
        users = [(row[0], row[1] or "ru") for row in r.all()]

    if not users:
        logger.debug("Weekly summary: no premium users")
        return

    sem = asyncio.Semaphore(3)
    async def process(user_id: int, locale: str) -> None:
        async with sem:
            async with async_session_maker() as session:
                try:
                    await generate_and_save_weekly_summary(
                        session, user_id, week_start, week_end, locale
                    )
                    await session.commit()
                except Exception as e:
                    logger.warning("Weekly summary failed for user_id=%s: %s", user_id, e)
                    await session.rollback()

    await asyncio.gather(*[process(uid, loc) for uid, loc in users])
    logger.info("Weekly summary job finished for week %s", week_start)
