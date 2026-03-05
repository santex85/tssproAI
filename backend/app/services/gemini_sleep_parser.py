"""
Extract sleep metrics from image (screenshot/chart) using Gemini.
"""
import json
import logging
import re

import google.generativeai as genai
from google.generativeai.types import HarmCategory, HarmBlockThreshold

from app.config import settings
from app.schemas.sleep_extraction import SleepExtractionResult
from app.services.gemini_common import run_generate_content

GENERATION_CONFIG = {
    "temperature": 0.2,
    "top_p": 0.95,
    "max_output_tokens": 4096,
    "response_mime_type": "application/json",
}

SAFETY_SETTINGS = {
    HarmCategory.HARM_CATEGORY_HARASSMENT: HarmBlockThreshold.BLOCK_NONE,
    HarmCategory.HARM_CATEGORY_HATE_SPEECH: HarmBlockThreshold.BLOCK_NONE,
    HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_NONE,
    HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_NONE,
}

SLEEP_EXTRACT_PROMPT_LITE = """You are a sleep data extraction system. This image is a screenshot from a sleep tracker. Interface can be in any language. Extract only the main metrics. Never round to whole hours: use exact decimals. Examples: "6 ч 31 мин" or "6h 31m" → sleep_hours 6.52; "6 ч 5 мин" or "Фактическое время сна 6 ч 5 мин" → actual_sleep_hours 6.08. Formula: hours + minutes/60. Prefer null over guessing — if you cannot read a value, omit it or set null.

IMPORTANT: The app displays "actual sleep" (time truly asleep, excluding wake-ups). Always extract "Фактическое время сна" / "Actual sleep" / the metric that excludes awakenings into actual_sleep_hours. If the screenshot shows both total "Время сна" (time in bed or total) and "Фактическое время сна", put the former in sleep_hours and the latter in actual_sleep_hours. Do NOT put (actual_sleep + awake_min) or time-in-bed as the main value.

Return a JSON object with only these optional fields (null for missing):
- date: string YYYY-MM-DD
- sleep_hours, actual_sleep_hours: numbers (exact decimals, e.g. 6.52 not 6); prefer actual_sleep_hours for the metric that excludes wake time
- quality_score: number 0-100
- bedtime, wake_time: "HH:MM"
- deep_sleep_min, rem_min, light_sleep_min, awake_min: minutes (optional, from phases if visible)

Output ONLY valid JSON, no markdown."""

SLEEP_EXTRACT_PROMPT = """You are a sleep data extraction system. This image is a screenshot from a sleep tracker (e.g. Russian: Сон, Время сна, Показатель сна, Фазы сна, Факторы влияющие на показатели сна). Interface can be in any language. Extract EVERY number, label, and graph. Never round to whole hours: use exact decimals. Examples: "Время сна 6 ч 31 мин" → sleep_hours 6.52; "Фактическое время сна 6 ч 5 мин" → actual_sleep_hours 6.08. Formula: hours + minutes/60. Prefer null over guessing — if you cannot read a value, omit it or set null.

IMPORTANT: The app uses "actual sleep" (time truly asleep, excluding wake-ups). Always put "Фактическое время сна" / "Actual sleep" into actual_sleep_hours. If the UI shows both a total (e.g. "Время сна" / time in bed) and "Фактическое время сна", put the former in sleep_hours and the latter in actual_sleep_hours. Do NOT use (actual_sleep + awake_min) or time-in-bed as the main display value.

Return a JSON object with only these optional fields (null for missing):

Basic:
- date: string YYYY-MM-DD ("23/2" → current year 02-23)
- sleep_hours, sleep_minutes: total from "Время сна" or time in bed (exact decimal for hours, e.g. 6.52)
- actual_sleep_hours, actual_sleep_minutes: "Фактическое время сна" / actual sleep time excluding awakenings (exact decimal) — always extract this when the screenshot shows it
- time_in_bed_min: total time in bed, minutes
- quality_score: number 0-100 (main score e.g. 54)
- score_delta: number (change vs previous, e.g. 27 or -27 if shown next to score)
- efficiency_pct, rest_min
- bedtime, wake_time: "HH:MM"
- sleep_periods: array of strings, e.g. ["22:47 - 04:23", "04:54 - 07:12"] — every time range shown for sleep

Phases (from numbers or from "Фазы сна" graph — estimate minutes from bar lengths: dark blue=deep, light blue/cyan=REM, orange=awake, other=light):
- deep_sleep_min, rem_min, light_sleep_min, awake_min: minutes for each phase. If the graph has no numbers, estimate from the visual bar lengths (e.g. dark blue ~1/3 of total → deep_sleep_min ≈ total_min/3).

Factors section ("Факторы, влияющие на показатели сна"): for each row, record the rating label into factor_ratings:
- factor_ratings: object. Keys (use English): actual_sleep_time, deep_sleep, rem_sleep, rest, latency. Values: the exact label from the image (e.g. "Внимание", "Удовлетворительно", "Хорошо", "Отлично"). Example: {"actual_sleep_time": "Внимание", "deep_sleep": "Удовлетворительно", "rem_sleep": "Внимание", "rest": "Хорошо", "latency": "Отлично"}.

Optional timeline from "Фазы сна" graph (estimate segment boundaries from the horizontal bars):
- sleep_phases: array of objects [{"start":"HH:MM","end":"HH:MM","phase":"deep"|"rem"|"light"|"awake"}, ...]. Order by time. Estimate start/end from the graph axis (e.g. 22:40 to 04:30). Include as many segments as you can distinguish.

Other:
- latency_min, awakenings
- source_app, raw_notes (any comment under score, e.g. "1 период короткого сна...")

Blood oxygen ("Кислород в крови"): if the screenshot shows SpO2 / blood oxygen graph or numbers:
- spo2_avg, spo2_min, spo2_max: numbers 0-100 (average, minimum, maximum % if visible).

Rules: No rounding. Fill factor_ratings from the factors section; fill phase minutes from graph or text; add sleep_phases timeline if you can estimate segments. Prefer null over guessing. Output ONLY valid JSON, no markdown."""


def _language_for_locale(locale: str) -> str:
    return {"ru": "Russian", "en": "English"}.get((locale or "ru").lower(), "Russian")


def _sleep_prompt_with_locale(base_prompt: str, locale: str) -> str:
    lang = _language_for_locale(locale)
    lang_rule = (
        f"JSON keys must always be in English (e.g. sleep_hours, factor_ratings, raw_notes). "
        f"Text values (e.g. factor_ratings values, raw_notes) must be in {lang}."
    )
    return f"{lang_rule}\n\n{base_prompt}"


async def extract_sleep_data(
    image_bytes: bytes,
    mode: str = "lite",
    user_correction: str | None = None,
    locale: str = "ru",
) -> SleepExtractionResult:
    """Parse image and return structured sleep extraction result. mode: 'lite' (default) or 'full'."""
    base = SLEEP_EXTRACT_PROMPT_LITE if mode == "lite" else SLEEP_EXTRACT_PROMPT
    prompt = _sleep_prompt_with_locale(base, locale)
    if user_correction:
        correction_line = (
            f'User correction: {user_correction}\n\n'
            "Re-extract sleep data from the image taking this correction into account.\n\n"
        )
        prompt = correction_line + prompt
    model = genai.GenerativeModel(
        settings.gemini_model,
        generation_config=GENERATION_CONFIG,
        safety_settings=SAFETY_SETTINGS,
    )
    part = {"mime_type": "image/jpeg", "data": image_bytes}
    contents = [prompt, part]
    response = await run_generate_content(model, contents)
    if not response or not response.text:
        raise ValueError("Empty response from Gemini")
    text = response.text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    data = _parse_sleep_json(text)
    return SleepExtractionResult(**data)


def _parse_sleep_json(text: str) -> dict:
    """Parse JSON from Gemini, tolerating trailing commas and minor truncation."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Remove trailing comma before } or ]
    fixed = re.sub(r",\s*([}\]])", r"\1", text)
    try:
        return json.loads(fixed)
    except json.JSONDecodeError:
        pass
    # If truncated (unterminated string or missing brace), try closing
    trimmed = text.rstrip()
    for suffix in ['" }', " null}", "}", " }"]:
        try:
            return json.loads(trimmed.rstrip(",").rstrip() + suffix)
        except json.JSONDecodeError:
            continue
    logging.warning("gemini_sleep_parser: invalid JSON from Gemini (first 500 chars): %s", text[:500])
    raise ValueError("Could not parse sleep data from image. Please try another photo.")
