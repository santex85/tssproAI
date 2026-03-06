"""
AI Orchestrator: aggregates nutrition, wellness, load; applies 3-level hierarchy;
returns Go/Modify/Skip with optional modified plan. TZ: Level 1 (sleep, HRV, RHR, calories)
cannot be overridden by Level 2 (TSS, CTL, ATL). Level 3: polarised intensity (Seiler).
"""
import asyncio
import json
import logging
from datetime import date, datetime, timedelta, time, timezone
from typing import Any
from zoneinfo import ZoneInfo

import google.generativeai as genai
from google.generativeai.types import HarmCategory, HarmBlockThreshold
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import language_for_locale
from app.config import settings
from app.models.athlete_profile import AthleteProfile
from app.models.chat_message import ChatMessage, MessageRole
from app.models.food_log import FoodLog
from app.models.user import User
from app.models.wellness_cache import WellnessCache
from app.models.workout import Workout
from app.schemas.orchestrator import Decision, ModifiedPlanItem, OrchestratorResponse
from app.services.gemini_common import run_generate_content
from app.services.load_metrics import compute_fitness_from_workouts
from app.services.intervals_client import create_event
from app.services.crypto import decrypt_value
from app.models.intervals_credentials import IntervalsCredentials

def _get_response_schema() -> dict:
    """Derive JSON schema from Pydantic model to avoid duplication."""
    schema = OrchestratorResponse.model_json_schema()
    # Remove top-level title; keep $defs for nested ModifiedPlanItem
    schema.pop("title", None)
    return schema


GENERATION_CONFIG = {
    "temperature": 0.3,
    "max_output_tokens": 1024,
    "response_mime_type": "application/json",
    "response_schema": _get_response_schema(),
}

SAFETY_SETTINGS = {
    HarmCategory.HARM_CATEGORY_HARASSMENT: HarmBlockThreshold.BLOCK_NONE,
    HarmCategory.HARM_CATEGORY_HATE_SPEECH: HarmBlockThreshold.BLOCK_NONE,
    HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_NONE,
    HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_NONE,
}

SYSTEM_PROMPT = """You are a sports physiologist coach. Your ONLY task is to decide whether the athlete should do the planned workout today: Go, Modify, or Skip. Output ONLY valid JSON.

Hierarchy (NEVER violate):
- Level 1 (primary): Readiness — sleep quality/duration, HRV, RHR, calorie/carb deficit from food log. If Level 1 is critical (e.g. very poor sleep + low carbs), you MUST block hard training (Modify or Skip). Level 2 cannot override Level 1.
- Level 2 (secondary): Training load math — TSS, CTL, ATL. Use to decide intensity, but never override Level 1.
- Level 3 (diagnostic): Prefer polarised distribution (Seiler); minimise grey zone (Zone 3); preserve quality in Zone 4+ when fresh.

If context is insufficient to decide safely (e.g. missing sleep/wellness data), output Modify or Skip with a short reason — do not output Go.

Output format (strict JSON). Always include decision, reason, modified_plan, suggestions_next_days. When asked for evening mode or when athlete already trained today, also include evening_tips and/or plan_tomorrow:
{
  "decision": "Go" | "Modify" | "Skip",
  "reason": "short explanation",
  "modified_plan": { "title": "...", "start_date": "ISO datetime", "end_date": "ISO or null", "description": "..." } or null,
  "suggestions_next_days": "optional text for next 7-14 days" or null,
  "evening_tips": "food and sleep advice for the rest of the evening (only when evening mode or post-workout)" or null,
  "plan_tomorrow": "workout recommendation for tomorrow (only when evening mode or post-workout)" or null
}

Consider already completed workouts today, today's nutrition, and sleep/wellness in all recommendations. When context includes target_race_name and days_to_race, you may mention the approaching race in reason or suggestions_next_days when relevant (e.g. "N days to race").

Example (Go):
{"decision": "Go", "reason": "Sleep and load OK.", "modified_plan": null, "suggestions_next_days": null, "evening_tips": null, "plan_tomorrow": null}

Example (Skip):
{"decision": "Skip", "reason": "Poor sleep, low carbs.", "modified_plan": null, "suggestions_next_days": "Rest today; easy 30 min tomorrow if recovered.", "evening_tips": null, "plan_tomorrow": null}

No metaphors, no long text. Output only a single JSON object, no markdown code fences."""

def _build_system_prompt(
    locale: str,
    had_workout_today: bool,
    is_evening: bool = False,
    client_local_hour: int | None = None,
) -> str:
    lang = language_for_locale(locale)
    lang_rule = (
        f"You must respond only in {lang}. All text fields (reason, suggestions_next_days, evening_tips, plan_tomorrow) must be in this language."
    )
    morning_until = getattr(settings, "orchestrator_morning_until_hour", 10)
    evening_from = getattr(settings, "orchestrator_evening_from_hour", 18)

    time_rule = (
        "Current local hour (0-23) is provided in the context. Adapt your response to time of day. "
        f"If hour <= {morning_until} (morning): do NOT infer calorie deficit from today's food log — the day just started. "
        "Output: suggest today's workout and a sample nutrition plan for the day in suggestions_next_days (e.g. breakfast/lunch/dinner targets). Do not say the athlete has a deficit. "
        f"If {morning_until} < hour < {evening_from} (day): consider intake so far. If the athlete already trained today and calories so far are low (e.g. ~1200), "
        "in reason state the shortfall briefly; in suggestions_next_days or evening_tips recommend how many kcal to add by end of day to recover for tomorrow; "
        "in evening_tips give what to eat for the rest of the day; in plan_tomorrow give tomorrow's workout. "
        f"If hour >= {evening_from} (evening): provide evening_tips (food and sleep for the rest of the evening) and plan_tomorrow (workout for tomorrow). "
        "If hour is not provided, treat as daytime (do not assume morning)."
    )

    if had_workout_today:
        scenario = (
            "The athlete already had a workout today. Do not suggest Go/Modify/Skip for today's workout. "
            "In 'reason' give a brief assessment of the day and readiness. "
            "In 'suggestions_next_days' give recovery, nutrition and rest recommendations. "
            "In 'plan_tomorrow' give a concrete workout recommendation for tomorrow. "
            "Optionally in 'evening_tips' give food and sleep advice for the rest of the evening. "
            "If it is still daytime and intake so far is low, recommend how many kcal to add by end of day and what to eat."
        )
    elif is_evening:
        scenario = (
            "The athlete is running analysis in the evening and has not trained today. Do not suggest 'Skip' as the main message. "
            "Provide 'plan_tomorrow' (workout recommendation for tomorrow) and 'evening_tips' (food and sleep advice for the rest of the evening). "
            "Use 'reason' to briefly summarise the day; use 'suggestions_next_days' for any additional recovery or planning notes."
        )
    else:
        scenario = (
            "The athlete has not trained today. In 'reason' keep the Go/Modify/Skip explanation. "
            "In 'suggestions_next_days' give recommendations for today and for tomorrow. "
            "Consider current time of day and intake so far (see time rule above) — do not treat low calories as deficit in early morning."
        )
    return f"{SYSTEM_PROMPT}\n\n{lang_rule}\n\n{time_rule}\n\n{scenario}"


logger = logging.getLogger(__name__)


def _normalize_decision(raw: Any) -> Decision:
    """Map various LLM outputs to Decision enum."""
    s = (str(raw).strip() if raw is not None else "").lower()
    if s == "go":
        return Decision.GO
    if s == "modify":
        return Decision.MODIFY
    if s == "skip":
        return Decision.SKIP
    return Decision.GO


def _parse_llm_response(text: str) -> OrchestratorResponse:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    try:
        return OrchestratorResponse.model_validate_json(text)
    except Exception:
        data = json.loads(text)
        decision = _normalize_decision(data.get("decision", "Go"))
        modified = data.get("modified_plan")
        modified_item = None
        if modified and isinstance(modified, dict) and modified.get("title") and modified.get("start_date"):
            try:
                modified_item = ModifiedPlanItem.model_validate(modified, strict=False)
            except Exception:
                modified_item = None
        reason = str(data.get("reason") or "")[:1000]
        suggestions = data.get("suggestions_next_days")
        if suggestions is not None:
            suggestions = str(suggestions)[:2000]
        evening_tips = data.get("evening_tips")
        evening_tips = str(evening_tips)[:1000] if evening_tips is not None and isinstance(evening_tips, str) else None
        plan_tomorrow = data.get("plan_tomorrow")
        plan_tomorrow = str(plan_tomorrow)[:1000] if plan_tomorrow is not None and isinstance(plan_tomorrow, str) else None
        return OrchestratorResponse(
            decision=decision,
            reason=reason,
            modified_plan=modified_item,
            suggestions_next_days=suggestions,
            evening_tips=evening_tips,
            plan_tomorrow=plan_tomorrow,
        )


def _format_food_entries(entries: list[dict]) -> str:
    if not entries:
        return "(none)"
    lines = []
    for e in entries:
        name = e.get("name") or "?"
        cal = e.get("calories") or 0
        p = e.get("protein_g") or 0
        f = e.get("fat_g") or 0
        c = e.get("carbs_g") or 0
        lines.append(f"- {name}: {cal:.0f} kcal (P{p:.0f} F{f:.0f} C{c:.0f})")
    return "\n".join(lines)


def _format_recent_workouts(workouts: list[dict]) -> str:
    if not workouts:
        return "(none)"
    lines = []
    for w in workouts:
        d = w.get("date") or "?"
        name = w.get("name") or "Workout"
        dist = w.get("distance_km")
        tss = w.get("tss")
        dist_str = f", {dist} km" if dist is not None else ""
        tss_str = f", TSS {tss}" if tss is not None else ""
        lines.append(f"- {d}: {name}{dist_str}{tss_str}")
    return "\n".join(lines)


def _format_wellness_history(history: list[dict]) -> str:
    if not history:
        return "(none)"
    lines = []
    for h in history:
        d = h.get("date") or "?"
        sleep = h.get("sleep_hours")
        hrv = h.get("hrv")
        rhr = h.get("rhr")
        parts = []
        if sleep is not None:
            parts.append(f"Sleep {sleep}h")
        if hrv is not None:
            parts.append(f"HRV {hrv}")
        if rhr is not None:
            parts.append(f"RHR {rhr}")
        lines.append(f"- {d}: {', '.join(parts) or '—'}")
    return "\n".join(lines)


def _format_planned_workouts(events: list[dict]) -> str:
    if not events:
        return "(none)"
    lines = []
    for e in events:
        title = e.get("title") or "?"
        t = e.get("type") or "workout"
        lines.append(f"- {title} ({t})")
    return "\n".join(lines)


def _build_context(
    food_sum: dict[str, float],
    wellness_today: dict[str, Any] | None,
    events_today: list[dict],
    ctl_atl_tsb: dict[str, float] | None,
    athlete_profile: dict[str, Any] | None = None,
    food_entries: list[dict] | None = None,
    wellness_history: list[dict] | None = None,
    recent_workouts: list[dict] | None = None,
    had_workout_today: bool | None = None,
    current_local_hour: int | None = None,
) -> str:
    hour_str = str(current_local_hour) if current_local_hour is not None else "not provided"
    profile_str = ", ".join(f"{k}={v}" for k, v in (athlete_profile or {}).items()) or "(none)"
    wellness_str = ", ".join(f"{k}={v}" for k, v in (wellness_today or {}).items() if v is not None) or "(none)"
    load_str = ", ".join(f"{k}={v}" for k, v in (ctl_atl_tsb or {}).items() if v is not None) or "(none)"
    parts = [
        "## Current local hour (0-23, athlete's local time)",
        hour_str,
        "## Athlete profile (weight, height, age, FTP, name, sex)",
        profile_str,
        "## Food today (sum)",
        f"Calories: {food_sum.get('calories', 0):.0f}, Protein: {food_sum.get('protein_g', 0):.0f}g, Fat: {food_sum.get('fat_g', 0):.0f}g, Carbs: {food_sum.get('carbs_g', 0):.0f}g",
        "## Food today (entries)",
        _format_food_entries(food_entries or []),
        "## Wellness today",
        wellness_str,
        "## Load (CTL/ATL/TSB)",
        load_str,
        "## Wellness history (last 7 days)",
        _format_wellness_history(wellness_history or []),
        "## Planned workouts today (Intervals)",
        _format_planned_workouts(events_today),
        "## Recent workouts (manual/FIT, if any)",
        _format_recent_workouts(recent_workouts or []),
    ]
    if had_workout_today is not None:
        parts.append("## Workout already done today (yes/no)")
        parts.append("yes" if had_workout_today else "no")
    return "\n".join(parts)


def _is_morning(client_local_hour: int | None) -> bool:
    """True if client local hour is at or before the configured morning threshold (e.g. <= 10)."""
    if client_local_hour is None:
        return False
    return client_local_hour <= getattr(settings, "orchestrator_morning_until_hour", 10)


def _is_evening(client_local_hour: int | None) -> bool:
    """True if client local hour is at or past the configured evening threshold."""
    if client_local_hour is None:
        return False
    return client_local_hour >= getattr(settings, "orchestrator_evening_from_hour", 18)


def _day_bounds_utc(d: date, tz_name: str) -> tuple[datetime, datetime]:
    """Return (start_utc, end_utc) for the given date in user's timezone.
    start_utc = 00:00 local, end_utc = 00:00 next day local (exclusive upper bound).
    """
    try:
        tz = ZoneInfo(tz_name) if tz_name else timezone.utc
    except Exception:
        tz = timezone.utc
    start_local = datetime.combine(d, time.min, tzinfo=tz)
    end_local = datetime.combine(d + timedelta(days=1), time.min, tzinfo=tz)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)


async def run_daily_decision(
    session: AsyncSession,
    user_id: int,
    today: date | None = None,
    locale: str = "ru",
    client_local_hour: int | None = None,
) -> OrchestratorResponse:
    """
    Aggregate context from food_log, wellness_cache, and Intervals events;
    call Gemini; return validated decision; on Modify/Skip optionally update
    Intervals and write to chat.
    When client_local_hour is evening (e.g. >= 18), prompt asks for plan_tomorrow and evening_tips instead of Skip.
    """
    today = today or date.today()
    is_evening = _is_evening(client_local_hour)
    wellness_from = today - timedelta(days=7)
    from_date = today - timedelta(days=14)

    # Fetch user first to get timezone for correct daily bounds (UTC vs user local)
    r_user = await session.execute(select(User.email, User.is_premium, User.timezone).where(User.id == user_id))
    user_row = r_user.one_or_none()
    user_tz = (user_row[2] or "UTC").strip() or "UTC" if user_row and len(user_row) > 2 else "UTC"
    today_start_utc, today_end_utc = _day_bounds_utc(today, user_tz)
    from_start_utc, _ = _day_bounds_utc(from_date, user_tz)
    _, to_start_utc = _day_bounds_utc(today + timedelta(days=1), user_tz)

    (
        r_food,
        r_wellness,
        r_prof,
        r_fe,
        r_wh,
        r_workouts,
        r_creds,
    ) = await asyncio.gather(
        session.execute(
            select(
                FoodLog.calories,
                FoodLog.protein_g,
                FoodLog.fat_g,
                FoodLog.carbs_g,
            ).where(
                FoodLog.user_id == user_id,
                FoodLog.timestamp >= today_start_utc,
                FoodLog.timestamp < today_end_utc,
            )
        ),
        session.execute(
            select(WellnessCache).where(
                WellnessCache.user_id == user_id,
                WellnessCache.date == today,
            )
        ),
        session.execute(select(AthleteProfile).where(AthleteProfile.user_id == user_id)),
        session.execute(
            select(FoodLog.name, FoodLog.portion_grams, FoodLog.calories, FoodLog.protein_g, FoodLog.fat_g, FoodLog.carbs_g, FoodLog.meal_type, FoodLog.extended_nutrients).where(
                FoodLog.user_id == user_id,
                FoodLog.timestamp >= today_start_utc,
                FoodLog.timestamp < today_end_utc,
            )
        ),
        session.execute(
            select(WellnessCache.date, WellnessCache.sleep_hours, WellnessCache.rhr, WellnessCache.hrv, WellnessCache.ctl, WellnessCache.atl, WellnessCache.tsb, WellnessCache.weight_kg).where(
                WellnessCache.user_id == user_id,
                WellnessCache.date >= wellness_from,
                WellnessCache.date <= today,
            ).order_by(WellnessCache.date.asc())
        ),
        session.execute(
            select(Workout).where(
                Workout.user_id == user_id,
                Workout.start_date >= from_start_utc,
                Workout.start_date < to_start_utc,
            ).order_by(Workout.start_date.desc()).limit(10)
        ),
        session.execute(select(IntervalsCredentials).where(IntervalsCredentials.user_id == user_id)),
    )

    # Process food sum
    rows = r_food.all()
    food_sum = {"calories": 0.0, "protein_g": 0.0, "fat_g": 0.0, "carbs_g": 0.0}
    for row in rows:
        food_sum["calories"] += row[0] or 0
        food_sum["protein_g"] += row[1] or 0
        food_sum["fat_g"] += row[2] or 0
        food_sum["carbs_g"] += row[3] or 0

    w = r_wellness.scalar_one_or_none()
    wellness_today = None
    ctl_atl_tsb = None
    if w:
        wellness_today = {
            "sleep_hours": w.sleep_hours,
            "rhr": w.rhr,
            "hrv": w.hrv,
            "weight_kg": w.weight_kg,
        }
        if w.ctl is not None or w.atl is not None or w.tsb is not None:
            ctl_atl_tsb = {"ctl": w.ctl, "atl": w.atl, "tsb": w.tsb}
    if ctl_atl_tsb is None:
        fitness = await compute_fitness_from_workouts(session, user_id, as_of=today)
        if fitness:
            ctl_atl_tsb = {"ctl": fitness["ctl"], "atl": fitness["atl"], "tsb": fitness["tsb"]}
    if wellness_today is None:
        wellness_today = {}

    email = user_row[0] if user_row else None
    is_premium = bool(user_row[1]) if user_row and len(user_row) > 1 else False
    profile = r_prof.scalar_one_or_none()
    athlete_profile: dict[str, Any] = {}
    if profile:
        if profile.weight_kg is not None:
            athlete_profile["weight_kg"] = float(profile.weight_kg)
        if profile.height_cm is not None:
            athlete_profile["height_cm"] = float(profile.height_cm)
        if profile.birth_year is not None:
            athlete_profile["birth_year"] = profile.birth_year
            athlete_profile["age_years"] = today.year - profile.birth_year
        if profile.ftp is not None:
            athlete_profile["ftp"] = profile.ftp
        if profile.target_race_date is not None:
            athlete_profile["target_race_date"] = profile.target_race_date.isoformat()
        if profile.target_race_name:
            athlete_profile["target_race_name"] = profile.target_race_name
        if profile.target_race_date is not None and profile.target_race_date >= today:
            athlete_profile["days_to_race"] = (profile.target_race_date - today).days
    if not athlete_profile.get("display_name") and email:
        athlete_profile["display_name"] = email

    food_entries = []
    for row in r_fe.all():
        food_entries.append({
            "name": row[0], "portion_grams": row[1], "calories": row[2], "protein_g": row[3], "fat_g": row[4], "carbs_g": row[5], "meal_type": row[6],
            "extended_nutrients": row[7] if is_premium else None,
        })

    wellness_history = []
    for row in r_wh.all():
        wellness_history.append({
            "date": row[0].isoformat() if row[0] else None,
            "sleep_hours": row[1], "rhr": row[2], "hrv": row[3], "ctl": row[4], "atl": row[5], "tsb": row[6], "weight_kg": row[7],
        })

    recent_workouts = []
    for w in r_workouts.scalars().all():
        d = w.start_date.date() if w.start_date and hasattr(w.start_date, "date") else None
        recent_workouts.append({
            "date": d.isoformat() if d else None,
            "name": w.name,
            "type": w.type,
            "duration_sec": w.duration_sec,
            "distance_km": round(w.distance_m / 1000, 1) if w.distance_m is not None else None,
            "tss": w.tss,
            "source": w.source,
        })

    had_workout_today = any(
        (w.get("date") or "").startswith(str(today)) or (w.get("date") == today.isoformat())
        for w in recent_workouts
    )

    events_today: list[dict] = []
    creds = r_creds.scalar_one_or_none()
    if creds:
        from app.services.intervals_client import get_events
        api_key = decrypt_value(creds.encrypted_token_or_key)
        if api_key:
            try:
                evs = await get_events(creds.athlete_id, api_key, today, today)
                events_today = [
                    {"id": e.id, "title": e.title, "start_date": e.start_date.isoformat() if e.start_date else None, "type": e.type}
                    for e in evs
                ]
            except Exception as e:
                logger.warning(
                    "Intervals get_events failed for user_id=%s athlete_id=%s: %s",
                    user_id,
                    creds.athlete_id,
                    e,
                    exc_info=True,
                )

    context = _build_context(
        food_sum,
        wellness_today,
        events_today,
        ctl_atl_tsb,
        athlete_profile=athlete_profile,
        food_entries=food_entries,
        wellness_history=wellness_history,
        recent_workouts=recent_workouts,
        had_workout_today=had_workout_today,
        current_local_hour=client_local_hour,
    )

    system_prompt = _build_system_prompt(
        locale, had_workout_today, is_evening=is_evening, client_local_hour=client_local_hour
    )
    model = genai.GenerativeModel(
        settings.gemini_model,
        generation_config=GENERATION_CONFIG,
        safety_settings=SAFETY_SETTINGS,
    )
    response = await run_generate_content(model, [system_prompt, "\n\nContext:\n" + context])
    if not response or not response.text:
        return OrchestratorResponse(decision=Decision.SKIP, reason="No AI response; defaulting to Skip.")
    try:
        result = _parse_llm_response(response.text)
    except (json.JSONDecodeError, Exception) as e:
        raw_text = response.text or ""
        raw_preview = raw_text[:1000].replace("\n", " ")
        logger.warning(
            "Orchestrator parse failed: %s: %s. Response length: %d. Raw response preview: %s",
            type(e).__name__,
            str(e),
            len(raw_text),
            raw_preview,
        )
        return OrchestratorResponse(decision=Decision.SKIP, reason="Parse error; defaulting to Skip.")

    # On Modify/Skip or when we have evening/plan tips: write to chat
    write_chat = (
        result.decision in (Decision.MODIFY, Decision.SKIP) and result.reason
    ) or result.evening_tips or result.plan_tomorrow
    if write_chat:
        parts = []
        if result.reason:
            parts.append(f"Decision: {result.decision.value}. {result.reason}")
        if result.suggestions_next_days:
            parts.append(f"Next days: {result.suggestions_next_days}")
        if result.evening_tips:
            parts.append(f"Evening: {result.evening_tips}")
        if result.plan_tomorrow:
            parts.append(f"Tomorrow: {result.plan_tomorrow}")
        if parts:
            session.add(
                ChatMessage(
                    user_id=user_id,
                    role=MessageRole.assistant.value,
                    content="\n\n".join(parts),
                )
            )
        api_key = decrypt_value(creds.encrypted_token_or_key) if creds else None
        if result.decision == Decision.MODIFY and result.modified_plan and creds and api_key:
            try:
                start = datetime.fromisoformat(result.modified_plan.start_date.replace("Z", "+00:00"))
                end = None
                if result.modified_plan.end_date:
                    end = datetime.fromisoformat(result.modified_plan.end_date.replace("Z", "+00:00"))
                await create_event(
                    creds.athlete_id,
                    api_key,
                    {
                        "title": result.modified_plan.title,
                        "start_date": start,
                        "end_date": end,
                        "description": result.modified_plan.description,
                        "type": result.modified_plan.type,
                    },
                )
            except Exception as e:
                logger.error(
                    "Intervals create_event failed for user_id=%s athlete_id=%s (modified plan not synced): %s",
                    user_id,
                    creds.athlete_id,
                    e,
                    exc_info=True,
                )

    return result
