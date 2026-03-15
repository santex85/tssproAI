"""User type resolution: athlete vs regular user."""

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.athlete_profile import AthleteProfile
from app.models.intervals_credentials import IntervalsCredentials
from app.models.workout import Workout


async def resolve_is_athlete(
    session: AsyncSession,
    user_id: int,
    profile: AthleteProfile | None = None,
) -> bool:
    """
    Resolve whether user is an athlete (structured training) or regular user.

    If profile.is_athlete is explicitly set (not None), use it.
    Otherwise use heuristic: is_athlete = True if any of:
    - Intervals linked (IntervalsCredentials for user_id)
    - FTP set in profile
    - Target race set (target_race_date or target_race_name)
    - Workouts in last 30 days
    """
    if profile is not None and profile.is_athlete is not None:
        return profile.is_athlete

    # Heuristic: check Intervals
    r_creds = await session.execute(
        select(IntervalsCredentials).where(IntervalsCredentials.user_id == user_id)
    )
    if r_creds.scalar_one_or_none() is not None:
        return True

    # Heuristic: FTP or target race in profile
    if profile is not None:
        if profile.ftp is not None:
            return True
        if profile.target_race_date is not None or profile.target_race_name:
            return True

    # Heuristic: workouts in last 30 days
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    r_workouts = await session.execute(
        select(Workout.id).where(
            Workout.user_id == user_id,
            Workout.start_date >= cutoff,
        ).limit(1)
    )
    if r_workouts.scalar_one_or_none() is not None:
        return True

    return False
