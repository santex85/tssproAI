"""Analytics API: aggregated data for charts (sleep, workouts, wellness, nutrition) and AI insight."""

from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import Date, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_request_locale, language_for_locale
from app.services.user_type import resolve_is_athlete
from app.db.session import get_db
from app.models.athlete_profile import AthleteProfile
from app.models.food_log import FoodLog
from app.models.user import User
from app.models.wellness_cache import WellnessCache
from app.models.workout import Workout

router = APIRouter(prefix="/analytics", tags=["analytics"])

DEFAULT_DAYS = 30
MAX_DAYS = 365


def _parse_date_range(
    from_date: date | None,
    to_date: date | None,
    days: int = DEFAULT_DAYS,
) -> tuple[date, date]:
    to_d = to_date or date.today()
    from_d = from_date or (to_d - timedelta(days=days))
    if (to_d - from_d).days > MAX_DAYS:
        from_d = to_d - timedelta(days=MAX_DAYS)
    return from_d, to_d


@router.get(
    "/overview",
    summary="Analytics overview",
    responses={401: {"description": "Not authenticated"}},
)
async def get_analytics_overview(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    from_date: date | None = None,
    to_date: date | None = None,
    days: int = Query(default=DEFAULT_DAYS, ge=7, le=MAX_DAYS),
) -> dict[str, Any]:
    """High-level stats: recent sleep avg, workout count, nutrition adherence summary."""
    uid = user.id
    from_d, to_d = _parse_date_range(from_date, to_date, days)

    # Wellness: avg sleep, last CTL/ATL/TSB
    w_stmt = select(
        func.avg(WellnessCache.sleep_hours).label("avg_sleep"),
        func.count(WellnessCache.id).label("wellness_days"),
    ).where(
        WellnessCache.user_id == uid,
        WellnessCache.date >= from_d,
        WellnessCache.date <= to_d,
        WellnessCache.sleep_hours.isnot(None),
    )
    w_row = (await session.execute(w_stmt)).one_or_none()
    avg_sleep = float(w_row.avg_sleep) if w_row and w_row.avg_sleep is not None else None
    wellness_days = w_row.wellness_days or 0

    last_wellness = await session.execute(
        select(WellnessCache.ctl, WellnessCache.atl, WellnessCache.tsb)
        .where(WellnessCache.user_id == uid, WellnessCache.ctl.isnot(None))
        .order_by(WellnessCache.date.desc())
        .limit(1)
    )
    lw = last_wellness.one_or_none()
    if lw:
        ctl = float(lw.ctl or 0)
        atl = float(lw.atl or 0)
        tsb = float(lw.tsb) if lw.tsb is not None else (ctl - atl)
        ctl_atl_tsb = {"ctl": round(ctl, 1), "atl": round(atl, 1), "tsb": round(tsb, 1)}
    else:
        ctl_atl_tsb = None

    # Workouts count and total TSS in range
    from_dt = datetime.combine(from_d, datetime.min.time()).replace(tzinfo=timezone.utc)
    to_dt = datetime.combine(to_d + timedelta(days=1), datetime.min.time()).replace(tzinfo=timezone.utc)
    w_count = await session.execute(
        select(func.count(Workout.id)).where(
            Workout.user_id == uid,
            Workout.start_date >= from_dt,
            Workout.start_date < to_dt,
        )
    )
    workout_count = w_count.scalar() or 0
    tss_sum = await session.execute(
        select(func.coalesce(func.sum(Workout.tss), 0)).where(
            Workout.user_id == uid,
            Workout.start_date >= from_dt,
            Workout.start_date < to_dt,
        )
    )
    total_tss = float(tss_sum.scalar() or 0)

    # Nutrition: days with food logs and avg calories
    day_start = datetime.combine(from_d, datetime.min.time()).replace(tzinfo=timezone.utc)
    day_end = datetime.combine(to_d + timedelta(days=1), datetime.min.time()).replace(tzinfo=timezone.utc)
    ts_date = cast(FoodLog.timestamp, Date)
    food_agg = await session.execute(
        select(
            func.count(func.distinct(ts_date)).label("days_with_food"),
            func.avg(FoodLog.calories).label("avg_calories_per_entry"),
        ).where(
            FoodLog.user_id == uid,
            FoodLog.timestamp >= day_start,
            FoodLog.timestamp < day_end,
        )
    )
    fa = food_agg.one_or_none()
    days_with_food = fa.days_with_food or 0 if fa else 0
    # Daily totals for calories: sum per day then avg
    daily_cal = await session.execute(
        select(
            ts_date.label("day"),
            func.sum(FoodLog.calories).label("day_cal"),
        )
        .where(
            FoodLog.user_id == uid,
            FoodLog.timestamp >= day_start,
            FoodLog.timestamp < day_end,
        )
        .group_by(ts_date)
    )
    daily_totals = [float(row.day_cal) for row in daily_cal.all() if row.day_cal is not None]
    avg_calories_per_day = sum(daily_totals) / len(daily_totals) if daily_totals else None

    # Goals from profile
    prof = (await session.execute(select(AthleteProfile).where(AthleteProfile.user_id == uid))).scalar_one_or_none()
    goals = {}
    if prof:
        if prof.calorie_goal is not None:
            goals["calorie_goal"] = float(prof.calorie_goal)
        if prof.protein_goal is not None:
            goals["protein_goal"] = float(prof.protein_goal)

    return {
        "from_date": from_d.isoformat(),
        "to_date": to_d.isoformat(),
        "avg_sleep_hours": round(avg_sleep, 1) if avg_sleep is not None else None,
        "wellness_days_with_sleep": wellness_days,
        "ctl_atl_tsb": ctl_atl_tsb,
        "workout_count": workout_count,
        "total_tss": round(total_tss, 1),
        "days_with_food": days_with_food,
        "avg_calories_per_day": round(avg_calories_per_day, 0) if avg_calories_per_day is not None else None,
        "goals": goals,
    }


@router.get(
    "/sleep",
    summary="Sleep and wellness trends",
    responses={401: {"description": "Not authenticated"}},
)
async def get_analytics_sleep(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    from_date: date | None = None,
    to_date: date | None = None,
    days: int = Query(default=DEFAULT_DAYS, ge=7, le=MAX_DAYS),
) -> dict[str, Any]:
    """Sleep hours, RHR, HRV by date for charts."""
    uid = user.id
    from_d, to_d = _parse_date_range(from_date, to_date, days)
    stmt = (
        select(
            WellnessCache.date,
            WellnessCache.sleep_hours,
            WellnessCache.rhr,
            WellnessCache.hrv,
        )
        .where(
            WellnessCache.user_id == uid,
            WellnessCache.date >= from_d,
            WellnessCache.date <= to_d,
        )
        .order_by(WellnessCache.date.asc())
    )
    r = await session.execute(stmt)
    rows = r.all()
    items = [
        {
            "date": row.date.isoformat(),
            "sleep_hours": round(row.sleep_hours, 1) if row.sleep_hours is not None else None,
            "rhr": round(row.rhr, 0) if row.rhr is not None else None,
            "hrv": round(row.hrv, 0) if row.hrv is not None else None,
        }
        for row in rows
    ]
    return {"from_date": from_d.isoformat(), "to_date": to_d.isoformat(), "items": items}


@router.get(
    "/workouts",
    summary="Workout and load trends",
    responses={401: {"description": "Not authenticated"}},
)
async def get_analytics_workouts(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    from_date: date | None = None,
    to_date: date | None = None,
    days: int = Query(default=DEFAULT_DAYS, ge=7, le=MAX_DAYS),
) -> dict[str, Any]:
    """Daily workout summary (duration, TSS, distance) and CTL/ATL/TSB by date."""
    uid = user.id
    from_d, to_d = _parse_date_range(from_date, to_date, days)
    from_dt = datetime.combine(from_d, datetime.min.time()).replace(tzinfo=timezone.utc)
    to_dt = datetime.combine(to_d + timedelta(days=1), datetime.min.time()).replace(tzinfo=timezone.utc)

    # Workouts list for the range
    w_stmt = (
        select(Workout)
        .where(
            Workout.user_id == uid,
            Workout.start_date >= from_dt,
            Workout.start_date < to_dt,
        )
        .order_by(Workout.start_date.asc())
    )
    w_r = await session.execute(w_stmt)
    workouts = w_r.scalars().all()
    workout_items = [
        {
            "date": w.start_date.date().isoformat() if w.start_date else None,
            "name": w.name,
            "type": w.type,
            "duration_sec": w.duration_sec,
            "distance_m": w.distance_m,
            "tss": round(w.tss, 1) if w.tss is not None else None,
        }
        for w in workouts
    ]

    # CTL/ATL/TSB by date from wellness_cache
    wc_stmt = (
        select(WellnessCache.date, WellnessCache.ctl, WellnessCache.atl, WellnessCache.tsb)
        .where(
            WellnessCache.user_id == uid,
            WellnessCache.date >= from_d,
            WellnessCache.date <= to_d,
        )
        .order_by(WellnessCache.date.asc())
    )
    wc_r = await session.execute(wc_stmt)
    load_items = [
        {
            "date": row.date.isoformat(),
            "ctl": round(row.ctl, 1) if row.ctl is not None else None,
            "atl": round(row.atl, 1) if row.atl is not None else None,
            "tsb": round(row.tsb, 1) if row.tsb is not None else None,
        }
        for row in wc_r.all()
    ]

    # Daily aggregates: sum duration, TSS, distance per day
    daily_agg = {}
    for w in workouts:
        d = w.start_date.date().isoformat() if w.start_date else None
        if not d:
            continue
        if d not in daily_agg:
            daily_agg[d] = {"duration_sec": 0, "tss": 0.0, "distance_m": 0.0}
        daily_agg[d]["duration_sec"] += w.duration_sec or 0
        daily_agg[d]["tss"] += w.tss or 0.0
        daily_agg[d]["distance_m"] += w.distance_m or 0.0
    daily_list = [
        {
            "date": d,
            "duration_sec": v["duration_sec"],
            "tss": round(v["tss"], 1),
            "distance_m": round(v["distance_m"], 0),
        }
        for d, v in sorted(daily_agg.items())
    ]

    return {
        "from_date": from_d.isoformat(),
        "to_date": to_d.isoformat(),
        "workouts": workout_items,
        "daily": daily_list,
        "load": load_items,
    }


@router.get(
    "/nutrition",
    summary="Nutrition and macro trends",
    responses={401: {"description": "Not authenticated"}},
)
async def get_analytics_nutrition(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    from_date: date | None = None,
    to_date: date | None = None,
    days: int = Query(default=DEFAULT_DAYS, ge=7, le=MAX_DAYS),
) -> dict[str, Any]:
    """Daily calories and macros (protein, fat, carbs) and optional micronutrients for charts."""
    uid = user.id
    from_d, to_d = _parse_date_range(from_date, to_date, days)
    day_start = datetime.combine(from_d, datetime.min.time()).replace(tzinfo=timezone.utc)
    day_end = datetime.combine(to_d + timedelta(days=1), datetime.min.time()).replace(tzinfo=timezone.utc)

    stmt = (
        select(FoodLog)
        .where(
            FoodLog.user_id == uid,
            FoodLog.timestamp >= day_start,
            FoodLog.timestamp < day_end,
        )
        .order_by(FoodLog.timestamp.asc())
    )
    r = await session.execute(stmt)
    rows = r.scalars().all()

    # Aggregate by date (macros + extended_nutrients)
    by_date: dict[str, dict[str, Any]] = {}
    for row in rows:
        d = row.timestamp.date().isoformat() if row.timestamp else None
        if not d:
            continue
        if d not in by_date:
            by_date[d] = {
                "calories": 0.0,
                "protein_g": 0.0,
                "fat_g": 0.0,
                "carbs_g": 0.0,
                "entries": 0,
                "extended_nutrients": {},
            }
        by_date[d]["calories"] += row.calories or 0
        by_date[d]["protein_g"] += row.protein_g or 0
        by_date[d]["fat_g"] += row.fat_g or 0
        by_date[d]["carbs_g"] += row.carbs_g or 0
        by_date[d]["entries"] += 1
        if row.extended_nutrients and isinstance(row.extended_nutrients, dict):
            for key, val in row.extended_nutrients.items():
                if isinstance(val, (int, float)):
                    by_date[d]["extended_nutrients"][key] = (
                        by_date[d]["extended_nutrients"].get(key, 0.0) + float(val)
                    )

    items = []
    for d, v in sorted(by_date.items()):
        item: dict[str, Any] = {
            "date": d,
            "calories": round(v["calories"], 0),
            "protein_g": round(v["protein_g"], 0),
            "fat_g": round(v["fat_g"], 0),
            "carbs_g": round(v["carbs_g"], 0),
            "entries": v["entries"],
        }
        if v.get("extended_nutrients"):
            item["extended_nutrients"] = {
                k: round(float(x), 1) for k, x in v["extended_nutrients"].items()
            }
        items.append(item)

    prof = (await session.execute(select(AthleteProfile).where(AthleteProfile.user_id == uid))).scalar_one_or_none()
    goals = {}
    if prof:
        if prof.calorie_goal is not None:
            goals["calorie_goal"] = float(prof.calorie_goal)
        if prof.protein_goal is not None:
            goals["protein_goal"] = float(prof.protein_goal)
        if prof.fat_goal is not None:
            goals["fat_goal"] = float(prof.fat_goal)
        if prof.carbs_goal is not None:
            goals["carbs_goal"] = float(prof.carbs_goal)

    return {
        "from_date": from_d.isoformat(),
        "to_date": to_d.isoformat(),
        "items": items,
        "goals": goals,
    }


def _insight_instruction(chart_type: str, has_question: bool, locale: str = "ru", is_athlete: bool = True) -> str:
    """Return chart-type-specific instruction for the AI insight. Reply in user's language."""
    lang = language_for_locale(locale)
    lang_rule = f"Reply only in {lang}."
    if has_question:
        return f"{lang_rule} Answer briefly in 2–5 bullet points. Use only the numbers from the data; do not invent data."
    if is_athlete:
        instructions = {
            "nutrition": (
                "Analyze the user's nutrition data: macronutrients (calories, protein, fat, carbs) and, if present, "
                "micronutrients (vitamins and minerals in extended_nutrients, e.g. fiber_g, vitamin_c_mg, iron_mg, "
                "calcium_mg, vitamin_d_iu). Note any deficiencies, excesses, or imbalances. Give 2–5 short bullet points "
                "and practical recommendations. In practical recommendations, when relevant, gently favor more plant-based "
                "options (vegetables, legumes, whole grains, fruits) where appropriate, without being prescriptive or extreme."
            ),
            "sleep": (
                "Analyze sleep and recovery: consistency of sleep hours, trends in RHR and HRV if present. "
                "Highlight notable patterns (e.g. under-sleeping, recovery trends). Give 2–5 short bullet points "
                "and one or two practical recommendations."
            ),
            "workouts": (
                "Analyze training data: volume (TSS, duration, distance), load trends (CTL/ATL/TSB if present), "
                "and consistency. Note any overreaching or recovery needs. Give 2–5 short bullet points and "
                "practical recommendations."
            ),
            "overview": (
                "Summarize the overview: main stats (sleep, workouts, nutrition, load). Note any notable highs/lows "
                "and give one or two practical recommendations. Reply in 2–5 short bullet points."
            ),
        }
    else:
        instructions = {
            "nutrition": (
                "Analyze the user's nutrition data: calories, protein, fat, carbs. Note any imbalances. "
                "Give 2–5 short bullet points and simple recommendations. Use everyday language; avoid diet jargon."
            ),
            "sleep": (
                "Analyze sleep: consistency of sleep hours, trends in RHR and HRV if present. "
                "Highlight notable patterns. Give 2–5 short bullet points and simple recommendations."
            ),
            "workouts": (
                "Analyze activity data: duration, distance, consistency. Give 2–5 short bullet points and "
                "simple recommendations. Avoid TSS, CTL, ATL, polarisation jargon."
            ),
            "overview": (
                "Summarize the overview: main stats (sleep, activity, nutrition). Note any notable highs/lows "
                "and give one or two simple recommendations. Reply in 2–5 short bullet points. Use simple language."
            ),
        }
    base = instructions.get(
        chart_type,
        "Summarize what this chart shows: main trends, notable highs/lows, and one or two practical recommendations. "
        "Reply in 2–5 short bullet points.",
    )
    return f"{lang_rule} {base}"


def _insight_instruction_teaser(locale: str = "ru") -> str:
    """One-sentence teaser for free users. Reply in user's language."""
    lang = language_for_locale(locale)
    return f"Reply only in {lang}. Give exactly one short sentence summarizing the main trend or takeaway. No bullet points, no lists."


class InsightRequest(BaseModel):
    chart_type: str  # overview | sleep | workouts | nutrition
    question: str | None = None  # optional user question
    data: dict[str, Any]  # serialized chart data sent from frontend


@router.post(
    "/insight",
    summary="Get AI explanation for a chart",
    responses={
        401: {"description": "Not authenticated"},
        400: {"description": "Invalid request"},
        503: {"description": "AI service unavailable"},
    },
)
async def post_analytics_insight(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    locale: Annotated[str, Depends(get_request_locale)],
    body: InsightRequest,
) -> dict[str, Any]:
    """Send chart data to Gemini; return text explanation. Free: one-sentence teaser with is_teaser=true; Premium: full insight."""
    from app.config import settings

    if not settings.google_gemini_api_key:
        raise HTTPException(status_code=503, detail="AI insights are not configured.")

    import json

    try:
        import google.generativeai as genai
        from app.services.gemini_common import run_generate_content

        genai.configure(api_key=settings.google_gemini_api_key)
        model = genai.GenerativeModel(settings.gemini_model)

        data_str = json.dumps(body.data, default=str, ensure_ascii=False)
        is_teaser = not user.is_premium
        if is_teaser:
            instruction = _insight_instruction_teaser(locale)
        else:
            has_question = bool(body.question and body.question.strip())
            r_prof = await session.execute(select(AthleteProfile).where(AthleteProfile.user_id == user.id))
            profile = r_prof.scalar_one_or_none()
            is_athlete = await resolve_is_athlete(session, user.id, profile)
            instruction = _insight_instruction(body.chart_type, has_question, locale, is_athlete=is_athlete)

        prompt = f"""You are a sports and wellness coach. The user is viewing an analytics chart of type "{body.chart_type}".

Data (dates, values, macros, and if present extended_nutrients with vitamins/minerals):

{data_str}
"""
        if not is_teaser and body.question and body.question.strip():
            prompt += f"\nUser question: {body.question.strip()}\n\n{instruction}"
        else:
            prompt += f"\n{instruction}"

        response = await run_generate_content(model, prompt)
        text = (response.text or "").strip()
        if not text:
            text = "No explanation could be generated."
        if is_teaser:
            return {"insight": text, "is_teaser": True}
        return {"insight": text}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"AI insight failed: {e!s}")
