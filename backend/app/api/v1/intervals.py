"""Intervals.icu: store credentials, events, activities, webhook. Wellness is separate (see wellness router)."""

import asyncio
import logging
from datetime import date, timedelta
from typing import Annotated, Any
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Body, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from jose import JWTError
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.config import settings
from app.core.auth import create_oauth_state_token, decode_oauth_state_token
from app.db.session import get_db, async_session_maker
from app.models.intervals_credentials import IntervalsCredentials
from app.models.user import User
from app.services.crypto import decrypt_value, encrypt_value
from app.services.intervals_pending import create_pending
from app.services.audit import log_action
from app.services.intervals_client import get_activities, get_activity_single, get_events, validate_credentials
from app.services.intervals_sync import sync_intervals_to_db
from app.services.push_notifications import send_push_to_user

router = APIRouter(prefix="/intervals", tags=["intervals"])

INTERVALS_OAUTH_SCOPES = "ACTIVITY:READ,WELLNESS:READ"


class LinkIntervalsBody(BaseModel):
    athlete_id: str
    api_key: str


class SyncIntervalsBody(BaseModel):
    """Optional body for POST /sync. client_today: user's local date (YYYY-MM-DD) for TZ-aware fetch."""

    client_today: str | None = None


@router.get(
    "/status",
    summary="Intervals.icu link status",
    responses={401: {"description": "Not authenticated"}},
)
async def get_intervals_status(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    """Return whether Intervals.icu is linked for the current user (no key in response)."""
    uid = user.id
    r = await session.execute(select(IntervalsCredentials).where(IntervalsCredentials.user_id == uid))
    creds = r.scalar_one_or_none()
    if not creds:
        return {"linked": False}
    return {"linked": True, "athlete_id": creds.athlete_id}


@router.get(
    "/oauth/authorize",
    summary="Get Intervals.icu OAuth redirect URL",
    responses={401: {"description": "Not authenticated"}, 503: {"description": "OAuth not configured"}},
)
async def intervals_oauth_authorize(
    user: Annotated[User, Depends(get_current_user)],
    return_app: bool = False,
) -> dict:
    """Return redirect_url for Intervals.icu OAuth. Frontend opens this URL in browser.
    return_app: when True, callback redirects to smarttrainer:// for mobile deep link."""
    if not settings.intervals_client_id or not settings.intervals_oauth_redirect_uri:
        raise HTTPException(
            status_code=503,
            detail="Intervals.icu OAuth is not configured. Set INTERVALS_CLIENT_ID and INTERVALS_OAUTH_REDIRECT_URI.",
        )
    state = create_oauth_state_token(user.id, return_app=return_app)
    params = {
        "client_id": settings.intervals_client_id,
        "redirect_uri": settings.intervals_oauth_redirect_uri,
        "scope": INTERVALS_OAUTH_SCOPES,
        "state": state,
    }
    redirect_url = f"https://intervals.icu/oauth/authorize?{urlencode(params)}"
    return {"redirect_url": redirect_url}


@router.get(
    "/oauth/callback",
    summary="Intervals.icu OAuth callback",
    responses={400: {"description": "Invalid code or state"}, 503: {"description": "Intervals.icu unavailable"}},
)
async def intervals_oauth_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> RedirectResponse:
    """Exchange authorization code for access token and redirect to frontend."""
    frontend_base = (settings.frontend_base_url or "").rstrip("/")
    success_url = f"{frontend_base}/?intervals_oauth=success" if frontend_base else "/"
    error_url = f"{frontend_base}/?intervals_oauth=error" if frontend_base else "/"
    app_scheme = "smarttrainer://intervals-callback"
    success_app_url = f"{app_scheme}?success=1"
    error_app_url = f"{app_scheme}?error=1"

    if error:
        logging.warning("Intervals OAuth callback error: %s", error)
        return RedirectResponse(url=error_url, status_code=302)

    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing code or state")

    try:
        try:
            payload = decode_oauth_state_token(state)
            return_app = payload.get("return_app") is True
            intent = payload.get("intent", "link")
            user_id = int(payload["sub"]) if "sub" in payload else None
        except (JWTError, ValueError, KeyError) as e:
            logging.warning("Intervals OAuth invalid state: %s", e)
            return RedirectResponse(url=error_url, status_code=302)

        if return_app:
            success_url = success_app_url
            error_url = error_app_url

        if intent == "link" and user_id is None:
            logging.warning("Intervals OAuth link intent requires sub in state")
            return RedirectResponse(url=error_url, status_code=302)

        if not settings.intervals_client_id or not settings.intervals_client_secret or not settings.intervals_oauth_redirect_uri:
            logging.error("Intervals OAuth not configured")
            return RedirectResponse(url=error_url, status_code=302)

        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                resp = await client.post(
                    "https://intervals.icu/api/oauth/token",
                    data={
                        "client_id": settings.intervals_client_id,
                        "client_secret": settings.intervals_client_secret,
                        "code": code,
                    },
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                )
                resp.raise_for_status()
                data = resp.json()
            except httpx.RequestError as e:
                logging.exception("Intervals OAuth token exchange failed: %s", e)
                return RedirectResponse(url=error_url, status_code=302)
            except httpx.HTTPStatusError as e:
                logging.warning("Intervals OAuth token exchange HTTP error: %s %s", e.response.status_code, e.response.text)
                return RedirectResponse(url=error_url, status_code=302)

        access_token = data.get("access_token")
        athlete = data.get("athlete") or {}
        athlete_id = str(athlete.get("id", "")) if athlete else ""
        athlete_name = str(athlete.get("name", "")) if athlete else ""

        if not access_token or not athlete_id:
            logging.warning("Intervals OAuth response missing access_token or athlete.id: %s", data)
            return RedirectResponse(url=error_url, status_code=302)

        intent = payload.get("intent", "link")
        if intent == "login":
            # Login/register flow: create pending, redirect to frontend
            encrypted = encrypt_value(access_token)
            async with async_session_maker() as session:
                r = await session.execute(
                    select(IntervalsCredentials).where(IntervalsCredentials.athlete_id == athlete_id)
                )
                creds = r.scalars().first()
                has_user = creds is not None
                user_id_for_pending = creds.user_id if creds else None
            try:
                pending_key = await create_pending(
                    athlete_id=athlete_id,
                    athlete_name=athlete_name,
                    encrypted_token=encrypted,
                    has_user=has_user,
                    user_id=user_id_for_pending,
                )
            except RuntimeError as e:
                logging.exception("Intervals pending storage failed: %s", e)
                return RedirectResponse(url=error_url, status_code=302)
            frontend_base = (settings.frontend_base_url or "").rstrip("/")
            redirect_url = f"{frontend_base}/?intervals_pending={pending_key}" if frontend_base else f"/?intervals_pending={pending_key}"
            if return_app:
                redirect_url = f"smarttrainer://intervals-login?pending={pending_key}"
            return RedirectResponse(url=redirect_url, status_code=302)

        # Link flow: user already logged in
        user_id = int(payload["sub"])
        async with async_session_maker() as session:
            encrypted = encrypt_value(access_token)
            r = await session.execute(select(IntervalsCredentials).where(IntervalsCredentials.user_id == user_id))
            existing = r.scalar_one_or_none()
            if existing:
                existing.encrypted_token_or_key = encrypted
                existing.athlete_id = athlete_id
                existing.auth_type = "oauth"
            else:
                session.add(
                    IntervalsCredentials(
                        user_id=user_id,
                        encrypted_token_or_key=encrypted,
                        athlete_id=athlete_id,
                        auth_type="oauth",
                    )
                )
            await log_action(
                session,
                user_id=user_id,
                action="link",
                resource="intervals",
                resource_id=athlete_id,
                details={"method": "oauth"},
            )
            await session.commit()

        return RedirectResponse(url=success_url, status_code=302)
    except HTTPException:
        raise
    except Exception as e:
        logging.exception("Intervals OAuth callback failed: %s", e)
        return RedirectResponse(url=error_url, status_code=302)


@router.post(
    "/link",
    summary="Link Intervals.icu account",
    responses={
        400: {"description": "Invalid athlete ID or API key"},
        401: {"description": "Not authenticated"},
        503: {"description": "Intervals.icu temporarily unavailable"},
    },
)
async def link_intervals(
    session: Annotated[AsyncSession, Depends(get_db)],
    body: LinkIntervalsBody,
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    """Store Intervals.icu athlete_id and API key (encrypted)."""
    try:
        if not await validate_credentials(body.athlete_id, body.api_key):
            raise HTTPException(
                status_code=400,
                detail="Invalid athlete ID or API key",
            )
    except httpx.RequestError as e:
        logging.warning("Intervals.icu validation request failed: %s", e)
        raise HTTPException(
            status_code=503,
            detail="Intervals.icu temporarily unavailable. Try again later.",
        ) from e

    uid = user.id
    encrypted = encrypt_value(body.api_key)
    r = await session.execute(select(IntervalsCredentials).where(IntervalsCredentials.user_id == uid))
    existing = r.scalar_one_or_none()
    if existing:
        existing.encrypted_token_or_key = encrypted
        existing.athlete_id = body.athlete_id
        existing.auth_type = "api_key"
    else:
        session.add(
            IntervalsCredentials(
                user_id=uid,
                encrypted_token_or_key=encrypted,
                athlete_id=body.athlete_id,
                auth_type="api_key",
            )
        )
    await log_action(
        session,
        user_id=uid,
        action="link",
        resource="intervals",
        resource_id=body.athlete_id,
    )
    await session.commit()
    return {"status": "linked", "athlete_id": body.athlete_id}


@router.post(
    "/webhook",
    summary="Intervals.icu webhook (no auth)",
    responses={400: {"description": "Invalid JSON or missing athlete_id"}},
)
async def intervals_webhook(
    request: Request,
) -> dict:
    """Receive webhook from Intervals.icu when activity/wellness changes; trigger sync for the athlete in background."""
    try:
        body: dict[str, Any] = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")
    athlete_id = body.get("athlete_id") if isinstance(body.get("athlete_id"), str) else None
    if not athlete_id or not athlete_id.strip():
        raise HTTPException(status_code=400, detail="athlete_id required")
    athlete_id = athlete_id.strip()
    event_type = body.get("type")  # "activity", "wellness", etc.
    logging.info("Intervals webhook: athlete_id=%s type=%s", athlete_id, event_type)

    async with async_session_maker() as session:
        r = await session.execute(
            select(IntervalsCredentials).where(IntervalsCredentials.athlete_id == athlete_id)
        )
        creds = r.scalars().first()
    if not creds:
        logging.warning("Intervals webhook: no credentials for athlete_id=%s", athlete_id)
        return {"ok": True}
    user_id = creds.user_id
    api_key = decrypt_value(creds.encrypted_token_or_key)
    if not api_key:
        logging.warning("Intervals webhook: decryption failed for user_id=%s", user_id)
        return {"ok": True}

    use_bearer = getattr(creds, "auth_type", "api_key") == "oauth"
    async def run_sync() -> None:
        async with async_session_maker() as session:
            try:
                await sync_intervals_to_db(session, user_id, athlete_id, api_key, use_bearer=use_bearer)
                await session.commit()
                await send_push_to_user(session, user_id, "Intervals sync", "Sync completed (webhook).")
            except Exception as e:
                logging.exception("Intervals webhook sync failed for user_id=%s: %s", user_id, e)

    asyncio.create_task(run_sync())
    return {"ok": True}


@router.post(
    "/unlink",
    summary="Unlink Intervals.icu",
    responses={401: {"description": "Not authenticated"}},
)
async def unlink_intervals(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    """Remove Intervals.icu credentials for the current user."""
    uid = user.id
    r = await session.execute(select(IntervalsCredentials).where(IntervalsCredentials.user_id == uid))
    creds = r.scalar_one_or_none()
    if creds:
        await log_action(
            session,
            user_id=uid,
            action="unlink",
            resource="intervals",
            resource_id=creds.athlete_id,
        )
        session.delete(creds)
        await session.commit()
    return {"status": "unlinked"}


@router.post(
    "/sync",
    summary="Trigger Intervals.icu sync",
    responses={
        400: {"description": "Intervals.icu not linked or invalid client_today"},
        401: {"description": "Not authenticated"},
        503: {"description": "Sync failed or timed out"},
    },
)
async def trigger_sync(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    body: SyncIntervalsBody | None = Body(default=None),
) -> dict:
    """Fetch activities and wellness from Intervals.icu and save to our DB.
    Pass client_today (YYYY-MM-DD) to use the user's local date for the fetch range."""
    uid = user.id
    r = await session.execute(select(IntervalsCredentials).where(IntervalsCredentials.user_id == uid))
    creds = r.scalar_one_or_none()
    if not creds:
        raise HTTPException(status_code=400, detail="Intervals.icu is not linked.")
    api_key = decrypt_value(creds.encrypted_token_or_key)
    if not api_key:
        logging.warning("Intervals.icu: API key decryption failed for user_id=%s", uid)
        raise HTTPException(status_code=500, detail="Invalid stored credentials.")
    client_today: date | None = None
    if body and body.client_today and body.client_today.strip():
        try:
            client_today = date.fromisoformat(body.client_today.strip()[:10])
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid client_today format. Use YYYY-MM-DD.")
        server_today = date.today()
        if client_today < server_today - timedelta(days=1) or client_today > server_today + timedelta(days=1):
            raise HTTPException(
                status_code=400,
                detail="client_today must be within yesterday and tomorrow (server UTC).",
            )
    use_bearer = getattr(creds, "auth_type", "api_key") == "oauth"
    try:
        activities_count, wellness_count = await sync_intervals_to_db(
            session, uid, creds.athlete_id, api_key, client_today=client_today, use_bearer=use_bearer
        )
    except httpx.TimeoutException as e:
        logging.exception("Intervals sync failed for user_id=%s: %s", uid, e)
        raise HTTPException(
            status_code=503,
            detail="Sync timed out. Intervals.icu is slow; try again later.",
        )
    except httpx.HTTPStatusError as e:
        logging.exception("Intervals sync failed for user_id=%s: %s", uid, e)
        if e.response.status_code in (401, 403):
            raise HTTPException(
                status_code=503,
                detail="Invalid Intervals.icu API key or athlete ID. Check Settings.",
            )
        raise HTTPException(
            status_code=503,
            detail="Intervals.icu sync failed. Try again later or check your connection.",
        )
    except Exception as e:
        logging.exception("Intervals sync failed for user_id=%s: %s", uid, e)
        raise HTTPException(
            status_code=503,
            detail="Intervals.icu sync failed. Try again later or check your connection.",
        )
    logging.info(
        "Intervals sync completed for user_id=%s: activities_synced=%s, wellness_days_synced=%s",
        uid,
        activities_count,
        wellness_count,
    )
    if wellness_count == 0:
        logging.warning(
            "Intervals sync returned 0 wellness days for user_id=%s; Intervals.icu may have no wellness data for the range.",
            uid,
        )
    await log_action(
        session,
        user_id=uid,
        action="sync",
        resource="intervals",
        resource_id=creds.athlete_id,
        details={"activities_synced": activities_count, "wellness_days_synced": wellness_count},
    )
    await send_push_to_user(
        session, uid, "Intervals sync", f"Synced: {activities_count} activities, {wellness_count} wellness days."
    )
    return {
        "status": "synced",
        "user_id": uid,
        "activities_synced": activities_count,
        "wellness_days_synced": wellness_count,
    }


@router.get(
    "/events",
    summary="Get planned events from Intervals.icu",
    responses={401: {"description": "Not authenticated"}},
)
async def get_events_from_api(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    from_date: date | None = None,
    to_date: date | None = None,
) -> list[dict]:
    """Fetch planned events from Intervals.icu for date range."""
    uid = user.id
    r = await session.execute(select(IntervalsCredentials).where(IntervalsCredentials.user_id == uid))
    creds = r.scalar_one_or_none()
    if not creds:
        return []
    api_key = decrypt_value(creds.encrypted_token_or_key)
    if not api_key:
        logging.warning("Intervals.icu: API key decryption failed for user_id=%s", uid)
        return []
    to_date = to_date or date.today()
    from_date = from_date or (to_date - timedelta(days=7))
    use_bearer = getattr(creds, "auth_type", "api_key") == "oauth"
    try:
        events = await get_events(creds.athlete_id, api_key, from_date, to_date, use_bearer=use_bearer)
    except Exception as e:
        logging.exception("Intervals.icu get_events failed for user_id=%s: %s", uid, e)
        return []
    return [
        {
            "id": e.id,
            "title": e.title,
            "start_date": e.start_date.isoformat() if e.start_date else None,
            "end_date": e.end_date.isoformat() if e.end_date else None,
            "type": e.type,
        }
        for e in events
    ]


@router.get(
    "/activities",
    summary="Get activities from Intervals.icu",
    responses={401: {"description": "Not authenticated"}},
)
async def get_activities_from_api(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    from_date: date | None = None,
    to_date: date | None = None,
) -> list[dict]:
    """Fetch completed activities (workouts) from Intervals.icu for date range."""
    uid = user.id
    r = await session.execute(select(IntervalsCredentials).where(IntervalsCredentials.user_id == uid))
    creds = r.scalar_one_or_none()
    if not creds:
        return []
    api_key = decrypt_value(creds.encrypted_token_or_key)
    if not api_key:
        logging.warning("Intervals.icu: API key decryption failed for user_id=%s", uid)
        return []
    to_date = to_date or date.today()
    from_date = from_date or (to_date - timedelta(days=14))
    use_bearer = getattr(creds, "auth_type", "api_key") == "oauth"
    try:
        activities = await get_activities(creds.athlete_id, api_key, from_date, to_date, limit=100, use_bearer=use_bearer)
    except Exception as e:
        logging.exception("Intervals.icu get_activities failed for user_id=%s: %s", uid, e)
        return []
    # Enrich with full details when list returns only id/start_date (single-activity fetch).
    # Skip for Strava: API returns _note "STRAVA activities are not available via the API" and single-activity GET returns same minimal object.
    raw_get = lambda a: a.raw or {}
    need_detail = [
        a for a in activities
        if a.id
        and raw_get(a).get("source") != "STRAVA"
        and (not a.name and not raw_get(a).get("moving_time") and not raw_get(a).get("movingTime"))
    ]
    detail_by_id: dict[str, dict] = {}
    if need_detail:
        results = await asyncio.gather(
            *[get_activity_single(api_key, a.id, use_bearer=use_bearer) for a in need_detail],
            return_exceptions=True,
        )
        for a, res in zip(need_detail, results):
            if isinstance(res, dict):
                detail_by_id[a.id] = res
    out = []
    for a in activities:
        raw = dict(a.raw or {})
        if a.id in detail_by_id:
            raw.update(detail_by_id[a.id])
        name = a.name or raw.get("title") or raw.get("name") or ("Strava" if raw.get("source") == "STRAVA" else None)
        duration_sec = raw.get("moving_time") or raw.get("movingTime") or raw.get("duration")
        if duration_sec is None and isinstance(raw.get("length"), (int, float)):
            duration_sec = raw.get("length")
        distance_m = raw.get("distance") or raw.get("length")
        distance_km = round(float(distance_m) / 1000, 1) if isinstance(distance_m, (int, float)) and distance_m else None
        start_date_out = a.start_date.isoformat() if a.start_date else raw.get("start_date_local") or raw.get("start_date") or raw.get("startDate")
        tss_out = a.icu_training_load if a.icu_training_load is not None else raw.get("icu_training_load") or raw.get("training_load") or raw.get("tss")
        out.append({
            "id": a.id,
            "name": name,
            "start_date": start_date_out,
            "duration_sec": int(duration_sec) if isinstance(duration_sec, (int, float)) else None,
            "distance_km": distance_km,
            "tss": tss_out,
        })
    return out
