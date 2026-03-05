"""
Single-call Gemini: classify image as food, sleep, or wellness (RHR/HRV) and return analysis in one round-trip.
"""
from __future__ import annotations

import logging

import google.generativeai as genai
from google.generativeai.types import HarmCategory, HarmBlockThreshold
from pydantic import ValidationError

from app.config import settings
from app.schemas.nutrition import NutritionAnalysisResult
from app.schemas.photo import WellnessPhotoResult, WorkoutPhotoResult
from app.schemas.sleep_extraction import SleepExtractionResult
from app.services.gemini_common import run_generate_content

# Reuse robust JSON parsing from sleep parser for the full response (trailing commas, truncation)
from app.services.gemini_sleep_parser import _parse_sleep_json

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

SYSTEM_PROMPT = """You are an image analyzer. In ONE response you must:
1) Classify the image as "food", "sleep", "wellness", or "workout".
2) If food: fill "food" object; set others to null.
3) If sleep: fill "sleep" object; set others to null.
4) If wellness: fill "wellness" object; set others to null.
5) If workout: fill "workout" object; set others to null.

Classification:
- "food": a photo of a real meal, plate, or dish.
- "sleep": any screenshot or report showing sleep data (duration, stages, quality score, Oura/Garmin/Whoop/Apple Health/Fitbit).
- "wellness": a screenshot showing RHR (resting heart rate) and/or HRV (heart rate variability).
- "workout": a screenshot from a fitness app (Strava, Garmin, Apple Fitness, TrainingPeaks, Nike Run Club, treadmill screen, etc.) showing workout summary: time, distance, pace, calories, HR, map, TSS, etc.

Output ONLY a single JSON object with exactly these fields:
- type: string, "food" | "sleep" | "wellness" | "workout"
- food: object or null
- sleep: object or null
- wellness: object or null
- workout: object or null

When type is "food", set "food" to: { name, portion_grams, calories, protein_g, fat_g, carbs_g }. All numbers non-negative.
When type is "sleep", set "sleep" to: { date, sleep_hours, sleep_minutes, actual_sleep_hours, actual_sleep_minutes, time_in_bed_min, quality_score, score_delta, efficiency_pct, rest_min, bedtime, wake_time, sleep_periods, deep_sleep_min, rem_min, light_sleep_min, awake_min, factor_ratings, sleep_phases, latency_min, awakenings, source_app, raw_notes, rhr, hrv }. Do NOT round durations to whole hours. Use exact decimals: formula hours + minutes/60 (e.g. "6 ч 31 мин" or "6h 31m" → sleep_hours 6.52; "Фактическое время сна 6 ч 5 мин" or "Actual sleep 6h 5m" → actual_sleep_hours 6.08). The app displays actual sleep (excluding wake-ups): always extract "Фактическое время сна" / "Actual sleep" into actual_sleep_hours when visible; put total/time-in-bed in sleep_hours. Do NOT use (actual_sleep + awake) or time-in-bed as the main value. If the screenshot also shows RHR or HRV, set rhr and/or hrv in the sleep object.
When type is "wellness", set "wellness" to: { "rhr": <number or null>, "hrv": <number or null> }.
When type is "workout", set "workout" to: {
  "name": string or null (e.g. "Morning Run", "Zwift - Watopia"),
  "date": string or null (YYYY-MM-DD if visible, else null),
  "sport_type": string or null (Run, Ride, Swim, WeightTraining, Yoga, etc. infer from icon/context),
  "duration_sec": integer or null (total seconds),
  "distance_m": float or null (meters),
  "calories": float or null,
  "avg_hr": integer or null,
  "max_hr": integer or null,
  "tss": integer or null (Training Stress Score, Load, etc.),
  "notes": string or null (any other useful info like "Indoor", "Treadmill", "Intervals")
}.

Output ONLY valid JSON. No markdown."""


def _language_for_locale(locale: str) -> str:
    return {"ru": "Russian", "en": "English"}.get((locale or "ru").lower(), "Russian")


def _photo_system_prompt(locale: str, reference_date: str | None = None) -> str:
    lang = _language_for_locale(locale)
    lang_rule = (
        f"All text values in your JSON (dish name in food.name, workout name/notes, raw_notes, factor_ratings values) must be STRICTLY in {lang}. "
        "JSON keys must always be in English (e.g. name, type, food, sleep, workout); only string values may be in the user's language."
    )
    base = f"{lang_rule}\n\n{SYSTEM_PROMPT}"
    if reference_date and len(str(reference_date).strip()) >= 10:
        base += f"\n\nThe user is logging this entry for date {reference_date.strip()[:10]}. For sleep, set the 'date' field to this exact value (YYYY-MM-DD)."
    return base


async def classify_and_analyze_image(
    image_bytes: bytes,
    *,
    locale: str = "ru",
    reference_date: str | None = None,
) -> tuple[str, NutritionAnalysisResult | SleepExtractionResult | WellnessPhotoResult | WorkoutPhotoResult]:
    """
    Single Gemini call: classify image and return the analysis.
    Returns ("food", result), ("sleep", result), ("wellness", result), or ("workout", result).
    reference_date: optional YYYY-MM-DD for sleep; if set, prompt tells the model to use this date.
    """
    model = genai.GenerativeModel(
        settings.gemini_model,
        generation_config=GENERATION_CONFIG,
        safety_settings=SAFETY_SETTINGS,
    )
    part = {"mime_type": "image/jpeg", "data": image_bytes}
    contents = [_photo_system_prompt(locale, reference_date=reference_date), part]
    response = await run_generate_content(model, contents)
    if not response or not response.text:
        raise ValueError("Empty response from Gemini")
    text = response.text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    data = _parse_sleep_json(text)

    kind = (data.get("type") or "food").strip().lower()
    if kind not in ("food", "sleep", "wellness", "workout"):
        kind = "food"

    if kind == "food":
        food_payload = data.get("food")
        if not food_payload or not isinstance(food_payload, dict):
            # Fallback if model said food but returned null
            raise ValueError("Model returned type 'food' but food object is missing")
        return "food", NutritionAnalysisResult(**food_payload)

    if kind == "wellness":
        wellness_payload = data.get("wellness")
        if not wellness_payload or not isinstance(wellness_payload, dict):
            raise ValueError("Model returned type 'wellness' but wellness object is missing")
        rhr = wellness_payload.get("rhr")
        hrv = wellness_payload.get("hrv")
        return "wellness", WellnessPhotoResult(
            rhr=int(rhr) if isinstance(rhr, (int, float)) else None,
            hrv=float(hrv) if isinstance(hrv, (int, float)) else None
        )

    if kind == "workout":
        workout_payload = data.get("workout")
        if not workout_payload or not isinstance(workout_payload, dict):
            raise ValueError("Model returned type 'workout' but workout object is missing")
        return "workout", WorkoutPhotoResult(**workout_payload)

    # kind == "sleep"
    sleep_payload = data.get("sleep")
    if not sleep_payload or not isinstance(sleep_payload, dict):
        raise ValueError("Model returned type 'sleep' but sleep object is missing")
    try:
        return "sleep", SleepExtractionResult(**sleep_payload)
    except ValidationError as e:
        logging.warning("SleepExtractionResult validation failed, using safe subset: %s", e.errors())
        allowed = set(SleepExtractionResult.model_fields)
        safe = {k: v for k, v in sleep_payload.items() if k in allowed}
        try:
            return "sleep", SleepExtractionResult(**safe)
        except ValidationError:
            raise ValueError("Could not parse sleep data from image. Please try another photo.") from e
