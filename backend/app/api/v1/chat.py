"""Chat with AI coach: history, send message, optional orchestrator run, optional FIT upload."""

import asyncio
import json
from datetime import date, datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import check_chat_usage, get_current_user, get_request_locale, language_for_locale, require_premium
from app.core.upload import read_upload_bounded
from app.db.session import get_db
from app.models.athlete_profile import AthleteProfile
from app.models.chat_message import ChatMessage, MessageRole
from app.models.chat_thread import ChatThread
from app.models.food_log import FoodLog
from app.models.sleep_extraction import SleepExtraction
from app.models.user import User
from app.models.user_weekly_summary import UserWeeklySummary
from app.models.wellness_cache import WellnessCache
from app.models.workout import Workout
from app.schemas.pagination import PaginatedResponse
from app.services.fit_parser import parse_fit_session
from app.services.workout_processor import fit_data_to_summary, save_workout_from_fit
from app.services.gemini_photo_analyzer import classify_and_analyze_image
from app.services.image_resize import resize_image_for_ai_async
from app.services.orchestrator import run_daily_decision

router = APIRouter(prefix="/chat", tags=["chat"])


def _validate_chat_image(file: UploadFile | None, image_bytes: bytes) -> None:
    """Validate image file for chat upload. Raises HTTPException if invalid."""
    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="No image file")
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")
    if len(image_bytes) == 0:
        raise HTTPException(status_code=400, detail="File is empty or invalid.")
    if len(image_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image too large (max 10MB)")
    magic = image_bytes[:12] if len(image_bytes) >= 12 else image_bytes
    if not (
        magic.startswith(b"\xff\xd8\xff")
        or magic.startswith(b"\x89PNG\r\n\x1a\n")
        or magic.startswith(b"GIF87a")
        or magic.startswith(b"GIF89a")
        or (magic[:4] == b"RIFF" and magic[8:12] == b"WEBP")
    ):
        raise HTTPException(status_code=400, detail="File must be a valid image (JPEG, PNG, GIF or WebP).")


async def _describe_image_for_chat(image_bytes: bytes, locale: str) -> str:
    """Get a short text description of the image for coach context. Uses classify_and_analyze_image."""
    try:
        kind, result = await classify_and_analyze_image(image_bytes, locale=locale)
        parts = [f"Photo type: {kind}."]
        if hasattr(result, "model_dump"):
            d = result.model_dump()
        elif isinstance(result, dict):
            d = result
        else:
            d = {}
        # Brief summary: key fields only
        if kind == "food" and d.get("name"):
            parts.append(f"Content: {d.get('name')}; calories {d.get('calories')}, protein {d.get('protein_g')}g.")
        elif kind == "sleep":
            if d.get("sleep_hours") is not None or d.get("actual_sleep_hours") is not None:
                parts.append(f"Sleep: {d.get('sleep_hours') or d.get('actual_sleep_hours')} h, quality {d.get('quality_score')}.")
            else:
                parts.append("Sleep data from screenshot.")
        elif kind == "wellness":
            parts.append(f"RHR: {d.get('rhr')}, HRV: {d.get('hrv')}.")
        elif kind == "workout":
            parts.append(
                f"Workout: {d.get('name') or 'Activity'}; "
                f"duration {d.get('duration_sec')}s, distance {d.get('distance_m')}m, TSS {d.get('tss')}."
            )
        return " ".join(parts)
    except (ValueError, Exception):
        return "User attached a photo (content could not be automatically classified)."

CHAT_SYSTEM_REGULAR = """You are a sports coach. You have the following context about the athlete.
- Consider what the user is asking about (sleep, nutrition, load, workouts, etc.) and focus your answer on that. Use the metrics from context to give concrete, practical advice — not just listing numbers. Tie your advice to the user's question.
- If a section has no data, say "No data" for that topic; never invent numbers. Only use numbers that appear in the context.
- Reply briefly and to the point; 3–6 short bullets when listing data is fine, but keep the tone helpful and human, not mechanical."""

CHAT_SYSTEM_PREMIUM = """You are the athlete's personal coach in a live, conversational mode. You can discuss any of their metrics and any topic that the context supports (training load, sleep, nutrition, wellness, goals).
- Be warm and human: respond like a real coach who knows the athlete's data. Avoid robotic or template phrases. It's fine to be more detailed or to ask a follow-up when it helps.
- Use only numbers and facts from the context; never invent data. If something is missing, say so naturally.
- You may give longer, more conversational answers when the user asks for deeper discussion or when explaining trends and recommendations.
- When the context includes a target race and days_to_race, you may mention the approaching start when relevant (e.g. when discussing load, recovery, or planning); do not repeat it in every message.

Avoid repetition and rigid structure:
- Do not repeat the same metrics (TSB, ATL, CTL, calories, sleep hours, etc.) in every message. If you or the user already mentioned them in this conversation, refer briefly to what was said ("as I said", "given your current balance") or answer only the new question; do not re-list the numbers.
- Vary your responses: do not use the same template every time (e.g. load then sleep then nutrition then advice). Answer the user's specific question first; add one or two relevant facts only when needed.
- For short user messages (e.g. "What should I do tomorrow?", "A bit", "No"), give a short, focused reply without re-listing all metrics."""

def _chat_system_with_locale(locale: str, is_premium: bool = False) -> str:
    lang = language_for_locale(locale)
    base = CHAT_SYSTEM_PREMIUM if is_premium else CHAT_SYSTEM_REGULAR
    return f"You must respond only in {lang}. All your reply must be in this language.\n\n{base}"


# Context limits: last N days, last M workouts, max chars per section to keep prompts smaller
CHAT_CONTEXT_DAYS = 7
CHAT_WORKOUTS_LIMIT = 10
CHAT_SECTION_MAX_CHARS = 1200
# Conversation history for chat: last N messages (chronological), max total chars to avoid blowing the prompt
CHAT_HISTORY_MESSAGES_LIMIT = 20
CHAT_HISTORY_MAX_CHARS = 3000


async def _build_athlete_context(session: AsyncSession, user_id: int, is_premium: bool = False) -> str:
    """Build a compressed text summary: profile, food/wellness today + last N days, last M workouts. No passwords/tokens."""
    today = date.today()
    sleep_from = today - timedelta(days=CHAT_CONTEXT_DAYS)
    wellness_from = today - timedelta(days=CHAT_CONTEXT_DAYS)
    from_dt = datetime.combine(wellness_from, datetime.min.time()).replace(tzinfo=timezone.utc)
    to_dt = datetime.combine(today + timedelta(days=1), datetime.min.time()).replace(tzinfo=timezone.utc)

    (
        r_user,
        r_prof,
        r_food,
        r_wellness,
        r_sleep_list,
        r_well,
        r_w,
    ) = await asyncio.gather(
        session.execute(select(User.email).where(User.id == user_id)),
        session.execute(select(AthleteProfile).where(AthleteProfile.user_id == user_id)),
        session.execute(
            select(FoodLog.name, FoodLog.portion_grams, FoodLog.calories, FoodLog.protein_g, FoodLog.fat_g, FoodLog.carbs_g, FoodLog.meal_type, FoodLog.timestamp, FoodLog.extended_nutrients).where(
                FoodLog.user_id == user_id,
                FoodLog.timestamp >= datetime.combine(today, datetime.min.time()),
                FoodLog.timestamp < datetime.combine(today + timedelta(days=1), datetime.min.time()),
            )
        ),
        session.execute(
            select(WellnessCache).where(
                WellnessCache.user_id == user_id,
                WellnessCache.date == today,
            )
        ),
        session.execute(
            select(SleepExtraction.created_at, SleepExtraction.extracted_data).where(
                SleepExtraction.user_id == user_id,
                SleepExtraction.created_at >= from_dt,
            ).order_by(SleepExtraction.created_at.desc()).limit(20)
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
                Workout.start_date >= from_dt,
                Workout.start_date < to_dt,
            ).order_by(Workout.start_date.desc()).limit(CHAT_WORKOUTS_LIMIT)
        ),
    )

    user_row = r_user.one_or_none()
    email = user_row[0] if user_row else None
    profile = r_prof.scalar_one_or_none()
    athlete = {}
    if profile:
        if profile.weight_kg is not None:
            athlete["weight_kg"] = float(profile.weight_kg)
        if profile.height_cm is not None:
            athlete["height_cm"] = float(profile.height_cm)
        if profile.birth_year is not None:
            athlete["birth_year"] = profile.birth_year
            athlete["age_years"] = today.year - profile.birth_year
        if profile.ftp is not None:
            athlete["ftp"] = profile.ftp
        if profile.target_race_date is not None:
            athlete["target_race_date"] = profile.target_race_date.isoformat()
        if profile.target_race_name:
            athlete["target_race_name"] = profile.target_race_name
        if profile.target_race_date is not None and profile.target_race_date >= today:
            athlete["days_to_race"] = (profile.target_race_date - today).days
    if not athlete.get("display_name") and email:
        athlete["display_name"] = email

    rows = r_food.all()
    food_sum = {"calories": 0.0, "protein_g": 0.0, "fat_g": 0.0, "carbs_g": 0.0}
    food_entries = []
    for row in rows:
        food_sum["calories"] += row[2] or 0
        food_sum["protein_g"] += row[3] or 0
        food_sum["fat_g"] += row[4] or 0
        food_sum["carbs_g"] += row[5] or 0
        food_entries.append({
            "name": row[0], "portion_grams": row[1], "calories": row[2], "protein_g": row[3], "fat_g": row[4], "carbs_g": row[5],
            "meal_type": row[6], "timestamp": row[7].isoformat() if row[7] else None,
            "extended_nutrients": row[8] if is_premium else None,
        })

    w = r_wellness.scalar_one_or_none()
    wellness_today = None
    ctl_atl_tsb = None
    if w:
        wellness_today = {"sleep_hours": w.sleep_hours, "rhr": w.rhr, "hrv": w.hrv, "weight_kg": w.weight_kg}
        ctl_atl_tsb = {"ctl": w.ctl, "atl": w.atl, "tsb": w.tsb}
    if wellness_today is None:
        wellness_today = {}

    sleep_entries = []
    for created_at, data_json in r_sleep_list.all():
        try:
            data = json.loads(data_json) if isinstance(data_json, str) else data_json
        except (json.JSONDecodeError, TypeError):
            continue
        created_date = created_at.date() if created_at and hasattr(created_at, "date") else None
        sleep_entries.append({
            "date": created_date.isoformat() if created_date else None,
            "recorded_at": created_at.isoformat() if created_at else None,
            "sleep_date": data.get("date"),
            "sleep_hours": data.get("sleep_hours"),
            "actual_sleep_hours": data.get("actual_sleep_hours"),
            "quality_score": data.get("quality_score"),
            "deep_sleep_min": data.get("deep_sleep_min"),
            "rem_min": data.get("rem_min"),
        })
    sleep_summary = json.dumps(sleep_entries, default=str) if sleep_entries else "No sleep data from photos."

    wellness_history = []
    for row in r_well.all():
        wellness_history.append({
            "date": row[0].isoformat() if row[0] else None,
            "sleep_hours": row[1], "rhr": row[2], "hrv": row[3], "ctl": row[4], "atl": row[5], "tsb": row[6], "weight_kg": row[7],
        })

    workouts = []
    for w in r_w.scalars().all():
        d = w.start_date.date() if w.start_date and hasattr(w.start_date, "date") else None
        workouts.append({
            "date": d.isoformat() if d else None,
            "name": w.name,
            "type": w.type,
            "duration_sec": w.duration_sec,
            "distance_km": round(w.distance_m / 1000, 1) if w.distance_m is not None else None,
            "tss": w.tss,
            "source": w.source,
        })

    def _cap(s: str, limit: int = CHAT_SECTION_MAX_CHARS) -> str:
        s = s.strip()
        return s if len(s) <= limit else s[: limit - 3] + "..."

    parts = [
        "## Athlete profile (weight, height, age, FTP, name, sex)",
        _cap(json.dumps(athlete, default=str)),
    ]
    if is_premium:
        r_summary = await session.execute(
            select(UserWeeklySummary.summary_text)
            .where(UserWeeklySummary.user_id == user_id)
            .order_by(UserWeeklySummary.week_start_date.desc())
            .limit(1)
        )
        row = r_summary.one_or_none()
        if row and row[0]:
            parts.append("## Coach memory (weekly summary)\n" + _cap(row[0], limit=600))
    parts.extend([
        "## Food today (sum)",
        f"Calories: {food_sum['calories']:.0f}, Protein: {food_sum['protein_g']:.0f}g, Fat: {food_sum['fat_g']:.0f}g, Carbs: {food_sum['carbs_g']:.0f}g",
        "## Food today (entries)",
        _cap(json.dumps(food_entries, default=str)),
        "## Wellness today (sleep, RHR, HRV)",
        _cap(json.dumps(wellness_today or {})),
        "## Load (CTL/ATL/TSB)",
        _cap(json.dumps(ctl_atl_tsb or {})),
        "## Wellness history (last %d days)" % CHAT_CONTEXT_DAYS,
        _cap(json.dumps(wellness_history, default=str)),
        "## Sleep (from photos, last %d days)" % CHAT_CONTEXT_DAYS,
        _cap(sleep_summary),
        "## Recent workouts (manual/FIT)",
        _cap(json.dumps(workouts, default=str)),
    ])
    return "\n".join(parts)


async def _get_conversation_block(
    session: AsyncSession,
    user_id: int,
    thread_id: int,
    max_messages: int = CHAT_HISTORY_MESSAGES_LIMIT,
    max_chars: int = CHAT_HISTORY_MAX_CHARS,
) -> str:
    """Load last N messages for the thread in chronological order, format as 'User: ... Coach: ...', truncate if over max_chars."""
    r = await session.execute(
        select(ChatMessage.role, ChatMessage.content)
        .where(ChatMessage.user_id == user_id, ChatMessage.thread_id == thread_id)
        .order_by(ChatMessage.timestamp.desc())
        .limit(max_messages)
    )
    rows = list(r.all())
    rows.reverse()  # chronological order
    if not rows:
        return ""
    lines = []
    total = 0
    for role, content in rows:
        label = "Coach" if role == MessageRole.assistant.value else "User"
        line = f"{label}: {content}"
        if max_chars and total + len(line) + 1 > max_chars and lines:
            break
        lines.append(line)
        total += len(line) + 1
    return "\n".join(lines)


async def _get_fit_monthly_aggregates(
    session: AsyncSession,
    user_id: int,
    fit_data: dict,
) -> str | None:
    """
    Fetch workouts from the last 30 days with power/HR in raw (FIT or similar),
    optionally filter by same sport. Return a short text block with monthly averages
    (avg power, avg HR, average EF) for context when analyzing the current FIT.
    """
    from_dt = datetime.now(timezone.utc) - timedelta(days=30)
    r = await session.execute(
        select(Workout.raw, Workout.type).where(
            Workout.user_id == user_id,
            Workout.start_date >= from_dt,
            Workout.raw.isnot(None),
        )
    )
    rows = r.all()
    current_sport = (fit_data.get("sport") or "").strip().lower()
    if current_sport:
        current_sport = current_sport.replace("_", " ")

    ef_values: list[float] = []
    avg_powers: list[float] = []
    avg_hrs: list[float] = []
    np_values: list[float] = []

    for raw_json, w_type in rows:
        if not raw_json or not isinstance(raw_json, dict):
            continue
        if current_sport:
            raw_sport = (raw_json.get("sport") or "").strip().lower().replace("_", " ")
            type_lower = (w_type or "").strip().lower()
            if raw_sport != current_sport and type_lower != current_sport:
                continue
        hr = raw_json.get("avg_heart_rate")
        if hr is not None:
            try:
                hr = float(hr)
            except (TypeError, ValueError):
                continue
        power = raw_json.get("avg_power")
        np_val = raw_json.get("normalized_power")
        if power is not None:
            try:
                power = float(power)
            except (TypeError, ValueError):
                power = None
        if np_val is not None:
            try:
                np_val = float(np_val)
            except (TypeError, ValueError):
                np_val = None
        use_power = np_val if np_val is not None else power
        if use_power is not None and hr is not None and hr > 0:
            ef_values.append(use_power / hr)
            avg_powers.append(use_power)
            avg_hrs.append(hr)
            if np_val is not None:
                np_values.append(np_val)

    if not ef_values:
        return None
    n = len(ef_values)
    avg_ef = sum(ef_values) / n
    avg_pwr = sum(avg_powers) / n
    avg_hr = sum(avg_hrs) / n
    parts = [
        f"Monthly averages (last 30 days, similar workouts): count={n}",
        f"Avg power/NP: {avg_pwr:.1f} W, Avg HR: {avg_hr:.1f} bpm, Avg EF (power/HR): {avg_ef:.2f}.",
    ]
    return " ".join(parts)


class SendMessageBody(BaseModel):
    message: str
    run_orchestrator: bool = False  # if True, run daily decision and include in context
    thread_id: int | None = None  # if None, use default (first) thread or create one


class CreateThreadBody(BaseModel):
    title: str | None = None


class RunOrchestratorBody(BaseModel):
    locale: str = "ru"
    for_date: date | None = None
    client_local_hour: int | None = None  # 0-23, local hour when user tapped "analysis"


async def _get_or_create_default_thread(session: AsyncSession, user_id: int) -> ChatThread:
    """Return first thread for user or create one 'Основной'."""
    r = await session.execute(
        select(ChatThread).where(ChatThread.user_id == user_id).order_by(ChatThread.id.asc()).limit(1)
    )
    thread = r.scalar_one_or_none()
    if thread:
        return thread
    thread = ChatThread(user_id=user_id, title="Основной")
    session.add(thread)
    await session.flush()
    return thread


@router.get(
    "/threads",
    response_model=PaginatedResponse,
    summary="List chat threads",
    responses={401: {"description": "Not authenticated"}},
)
async def list_threads(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> PaginatedResponse:
    """List chat threads for the current user, ordered by created_at desc (paginated)."""
    uid = user.id
    base = select(ChatThread).where(ChatThread.user_id == uid).order_by(ChatThread.created_at.desc())
    count_q = select(func.count()).select_from(base.subquery())
    total = (await session.execute(count_q)).scalar() or 0
    r = await session.execute(base.offset(offset).limit(limit))
    threads = r.scalars().all()
    items = [
        {"id": t.id, "title": t.title, "created_at": t.created_at.isoformat() if t.created_at else None}
        for t in threads
    ]
    return PaginatedResponse(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
        has_more=(offset + limit) < total,
    )


@router.post(
    "/threads",
    response_model=dict,
    summary="Create chat thread",
    responses={401: {"description": "Not authenticated"}},
)
async def create_thread(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    body: CreateThreadBody | None = None,
) -> dict:
    """Create a new chat thread."""
    uid = user.id
    title = (body.title if body else "") or ""
    title = title.strip() or "Новый чат"
    thread = ChatThread(user_id=uid, title=title)
    session.add(thread)
    await session.commit()
    await session.refresh(thread)
    return {"id": thread.id, "title": thread.title, "created_at": thread.created_at.isoformat() if thread.created_at else None}


class UpdateThreadBody(BaseModel):
    title: str


@router.patch(
    "/threads/{thread_id}",
    response_model=dict,
    summary="Update chat thread (rename)",
    responses={401: {"description": "Not authenticated"}, 404: {"description": "Thread not found"}},
)
async def update_thread(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    thread_id: int,
    body: UpdateThreadBody,
) -> dict:
    """Rename a chat thread."""
    uid = user.id
    r = await session.execute(select(ChatThread).where(ChatThread.id == thread_id, ChatThread.user_id == uid))
    thread = r.scalar_one_or_none()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    title = (body.title or "").strip() or "Чат"
    thread.title = title[:128]
    await session.commit()
    await session.refresh(thread)
    return {"id": thread.id, "title": thread.title, "created_at": thread.created_at.isoformat() if thread.created_at else None}


@router.delete(
    "/threads/{thread_id}",
    summary="Delete chat thread",
    responses={401: {"description": "Not authenticated"}, 404: {"description": "Thread not found"}},
)
async def delete_thread(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    thread_id: int,
) -> None:
    """Delete a thread and all its messages (cascade)."""
    uid = user.id
    r = await session.execute(select(ChatThread).where(ChatThread.id == thread_id, ChatThread.user_id == uid))
    thread = r.scalar_one_or_none()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    await session.delete(thread)
    await session.commit()


@router.post(
    "/threads/{thread_id}/clear",
    summary="Clear thread messages",
    responses={401: {"description": "Not authenticated"}, 404: {"description": "Thread not found"}},
)
async def clear_thread(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    thread_id: int,
) -> dict:
    """Delete all messages in the thread; thread remains."""
    uid = user.id
    r = await session.execute(select(ChatThread).where(ChatThread.id == thread_id, ChatThread.user_id == uid))
    thread = r.scalar_one_or_none()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    await session.execute(delete(ChatMessage).where(ChatMessage.thread_id == thread_id))
    await session.commit()
    return {"ok": True}


@router.get(
    "/history",
    summary="Get chat history",
    responses={401: {"description": "Not authenticated"}},
)
async def get_history(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    thread_id: int | None = None,
    limit: int = 50,
) -> list[dict]:
    """Return recent chat messages for a thread. If thread_id omitted, use default thread."""
    uid = user.id
    if thread_id is None:
        thread = await _get_or_create_default_thread(session, uid)
        thread_id = thread.id
    else:
        r = await session.execute(select(ChatThread).where(ChatThread.id == thread_id, ChatThread.user_id == uid))
        if r.scalar_one_or_none() is None:
            raise HTTPException(status_code=404, detail="Thread not found")
    r = await session.execute(
        select(ChatMessage)
        .where(ChatMessage.user_id == uid, ChatMessage.thread_id == thread_id)
        .order_by(ChatMessage.timestamp.desc())
        .limit(limit)
    )
    rows = r.scalars().all()
    return [
        {"role": m.role, "content": m.content, "timestamp": m.timestamp.isoformat() if m.timestamp else None}
        for m in reversed(rows)
    ]


@router.post(
    "/send",
    response_model=dict,
    summary="Send chat message",
    responses={401: {"description": "Not authenticated"}, 502: {"description": "AI service unavailable"}},
)
async def send_message(
    session: Annotated[AsyncSession, Depends(get_db)],
    body: SendMessageBody,
    user: Annotated[User, Depends(get_current_user)],
    locale: Annotated[str, Depends(get_request_locale)],
    _usage: Annotated[None, Depends(check_chat_usage)],
) -> dict:
    """Append user message, optionally run orchestrator, then get AI reply and return it."""
    uid = user.id
    thread_id = body.thread_id
    if thread_id is None:
        thread = await _get_or_create_default_thread(session, uid)
        thread_id = thread.id
    else:
        r = await session.execute(select(ChatThread).where(ChatThread.id == thread_id, ChatThread.user_id == uid))
        if r.scalar_one_or_none() is None:
            raise HTTPException(status_code=404, detail="Thread not found")

    session.add(
        ChatMessage(user_id=uid, thread_id=thread_id, role=MessageRole.user.value, content=body.message)
    )
    await session.commit()

    reply = ""
    try:
        if body.run_orchestrator:
            result = await run_daily_decision(session, uid, date.today(), locale=locale)
            reply = f"Decision: {result.decision.value}. {result.reason}"
            if result.suggestions_next_days:
                reply += f"\n\n{result.suggestions_next_days}"
        else:
            import google.generativeai as genai
            from app.config import settings
            from app.services.gemini_common import run_generate_content
            context = await _build_athlete_context(session, uid, user.is_premium)
            model = genai.GenerativeModel(settings.gemini_model)
            chat_system = _chat_system_with_locale(locale, user.is_premium)
            conversation_block = await _get_conversation_block(session, uid, thread_id)
            if conversation_block:
                prompt = (
                    f"{chat_system}\n\nContext:\n{context}\n\nConversation so far:\n{conversation_block}\n\n"
                    "Reply as the coach to the last user message. Do not repeat numbers or advice you already gave above."
                )
            else:
                prompt = f"{chat_system}\n\nContext:\n{context}\n\nUser message: {body.message}"
            response = await run_generate_content(model, prompt)
            reply = response.text if response and response.text else "No response."
    except Exception:
        reply = "Sorry, the AI service is temporarily unavailable. Please try again."
        session.add(
            ChatMessage(user_id=uid, thread_id=thread_id, role=MessageRole.assistant.value, content=reply)
        )
        await session.commit()
        raise HTTPException(status_code=502, detail="AI service unavailable")

    session.add(
        ChatMessage(user_id=uid, thread_id=thread_id, role=MessageRole.assistant.value, content=reply)
    )
    await session.commit()
    return {"reply": reply}


@router.post(
    "/send-with-file",
    response_model=dict,
    summary="Send message with FIT file (Premium)",
    responses={
        401: {"description": "Not authenticated"},
        403: {"description": "Premium required"},
        502: {"description": "AI service unavailable"},
    },
)
async def send_message_with_file(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(require_premium)],
    locale: Annotated[str, Depends(get_request_locale)],
    _usage: Annotated[None, Depends(check_chat_usage)],
    message: Annotated[str, Form()] = "",
    run_orchestrator: Annotated[str, Form()] = "false",
    thread_id: Annotated[str | None, Form()] = None,
    save_workout: Annotated[str, Form()] = "false",
    file: Annotated[UploadFile | None, File()] = None,
) -> dict:
    """Send a message with optional FIT file. Uses multipart/form-data. When file is .fit, adds workout summary to context and optionally saves to diary."""
    uid = user.id
    run_orch = run_orchestrator.strip().lower() in ("true", "1")
    tid = int(thread_id) if (thread_id and str(thread_id).strip()) else None
    save_w = save_workout.strip().lower() in ("true", "1")

    if tid is None:
        thread = await _get_or_create_default_thread(session, uid)
        tid = thread.id
    else:
        r = await session.execute(select(ChatThread).where(ChatThread.id == tid, ChatThread.user_id == uid))
        if r.scalar_one_or_none() is None:
            raise HTTPException(status_code=404, detail="Thread not found")

    fit_summary: str | None = None
    fit_data: dict | None = None
    user_content = (message or "").strip()

    if file and file.filename and file.filename.lower().endswith(".fit"):
        content = await read_upload_bounded(file)
        if not content:
            raise HTTPException(status_code=400, detail="Empty FIT file.")
        fit_data = parse_fit_session(content)
        if not fit_data:
            raise HTTPException(status_code=400, detail="Could not parse FIT file or no session found.")
        fit_summary = fit_data_to_summary(fit_data)
        if not user_content:
            user_content = f"Приложен FIT-файл тренировки. {fit_summary[:300]}"

        if save_w and fit_data:
            await save_workout_from_fit(session, uid, fit_data, content)

    session.add(
        ChatMessage(user_id=uid, thread_id=tid, role=MessageRole.user.value, content=user_content or "(сообщение)")
    )
    await session.commit()

    reply = ""
    try:
        if run_orch:
            result = await run_daily_decision(session, uid, date.today(), locale=locale)
            reply = f"Decision: {result.decision.value}. {result.reason}"
            if result.suggestions_next_days:
                reply += f"\n\n{result.suggestions_next_days}"
        else:
            import google.generativeai as genai
            from app.config import settings
            from app.services.gemini_common import run_generate_content

            context = await _build_athlete_context(session, uid, user.is_premium)
            if fit_summary:
                context += "\n\n## Uploaded workout (this message)\n" + fit_summary
            if fit_data:
                monthly = await _get_fit_monthly_aggregates(session, uid, fit_data)
                if monthly:
                    context += "\n\n## Monthly averages (similar workouts, last 30 days)\n" + monthly
            model = genai.GenerativeModel(settings.gemini_model)
            chat_system = _chat_system_with_locale(locale, user.is_premium)
            fit_instruction = ""
            if fit_summary and fit_data:
                fit_instruction = (
                    "\n\nIf context includes monthly averages for similar workouts, compare the current workout to them "
                    "and comment on progress in power-to-heart-rate efficiency (EF) and decoupling where data allows. "
                    "Respond in the user's language."
                )
            prompt = (
                f"{chat_system}\n\nContext:\n{context}\n\n"
                f"User message: {user_content or 'Разбери приложенную тренировку.'}{fit_instruction}"
            )
            response = await run_generate_content(model, prompt)
            reply = response.text if response and response.text else "No response."
    except Exception:
        reply = "Sorry, the AI service is temporarily unavailable. Please try again."
        session.add(
            ChatMessage(user_id=uid, thread_id=tid, role=MessageRole.assistant.value, content=reply)
        )
        await session.commit()
        raise HTTPException(status_code=502, detail="AI service unavailable")

    session.add(
        ChatMessage(user_id=uid, thread_id=tid, role=MessageRole.assistant.value, content=reply)
    )
    await session.commit()
    return {"reply": reply}


@router.post(
    "/send-with-image",
    response_model=dict,
    summary="Send message with image (Premium)",
    responses={
        400: {"description": "Invalid image"},
        401: {"description": "Not authenticated"},
        403: {"description": "Premium required"},
        502: {"description": "AI service unavailable"},
    },
)
async def send_message_with_image(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(require_premium)],
    locale: Annotated[str, Depends(get_request_locale)],
    _usage: Annotated[None, Depends(check_chat_usage)],
    message: Annotated[str, Form()] = "",
    thread_id: Annotated[str | None, Form()] = None,
    file: Annotated[UploadFile | None, File()] = None,
) -> dict:
    """Send a chat message with an attached image. Premium only. Image is analyzed and description is added to context."""
    uid = user.id
    tid = int(thread_id) if (thread_id and str(thread_id).strip()) else None
    if tid is None:
        thread = await _get_or_create_default_thread(session, uid)
        tid = thread.id
    else:
        r = await session.execute(select(ChatThread).where(ChatThread.id == tid, ChatThread.user_id == uid))
        if r.scalar_one_or_none() is None:
            raise HTTPException(status_code=404, detail="Thread not found")

    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="No image file")
    image_bytes = await read_upload_bounded(file)
    _validate_chat_image(file, image_bytes)
    image_bytes = await resize_image_for_ai_async(image_bytes)
    image_description = await _describe_image_for_chat(image_bytes, locale)

    user_content = (message or "").strip() or "Что на фото? Прокомментируй."
    session.add(
        ChatMessage(user_id=uid, thread_id=tid, role=MessageRole.user.value, content=user_content)
    )
    await session.commit()

    reply = ""
    try:
        import google.generativeai as genai
        from app.config import settings
        from app.services.gemini_common import run_generate_content

        context = await _build_athlete_context(session, uid, user.is_premium)
        context += "\n\n## Photo in this message\n" + image_description
        model = genai.GenerativeModel(settings.gemini_model)
        chat_system = _chat_system_with_locale(locale, is_premium=True)
        prompt = f"{chat_system}\n\nContext:\n{context}\n\nUser message: {user_content}"
        response = await run_generate_content(model, prompt)
        reply = response.text if response and response.text else "No response."
    except Exception:
        reply = "Sorry, the AI service is temporarily unavailable. Please try again."
        session.add(
            ChatMessage(user_id=uid, thread_id=tid, role=MessageRole.assistant.value, content=reply)
        )
        await session.commit()
        raise HTTPException(status_code=502, detail="AI service unavailable")

    session.add(
        ChatMessage(user_id=uid, thread_id=tid, role=MessageRole.assistant.value, content=reply)
    )
    await session.commit()
    return {"reply": reply}


@router.post(
    "/orchestrator/run",
    response_model=dict,
    summary="Run daily orchestrator",
    responses={401: {"description": "Not authenticated"}, 502: {"description": "Orchestrator failed"}},
)
async def run_orchestrator(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    body: RunOrchestratorBody | None = Body(default=None),
) -> dict:
    """Run daily decision for today. Premium: full result; Free: decision only with is_teaser=true."""
    uid = user.id
    body = body or RunOrchestratorBody()
    locale = body.locale
    for_date = body.for_date or date.today()
    client_local_hour = body.client_local_hour
    result = await run_daily_decision(
        session, uid, today=for_date, locale=locale, client_local_hour=client_local_hour
    )
    await session.commit()
    if user.is_premium:
        return {
            "decision": result.decision.value,
            "reason": result.reason,
            "modified_plan": result.modified_plan.model_dump() if result.modified_plan else None,
            "suggestions_next_days": result.suggestions_next_days,
            "evening_tips": result.evening_tips,
            "plan_tomorrow": result.plan_tomorrow,
        }
    return {"decision": result.decision.value, "is_teaser": True}


