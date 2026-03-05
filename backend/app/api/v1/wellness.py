"""Wellness API: user-entered sleep, RHR, HRV. Independent of Intervals."""

from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.models.wellness_cache import WellnessCache
from app.schemas.pagination import PaginatedResponse
from app.schemas.wellness import WellnessUpsertBody

router = APIRouter(prefix="/wellness", tags=["wellness"])


def _row_to_response(row: WellnessCache) -> dict:
    return {
        "date": row.date.isoformat(),
        "sleep_hours": row.sleep_hours,
        "sleep_source": row.sleep_source,
        "rhr": row.rhr,
        "hrv": row.hrv,
        "ctl": row.ctl,
        "atl": row.atl,
        "tsb": row.tsb,
        "weight_kg": row.weight_kg,
        "sport_info": row.sport_info,
    }


@router.get(
    "",
    response_model=PaginatedResponse,
    summary="Get wellness entries",
    responses={401: {"description": "Not authenticated"}},
)
async def get_wellness(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    from_date: date | None = None,
    to_date: date | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> PaginatedResponse:
    """Return wellness entries for date range from DB only (paginated, no Intervals sync)."""
    uid = user.id
    to_date = to_date or date.today()
    from_date = from_date or (to_date - timedelta(days=30))
    base = select(WellnessCache).where(
        WellnessCache.user_id == uid,
        WellnessCache.date >= from_date,
        WellnessCache.date <= to_date,
    ).order_by(WellnessCache.date.asc())
    count_q = select(func.count()).select_from(base.subquery())
    total = (await session.execute(count_q)).scalar() or 0
    r = await session.execute(base.offset(offset).limit(limit))
    rows = r.scalars().all()
    items = [_row_to_response(row) for row in rows]
    return PaginatedResponse(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
        has_more=(offset + limit) < total,
    )


@router.put(
    "",
    response_model=dict,
    summary="Create or update wellness day",
    responses={401: {"description": "Not authenticated"}},
)
async def upsert_wellness(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    body: WellnessUpsertBody,
) -> dict:
    """Create or update one day of wellness. Only sleep_hours, rhr, hrv are writable; ctl/atl/tsb remain from DB or null."""
    uid = user.id
    r = await session.execute(
        select(WellnessCache).where(
            WellnessCache.user_id == uid,
            WellnessCache.date == body.date,
        )
    )
    row = r.scalar_one_or_none()
    sleep_key_sent = "sleep_hours" in body.model_fields_set
    if row:
        if sleep_key_sent:
            row.sleep_hours = body.sleep_hours
            row.sleep_source = "manual"
        if body.rhr is not None:
            row.rhr = body.rhr
        if body.hrv is not None:
            row.hrv = body.hrv
        if body.weight_kg is not None:
            row.weight_kg = body.weight_kg
    else:
        session.add(
            WellnessCache(
                user_id=uid,
                date=body.date,
                sleep_hours=body.sleep_hours,
                sleep_source="manual" if sleep_key_sent else None,
                rhr=body.rhr,
                hrv=body.hrv,
                weight_kg=body.weight_kg,
            )
        )
    await session.commit()
    r2 = await session.execute(
        select(WellnessCache).where(
            WellnessCache.user_id == uid,
            WellnessCache.date == body.date,
        )
    )
    saved = r2.scalar_one()
    return _row_to_response(saved)
