"""Billing: Stripe checkout, portal, webhook, subscription status."""

from datetime import date
from typing import Annotated, Literal

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.config import settings
from app.db.session import async_session_maker, get_db
from app.models.daily_usage import DailyUsage
from app.models.subscription import Subscription
from app.models.user import User
from app.services import stripe_service

router = APIRouter(prefix="/billing", tags=["billing"])


class CheckoutSessionRequest(BaseModel):
    plan: Literal["monthly", "annual"]
    success_url: str
    cancel_url: str


class PortalSessionRequest(BaseModel):
    return_url: str


@router.get(
    "/status",
    summary="Get billing status and daily limits",
    responses={401: {"description": "Not authenticated"}},
)
async def get_billing_status(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    """Return plan, subscription status, and today's usage limits for the authenticated user."""
    today = date.today()
    r_sub = await session.execute(
        select(Subscription).where(Subscription.user_id == user.id)
    )
    sub = r_sub.scalar_one_or_none()

    r_usage = await session.execute(
        select(DailyUsage).where(
            DailyUsage.user_id == user.id,
            DailyUsage.date == today,
        )
    )
    usage = r_usage.scalar_one_or_none()
    if not usage:
        usage = DailyUsage(user_id=user.id, date=today, photo_analyses=0, chat_messages=0)
        session.add(usage)
        await session.flush()

    plan = "Premium" if user.is_premium else "Free"
    subscription_status = sub.status if sub else None
    current_period_end = None
    if sub and sub.current_period_end:
        current_period_end = sub.current_period_end.isoformat()

    if user.is_premium:
        photo_analyses_limit = None
        chat_messages_limit = None
    else:
        photo_analyses_limit = settings.free_daily_photo_limit
        chat_messages_limit = settings.free_daily_chat_limit

    return {
        "plan": plan,
        "subscription_status": subscription_status,
        "current_period_end": current_period_end,
        "photo_analyses_used": usage.photo_analyses,
        "photo_analyses_limit": photo_analyses_limit,
        "chat_messages_used": usage.chat_messages,
        "chat_messages_limit": chat_messages_limit,
    }


@router.post(
    "/checkout-session",
    summary="Create Stripe Checkout Session",
    responses={401: {"description": "Not authenticated"}, 400: {"description": "Stripe not configured"}},
)
async def create_checkout_session(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    body: CheckoutSessionRequest,
) -> dict:
    """Create a Stripe Checkout Session for subscription. Frontend redirects user to returned url."""
    try:
        url = await stripe_service.create_checkout_session(
            session, user, body.plan, body.success_url, body.cancel_url
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except stripe.error.StripeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    await session.commit()
    return {"url": url}


@router.post(
    "/portal-session",
    summary="Create Stripe Customer Portal Session",
    responses={401: {"description": "Not authenticated"}, 400: {"description": "No customer"}},
)
async def create_portal_session(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    body: PortalSessionRequest,
) -> dict:
    """Create a Stripe Customer Portal session for managing subscription. Redirect user to returned url."""
    try:
        url = await stripe_service.create_portal_session(user, body.return_url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except stripe.error.StripeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"url": url}


@router.post(
    "/portal",
    summary="Create Stripe Customer Portal Session (alias)",
    responses={401: {"description": "Not authenticated"}, 400: {"description": "No customer"}},
)
async def create_portal_session_alias(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    body: PortalSessionRequest,
) -> dict:
    """Same as portal-session: create Stripe Customer Portal session. Redirect user to returned url."""
    try:
        url = await stripe_service.create_portal_session(user, body.return_url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except stripe.error.StripeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"url": url}


@router.post(
    "/webhook",
    summary="Stripe webhook",
    include_in_schema=False,
)
async def stripe_webhook(request: Request):
    """Stripe sends events here. Signature is verified; then subscription and user.is_premium are updated."""
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")
    if not sig_header:
        raise HTTPException(status_code=400, detail="Missing stripe-signature")
    try:
        stripe_service.construct_webhook_event(payload, sig_header)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid signature: {e}")
    from app.services.stripe_service import handle_webhook
    async with async_session_maker() as session:
        try:
            await handle_webhook(session, payload, sig_header)
            await session.commit()
        except Exception as e:
            await session.rollback()
            raise HTTPException(status_code=500, detail=str(e))
    return {"received": True}


@router.get(
    "/subscription",
    summary="Get current subscription status",
    responses={401: {"description": "Not authenticated"}},
)
async def get_subscription(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> dict:
    """Return current subscription info for the authenticated user."""
    r = await session.execute(
        select(Subscription).where(Subscription.user_id == user.id)
    )
    sub = r.scalar_one_or_none()
    if not sub:
        return {
            "has_subscription": False,
            "is_premium": user.is_premium,
            "plan": None,
            "status": None,
            "current_period_end": None,
            "trial_end": None,
            "cancel_at_period_end": None,
        }
    return {
        "has_subscription": True,
        "is_premium": user.is_premium,
        "plan": sub.plan,
        "status": sub.status,
        "current_period_end": sub.current_period_end.isoformat() if sub.current_period_end else None,
        "trial_end": sub.trial_end.isoformat() if sub.trial_end else None,
        "cancel_at_period_end": sub.cancel_at_period_end,
    }
