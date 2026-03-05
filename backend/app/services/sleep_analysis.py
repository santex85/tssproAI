"""
Глубокий анализ сна: извлечение метрик из фото и сохранение в БД.
Объединяет парсинг (Gemini) и запись в sleep_extractions.
"""
from datetime import date as date_cls
import json
from typing import Any

from sqlalchemy import case, literal
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.models.sleep_extraction import SleepExtraction
from app.models.wellness_cache import WellnessCache
from app.schemas.sleep_extraction import SleepExtractionResult
from app.services.gemini_sleep_parser import extract_sleep_data


def _normalize_sleep_result(result: SleepExtractionResult) -> SleepExtractionResult:
    """Merge hours + minutes into decimal hours so 6 + 31 min → 6.52. Does not overwrite if already decimal."""
    updates: dict[str, Any] = {}
    h = result.sleep_hours
    m = result.sleep_minutes
    if h is not None and m is not None:
        try:
            updates["sleep_hours"] = round(float(h) + m / 60.0, 2)
        except (TypeError, ValueError):
            pass
    elif m is not None and h is None:
        updates["sleep_hours"] = round(m / 60.0, 2)
    ah = result.actual_sleep_hours
    am = result.actual_sleep_minutes
    if ah is not None and am is not None:
        try:
            updates["actual_sleep_hours"] = round(float(ah) + am / 60.0, 2)
        except (TypeError, ValueError):
            pass
    elif am is not None and ah is None:
        updates["actual_sleep_hours"] = round(am / 60.0, 2)
    if not updates:
        return result
    return result.model_copy(update=updates)


def _payload_for_storage(result: SleepExtractionResult) -> dict[str, Any]:
    """Словарь для сохранения в БД: только поля схемы, в том числе null."""
    raw = result.model_dump(mode="json")
    return {k: raw.get(k) for k in SleepExtractionResult.model_fields}


def _sleep_date_from_result(result: SleepExtractionResult) -> date_cls:
    today = date_cls.today()
    if not result.date:
        return today
    s = str(result.date).strip()
    parsed: date_cls | None = None
    # ISO YYYY-MM-DD
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        try:
            parsed = date_cls.fromisoformat(s[:10])
        except ValueError:
            pass
    if parsed is None:
        # D/M or D/M/YYYY (e.g. "26/2" or "26/2/2026")
        parts = s.replace("-", "/").split("/")
        if len(parts) >= 2:
            try:
                day = int(parts[0])
                month = int(parts[1])
                year = int(parts[2]) if len(parts) >= 3 else today.year
                if 1 <= month <= 12 and 1 <= day <= 31 and 2000 <= year <= 2100:
                    parsed = date_cls(year, month, day)
            except (ValueError, IndexError):
                pass
    if parsed is None:
        return today
    # If year is wrong (e.g. 2024 instead of 2026), use current year so "today" and history display correctly
    if parsed.year != today.year:
        try:
            return date_cls(today.year, parsed.month, parsed.day)
        except ValueError:
            return today
    return parsed


def _sleep_hours_from_result(result: SleepExtractionResult) -> float | None:
    """Use actual sleep only (never time in bed or actual+awake). Priority: actual_sleep_hours → deep+light+rem → sleep_hours-awake → sleep_hours."""
    if result.actual_sleep_hours is not None:
        try:
            return round(float(result.actual_sleep_hours), 2)
        except (TypeError, ValueError):
            pass
    deep = getattr(result, "deep_sleep_min", None)
    light = getattr(result, "light_sleep_min", None)
    rem = getattr(result, "rem_min", None)
    if deep is not None or light is not None or rem is not None:
        try:
            total_min = (float(deep or 0) + float(light or 0) + float(rem or 0))
            if 60 <= total_min <= 600:
                return round(total_min / 60.0, 2)
        except (TypeError, ValueError):
            pass
    if result.sleep_hours is not None and getattr(result, "awake_min", None) is not None:
        try:
            total_h = float(result.sleep_hours)
            awake_h = float(result.awake_min) / 60.0
            if total_h >= awake_h:
                return round(total_h - awake_h, 2)
        except (TypeError, ValueError):
            pass
    if result.sleep_hours is not None:
        try:
            return round(float(result.sleep_hours), 2)
        except (TypeError, ValueError):
            pass
    return None


def get_resolved_sleep_hours_from_data(data: dict[str, Any]) -> float | None:
    """Same logic as _sleep_hours_from_result but for raw extracted_data dict. Used by list API so dashboard shows actual sleep only."""
    ah = data.get("actual_sleep_hours")
    if ah is not None:
        try:
            return round(float(ah), 2)
        except (TypeError, ValueError):
            pass
    if ah is None and data.get("actual_sleep_minutes") is not None:
        try:
            return round(data["actual_sleep_minutes"] / 60.0, 2)
        except (TypeError, ValueError):
            pass
    deep = data.get("deep_sleep_min")
    light = data.get("light_sleep_min")
    rem = data.get("rem_min")
    if deep is not None or light is not None or rem is not None:
        try:
            total_min = (float(deep or 0) + float(light or 0) + float(rem or 0))
            if 60 <= total_min <= 600:
                return round(total_min / 60.0, 2)
        except (TypeError, ValueError):
            pass
    sh = data.get("sleep_hours")
    if sh is None and data.get("sleep_minutes") is not None:
        sh = data["sleep_minutes"] / 60.0
    awake = data.get("awake_min")
    if sh is not None and awake is not None:
        try:
            total_h = float(sh)
            awake_h = float(awake) / 60.0
            if total_h >= awake_h:
                return round(total_h - awake_h, 2)
        except (TypeError, ValueError):
            pass
    if sh is not None:
        try:
            return round(float(sh), 2)
        except (TypeError, ValueError):
            pass
    return None


def _rhr_from_result(result: SleepExtractionResult) -> float | None:
    v = getattr(result, "rhr", None)
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _hrv_from_result(result: SleepExtractionResult) -> float | None:
    v = getattr(result, "hrv", None)
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


async def _upsert_sleep_into_wellness_cache(
    session: AsyncSession,
    user_id: int,
    result: SleepExtractionResult,
) -> None:
    sleep_hours = _sleep_hours_from_result(result)
    sleep_date = _sleep_date_from_result(result)
    rhr = _rhr_from_result(result)
    hrv = _hrv_from_result(result)
    if sleep_hours is None and rhr is None and hrv is None:
        return
    values: dict[str, object] = {
        "user_id": user_id,
        "date": sleep_date,
        "sleep_hours": sleep_hours,
        "sleep_source": "photo" if sleep_hours is not None else None,
        "rhr": rhr,
        "hrv": hrv,
    }
    stmt = pg_insert(WellnessCache).values(values)
    set_: dict[str, object] = {}
    if sleep_hours is not None:
        # Do not overwrite sleep when user set it manually
        set_["sleep_hours"] = case(
            (WellnessCache.sleep_source == "manual", WellnessCache.sleep_hours),
            else_=stmt.excluded.sleep_hours,
        )
        set_["sleep_source"] = case(
            (WellnessCache.sleep_source == "manual", WellnessCache.sleep_source),
            else_=literal("photo"),
        )
    if rhr is not None:
        set_["rhr"] = stmt.excluded.rhr
    if hrv is not None:
        set_["hrv"] = stmt.excluded.hrv
    if not set_:
        return
    stmt = stmt.on_conflict_do_update(
        constraint="uq_wellness_cache_user_id_date",
        set_=set_,
    )
    await session.execute(stmt)


async def save_sleep_result(
    session: AsyncSession,
    user_id: int,
    result: SleepExtractionResult,
    image_storage_path: str | None = None,
) -> tuple[SleepExtraction, dict]:
    """
    Save already-extracted sleep result to DB (no Gemini call).
    Returns (record, extracted_data) for API response.
    """
    result = _normalize_sleep_result(result)
    stored = _payload_for_storage(result)
    stored["date"] = _sleep_date_from_result(result).isoformat()
    record = SleepExtraction(
        user_id=user_id,
        extracted_data=json.dumps(stored, ensure_ascii=False),
        image_storage_path=image_storage_path,
    )
    session.add(record)
    await _upsert_sleep_into_wellness_cache(session, user_id, result)
    await session.flush()
    data = json.loads(record.extracted_data)
    return record, data


async def update_sleep_extraction_result(
    session: AsyncSession,
    user_id: int,
    record: SleepExtraction,
    result: SleepExtractionResult,
) -> dict:
    """Update existing SleepExtraction with new result and refresh wellness cache. Returns extracted_data for response."""
    result = _normalize_sleep_result(result)
    stored = _payload_for_storage(result)
    stored["date"] = _sleep_date_from_result(result).isoformat()
    record.extracted_data = json.dumps(stored, ensure_ascii=False)
    await _upsert_sleep_into_wellness_cache(session, user_id, result)
    await session.flush()
    return stored


async def analyze_and_save_sleep(
    session: AsyncSession,
    user_id: int,
    image_bytes: bytes,
    mode: str = "lite",
    image_storage_path: str | None = None,
    locale: str = "ru",
) -> tuple[SleepExtraction, dict]:
    """
    Глубокий анализ фото сна: извлечение метрик (Gemini), сохранение в sleep_extractions,
    возврат записи и extracted_data для ответа API. mode: 'lite' (default) or 'full'.
    """
    result = await extract_sleep_data(image_bytes, mode=mode, locale=locale)
    return await save_sleep_result(session, user_id, result, image_storage_path=image_storage_path)
