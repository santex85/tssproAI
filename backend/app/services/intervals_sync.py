"""Sync Intervals.icu data into our DB: activities -> workouts, wellness -> wellness_cache (sleep, RHR, HRV, CTL/ATL/TSB)."""

import asyncio
import logging
import re
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import case, literal, select
from zoneinfo import ZoneInfo
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import func

from app.models.wellness_cache import WellnessCache
from app.models.workout import Workout
from app.services.intervals_client import get_activities, get_activity_single, get_wellness
from app.services.workout_merge import merge_raw


SYNC_DAYS = 90


def _parse_float(v: object) -> float | None:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        s = v.strip().replace(",", ".")
        if not s:
            return None
        m = re.search(r"-?\d+(\.\d+)?", s)
        if not m:
            return None
        try:
            return float(m.group(0))
        except ValueError:
            return None
    return None


def _parse_duration_sec(v: object) -> int | None:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        try:
            return int(float(v))
        except (ValueError, OverflowError):
            return None
    if not isinstance(v, str):
        return None
    s = v.strip().lower()
    if not s:
        return None
    # HH:MM:SS or H:MM
    if ":" in s:
        parts = s.split(":")
        try:
            nums = [int(p) for p in parts]
        except ValueError:
            nums = []
        if len(nums) == 3:
            h, m, sec = nums
            return h * 3600 + m * 60 + sec
        if len(nums) == 2:
            h, m = nums
            return h * 3600 + m * 60
    # "2h 20m", "140m", "2 h", "1h37m"
    h = 0
    m = 0
    sec = 0
    mh = re.search(r"(\d+)\s*h", s)
    mm = re.search(r"(\d+)\s*m", s)
    ms = re.search(r"(\d+)\s*s", s)
    if mh:
        h = int(mh.group(1))
    if mm:
        m = int(mm.group(1))
    if ms:
        sec = int(ms.group(1))
    if mh or mm or ms:
        return h * 3600 + m * 60 + sec
    # digits only: assume seconds
    mf = _parse_float(s)
    if mf is not None:
        return int(mf)
    return None


def _parse_distance_m(v: object) -> float | None:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if not isinstance(v, str):
        return None
    s = v.strip().lower()
    if not s:
        return None
    f = _parse_float(s)
    if f is None:
        return None
    # Heuristic units: if explicitly contains km -> convert; if contains m -> meters
    if "km" in s:
        return f * 1000.0
    return f


def _activity_to_workout_row(user_id: int, raw: dict, ext_id: str, start_dt: datetime | None, name: str | None, tss: float | None) -> dict:
    duration_raw = raw.get("moving_time") or raw.get("movingTime") or raw.get("duration")
    if duration_raw is None:
        duration_raw = raw.get("length")
    duration_sec = _parse_duration_sec(duration_raw)

    distance_raw = raw.get("distance")
    if distance_raw is None:
        distance_raw = raw.get("length")
    distance_m = _parse_distance_m(distance_raw)

    tss_f = _parse_float(tss) if tss is not None else _parse_float(raw.get("icu_training_load") or raw.get("training_load") or raw.get("tss"))
    if start_dt and start_dt.tzinfo is None:
        start_dt = start_dt.replace(tzinfo=timezone.utc)
    return {
        "user_id": user_id,
        "external_id": ext_id,
        "source": "intervals",
        "start_date": start_dt,
        "name": name or raw.get("title") or raw.get("name"),
        "type": raw.get("type"),
        "duration_sec": duration_sec,
        "distance_m": distance_m,
        "tss": tss_f,
        "raw": raw,
    }


async def sync_intervals_to_db(
    session: AsyncSession,
    user_id: int,
    athlete_id: str,
    api_key: str,
    *,
    client_today: date | None = None,
    user_timezone: str | None = None,
    use_bearer: bool = False,
) -> tuple[int, int]:
    """
    Fetch activities and wellness from Intervals.icu and upsert into workouts and wellness_cache.
    Returns (activities_upserted, wellness_days_upserted).

    When client_today is provided (user's local date), the fetch range extends to include that date,
    so sync at 4–5 AM in Thailand (UTC+7) fetches data for the user's "today" instead of server UTC yesterday.
    When client_today is None but user_timezone is provided, compute today in that timezone (for webhook/background sync).
    """
    server_today = date.today()
    if client_today is None and user_timezone and user_timezone.strip():
        try:
            tz = ZoneInfo(user_timezone.strip())
            client_today = datetime.now(tz).date()
        except Exception:
            pass
    anchor = max(server_today, client_today) if client_today else server_today
    newest = anchor + timedelta(days=1)  # include "tomorrow" so athlete's "today" in any TZ is fetched
    oldest = newest - timedelta(days=SYNC_DAYS)
    activities = await get_activities(athlete_id, api_key, oldest, newest, limit=500, use_bearer=use_bearer)
    wellness_days = await get_wellness(athlete_id, api_key, oldest, newest, use_bearer=use_bearer)

    if not wellness_days:
        logging.warning(
            "Intervals.icu get_wellness returned no days for range %s..%s (user_id=%s)",
            oldest.isoformat(),
            newest.isoformat(),
            user_id,
        )
    else:
        first_date = wellness_days[0].date.isoformat() if wellness_days[0].date else "?"
        last_date = wellness_days[-1].date.isoformat() if wellness_days[-1].date else "?"
        logging.info(
            "Intervals.icu get_wellness returned %s days for user_id=%s (first=%s, last=%s)",
            len(wellness_days),
            user_id,
            first_date,
            last_date,
        )

    # Deduplicate activities by external_id (same activity may appear with different id representation)
    seen_ids: set[str] = set()
    activities_deduped = []
    for a in activities:
        if not a.id or a.id in seen_ids:
            continue
        seen_ids.add(a.id)
        activities_deduped.append(a)

    # Batch upsert workouts by (user_id, external_id); merge raw with existing to preserve FIT series etc.
    workout_rows = []
    for a in activities_deduped:
        if not a.id:
            continue
        raw = dict(a.raw or {})
        start_dt = a.start_date
        name = a.name or raw.get("title") or raw.get("name")
        tss = a.icu_training_load if a.icu_training_load is not None else raw.get("icu_training_load") or raw.get("training_load") or raw.get("tss")
        workout_rows.append(_activity_to_workout_row(user_id, raw, a.id, start_dt, name, tss))

    # For truncated rows (missing duration/distance/tss/name), fetch full activity detail and fill in.
    # Also always fetch detail for activities in the last 2 days so "today" gets full data after processing.
    DETAIL_FETCH_LIMIT = 30
    RECENT_DAYS_FOR_DETAIL = 2
    cutoff_recent = newest - timedelta(days=RECENT_DAYS_FOR_DETAIL)

    truncated = [
        row for row in workout_rows
        if row.get("external_id")
        and (
            row.get("duration_sec") is None
            or row.get("distance_m") is None
            or row.get("tss") is None
            or not (row.get("name") or "").strip()
        )
    ]
    recent_ids: set[str] = set()
    for row in workout_rows:
        if not row.get("external_id"):
            continue
        sd = row.get("start_date")
        if sd is None:
            d = None
        elif isinstance(sd, datetime):
            d = sd.date()
        elif isinstance(sd, date):
            d = sd
        else:
            d = None
        if d is not None and d >= cutoff_recent:
            recent_ids.add(row["external_id"])

    need_detail_ids = {r["external_id"] for r in truncated} | recent_ids
    need_detail = [r for r in workout_rows if r.get("external_id") in need_detail_ids]
    need_detail.sort(key=lambda r: (r.get("start_date") or datetime.min.replace(tzinfo=timezone.utc)), reverse=True)
    need_detail = need_detail[:DETAIL_FETCH_LIMIT]

    if need_detail:
        logging.info(
            "Intervals sync user_id=%s: fetching detail for %s activities (truncated + last %s days), sample id=%s start=%s",
            user_id,
            len(need_detail),
            RECENT_DAYS_FOR_DETAIL,
            need_detail[0].get("external_id"),
            need_detail[0].get("start_date"),
        )
        detail_tasks = [get_activity_single(api_key, row["external_id"], use_bearer=use_bearer) for row in need_detail]
        detail_results = await asyncio.gather(*detail_tasks, return_exceptions=True)
        detail_ok = 0
        still_empty = 0
        for row, result in zip(need_detail, detail_results):
            if not isinstance(result, dict):
                logging.warning(
                    "Intervals get_activity_single failed for activity_id=%s user_id=%s: %s",
                    row.get("external_id"),
                    user_id,
                    result if isinstance(result, Exception) else type(result).__name__,
                )
                continue
            detail = result
            # Flatten nested response: GET /activity/{id} may return { "activity": { moving_time, ... } }
            base_raw = row.get("raw") or {}
            inner = detail.get("activity") if isinstance(detail.get("activity"), dict) else {}
            top = {k: v for k, v in detail.items() if k != "activity"}
            row["raw"] = {**base_raw, **inner, **top}

            start_raw = (
                detail.get("start_date")
                or detail.get("startDate")
                or detail.get("start_date_local")
                or detail.get("startDateLocal")
            )
            start_dt = row.get("start_date")
            if isinstance(start_raw, str):
                try:
                    start_dt = datetime.fromisoformat(start_raw.replace("Z", "+00:00"))
                except Exception:
                    pass
            if start_dt and start_dt.tzinfo is None:
                start_dt = start_dt.replace(tzinfo=timezone.utc)
            name = detail.get("name") or detail.get("title") or row.get("name")
            tss = detail.get("icu_training_load") or detail.get("training_load") or detail.get("tss") or row.get("tss")
            filled = _activity_to_workout_row(user_id, row["raw"], row["external_id"], start_dt, name, tss)
            for key in ("start_date", "name", "type", "duration_sec", "distance_m", "tss"):
                if filled.get(key) is not None:
                    row[key] = filled[key]
            detail_ok += 1
            if filled.get("duration_sec") is None and filled.get("distance_m") is None:
                still_empty += 1
                logging.debug(
                    "Intervals detail still missing duration/distance for activity_id=%s user_id=%s",
                    row.get("external_id"),
                    user_id,
                )
        logging.info(
            "Intervals sync user_id=%s: detail fetch done, ok=%s, still_empty=%s",
            user_id,
            detail_ok,
            still_empty,
        )

    if workout_rows:
        external_ids = [r["external_id"] for r in workout_rows]
        r = await session.execute(
            select(Workout).where(
                Workout.user_id == user_id,
                Workout.external_id.in_(external_ids),
            )
        )
        existing_by_ext = {w.external_id: w for w in r.scalars().all()}
        for row in workout_rows:
            existing = existing_by_ext.get(row["external_id"])
            row["raw"] = merge_raw(existing.raw if existing else None, row["raw"])
        stmt_workouts = pg_insert(Workout).values(workout_rows)
        stmt_workouts = stmt_workouts.on_conflict_do_update(
            index_elements=["user_id", "external_id"],
            set_={
                "start_date": func.coalesce(stmt_workouts.excluded.start_date, Workout.start_date),
                "name": func.coalesce(stmt_workouts.excluded.name, Workout.name),
                "type": func.coalesce(stmt_workouts.excluded.type, Workout.type),
                "duration_sec": func.coalesce(stmt_workouts.excluded.duration_sec, Workout.duration_sec),
                "distance_m": func.coalesce(stmt_workouts.excluded.distance_m, Workout.distance_m),
                "tss": func.coalesce(stmt_workouts.excluded.tss, Workout.tss),
                "raw": stmt_workouts.excluded.raw,
            },
        )
        await session.execute(stmt_workouts)
    count_workouts = len(workout_rows)

    # Batch upsert wellness_cache: ctl, atl, tsb from Intervals; sleep_hours only when not manual/photo
    wellness_rows = []
    for w in wellness_days:
        if w.date is None:
            continue
        wellness_rows.append({
            "user_id": user_id,
            "date": w.date,
            "sleep_hours": w.sleep_hours,
            "sleep_source": "sync" if w.sleep_hours is not None else None,
            "rhr": float(w.rhr) if w.rhr is not None else None,
            "hrv": float(w.hrv) if w.hrv is not None else None,
            "ctl": w.ctl,
            "atl": w.atl,
            "tsb": w.tsb,
            "weight_kg": float(w.weight_kg) if w.weight_kg is not None else None,
            "sport_info": w.sport_info if w.sport_info else None,
        })
    if wellness_rows:
        stmt_wellness = pg_insert(WellnessCache).values(wellness_rows)
        stmt_wellness = stmt_wellness.on_conflict_do_update(
            index_elements=["user_id", "date"],
            set_={
                "ctl": stmt_wellness.excluded.ctl,
                "atl": stmt_wellness.excluded.atl,
                "tsb": stmt_wellness.excluded.tsb,
                "sleep_hours": case(
                    (WellnessCache.sleep_source.in_(["manual", "photo"]), WellnessCache.sleep_hours),
                    else_=func.coalesce(WellnessCache.sleep_hours, stmt_wellness.excluded.sleep_hours),
                ),
                "sleep_source": case(
                    (WellnessCache.sleep_source.in_(["manual", "photo"]), WellnessCache.sleep_source),
                    (stmt_wellness.excluded.sleep_hours.isnot(None), literal("sync")),
                    else_=WellnessCache.sleep_source,
                ),
                "rhr": func.coalesce(WellnessCache.rhr, stmt_wellness.excluded.rhr),
                "hrv": func.coalesce(WellnessCache.hrv, stmt_wellness.excluded.hrv),
                "weight_kg": func.coalesce(WellnessCache.weight_kg, stmt_wellness.excluded.weight_kg),
                "sport_info": stmt_wellness.excluded.sport_info,
            },
        )
        await session.execute(stmt_wellness)
    count_wellness = len(wellness_rows)

    await session.commit()
    return (count_workouts, count_wellness)


async def sync_user_wellness(session: AsyncSession, user_id: int) -> None:
    """No-op: use sync_intervals_to_db for full Intervals sync."""
    pass


async def sync_all_users_wellness(session: AsyncSession) -> None:
    """No-op: use sync_intervals_to_db per user with Intervals linked."""
    pass
