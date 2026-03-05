"""Pydantic schemas for wellness API (user-entered data, independent of Intervals)."""

from datetime import date

from pydantic import BaseModel


class WellnessUpsertBody(BaseModel):
    """Body for creating or updating one day of wellness. Only date is required."""

    date: date
    sleep_hours: float | None = None
    rhr: float | None = None
    hrv: float | None = None
    weight_kg: float | None = None


class WellnessDayResponse(BaseModel):
    """Single day wellness as returned by the API."""

    date: date
    sleep_hours: float | None = None
    sleep_source: str | None = None  # 'manual' | 'photo' | 'sync'
    rhr: float | None = None
    hrv: float | None = None
    ctl: float | None = None
    atl: float | None = None
    tsb: float | None = None
    weight_kg: float | None = None
