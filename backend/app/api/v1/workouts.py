"""Workouts API: CRUD for manual (and later FIT) training entries; fitness (CTL/ATL/TSB) from workouts."""

import hashlib
from datetime import date, datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.athlete_profile import AthleteProfile
from app.models.user import User
from app.models.wellness_cache import WellnessCache
from app.models.workout import Workout
from app.models.intervals_credentials import IntervalsCredentials
from app.schemas.pagination import PaginatedResponse
from app.schemas.workout import WorkoutCreate, WorkoutUpdate
from app.services.fit_parser import parse_fit_session
from app.services.load_metrics import compute_fitness_from_workouts
from app.services.workout_merge import merge_raw
from app.services.audit import log_action

# Default TSS per hour when no power (by sport)
DEFAULT_TSS_PER_HOUR: dict[str, float] = {
    "running": 60.0,
    "cycling": 55.0,
    "swimming": 65.0,
    "generic": 50.0,
}
DEFAULT_TSS_PER_HOUR_FALLBACK = 50.0

router = APIRouter(prefix="/workouts", tags=["workouts"])


def _row_to_response(row: Workout) -> dict:
    return {
        "id": row.id,
        "start_date": row.start_date.isoformat() if row.start_date else None,
        "name": row.name,
        "type": row.type,
        "duration_sec": row.duration_sec,
        "distance_m": row.distance_m,
        "tss": row.tss,
        "source": row.source,
        "notes": row.notes,
        "raw": row.raw,
        "fit_checksum": row.fit_checksum,
    }


def _logical_key(row: Workout) -> str:
    start_iso = row.start_date.isoformat() if row.start_date else ""
    return f"{start_iso}|{row.name or ''}|{row.duration_sec or ''}|{row.tss or ''}"


def _date_logical_key(row: Workout) -> str:
    """Key by date only (no time), name, duration_sec, tss — for list dedupe."""
    date_str = row.start_date.date().isoformat() if row.start_date else ""
    return f"{date_str}|{row.name or ''}|{row.duration_sec or ''}|{row.tss or ''}"


def _row_priority(row: Workout) -> int:
    """Higher = prefer when deduping: Intervals (external_id) > FIT (fit_checksum/series) > manual."""
    if row.external_id:
        return 2
    if row.fit_checksum or (row.raw or {}).get("series"):
        return 1
    return 0


# Matching tolerances for "same workout" (merge)
DURATION_TOLERANCE = 0.02   # ±2%
TSS_TOLERANCE = 0.05       # ±5%
DISTANCE_TOLERANCE = 0.02  # ±2%
START_WINDOW_SEC = 5 * 60  # 5 minutes for "same start" match


def _within_tolerance(a: float | int | None, b: float | int | None, tol: float) -> bool:
    """True if both are None or both within tolerance of each other."""
    if a is None and b is None:
        return True
    if a is None or b is None:
        return False
    try:
        va, vb = float(a), float(b)
        if va == 0 and vb == 0:
            return True
        if va == 0 or vb == 0:
            return abs(va - vb) < 1e-6
        return abs(va - vb) / max(abs(va), abs(vb)) <= tol
    except (TypeError, ValueError):
        return False


async def _find_matching_workout(
    session: AsyncSession,
    user_id: int,
    start_date: datetime,
    duration_sec: int | None = None,
    tss: float | None = None,
    distance_m: float | None = None,
) -> Workout | None:
    """
    Find an existing workout for the same user on the same day that matches by
    duration/tss/distance within tolerance, or by start time within 5 minutes.
    """
    day_start = start_date.replace(hour=0, minute=0, second=0, microsecond=0)
    if day_start.tzinfo is None:
        day_start = day_start.replace(tzinfo=timezone.utc)
    day_end = day_start + timedelta(days=1)
    q = select(Workout).where(
        Workout.user_id == user_id,
        Workout.start_date >= day_start,
        Workout.start_date < day_end,
    ).order_by(Workout.start_date.desc())
    r = await session.execute(q)
    rows = r.scalars().all()
    for row in rows:
        # Same start within 5 min
        if row.start_date and start_date:
            delta = abs((row.start_date - start_date).total_seconds())
            if delta <= START_WINDOW_SEC:
                return row
        # Or matching duration/tss/distance within tolerance
        dur_ok = _within_tolerance(duration_sec, row.duration_sec, DURATION_TOLERANCE)
        tss_ok = _within_tolerance(tss, row.tss, TSS_TOLERANCE)
        dist_ok = _within_tolerance(distance_m, row.distance_m, DISTANCE_TOLERANCE)
        if (duration_sec is not None or row.duration_sec is not None) and not dur_ok:
            continue
        if (tss is not None or row.tss is not None) and not tss_ok:
            continue
        if (distance_m is not None or row.distance_m is not None) and not dist_ok:
            continue
        if (duration_sec is not None or tss is not None or distance_m is not None) or (row.duration_sec is not None or row.tss is not None or row.distance_m is not None):
            return row
    return None


def _merge_workout_fields(
    existing: Workout,
    name: str | None = None,
    type_: str | None = None,
    duration_sec: int | None = None,
    distance_m: float | None = None,
    tss: float | None = None,
    notes: str | None = None,
    raw: dict | None = None,
    fit_checksum: str | None = None,
    source: str | None = None,
) -> None:
    """Update existing workout with non-null values (prefer incoming)."""
    if name is not None:
        existing.name = name
    if type_ is not None:
        existing.type = type_
    if duration_sec is not None:
        existing.duration_sec = duration_sec
    if distance_m is not None:
        existing.distance_m = distance_m
    if tss is not None:
        existing.tss = tss
    if notes is not None:
        existing.notes = notes
    if fit_checksum is not None:
        existing.fit_checksum = fit_checksum
    if source is not None:
        existing.source = source
    if raw is not None:
        existing.raw = merge_raw(existing.raw, raw)


@router.get(
    "",
    response_model=PaginatedResponse,
    summary="List workouts",
    responses={401: {"description": "Not authenticated"}},
)
async def list_workouts(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    from_date: date | None = None,
    to_date: date | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> PaginatedResponse:
    """List workouts for the current user in the given date range (paginated)."""
    uid = user.id
    to_date = to_date or date.today()
    from_date = from_date or (to_date - timedelta(days=14))
    from_dt = datetime.combine(from_date, datetime.min.time()).replace(tzinfo=timezone.utc)
    to_dt = datetime.combine(to_date + timedelta(days=1), datetime.min.time()).replace(tzinfo=timezone.utc)
    base = select(Workout).where(
        Workout.user_id == uid,
        Workout.start_date >= from_dt,
        Workout.start_date < to_dt,
    ).order_by(Workout.start_date.desc())
    count_q = select(func.count()).select_from(base.subquery())
    total = (await session.execute(count_q)).scalar() or 0
    # Fetch a slice; dedupe by date-only key, keep best row per key (Intervals > FIT > manual)
    r = await session.execute(base.offset(offset).limit(limit * 2))
    rows = r.scalars().all()
    best_by_key: dict[str, Workout] = {}
    for row in rows:
        key = _date_logical_key(row)
        if key not in best_by_key:
            best_by_key[key] = row
        elif _row_priority(row) > _row_priority(best_by_key[key]):
            best_by_key[key] = row
    best_list = sorted(
        best_by_key.values(),
        key=lambda r: r.start_date or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )[:limit]
    out = [_row_to_response(r) for r in best_list]
    return PaginatedResponse(
        items=out,
        total=total,
        limit=limit,
        offset=offset,
        has_more=(offset + limit) < total,
    )


@router.post(
    "",
    response_model=dict,
    status_code=201,
    summary="Create workout",
    responses={401: {"description": "Not authenticated"}},
)
async def create_workout(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    body: WorkoutCreate,
) -> dict:
    """Create a manual workout entry, or merge into existing match (e.g. from screenshot)."""
    uid = user.id
    start = body.start_date
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    match = await _find_matching_workout(
        session,
        uid,
        start,
        duration_sec=body.duration_sec,
        tss=float(body.tss) if body.tss is not None else None,
        distance_m=body.distance_m,
    )
    if match:
        _merge_workout_fields(
            match,
            name=body.name if body.name is not None else match.name,
            type_=body.type if body.type is not None else match.type,
            duration_sec=body.duration_sec if body.duration_sec is not None else match.duration_sec,
            distance_m=body.distance_m if body.distance_m is not None else match.distance_m,
            tss=float(body.tss) if body.tss is not None else (float(match.tss) if match.tss is not None else None),
            notes=body.notes if body.notes is not None else match.notes,
            raw={"photo": {"name": body.name, "type": body.type, "duration_sec": body.duration_sec, "distance_m": body.distance_m, "tss": body.tss, "notes": body.notes}} if (body.name is not None or body.type is not None or body.duration_sec is not None or body.distance_m is not None or body.tss is not None or body.notes is not None) else None,
        )
        await log_action(
            session,
            user_id=uid,
            action="update",
            resource="workout",
            resource_id=str(match.id),
            details={"source": "manual", "merged": True},
        )
        await session.commit()
        await session.refresh(match)
        return _row_to_response(match)
    w = Workout(
        user_id=uid,
        start_date=start,
        name=body.name,
        type=body.type,
        duration_sec=body.duration_sec,
        distance_m=body.distance_m,
        tss=body.tss,
        notes=body.notes,
        source="manual",
    )
    session.add(w)
    await session.flush()
    await log_action(
        session,
        user_id=uid,
        action="create",
        resource="workout",
        resource_id=str(w.id),
        details={"source": "manual"},
    )
    await session.commit()
    await session.refresh(w)
    return _row_to_response(w)


@router.patch(
    "/{workout_id}",
    response_model=dict,
    summary="Update workout",
    responses={401: {"description": "Not authenticated"}, 404: {"description": "Workout not found"}},
)
async def update_workout(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    workout_id: int,
    body: WorkoutUpdate,
) -> dict:
    """Update a workout (only manual workouts should be updated)."""
    uid = user.id
    r = await session.execute(select(Workout).where(Workout.id == workout_id, Workout.user_id == uid))
    w = r.scalar_one_or_none()
    if not w:
        raise HTTPException(status_code=404, detail="Workout not found.")
    if body.start_date is not None:
        start = body.start_date
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        w.start_date = start
    if body.name is not None:
        w.name = body.name
    if body.type is not None:
        w.type = body.type
    if body.duration_sec is not None:
        w.duration_sec = body.duration_sec
    if body.distance_m is not None:
        w.distance_m = body.distance_m
    if body.tss is not None:
        w.tss = body.tss
    if body.notes is not None:
        w.notes = body.notes
    await log_action(
        session,
        user_id=uid,
        action="update",
        resource="workout",
        resource_id=str(w.id),
    )
    await session.commit()
    await session.refresh(w)
    return _row_to_response(w)


@router.delete(
    "/{workout_id}",
    status_code=204,
    summary="Delete workout",
    responses={401: {"description": "Not authenticated"}, 404: {"description": "Workout not found"}},
)
async def delete_workout(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    workout_id: int,
) -> None:
    """Delete a workout."""
    uid = user.id
    r = await session.execute(select(Workout).where(Workout.id == workout_id, Workout.user_id == uid))
    w = r.scalar_one_or_none()
    if not w:
        raise HTTPException(status_code=404, detail="Workout not found.")
    await log_action(
        session,
        user_id=uid,
        action="delete",
        resource="workout",
        resource_id=str(w.id),
    )
    await session.delete(w)
    await session.commit()


@router.get(
    "/fitness",
    response_model=dict | None,
    summary="Get CTL/ATL/TSB fitness",
    responses={401: {"description": "Not authenticated"}},
)
async def get_fitness(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict | None:
    """Return CTL/ATL/TSB: from Intervals.icu (wellness_cache) when linked, else from our workout-based calculation."""
    uid = user.id
    # If Intervals is linked, use synced wellness (CTL/ATL/TSB from Intervals). Prefer today's row so numbers match Intervals UI.
    r = await session.execute(select(IntervalsCredentials).where(IntervalsCredentials.user_id == uid))
    if r.scalar_one_or_none():
        today = date.today()
        w_today = await session.execute(
            select(WellnessCache).where(
                WellnessCache.user_id == uid,
                WellnessCache.date == today,
                WellnessCache.ctl.isnot(None),
            )
        )
        row = w_today.scalar_one_or_none()
        if not row or (row.ctl is None and row.atl is None):
            w = await session.execute(
                select(WellnessCache)
                .where(WellnessCache.user_id == uid, WellnessCache.ctl.isnot(None))
                .order_by(WellnessCache.date.desc())
                .limit(1)
            )
            row = w.scalar_one_or_none()
        if row and (row.ctl is not None or row.atl is not None):
            ctl = row.ctl or 0.0
            atl = row.atl or 0.0
            tsb = row.tsb if row.tsb is not None else (ctl - atl)
            return {
                "ctl": round(ctl, 1),
                "atl": round(atl, 1),
                "tsb": round(tsb, 1),
                "date": row.date.isoformat(),
            }
        return None
    return await compute_fitness_from_workouts(session, uid)


def _estimate_tss_from_fit(
    duration_sec: int,
    avg_power: float | None,
    normalized_power: float | None,
    ftp: float | None,
    sport: str | None,
) -> float:
    """Estimate TSS from FIT session: power-based if FTP and power available, else duration/sport."""
    if duration_sec <= 0:
        return 0.0
    np = normalized_power or avg_power
    if np is not None and ftp is not None and ftp > 0 and np > 0:
        # TSS = (t * NP^2) / (FTP^2 * 36), t in seconds
        return round((duration_sec * np * np) / (ftp * ftp * 36.0), 1)
    key = (sport or "generic").lower()
    if "run" in key:
        key = "running"
    elif "cycl" in key or "bike" in key:
        key = "cycling"
    elif "swim" in key:
        key = "swimming"
    else:
        key = "generic"
    tss_per_hour = DEFAULT_TSS_PER_HOUR.get(key, DEFAULT_TSS_PER_HOUR_FALLBACK)
    return round((duration_sec / 3600.0) * tss_per_hour, 1)


@router.post(
    "/preview-fit",
    response_model=dict,
    summary="Preview FIT file (parse without saving)",
    responses={
        400: {"description": "Invalid or empty FIT file"},
        401: {"description": "Not authenticated"},
    },
)
async def preview_fit(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    file: Annotated[UploadFile, File(description="FIT file")],
) -> dict:
    """Parse a FIT file and return session summary without saving to DB."""
    if not file.filename or not file.filename.lower().endswith(".fit"):
        raise HTTPException(status_code=400, detail="Expected a .fit file.")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file.")

    data = parse_fit_session(content)
    if not data:
        raise HTTPException(status_code=400, detail="Could not parse FIT file or no session found.")

    start_date = data["start_date"]
    if isinstance(start_date, datetime) and start_date.tzinfo is None:
        start_date = start_date.replace(tzinfo=timezone.utc)

    uid = user.id
    r = await session.execute(select(AthleteProfile).where(AthleteProfile.user_id == uid))
    profile = r.scalar_one_or_none()
    ftp = None
    if profile and profile.ftp is not None:
        ftp = float(profile.ftp)

    duration_sec = data.get("duration_sec") or 0
    tss = _estimate_tss_from_fit(
        duration_sec,
        data.get("avg_power"),
        data.get("normalized_power"),
        ftp,
        data.get("sport"),
    )
    sport_name = (data.get("sport") or "Workout").capitalize()

    return {
        "start_date": start_date.isoformat() if isinstance(start_date, datetime) else str(start_date),
        "name": sport_name,
        "type": sport_name,
        "duration_sec": duration_sec or None,
        "distance_m": data.get("distance_m"),
        "tss": tss if tss > 0 else None,
        "raw": data.get("raw"),
    }


@router.post(
    "/upload-fit",
    response_model=dict,
    status_code=201,
    summary="Upload FIT file",
    responses={
        400: {"description": "Invalid or empty FIT file"},
        401: {"description": "Not authenticated"},
        409: {"description": "FIT file already imported"},
    },
)
async def upload_fit(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    file: Annotated[UploadFile, File(description="FIT file")],
) -> dict:
    """Upload a FIT file; parse session, dedupe by checksum, create workout with source=fit."""
    if not file.filename or not file.filename.lower().endswith(".fit"):
        raise HTTPException(status_code=400, detail="Expected a .fit file.")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file.")
    checksum = hashlib.sha256(content).hexdigest()
    uid = user.id

    r = await session.execute(
        select(Workout).where(Workout.user_id == uid, Workout.fit_checksum == checksum)
    )
    existing = r.scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="This FIT file was already imported.")

    data = parse_fit_session(content)
    if not data:
        raise HTTPException(status_code=400, detail="Could not parse FIT file or no session found.")

    start_date = data["start_date"]
    if isinstance(start_date, datetime) and start_date.tzinfo is None:
        start_date = start_date.replace(tzinfo=timezone.utc)

    r = await session.execute(select(AthleteProfile).where(AthleteProfile.user_id == uid))
    profile = r.scalar_one_or_none()
    ftp = None
    if profile and profile.ftp is not None:
        ftp = float(profile.ftp)

    duration_sec = data.get("duration_sec") or 0
    tss = _estimate_tss_from_fit(
        duration_sec,
        data.get("avg_power"),
        data.get("normalized_power"),
        ftp,
        data.get("sport"),
    )
    distance_m = data.get("distance_m")
    sport_name = (data.get("sport") or "Workout").capitalize()
    fit_raw = data.get("raw") or {}
    if data.get("series"):
        fit_raw = merge_raw(fit_raw, {"series": data["series"]})

    match = await _find_matching_workout(
        session,
        uid,
        start_date,
        duration_sec=duration_sec or None,
        tss=tss if tss > 0 else None,
        distance_m=distance_m,
    )
    if match:
        _merge_workout_fields(
            match,
            name=sport_name,
            type_=sport_name,
            duration_sec=duration_sec or None,
            distance_m=distance_m,
            tss=tss if tss > 0 else None,
            raw=fit_raw,
            fit_checksum=checksum,
            source="fit",
        )
        await log_action(
            session,
            user_id=uid,
            action="update",
            resource="workout",
            resource_id=str(match.id),
            details={"source": "fit", "merged": True},
        )
        await session.commit()
        await session.refresh(match)
        return _row_to_response(match)

    w = Workout(
        user_id=uid,
        start_date=start_date,
        name=sport_name,
        type=sport_name,
        duration_sec=duration_sec or None,
        distance_m=distance_m,
        tss=tss if tss > 0 else None,
        source="fit",
        fit_checksum=checksum,
        raw=fit_raw,
    )
    session.add(w)
    await session.flush()
    await log_action(
        session,
        user_id=uid,
        action="create",
        resource="workout",
        resource_id=str(w.id),
        details={"source": "fit"},
    )
    await session.commit()
    await session.refresh(w)
    return _row_to_response(w)
