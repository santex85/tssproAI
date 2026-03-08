"""Stripe billing: checkout, portal, webhooks, subscription sync."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Literal

import stripe
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.subscription import Subscription
from app.models.user import User

logger = logging.getLogger(__name__)
stripe.api_key = settings.stripe_secret_key

ACTIVE_STATUSES = ("trialing", "active")
Plan = Literal["monthly", "annual"]


def _price_id(plan: Plan) -> str:
    if plan == "monthly":
        return settings.stripe_price_monthly
    return settings.stripe_price_annual


async def create_checkout_session(
    session: AsyncSession,
    user: User,
    plan: Plan,
    success_url: str,
    cancel_url: str,
) -> str:
    """Create Stripe Checkout Session for subscription. Returns session URL."""
    if not settings.stripe_secret_key or not _price_id(plan):
        raise ValueError("Stripe is not configured")

    kwargs = {
        "mode": "subscription",
        "line_items": [{"price": _price_id(plan), "quantity": 1}],
        "subscription_data": {"trial_period_days": 7},
        "success_url": success_url,
        "cancel_url": cancel_url,
        "client_reference_id": str(user.id),
    }
    if user.stripe_customer_id:
        kwargs["customer"] = user.stripe_customer_id
    else:
        kwargs["customer_email"] = user.email

    checkout = stripe.checkout.Session.create(**kwargs)
    return checkout.url or ""


async def create_portal_session(user: User, return_url: str) -> str:
    """Create Stripe Customer Portal session. Returns portal URL."""
    if not settings.stripe_secret_key:
        raise ValueError("Stripe is not configured")
    customer_id = user.stripe_customer_id
    if not customer_id:
        raise ValueError("No Stripe customer for this user")
    portal = stripe.billing_portal.Session.create(
        customer=customer_id,
        return_url=return_url,
    )
    return portal.url or ""


def construct_webhook_event(payload: bytes, sig_header: str):
    """Verify and construct Stripe event. Raises on invalid signature."""
    return stripe.Webhook.construct_event(
        payload, sig_header, settings.stripe_webhook_secret
    )


async def sync_subscription_status(
    session: AsyncSession, stripe_subscription_id: str
) -> Subscription | None:
    """Fetch subscription from Stripe and upsert DB. Update user.is_premium. Returns Subscription or None."""
    if not settings.stripe_secret_key:
        return None
    sub = stripe.Subscription.retrieve(
        stripe_subscription_id, expand=["items.data.price"]
    )
    status = (sub.status or "").lower()
    is_active = status in ACTIVE_STATUSES

    # Resolve plan from price id
    plan = "monthly"
    if sub.items and sub.items.data:
        price_id = sub.items.data[0].price.id if sub.items.data[0].price else None
        if price_id == settings.stripe_price_annual:
            plan = "annual"

    current_start = datetime.fromtimestamp(sub.current_period_start, tz=timezone.utc)
    current_end = datetime.fromtimestamp(sub.current_period_end, tz=timezone.utc)
    trial_end_ts = sub.trial_end
    trial_end = datetime.fromtimestamp(trial_end_ts, tz=timezone.utc) if trial_end_ts else None

    r = await session.execute(
        select(Subscription).where(
            Subscription.stripe_subscription_id == stripe_subscription_id
        )
    )
    db_sub = r.scalar_one_or_none()
    if db_sub:
        db_sub.status = status
        db_sub.plan = plan
        db_sub.current_period_start = current_start
        db_sub.current_period_end = current_end
        db_sub.trial_end = trial_end
        db_sub.cancel_at_period_end = bool(sub.cancel_at_period_end)
        db_sub.updated_at = datetime.now(timezone.utc)
    else:
        customer_id = sub.customer if isinstance(sub.customer, str) else sub.customer.id
        ru = await session.execute(
            select(User).where(User.stripe_customer_id == customer_id)
        )
        u = ru.scalar_one_or_none()
        if not u:
            return None
        user_id = u.id
        db_sub = Subscription(
            user_id=user_id,
            stripe_customer_id=customer_id,
            stripe_subscription_id=stripe_subscription_id,
            plan=plan,
            status=status,
            current_period_start=current_start,
            current_period_end=current_end,
            trial_end=trial_end,
            cancel_at_period_end=bool(sub.cancel_at_period_end),
        )
        session.add(db_sub)

    # Ensure user has stripe_customer_id and correct is_premium
    ru = await session.execute(select(User).where(User.id == db_sub.user_id))
    u = ru.scalar_one_or_none()
    if u:
        if not u.stripe_customer_id:
            u.stripe_customer_id = db_sub.stripe_customer_id
        u.is_premium = is_active
    await session.flush()
    return db_sub


async def set_user_premium_from_subscription(
    session: AsyncSession, user_id: int, is_premium: bool
) -> None:
    """Set user.is_premium for user_id."""
    ru = await session.execute(select(User).where(User.id == user_id))
    u = ru.scalar_one_or_none()
    if u:
        u.is_premium = is_premium
        await session.flush()


def _normalize_id(value, prefix: str = "") -> str | None:
    """Extract string ID from Stripe object (may be str, dict with 'id', or object with .id)."""
    if isinstance(value, str) and (not prefix or value.startswith(prefix)):
        return value
    if isinstance(value, dict):
        return value.get("id") or None
    if hasattr(value, "id"):
        return getattr(value, "id", None)
    return None


async def handle_checkout_session_completed(
    session: AsyncSession, stripe_session
) -> None:
    """Handle checkout.session.completed: set customer on user, sync subscription, set is_premium."""
    customer_id = stripe_session.get("customer")
    if isinstance(customer_id, dict):
        customer_id = customer_id.get("id") or customer_id.get("email")
    sub_raw = stripe_session.get("subscription")
    sub_id = _normalize_id(sub_raw, "sub_") if sub_raw else None
    client_ref = stripe_session.get("client_reference_id")
    if not sub_id:
        return
    user_id = int(client_ref) if client_ref and str(client_ref).isdigit() else None
    if user_id and customer_id:
        ru = await session.execute(select(User).where(User.id == user_id))
        u = ru.scalar_one_or_none()
        if u and not u.stripe_customer_id:
            u.stripe_customer_id = customer_id if isinstance(customer_id, str) else None
            await session.flush()
    logger.info("Stripe checkout.session.completed: syncing subscription %s for user_id=%s", sub_id, user_id)
    await sync_subscription_status(session, sub_id)


async def handle_subscription_updated_deleted(
    session: AsyncSession, stripe_subscription
) -> None:
    """Handle customer.subscription.updated or .deleted: sync status, set is_premium."""
    sub_id = stripe_subscription.get("id")
    status = (stripe_subscription.get("status") or "").lower()
    is_active = status in ACTIVE_STATUSES
    if not sub_id:
        return
    r = await session.execute(
        select(Subscription).where(
            Subscription.stripe_subscription_id == sub_id
        )
    )
    db_sub = r.scalar_one_or_none()
    if db_sub:
        ru = await session.execute(select(User).where(User.id == db_sub.user_id))
        u = ru.scalar_one_or_none()
        if u:
            u.is_premium = is_active
            await session.flush()
    await sync_subscription_status(session, sub_id)


async def handle_webhook(
    session: AsyncSession, payload: bytes, sig_header: str
) -> None:
    """Verify webhook signature and dispatch to appropriate handler."""
    event = construct_webhook_event(payload, sig_header)
    typ = (event.get("type") or getattr(event, "type", None) or "").strip()
    data = event.get("data") or getattr(event, "data", None) or {}
    obj = (data.get("object") if hasattr(data, "get") else getattr(data, "object", None)) or {}

    if typ == "checkout.session.completed":
        if obj.get("mode") == "subscription":
            await handle_checkout_session_completed(session, obj)
    elif typ == "customer.subscription.updated":
        await handle_subscription_updated_deleted(session, obj)
    elif typ == "customer.subscription.deleted":
        await handle_subscription_updated_deleted(session, obj)
