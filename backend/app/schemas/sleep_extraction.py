from typing import Any

from pydantic import BaseModel, Field, field_validator


class SleepPhaseSegment(BaseModel):
    """Один сегмент графика фаз сна: начало, конец, тип фазы."""
    start: str  # HH:MM
    end: str    # HH:MM
    phase: str  # deep | rem | light | awake


class SleepExtractionResult(BaseModel):
    """Structured result from Gemini sleep image parsing. All fields optional."""

    # Дата и общая длительность
    date: str | None = Field(None, description="Sleep date YYYY-MM-DD")
    sleep_hours: float | None = Field(None, ge=0, le=24, description="Total sleep, exact decimal (e.g. 7.9 for 7h54m)")
    sleep_minutes: int | None = Field(None, ge=0, le=1440)
    actual_sleep_hours: float | None = Field(None, ge=0, le=24, description="Actual sleep time (excl. awakenings)")
    actual_sleep_minutes: int | None = Field(None, ge=0, le=1440)
    time_in_bed_min: int | None = Field(None, ge=0, le=1440)

    # Оценка и эффективность
    quality_score: float | None = Field(None, ge=0, le=100)
    score_delta: int | None = Field(None, description="Change vs previous score, e.g. +27 or -27")
    efficiency_pct: float | None = Field(None, ge=0, le=100)
    rest_min: int | None = Field(None, ge=0, le=600, description="Rest/восстановление в минутах")

    # Фазы сна (в минутах) — из графика «Фазы сна» или из текста
    deep_sleep_min: int | None = Field(None, ge=0, le=600)
    rem_min: int | None = Field(None, ge=0, le=600)
    light_sleep_min: int | None = Field(None, ge=0, le=600)
    awake_min: int | None = Field(None, ge=0, le=120, description="Время бодрствования ночью")

    # Факторы с оценками: «Факторы, влияющие на показатели сна» (Внимание, Удовлетворительно, Хорошо, Отлично)
    factor_ratings: dict[str, str] | None = Field(
        None,
        description='e.g. {"actual_sleep_time": "Внимание", "deep_sleep": "Удовлетворительно", "rem_sleep": "Внимание", "rest": "Хорошо", "latency": "Отлично"}',
    )

    @field_validator("factor_ratings", mode="before")
    @classmethod
    def coerce_factor_ratings(cls, v: object) -> dict[str, str] | None:
        """Accept dict or None; if Gemini returns a string (e.g. free text), use None."""
        if v is None:
            return None
        if isinstance(v, dict):
            return v
        if isinstance(v, str):
            return None
        return None

    @field_validator("sleep_phases", mode="before")
    @classmethod
    def coerce_sleep_phases(cls, v: object) -> list[dict[str, Any]] | None:
        """Accept list of dicts only; if Gemini returns a string (e.g. full text block), use None."""
        if v is None:
            return None
        if isinstance(v, list) and all(isinstance(x, dict) for x in v):
            return v
        return None

    @field_validator("sleep_periods", mode="before")
    @classmethod
    def coerce_sleep_periods(cls, v: object) -> list[str] | None:
        """Accept list of strings only; if Gemini returns count (int), use None."""
        if v is None:
            return None
        if isinstance(v, list) and all(isinstance(x, str) for x in v):
            return v
        return None

    # Таймлайн фаз из графика: сегменты по времени (оценка по длине полос)
    sleep_phases: list[dict[str, Any]] | None = Field(
        None,
        description='[{"start":"22:47","end":"23:10","phase":"light"},{"start":"23:10","end":"01:00","phase":"deep"},...]',
    )

    # Засыпание и пробуждения
    latency_min: int | None = Field(None, ge=0, le=180, description="Time to fall asleep")
    awakenings: int | None = Field(None, ge=0, le=100)

    # Время отхода/подъёма (HH:MM)
    bedtime: str | None = Field(None, max_length=8)
    wake_time: str | None = Field(None, max_length=8)
    # Несколько периодов сна, если указаны (напр. 22:47-04:23 и 04:54-07:12)
    sleep_periods: list[str] | None = Field(None, description='e.g. ["22:47 - 04:23", "04:54 - 07:12"]')

    # RHR / HRV если есть на скриншоте (часы сна + пульс покоя / HRV)
    rhr: int | float | None = Field(None, description="Resting heart rate from sleep/wellness screenshot")
    hrv: int | float | None = Field(None, description="Heart rate variability from sleep/wellness screenshot")

    @field_validator("rhr", "hrv", mode="before")
    @classmethod
    def coerce_numeric(cls, v: object) -> int | float | None:
        """Accept int, float, or numeric string from AI output."""
        if v is None:
            return None
        if isinstance(v, (int, float)):
            return v
        if isinstance(v, str):
            s = v.strip()
            if not s:
                return None
            try:
                if "." in s:
                    return float(s)
                return int(s)
            except ValueError:
                return None
        return None

    source_app: str | None = Field(None, max_length=256)
    raw_notes: str | None = Field(None, max_length=2048)

    # Blood oxygen ("Кислород в крови") from screenshot if visible
    spo2_avg: float | None = Field(None, ge=0, le=100, description="Average SpO2 %")
    spo2_min: float | None = Field(None, ge=0, le=100, description="Minimum SpO2 %")
    spo2_max: float | None = Field(None, ge=0, le=100, description="Maximum SpO2 %")

    @field_validator("spo2_avg", "spo2_min", "spo2_max", mode="before")
    @classmethod
    def coerce_spo2(cls, v: object) -> float | None:
        if v is None:
            return None
        if isinstance(v, (int, float)):
            return float(v)
        if isinstance(v, str):
            try:
                return float(v.strip())
            except ValueError:
                return None
        return None


class SleepReanalyzeRequest(BaseModel):
    """Body for POST /photo/sleep-extractions/{id}/reanalyze (premium)."""

    correction: str = Field(..., min_length=1, max_length=512)


class SleepExtractionResponse(BaseModel):
    id: int
    extracted_data: dict
    created_at: str
