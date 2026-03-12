"""
Intervals.icu API client: wellness, activities, events (GET/POST/PUT).
Auth: API Key (Athlete ID + API Key). Caller must pass decrypted key.
"""
import logging
from datetime import date, datetime
from typing import Any

import httpx

from app.config import settings
from app.services.http_client import get_http_client
from app.schemas.intervals import Activity, Event, EventCreate, WellnessDay


BASE_URL = settings.intervals_icu_base_url.rstrip("/")
logger = logging.getLogger(__name__)


def _normalize_athlete_id(athlete_id: str) -> str:
    """Use athlete id as-is (Intervals.icu accepts both i471411 and 471411 in URL)."""
    return (athlete_id or "").strip()


def _to_float(v: Any) -> float | None:
    """Coerce API value to float (handles int, float, numeric string)."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        try:
            return float(v.strip().replace(",", "."))
        except (ValueError, TypeError):
            return None
    return None


def _parse_date(s: str | None) -> date | None:
    """Parse date from API (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss...)."""
    if not s or not isinstance(s, str):
        return None
    s = s.strip()
    if not s:
        return None
    # Take date part only (first 10 chars) if string contains time
    if "T" in s or " " in s:
        s = s[:10]
    try:
        return date.fromisoformat(s)
    except (ValueError, TypeError):
        return None


def _basic_auth(api_key: str) -> tuple[str, str]:
    """Intervals.icu: Basic Auth — username API_KEY, password = API key (per forum/docs)."""
    return ("API_KEY", api_key)


def _auth_kwargs(api_key: str, use_bearer: bool = False) -> dict:
    """Return auth kwargs for httpx: Bearer for OAuth tokens, Basic for API keys."""
    if use_bearer:
        return {"headers": {"Authorization": f"Bearer {api_key}"}}
    return {"auth": _basic_auth(api_key)}


def _log_response_error(method: str, url: str, response: httpx.Response) -> None:
    """Log HTTP error without sensitive data."""
    body = (response.text or "")[:500]
    logger.warning(
        "Intervals.icu %s %s -> %s body=%s",
        method,
        url,
        response.status_code,
        body,
    )


async def validate_credentials(athlete_id: str, api_key: str, use_bearer: bool = False) -> bool:
    """Validate Intervals.icu credentials by making a minimal API call.
    Returns True if credentials are valid, False if 401/403/4xx/5xx.
    Raises httpx.RequestError on network/timeout errors (caller should map to 503).
    use_bearer: True for OAuth tokens, False for API keys.
    """
    athlete_id = _normalize_athlete_id(athlete_id)
    client = get_http_client()
    url = f"{BASE_URL}/athlete/{athlete_id}/wellness"
    today = date.today()
    params = {"oldest": today.isoformat(), "newest": today.isoformat()}
    timeout = 10
    r = await client.get(url, params=params, timeout=timeout, **_auth_kwargs(api_key, use_bearer))
    if r.status_code == 200:
        return True
    _log_response_error("GET", url, r)
    return False


async def get_wellness(
    athlete_id: str,
    api_key: str,
    oldest: date,
    newest: date,
    use_bearer: bool = False,
) -> list[WellnessDay]:
    """GET wellness data for date range. Returns list of WellnessDay."""
    athlete_id = _normalize_athlete_id(athlete_id)
    client = get_http_client()
    url = f"{BASE_URL}/athlete/{athlete_id}/wellness"
    params = {"oldest": oldest.isoformat(), "newest": newest.isoformat()}
    timeout = settings.intervals_sync_timeout_seconds
    r = await client.get(url, params=params, timeout=timeout, **_auth_kwargs(api_key, use_bearer))
    if r.status_code >= 400:
        _log_response_error("GET", url, r)
    r.raise_for_status()
    data = r.json() if r.content else []
    if not isinstance(data, list):
        data = [data] if data else []
    out: list[WellnessDay] = []
    for item in data:
        if isinstance(item, dict):
            # API returns date as "id" (e.g. "2026-02-09") or date/localDate
            d = item.get("date") or item.get("localDate") or item.get("id")
            day = _parse_date(str(d) if d is not None else None) if d is not None else None
            sleep_val = item.get("sleepDuration") or item.get("sleep_hours")
            if sleep_val is None and isinstance(item.get("sleepSecs"), (int, float)):
                sleep_val = item["sleepSecs"] / 3600.0
            rhr_val = item.get("restingHeartRate") or item.get("rhr") or item.get("restingHR")
            # Intervals.icu may return ctl/atl/tsb at top level or inside nested load/fitness object
            def _get_load(key: str) -> Any:
                for nest in ("load", "fitness", "trainingLoad", "icuLoad"):
                    obj = item.get(nest)
                    if isinstance(obj, dict):
                        v = obj.get(key)
                        if v is not None:
                            return v
                return None
            ctl_val = (
                item.get("ctl") or item.get("icu_ctl") or item.get("ctlLoad") or item.get("fitness")
                or _get_load("ctl")
            )
            atl_val = (
                item.get("atl") or item.get("icu_atl") or item.get("atlLoad") or item.get("fatigue")
                or _get_load("atl")
            )
            tsb_val = (
                item.get("tsb") or item.get("trainingStressBalance") or item.get("form")
                or _get_load("tsb")
            )
            if tsb_val is None and ctl_val is not None and atl_val is not None:
                tsb_val = float(ctl_val) - float(atl_val)
            if (ctl_val is None or atl_val is None) and (sleep_val is not None or rhr_val is not None):
                logger.debug(
                    "Intervals wellness day %s: sleep/rhr present but ctl/atl missing; keys=%s",
                    day,
                    list(item.keys()) if isinstance(item, dict) else [],
                )
            weight_val = item.get("weight")
            sport_info_raw = item.get("sportInfo")
            sport_info = sport_info_raw if isinstance(sport_info_raw, list) else None
            ctl_f = _to_float(ctl_val)
            atl_f = _to_float(atl_val)
            tsb_f = _to_float(tsb_val) if tsb_val is not None else (ctl_f - atl_f if (ctl_f is not None and atl_f is not None) else None)
            out.append(
                WellnessDay(
                    date=day or oldest,
                    sleep_hours=float(sleep_val) if isinstance(sleep_val, (int, float)) else None,
                    rhr=int(rhr_val) if isinstance(rhr_val, (int, float)) else None,
                    hrv=item.get("hrv") or item.get("hrvSDNN"),
                    ctl=ctl_f,
                    atl=atl_f,
                    tsb=tsb_f,
                    weight_kg=_to_float(weight_val) if weight_val is not None else None,
                    sport_info=sport_info,
                    raw=item,
                )
            )
    return out


async def get_activities(
    athlete_id: str,
    api_key: str,
    oldest: date,
    newest: date,
    limit: int = 100,
    use_bearer: bool = False,
) -> list[Activity]:
    """GET completed activities (workouts) in date range."""
    athlete_id = _normalize_athlete_id(athlete_id)
    client = get_http_client()
    url = f"{BASE_URL}/athlete/{athlete_id}/activities"
    params = {
        "oldest": oldest.isoformat(),
        "newest": newest.isoformat(),
        "limit": limit,
        "fields": "id,name,start_date_local,type,distance,moving_time,icu_training_load",
    }
    timeout = settings.intervals_sync_timeout_seconds
    r = await client.get(url, params=params, timeout=timeout, **_auth_kwargs(api_key, use_bearer))
    if r.status_code >= 400:
        _log_response_error("GET", url, r)
    r.raise_for_status()
    data = r.json() if r.content else []
    if not isinstance(data, list):
        data = [data] if data else []
    def _normalize_activity_id(raw_id: Any) -> str:
        """Canonical string id so 123, 123.0, '123' all become '123' (avoids duplicate rows)."""
        if raw_id is None:
            return ""
        if isinstance(raw_id, (int, float)):
            try:
                return str(int(float(raw_id)))
            except (ValueError, OverflowError):
                return str(raw_id)
        return str(raw_id).strip()

    out: list[Activity] = []
    for item in data:
        if isinstance(item, dict):
            sid = _normalize_activity_id(item.get("id"))
            start_raw = (
                item.get("start_date")
                or item.get("startDate")
                or item.get("start_date_local")
                or item.get("startDateLocal")
            )
            start = None
            if isinstance(start_raw, str):
                try:
                    start = datetime.fromisoformat(start_raw.replace("Z", "+00:00"))
                except Exception:
                    start = None
            out.append(
                Activity(
                    id=sid,
                    name=item.get("name") or item.get("title"),
                    start_date=start,
                    icu_training_load=item.get("icu_training_load") or item.get("training_load") or item.get("tss"),
                    icu_ctl=item.get("icu_ctl") or item.get("ctl"),
                    icu_atl=item.get("icu_atl") or item.get("atl"),
                    raw=item,
                )
            )
    return out


async def get_activity_single(api_key: str, activity_id: str, use_bearer: bool = False) -> dict | None:
    """GET single activity by id for full details (name, distance, moving_time, icu_training_load)."""
    client = get_http_client()
    url = f"{BASE_URL}/activity/{activity_id}"
    r = await client.get(url, **_auth_kwargs(api_key, use_bearer))
    if r.status_code >= 400:
        _log_response_error("GET", url, r)
    r.raise_for_status()
    return r.json() if r.content else None


async def get_events(
    athlete_id: str,
    api_key: str,
    oldest: date,
    newest: date,
    use_bearer: bool = False,
) -> list[Event]:
    """GET planned events (workouts) in date range."""
    athlete_id = _normalize_athlete_id(athlete_id)
    client = get_http_client()
    url = f"{BASE_URL}/athlete/{athlete_id}/events"
    params = {"oldest": oldest.isoformat(), "newest": newest.isoformat()}
    r = await client.get(url, params=params, **_auth_kwargs(api_key, use_bearer))
    if r.status_code >= 400:
        _log_response_error("GET", url, r)
    r.raise_for_status()
    data = r.json() if r.content else []
    if not isinstance(data, list):
        data = [data] if data else []
    out: list[Event] = []
    for item in data:
        if isinstance(item, dict):
            sid = str(item.get("id", ""))
            start = item.get("start_date") or item.get("startDate")
            end = item.get("end_date") or item.get("endDate")
            if isinstance(start, str):
                try:
                    start = datetime.fromisoformat(start.replace("Z", "+00:00"))
                except Exception:
                    start = None
            if isinstance(end, str):
                try:
                    end = datetime.fromisoformat(end.replace("Z", "+00:00"))
                except Exception:
                    end = None
            out.append(
                Event(
                    id=sid,
                    start_date=start,
                    end_date=end,
                    title=item.get("title") or item.get("name"),
                    type=item.get("type", "workout"),
                    raw=item,
                )
            )
    return out


async def create_event(
    athlete_id: str,
    api_key: str,
    payload: EventCreate | dict[str, Any],
    use_bearer: bool = False,
) -> Event:
    """POST new event (planned workout)."""
    athlete_id = _normalize_athlete_id(athlete_id)
    if isinstance(payload, EventCreate):
        body = {
            "title": payload.title,
            "start_date": payload.start_date.isoformat(),
            "type": payload.type,
        }
        if payload.end_date:
            body["end_date"] = payload.end_date.isoformat()
        if payload.description:
            body["description"] = payload.description
        if payload.raw:
            body.update(payload.raw)
    else:
        body = payload
    client = get_http_client()
    url = f"{BASE_URL}/athlete/{athlete_id}/events"
    r = await client.post(url, json=body, **_auth_kwargs(api_key, use_bearer))
    r.raise_for_status()
    data = r.json() if r.content else {}
    return Event(
        id=str(data.get("id", "")),
        start_date=datetime.fromisoformat(data["start_date"].replace("Z", "+00:00")) if data.get("start_date") else None,
        end_date=datetime.fromisoformat(data["end_date"].replace("Z", "+00:00")) if data.get("end_date") else None,
        title=data.get("title"),
        type=data.get("type", "workout"),
        raw=data,
    )


async def update_event(
    athlete_id: str,
    api_key: str,
    event_id: str,
    payload: EventCreate | dict[str, Any],
    use_bearer: bool = False,
) -> Event:
    """PUT update existing event."""
    athlete_id = _normalize_athlete_id(athlete_id)
    if isinstance(payload, EventCreate):
        body = {
            "title": payload.title,
            "start_date": payload.start_date.isoformat(),
            "type": payload.type,
        }
        if payload.end_date:
            body["end_date"] = payload.end_date.isoformat()
        if payload.description:
            body["description"] = payload.description
        if payload.raw:
            body.update(payload.raw)
    else:
        body = payload
    client = get_http_client()
    url = f"{BASE_URL}/athlete/{athlete_id}/events/{event_id}"
    r = await client.put(url, json=body, **_auth_kwargs(api_key, use_bearer))
    r.raise_for_status()
    data = r.json() if r.content else {}
    return Event(
        id=str(data.get("id", event_id)),
        start_date=datetime.fromisoformat(data["start_date"].replace("Z", "+00:00")) if data.get("start_date") else None,
        end_date=datetime.fromisoformat(data["end_date"].replace("Z", "+00:00")) if data.get("end_date") else None,
        title=data.get("title"),
        type=data.get("type", "workout"),
        raw=data,
    )
