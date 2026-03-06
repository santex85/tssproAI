import logging
from datetime import date, datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Path, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_request_locale
from app.core.upload import read_upload_bounded
from app.db.session import get_db
from app.models.food_log import FoodLog, MealType
from app.models.user import User
from app.schemas.nutrition import (
    AddFoodFromTextRequest,
    CreateFoodEntryRequest,
    NutritionAnalyzeResponse,
    NutritionDayEntry,
    NutritionDayResponse,
    NutritionDayTotals,
    NutritionEntryUpdate,
    ReanalyzeRequest,
)
from app.services.gemini_nutrition import analyze_food_from_image, analyze_food_from_text
from app.services.image_resize import resize_image_for_ai_async
from app.services.audit import log_action

router = APIRouter(prefix="/nutrition", tags=["nutrition"])


@router.post(
    "/analyze",
    response_model=NutritionAnalyzeResponse,
    summary="Analyze food photo",
    responses={
        400: {"description": "Invalid or missing image"},
        401: {"description": "Not authenticated"},
        422: {"description": "AI could not analyze image"},
        502: {"description": "AI service unavailable"},
    },
)
async def analyze_nutrition(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    locale: Annotated[str, Depends(get_request_locale)],
    file: Annotated[UploadFile, File(description="Photo of the plate")],
    meal_type: Annotated[str | None, Form()] = None,
) -> NutritionAnalyzeResponse:
    """
    Upload a photo of food; Gemini returns structured JSON (name, portion_grams, calories, protein_g, fat_g, carbs_g).
    Result is validated with Pydantic and saved to food_log.
    """
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")
    image_bytes = await read_upload_bounded(file)
    if len(image_bytes) == 0:
        raise HTTPException(status_code=400, detail="File is empty or invalid.")
    if len(image_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image too large (max 10MB)")
    # Check image magic bytes (JPEG, PNG, GIF, WebP)
    magic = image_bytes[:12] if len(image_bytes) >= 12 else image_bytes
    if not (
        magic.startswith(b"\xff\xd8\xff")
        or magic.startswith(b"\x89PNG\r\n\x1a\n")
        or magic.startswith(b"GIF87a")
        or magic.startswith(b"GIF89a")
        or (magic[:4] == b"RIFF" and magic[8:12] == b"WEBP")
    ):
        raise HTTPException(status_code=400, detail="File must be a valid image (JPEG, PNG, GIF or WebP).")
    image_bytes = await resize_image_for_ai_async(image_bytes)
    try:
        result, extended_nutrients = await analyze_food_from_image(
            image_bytes, extended=True, locale=locale
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception:
        logging.exception("Nutrition image analysis failed")
        raise HTTPException(status_code=502, detail="AI analysis failed. Please try again.")

    uid = user.id
    meal = (meal_type or MealType.other.value).lower()
    if meal not in [e.value for e in MealType]:
        meal = MealType.other.value

    log = FoodLog(
        user_id=uid,
        timestamp=datetime.utcnow(),
        meal_type=meal,
        name=result.name,
        portion_grams=result.portion_grams,
        calories=result.calories,
        protein_g=result.protein_g,
        fat_g=result.fat_g,
        carbs_g=result.carbs_g,
        image_storage_path=None,
        extended_nutrients=extended_nutrients,
    )
    session.add(log)
    await session.flush()
    await log_action(
        session,
        user_id=uid,
        action="create",
        resource="food_log",
        resource_id=str(log.id),
        details={"source": "nutrition.analyze"},
    )
    return NutritionAnalyzeResponse(
        id=log.id,
        name=log.name,
        portion_grams=log.portion_grams,
        calories=log.calories,
        protein_g=log.protein_g,
        fat_g=log.fat_g,
        carbs_g=log.carbs_g,
        extended_nutrients=extended_nutrients if user.is_premium else None,
    )


@router.post(
    "/analyze-from-text",
    response_model=NutritionAnalyzeResponse,
    summary="Recalculate macros from dish name and portion (no image). Premium only.",
    responses={
        401: {"description": "Not authenticated"},
        403: {"description": "Premium required"},
        422: {"description": "AI could not analyze"},
        502: {"description": "AI service unavailable"},
    },
)
async def analyze_nutrition_from_text(
    user: Annotated[User, Depends(get_current_user)],
    locale: Annotated[str, Depends(get_request_locale)],
    body: ReanalyzeRequest,
) -> NutritionAnalyzeResponse:
    """Return recalculated macros for given name and portion_grams. Does not create or update any entry. Premium only."""
    if not user.is_premium:
        raise HTTPException(status_code=403, detail="Premium required for re-analysis.")
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="Name is required.")
    portion = body.portion_grams if body.portion_grams is not None else 0.0
    correction = (body.correction or "").strip()
    try:
        food_result, extended_nutrients = await analyze_food_from_text(
            name=name,
            portion_grams=portion,
            correction=correction,
            extended=True,
            locale=locale,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception:
        logging.exception("analyze_from_text failed for name=%s", name)
        raise HTTPException(status_code=502, detail="AI analysis failed. Please try again.")
    return NutritionAnalyzeResponse(
        id=0,
        name=food_result.name,
        portion_grams=food_result.portion_grams,
        calories=food_result.calories,
        protein_g=food_result.protein_g,
        fat_g=food_result.fat_g,
        carbs_g=food_result.carbs_g,
        extended_nutrients=extended_nutrients if user.is_premium else None,
    )


@router.post(
    "/entries",
    response_model=NutritionDayEntry,
    summary="Create food log entry",
    responses={
        401: {"description": "Not authenticated"},
    },
)
async def create_nutrition_entry(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    body: CreateFoodEntryRequest,
) -> NutritionDayEntry:
    """Create a single food log entry (e.g. from photo preview). Optional meal_type and date (YYYY-MM-DD; default today)."""
    meal = (body.meal_type or MealType.other.value).lower()
    if meal not in [e.value for e in MealType]:
        meal = MealType.other.value
    day_str = body.date or datetime.utcnow().date().isoformat()
    try:
        day_date = date.fromisoformat(day_str)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")
    ts = datetime.combine(day_date, datetime.min.time(), tzinfo=timezone.utc)
    log = FoodLog(
        user_id=user.id,
        timestamp=ts,
        meal_type=meal,
        name=body.name,
        portion_grams=body.portion_grams,
        calories=body.calories,
        protein_g=body.protein_g,
        fat_g=body.fat_g,
        carbs_g=body.carbs_g,
    )
    session.add(log)
    await session.flush()
    await log_action(
        session,
        user_id=user.id,
        action="create",
        resource="food_log",
        resource_id=str(log.id),
        details={"source": "nutrition.entries"},
    )
    await session.refresh(log)
    return NutritionDayEntry(
        id=log.id,
        name=log.name,
        portion_grams=log.portion_grams,
        calories=log.calories,
        protein_g=log.protein_g,
        fat_g=log.fat_g,
        carbs_g=log.carbs_g,
        meal_type=log.meal_type,
        timestamp=log.timestamp.isoformat() if log.timestamp else "",
        can_reanalyze=False,
    )


@router.post(
    "/entries/add-from-text",
    response_model=NutritionDayEntry,
    summary="Add food manually (AI analyzes by name and portion)",
    responses={
        401: {"description": "Not authenticated"},
        422: {"description": "AI could not analyze"},
        502: {"description": "AI service unavailable"},
    },
)
async def add_food_from_text(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    locale: Annotated[str, Depends(get_request_locale)],
    body: AddFoodFromTextRequest,
) -> NutritionDayEntry:
    """
    Add food manually: provide name and portion_grams. AI analyzes and returns macros, then saves to food_log.
    Available to all users (no premium required).
    """
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="Name is required.")
    portion = body.portion_grams
    try:
        food_result, extended_nutrients = await analyze_food_from_text(
            name=name,
            portion_grams=portion,
            correction="",
            extended=True,
            locale=locale,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception:
        logging.exception("add_food_from_text failed for name=%s", name)
        raise HTTPException(status_code=502, detail="AI analysis failed. Please try again.")

    meal = (body.meal_type or MealType.other.value).lower()
    if meal not in [e.value for e in MealType]:
        meal = MealType.other.value
    day_str = body.date or datetime.utcnow().date().isoformat()
    try:
        day_date = date.fromisoformat(day_str)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")
    ts = datetime.combine(day_date, datetime.min.time(), tzinfo=timezone.utc)

    log = FoodLog(
        user_id=user.id,
        timestamp=ts,
        meal_type=meal,
        name=food_result.name,
        portion_grams=food_result.portion_grams,
        calories=food_result.calories,
        protein_g=food_result.protein_g,
        fat_g=food_result.fat_g,
        carbs_g=food_result.carbs_g,
        image_storage_path=None,
        extended_nutrients=extended_nutrients,
    )
    session.add(log)
    await session.flush()
    await log_action(
        session,
        user_id=user.id,
        action="create",
        resource="food_log",
        resource_id=str(log.id),
        details={"source": "nutrition.add-from-text"},
    )
    await session.refresh(log)
    return NutritionDayEntry(
        id=log.id,
        name=log.name,
        portion_grams=log.portion_grams,
        calories=log.calories,
        protein_g=log.protein_g,
        fat_g=log.fat_g,
        carbs_g=log.carbs_g,
        meal_type=log.meal_type,
        timestamp=log.timestamp.isoformat() if log.timestamp else "",
        extended_nutrients=extended_nutrients if user.is_premium else None,
        can_reanalyze=user.is_premium,
    )


@router.get(
    "/day",
    response_model=NutritionDayResponse,
    summary="Get nutrition for a day",
    responses={
        400: {"description": "Invalid date format"},
        401: {"description": "Not authenticated"},
    },
)
async def get_nutrition_day(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    date_param: Annotated[str | None, Query(alias="date", description="YYYY-MM-DD")] = None,
) -> NutritionDayResponse:
    """Get food log entries and totals for a single day (default: today)."""
    uid = user.id
    day = date_param or datetime.utcnow().date().isoformat()
    try:
        day_date = date.fromisoformat(day)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")
    # Use UTC day boundaries so stored UTC timestamps match the requested calendar day
    day_start = datetime.combine(day_date, datetime.min.time(), tzinfo=timezone.utc)
    day_end = day_start + timedelta(days=1)

    stmt = (
        select(FoodLog)
        .where(FoodLog.user_id == uid)
        .where(FoodLog.timestamp >= day_start)
        .where(FoodLog.timestamp < day_end)
        .order_by(FoodLog.timestamp)
    )
    result = await session.execute(stmt)
    rows = result.scalars().all()

    entries = [
        NutritionDayEntry(
            id=r.id,
            name=r.name,
            portion_grams=r.portion_grams,
            calories=r.calories,
            protein_g=r.protein_g,
            fat_g=r.fat_g,
            carbs_g=r.carbs_g,
            meal_type=r.meal_type,
            timestamp=r.timestamp.isoformat() if r.timestamp else "",
            extended_nutrients=r.extended_nutrients if user.is_premium else None,
            can_reanalyze=user.is_premium,
        )
        for r in rows
    ]
    totals = NutritionDayTotals(
        calories=sum(r.calories for r in rows),
        protein_g=sum(r.protein_g for r in rows),
        fat_g=sum(r.fat_g for r in rows),
        carbs_g=sum(r.carbs_g for r in rows),
    )
    return NutritionDayResponse(date=day, entries=entries, totals=totals)


@router.get(
    "/entries/{entry_id}",
    response_model=NutritionDayEntry,
    summary="Get single food log entry",
    responses={
        401: {"description": "Not authenticated"},
        404: {"description": "Entry not found"},
    },
)
async def get_nutrition_entry(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    entry_id: Annotated[int, Path(description="Food log entry ID")],
) -> NutritionDayEntry:
    """Get a single food log entry by ID. Returns 404 if not found or not owned."""
    result = await session.execute(select(FoodLog).where(FoodLog.id == entry_id))
    entry = result.scalar_one_or_none()
    if not entry or entry.user_id != user.id:
        raise HTTPException(status_code=404, detail="Entry not found.")
    return NutritionDayEntry(
        id=entry.id,
        name=entry.name,
        portion_grams=entry.portion_grams,
        calories=entry.calories,
        protein_g=entry.protein_g,
        fat_g=entry.fat_g,
        carbs_g=entry.carbs_g,
        meal_type=entry.meal_type,
        timestamp=entry.timestamp.isoformat() if entry.timestamp else "",
        extended_nutrients=entry.extended_nutrients if user.is_premium else None,
        can_reanalyze=user.is_premium,
    )


@router.post(
    "/entries/{entry_id}/reanalyze",
    response_model=NutritionDayEntry,
    summary="Recalculate macros from text (dish name + portion + correction). Premium only.",
    responses={
        401: {"description": "Not authenticated"},
        403: {"description": "Premium required"},
        404: {"description": "Entry not found"},
        422: {"description": "AI could not analyze"},
        502: {"description": "AI service unavailable"},
    },
)
async def reanalyze_nutrition_entry(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    locale: Annotated[str, Depends(get_request_locale)],
    entry_id: Annotated[int, Path(description="Food log entry ID")],
    body: ReanalyzeRequest,
) -> NutritionDayEntry:
    """Recalculate macros from text (dish name, portion, user correction). No image needed. Premium only."""
    if not user.is_premium:
        raise HTTPException(status_code=403, detail="Premium required for re-analysis.")
    result = await session.execute(select(FoodLog).where(FoodLog.id == entry_id))
    entry = result.scalar_one_or_none()
    if not entry or entry.user_id != user.id:
        raise HTTPException(status_code=404, detail="Entry not found.")
    recalc_name = (body.name or entry.name or "").strip() or entry.name
    recalc_portion = body.portion_grams if body.portion_grams is not None else float(entry.portion_grams or 0)
    recalc_correction = (body.correction or "").strip()
    try:
        food_result, extended_nutrients = await analyze_food_from_text(
            name=recalc_name,
            portion_grams=recalc_portion,
            correction=recalc_correction,
            extended=True,
            locale=locale,
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception:
        logging.exception("Reanalyze failed for entry_id=%s", entry_id)
        raise HTTPException(status_code=502, detail="AI analysis failed. Please try again.")
    entry.name = food_result.name
    entry.portion_grams = food_result.portion_grams
    entry.calories = food_result.calories
    entry.protein_g = food_result.protein_g
    entry.fat_g = food_result.fat_g
    entry.carbs_g = food_result.carbs_g
    entry.extended_nutrients = extended_nutrients
    await session.flush()
    await log_action(
        session,
        user_id=user.id,
        action="reanalyze",
        resource="food_log",
        resource_id=str(entry.id),
        details={"name": recalc_name, "portion_grams": recalc_portion, "correction": recalc_correction},
    )
    await session.refresh(entry)
    return NutritionDayEntry(
        id=entry.id,
        name=entry.name,
        portion_grams=entry.portion_grams,
        calories=entry.calories,
        protein_g=entry.protein_g,
        fat_g=entry.fat_g,
        carbs_g=entry.carbs_g,
        meal_type=entry.meal_type,
        timestamp=entry.timestamp.isoformat() if entry.timestamp else "",
        extended_nutrients=entry.extended_nutrients,
        can_reanalyze=user.is_premium,
    )


@router.patch(
    "/entries/{entry_id}",
    response_model=NutritionDayEntry,
    summary="Update food log entry",
    responses={
        401: {"description": "Not authenticated"},
        404: {"description": "Entry not found"},
    },
)
async def update_nutrition_entry(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    entry_id: Annotated[int, Path(description="Food log entry ID")],
    body: NutritionEntryUpdate,
) -> NutritionDayEntry:
    """Update a food log entry; only provided fields are updated. Returns 404 if not found or not owned."""
    result = await session.execute(select(FoodLog).where(FoodLog.id == entry_id))
    entry = result.scalar_one_or_none()
    if not entry or entry.user_id != user.id:
        raise HTTPException(status_code=404, detail="Entry not found.")
    payload = body.model_dump(exclude_unset=True)
    if "meal_type" in payload and payload["meal_type"] is not None:
        meal = payload["meal_type"].lower()
        if meal not in [e.value for e in MealType]:
            payload["meal_type"] = MealType.other.value
        else:
            payload["meal_type"] = meal
    for k, v in payload.items():
        setattr(entry, k, v)
    await session.flush()
    await log_action(
        session,
        user_id=user.id,
        action="update",
        resource="food_log",
        resource_id=str(entry.id),
        details={"fields": sorted(payload.keys())},
    )
    await session.refresh(entry)
    return NutritionDayEntry(
        id=entry.id,
        name=entry.name,
        portion_grams=entry.portion_grams,
        calories=entry.calories,
        protein_g=entry.protein_g,
        fat_g=entry.fat_g,
        carbs_g=entry.carbs_g,
        meal_type=entry.meal_type,
        timestamp=entry.timestamp.isoformat() if entry.timestamp else "",
        extended_nutrients=entry.extended_nutrients if user.is_premium else None,
        can_reanalyze=user.is_premium,
    )


@router.delete(
    "/entries/{entry_id}",
    summary="Delete food log entry",
    responses={
        401: {"description": "Not authenticated"},
        404: {"description": "Entry not found"},
    },
)
async def delete_nutrition_entry(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    entry_id: Annotated[int, Path(description="Food log entry ID")],
) -> dict:
    """Delete a food log entry. Returns 404 if not found or not owned."""
    result = await session.execute(select(FoodLog).where(FoodLog.id == entry_id))
    entry = result.scalar_one_or_none()
    if not entry or entry.user_id != user.id:
        raise HTTPException(status_code=404, detail="Entry not found.")
    await log_action(
        session,
        user_id=user.id,
        action="delete",
        resource="food_log",
        resource_id=str(entry.id),
    )
    await session.delete(entry)
    await session.flush()
    return {"status": "deleted"}
