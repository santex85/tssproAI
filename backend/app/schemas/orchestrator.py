"""Structured output from AI Orchestrator: Go / Modify / Skip."""

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class Decision(str, Enum):
    GO = "Go"
    MODIFY = "Modify"
    SKIP = "Skip"
    ADVICE = "Advice"


class ModifiedPlanItem(BaseModel):
    """Single workout to send to Intervals.icu."""

    title: str
    start_date: str  # ISO datetime
    end_date: str | None = None
    description: str | None = None
    type: str = "workout"
    raw: dict[str, Any] | None = None


class OrchestratorResponse(BaseModel):
    """LLM must return only this structure."""

    decision: Decision
    reason: str = Field(..., max_length=1000)
    modified_plan: ModifiedPlanItem | None = None
    suggestions_next_days: str | None = Field(None, max_length=2000)
    evening_tips: str | None = Field(None, max_length=1000)
    plan_tomorrow: str | None = Field(None, max_length=1000)
