"""
Shared helpers for formatting current date/time in Gemini prompts.
Unified format: "YYYY-MM-DD, HH:MM. Timezone: {tz}."
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo


def parse_client_now(client_now_str: str | None) -> datetime | None:
    """Parse client_now (ISO 8601 UTC). Return None if missing, invalid, or outside [-24h, +5min] from server UTC."""
    if not client_now_str or not client_now_str.strip():
        return None
    try:
        dt = datetime.fromisoformat(client_now_str.strip().replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        else:
            dt = dt.astimezone(timezone.utc)
        server_now = datetime.now(timezone.utc)
        delta = dt - server_now
        if delta < timedelta(hours=-24) or delta > timedelta(minutes=5):
            return None
        return dt
    except (ValueError, TypeError):
        return None


def format_current_datetime_for_prompt(
    client_now_utc: datetime | None,
    user_tz: str | None,
    label: str = "athlete's local",
) -> str:
    """Format 'Current date and time ({label})' block for the prompt. Uses client_now if valid, else server now."""
    tz_str = (user_tz or "").strip() or "UTC"
    try:
        tz = ZoneInfo(tz_str)
    except Exception:
        tz = timezone.utc
    if client_now_utc is not None:
        now_local = client_now_utc.astimezone(tz)
    else:
        now_local = datetime.now(tz)
    date_str = now_local.strftime("%Y-%m-%d")
    time_str = now_local.strftime("%H:%M")
    return f"## Current date and time ({label})\n{date_str}, {time_str}. Timezone: {tz_str}."
