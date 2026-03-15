"""Athlete profile: GET/PATCH profile (manual fields only)."""

from datetime import date
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.config import settings
from app.db.session import get_db
from app.models.athlete_profile import AthleteProfile
from app.models.user import User

router = APIRouter(prefix="/athlete-profile", tags=["athlete-profile"])


def _profile_response(profile: AthleteProfile | None, user: User) -> dict:
    """Build GET response: manual profile fields."""
    base = {
        "is_premium": user.is_premium,
        "dev_can_toggle_premium": settings.app_env != "production" or settings.dev_premium_toggle_enabled,
        "locale": user.locale or "ru",
        "timezone": user.timezone or "UTC",
    }
    if not profile:
        return {
            **base,
            "weight_kg": None,
            "weight_source": None,
            "ftp": None,
            "ftp_source": None,
            "height_cm": None,
            "birth_year": None,
            "display_name": user.email,
            "nutrition_goals": None,
            "target_race_date": None,
            "target_race_name": None,
            "days_to_race": None,
            "is_athlete": None,
        }
    nutrition_goals = None
    if (
        profile.calorie_goal is not None
        or profile.protein_goal is not None
        or profile.fat_goal is not None
        or profile.carbs_goal is not None
    ):
        nutrition_goals = {
            "calorie_goal": profile.calorie_goal,
            "protein_goal": profile.protein_goal,
            "fat_goal": profile.fat_goal,
            "carbs_goal": profile.carbs_goal,
        }
    today = date.today()
    days_to_race = None
    if profile.target_race_date is not None and profile.target_race_date >= today:
        days_to_race = (profile.target_race_date - today).days

    return {
        **base,
        "weight_kg": profile.weight_kg,
        "weight_source": "manual" if profile.weight_kg is not None else None,
        "ftp": profile.ftp,
        "ftp_source": "manual" if profile.ftp is not None else None,
        "height_cm": profile.height_cm,
        "birth_year": profile.birth_year,
        "display_name": user.email,
        "nutrition_goals": nutrition_goals,
        "target_race_date": profile.target_race_date.isoformat() if profile.target_race_date else None,
        "target_race_name": profile.target_race_name,
        "days_to_race": days_to_race,
        "is_athlete": profile.is_athlete,
    }


class AthleteProfileUpdate(BaseModel):
    weight_kg: float | None = Field(None, description="Weight in kg")
    height_cm: float | None = Field(None, description="Height in cm")
    birth_year: int | None = Field(None, ge=1900, le=2100, description="Birth year")
    ftp: int | None = Field(None, ge=1, le=999, description="Functional threshold power (watts)")
    calorie_goal: float | None = Field(None, ge=0, le=10000, description="Daily calorie goal (kcal)")
    protein_goal: float | None = Field(None, ge=0, le=1000, description="Daily protein goal (g)")
    fat_goal: float | None = Field(None, ge=0, le=1000, description="Daily fat goal (g)")
    carbs_goal: float | None = Field(None, ge=0, le=1000, description="Daily carbs goal (g)")
    target_race_date: date | None = Field(None, description="Target race date (YYYY-MM-DD)")
    target_race_name: str | None = Field(None, max_length=512, description="Target race name")
    is_athlete: bool | None = Field(None, description="Explicit user type: athlete vs regular (null = auto)")
    locale: str | None = Field(None, description="User language preference (ru, en)")
    timezone: str | None = Field(None, max_length=50, description="IANA timezone, e.g. Europe/Moscow")


@router.get(
    "",
    summary="Get athlete profile",
    responses={401: {"description": "Not authenticated"}},
)
async def get_athlete_profile(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    """Return athlete profile (manual fields only)."""
    uid = user.id
    r = await session.execute(select(AthleteProfile).where(AthleteProfile.user_id == uid))
    profile = r.scalar_one_or_none()
    return _profile_response(profile, user)


@router.patch(
    "",
    summary="Update athlete profile",
    responses={401: {"description": "Not authenticated"}},
)
async def update_athlete_profile(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    body: AthleteProfileUpdate,
) -> dict:
    """Update manual profile fields (weight_kg, height_cm, birth_year, ftp)."""
    uid = user.id
    r = await session.execute(select(AthleteProfile).where(AthleteProfile.user_id == uid))
    profile = r.scalar_one_or_none()
    if not profile:
        profile = AthleteProfile(user_id=uid)
        session.add(profile)
        await session.flush()
    if body.weight_kg is not None:
        profile.weight_kg = body.weight_kg
    if body.height_cm is not None:
        profile.height_cm = body.height_cm
    if body.birth_year is not None:
        profile.birth_year = body.birth_year
    if body.ftp is not None:
        profile.ftp = body.ftp
    if body.calorie_goal is not None:
        profile.calorie_goal = body.calorie_goal
    if body.protein_goal is not None:
        profile.protein_goal = body.protein_goal
    if body.fat_goal is not None:
        profile.fat_goal = body.fat_goal
    if body.carbs_goal is not None:
        profile.carbs_goal = body.carbs_goal
    if "target_race_date" in body.model_fields_set:
        profile.target_race_date = body.target_race_date
    if "target_race_name" in body.model_fields_set:
        profile.target_race_name = body.target_race_name
    if "is_athlete" in body.model_fields_set:
        profile.is_athlete = body.is_athlete
    if body.locale is not None:
        from app.api.deps import SUPPORTED_LOCALES, _normalize_locale
        normalized = _normalize_locale(body.locale)
        if normalized in SUPPORTED_LOCALES:
            user.locale = normalized
    if body.timezone is not None:
        try:
            ZoneInfo(body.timezone)
        except Exception:
            raise HTTPException(status_code=400, detail=f"Invalid timezone: {body.timezone}")
        user.timezone = body.timezone
    await session.commit()
    await session.refresh(profile)
    await session.refresh(user)
    r = await session.execute(select(AthleteProfile).where(AthleteProfile.user_id == uid))
    return _profile_response(r.scalar_one_or_none(), user)
