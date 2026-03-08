"""Tests for orchestrator helpers: _normalize_decision, _parse_llm_response, _build_system_prompt, _build_context, _get_response_schema."""

import json
import pytest

from app.schemas.orchestrator import Decision
from app.services.orchestrator import (
    _build_context,
    _build_system_prompt,
    _get_response_schema,
    _normalize_decision,
    _parse_llm_response,
)


@pytest.mark.parametrize("raw,expected", [
    ("go", Decision.GO),
    ("Go", Decision.GO),
    ("GO", Decision.GO),
    ("modify", Decision.MODIFY),
    ("Modify", Decision.MODIFY),
    ("skip", Decision.SKIP),
    ("Skip", Decision.SKIP),
    ("", Decision.GO),
    (None, Decision.GO),
    ("unknown", Decision.GO),
])
def test_normalize_decision(raw, expected):
    """Decision string is normalized to enum; unknown defaults to Go."""
    assert _normalize_decision(raw) == expected


def test_parse_llm_response_go():
    """Valid JSON with decision Go is parsed."""
    text = '{"decision": "Go", "reason": "All good.", "modified_plan": null, "suggestions_next_days": null}'
    r = _parse_llm_response(text)
    assert r.decision == Decision.GO
    assert r.reason == "All good."
    assert r.modified_plan is None
    assert r.suggestions_next_days is None


def test_parse_llm_response_skip():
    """Valid JSON with decision Skip is parsed."""
    text = '{"decision": "Skip", "reason": "Poor sleep.", "modified_plan": null, "suggestions_next_days": "Rest."}'
    r = _parse_llm_response(text)
    assert r.decision == Decision.SKIP
    assert r.reason == "Poor sleep."
    assert r.suggestions_next_days == "Rest."


def test_parse_llm_response_strips_code_fence():
    """Response wrapped in ```json ... ``` is unwrapped."""
    text = '```json\n{"decision": "Modify", "reason": "Reduce load.", "modified_plan": null, "suggestions_next_days": null}\n```'
    r = _parse_llm_response(text)
    assert r.decision == Decision.MODIFY
    assert r.reason == "Reduce load."


def test_parse_llm_response_truncates_long_reason():
    """Reason longer than 1000 chars is truncated."""
    long_reason = "x" * 1500
    text = f'{{"decision": "Go", "reason": "{long_reason}", "modified_plan": null, "suggestions_next_days": null}}'
    r = _parse_llm_response(text)
    assert len(r.reason) == 1000
    assert r.reason == "x" * 1000


def test_parse_llm_response_modified_plan_valid():
    """Valid modified_plan object is parsed."""
    text = '{"decision": "Modify", "reason": "OK", "modified_plan": {"title": "Easy run", "start_date": "2026-02-25T08:00:00", "end_date": null, "description": "30 min"}, "suggestions_next_days": null}'
    r = _parse_llm_response(text)
    assert r.modified_plan is not None
    assert r.modified_plan.title == "Easy run"
    assert r.modified_plan.start_date == "2026-02-25T08:00:00"


def test_build_system_prompt_morning_includes_no_deficit_rule():
    """When client_local_hour is 8 (morning), prompt tells model not to infer deficit from food log."""
    prompt = _build_system_prompt("ru", had_workout_today=False, is_evening=False, client_local_hour=8)
    assert "do NOT infer calorie deficit" in prompt or "do not infer" in prompt.lower()
    assert "morning" in prompt.lower() or "hour <=" in prompt or "hour <= 10" in prompt
    assert "suggest" in prompt.lower() and "nutrition" in prompt.lower()


def test_build_system_prompt_day_includes_shortfall_advice():
    """When client_local_hour is 14 (day), prompt includes shortfall and add kcal by evening."""
    prompt = _build_system_prompt("ru", had_workout_today=False, is_evening=False, client_local_hour=14)
    assert "hour" in prompt.lower()
    assert "evening" in prompt.lower() or "add" in prompt.lower() or "kcal" in prompt.lower() or "shortfall" in prompt.lower()


def test_build_system_prompt_evening_includes_plan_tomorrow():
    """When client_local_hour is 20 (evening), prompt asks for evening_tips and plan_tomorrow."""
    prompt = _build_system_prompt("ru", had_workout_today=False, is_evening=True, client_local_hour=20)
    assert "evening_tips" in prompt or "plan_tomorrow" in prompt
    assert "Russian" in prompt or "ru" in prompt.lower()


def test_build_context_includes_current_local_hour():
    """Context includes current local hour block when provided."""
    ctx = _build_context(
        {"calories": 0, "protein_g": 0, "fat_g": 0, "carbs_g": 0},
        {},
        [],
        None,
        current_local_hour=14,
    )
    assert "## Current local hour" in ctx
    assert "14" in ctx


def test_build_context_hour_not_provided():
    """Context shows 'not provided' when current_local_hour is None."""
    ctx = _build_context(
        {"calories": 0, "protein_g": 0, "fat_g": 0, "carbs_g": 0},
        {},
        [],
        None,
        current_local_hour=None,
    )
    assert "## Current local hour" in ctx
    assert "not provided" in ctx


# --- _get_response_schema: Gemini protobuf compatibility ---


def test_get_response_schema_no_defs_refs():
    """Schema contains no $defs or $ref (Gemini does not support them)."""
    schema = _get_response_schema()
    schema_str = json.dumps(schema)
    assert "$defs" not in schema_str
    assert "$ref" not in schema_str


def test_get_response_schema_no_maxlength():
    """Schema contains no maxLength (Gemini protobuf does not support it)."""
    schema = _get_response_schema()
    assert "maxLength" not in json.dumps(schema)


def test_get_response_schema_no_anyof():
    """Schema contains no anyOf (Gemini protobuf does not support it)."""
    schema = _get_response_schema()
    assert "anyOf" not in json.dumps(schema)


def test_get_response_schema_no_additional_properties():
    """Schema contains no additionalProperties (Gemini protobuf does not support it)."""
    schema = _get_response_schema()
    assert "additionalProperties" not in json.dumps(schema)


def test_get_response_schema_nullable_for_optional_fields():
    """Optional fields are represented with nullable: true."""
    schema = _get_response_schema()
    props = schema.get("properties", {})
    assert props.get("modified_plan", {}).get("nullable") is True
    assert props.get("suggestions_next_days", {}).get("nullable") is True
    assert props.get("evening_tips", {}).get("nullable") is True
    assert props.get("plan_tomorrow", {}).get("nullable") is True


def test_get_response_schema_modified_plan_has_title():
    """ModifiedPlanItem schema preserves the title property."""
    schema = _get_response_schema()
    mp = schema.get("properties", {}).get("modified_plan", {})
    mp_props = mp.get("properties", {})
    assert "title" in mp_props
    assert mp_props["title"].get("type") == "string"


def test_get_response_schema_modified_plan_required():
    """ModifiedPlanItem required includes title and start_date."""
    schema = _get_response_schema()
    mp = schema.get("properties", {}).get("modified_plan", {})
    required = mp.get("required", [])
    assert "title" in required
    assert "start_date" in required


def test_get_response_schema_sdk_accepts():
    """GENERATION_CONFIG response_schema is accepted by Gemini SDK."""
    from app.services.orchestrator import GENERATION_CONFIG

    from google.generativeai.types import generation_types

    generation_types.to_generation_config_dict(GENERATION_CONFIG)
