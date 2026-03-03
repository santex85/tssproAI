import json
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Path, Query, UploadFile
from pydantic import ValidationError as PydanticValidationError

from app.api.deps import check_photo_usage, get_current_user, get_request_locale
from app.core.rate_limit import check_and_consume_photo_ai_limit
from app.db.session import get_db
from app.models.food_log import FoodLog, MealType
from app.models.user import User
from app.models.wellness_cache import WellnessCache
from app.schemas.nutrition import NutritionAnalyzeResponse
from app.schemas.photo import PhotoAnalyzeResponse, PhotoFoodResponse, PhotoSleepResponse, PhotoWellnessResponse, PhotoWorkoutResponse, WellnessPhotoResult, WorkoutPhotoResult
from app.schemas.sleep_extraction import SleepExtractionResponse, SleepExtractionResult, SleepReanalyzeRequest
from app.models.sleep_extraction import SleepExtraction
from app.services.gemini_nutrition import analyze_food_from_image
from app.services.gemini_photo_analyzer import classify_and_analyze_image
from app.services.gemini_sleep_parser import extract_sleep_data
from app.services.image_resize import resize_image_for_ai_async
from app.services.sleep_analysis import analyze_and_save_sleep, save_sleep_result, update_sleep_extraction_result
from app.services.audit import log_action
from app.services.storage import download_image, upload_image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/photo", tags=["photo"])


def _validate_image(file: UploadFile, image_bytes: bytes) -> None:
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image")
    if len(image_bytes) == 0:
        raise HTTPException(status_code=400, detail="File is empty or invalid.")
    if len(image_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image too large (max 10MB)")
    magic = image_bytes[:12] if len(image_bytes) >= 12 else image_bytes
    if not (
        magic.startswith(b"\xff\xd8\xff")
        or magic.startswith(b"\x89PNG\r\n\x1a\n")
        or magic.startswith(b"GIF87a")
        or magic.startswith(b"GIF89a")
        or (magic[:4] == b"RIFF" and magic[8:12] == b"WEBP")
    ):
        raise HTTPException(status_code=400, detail="File must be a valid image (JPEG, PNG, GIF or WebP).")


def _parse_optional_date(value: str | None) -> date | None:
    """Parse YYYY-MM-DD from client; return None if invalid or missing."""
    if not value or not isinstance(value, str):
        return None
    s = value.strip()[:10]
    if len(s) == 10 and s[4] == "-" and s[7] == "-":
        try:
            return date.fromisoformat(s)
        except ValueError:
            pass
    return None


@router.post(
    "/analyze",
    response_model=PhotoAnalyzeResponse,
    summary="Analyze photo (food or sleep)",
    responses={
        400: {"description": "Invalid image"},
        401: {"description": "Not authenticated"},
        422: {"description": "AI could not analyze"},
        429: {"description": "Daily photo analysis limit exceeded"},
        502: {"description": "AI service unavailable"},
    },
)
async def analyze_photo(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    locale: Annotated[str, Depends(get_request_locale)],
    _usage: Annotated[None, Depends(check_photo_usage)],
    file: Annotated[UploadFile, File(description="Photo: food or sleep data")],
    meal_type: Annotated[str | None, Form()] = None,
    wellness_date: Annotated[str | None, Form(description="Date for wellness/sleep save (YYYY-MM-DD), client's today")] = None,
    save: Annotated[bool, Query(description="If false, analyze only and do not save")] = True,
) -> PhotoAnalyzeResponse:
    """
    Upload any photo. AI classifies as food or sleep data; then analyzes and optionally saves.
    If save=False, returns preview data without writing to DB.
    Returns either { type: "food", food: {...} } or { type: "sleep", sleep: {...} }.
    """
    await check_and_consume_photo_ai_limit(user.id, user.is_premium)
    image_bytes = await file.read()
    _validate_image(file, image_bytes)
    image_bytes = await resize_image_for_ai_async(image_bytes)

    try:
        kind, result = await classify_and_analyze_image(image_bytes, locale=locale)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except PydanticValidationError:
        raise HTTPException(status_code=422, detail="Could not parse analysis result. Please try another photo.")
    except Exception:
        logging.exception("Photo classify+analyze failed")
        raise HTTPException(status_code=502, detail="AI analysis failed. Please try again.")

    if kind == "food":
        food_result = result
        extended_nutrients: dict | None = None
        try:
            food_result, extended_nutrients = await analyze_food_from_image(
                image_bytes, extended=True, locale=locale
            )
        except (ValueError, Exception):
            pass  # keep classifier result if extended analysis fails
        if save:
            meal = (meal_type or MealType.other.value).lower()
            if meal not in [e.value for e in MealType]:
                meal = MealType.other.value
            log = FoodLog(
                user_id=user.id,
                timestamp=datetime.utcnow(),
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
                details={"source": "photo.analyze"},
            )
            return PhotoFoodResponse(
                type="food",
                food=NutritionAnalyzeResponse(
                    id=log.id,
                    name=log.name,
                    portion_grams=log.portion_grams,
                    calories=log.calories,
                    protein_g=log.protein_g,
                    fat_g=log.fat_g,
                    carbs_g=log.carbs_g,
                    extended_nutrients=log.extended_nutrients if user.is_premium else None,
                ),
            )
        return PhotoFoodResponse(
            type="food",
            food=NutritionAnalyzeResponse(
                id=0,
                name=food_result.name,
                portion_grams=food_result.portion_grams,
                calories=food_result.calories,
                protein_g=food_result.protein_g,
                fat_g=food_result.fat_g,
                carbs_g=food_result.carbs_g,
                extended_nutrients=extended_nutrients if user.is_premium else None,
            ),
        )

    if kind == "wellness":
        result_wellness: WellnessPhotoResult = result
        save_date = _parse_optional_date(wellness_date) or date.today()
        if save and (result_wellness.rhr is not None or result_wellness.hrv is not None):
            r = await session.execute(
                select(WellnessCache).where(
                    WellnessCache.user_id == user.id,
                    WellnessCache.date == save_date,
                )
            )
            row = r.scalar_one_or_none()
            if row:
                if result_wellness.rhr is not None:
                    row.rhr = float(result_wellness.rhr)
                if result_wellness.hrv is not None:
                    row.hrv = float(result_wellness.hrv)
            else:
                session.add(
                    WellnessCache(
                        user_id=user.id,
                        date=save_date,
                        rhr=float(result_wellness.rhr) if result_wellness.rhr is not None else None,
                        hrv=float(result_wellness.hrv) if result_wellness.hrv is not None else None,
                    )
                )
            await session.commit()
        return PhotoWellnessResponse(
            type="wellness",
            wellness=WellnessPhotoResult(rhr=result_wellness.rhr, hrv=result_wellness.hrv),
        )

    if kind == "workout":
        # result is WorkoutPhotoResult
        return PhotoWorkoutResponse(
            type="workout",
            workout=result,
        )

    # kind == "sleep"
    if save:
        try:
            sleep_result: SleepExtractionResult = result
            client_date = _parse_optional_date(wellness_date)
            if client_date and not (sleep_result.date and str(sleep_result.date).strip()):
                sleep_result = sleep_result.model_copy(update={"date": client_date.isoformat()})
            record, data = await save_sleep_result(session, user.id, sleep_result)
            await session.commit()
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))
        except Exception:
            logging.exception("Sleep save failed")
            raise HTTPException(status_code=502, detail="Sleep data save failed. Please try again.")
        return PhotoSleepResponse(
            type="sleep",
            sleep=SleepExtractionResponse(
                id=record.id,
                extracted_data=data,
                created_at=record.created_at.isoformat() if record.created_at else "",
            ),
        )
    data = result.model_dump(mode="json")
    return PhotoSleepResponse(
        type="sleep",
        sleep=SleepExtractionResponse(
            id=0,
            extracted_data=data,
            created_at="",
        ),
    )


@router.post(
    "/analyze-sleep",
    response_model=SleepExtractionResponse,
    summary="Extract sleep data from screenshot",
    responses={
        400: {"description": "Invalid image"},
        401: {"description": "Not authenticated"},
        422: {"description": "Could not extract sleep data"},
        429: {"description": "Daily photo analysis limit exceeded"},
        502: {"description": "Sleep extraction failed"},
    },
)
async def analyze_sleep_photo(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    locale: Annotated[str, Depends(get_request_locale)],
    file: Annotated[UploadFile, File(description="Sleep tracker screenshot")],
    mode: Annotated[str, Query(description="Extraction mode: lite (default) or full")] = "lite",
) -> SleepExtractionResponse:
    """Extract sleep data from a screenshot using the sleep parser. mode=lite (fewer tokens) or full."""
    await check_and_consume_photo_ai_limit(user.id, user.is_premium)
    if mode not in ("lite", "full"):
        mode = "lite"
    image_bytes = await file.read()
    _validate_image(file, image_bytes)
    image_storage_path: str | None = None
    try:
        image_storage_path = await upload_image(image_bytes, user.id, category="sleep")
    except Exception:
        logging.exception("Failed to store sleep image for user_id=%s", user.id)
    image_bytes = await resize_image_for_ai_async(image_bytes)
    try:
        record, data = await analyze_and_save_sleep(
            session, user.id, image_bytes, mode=mode, image_storage_path=image_storage_path, locale=locale
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception:
        logging.exception("Sleep extraction failed")
        raise HTTPException(status_code=502, detail="Sleep extraction failed. Please try again.")
    await session.commit()
    await session.refresh(record)
    return SleepExtractionResponse(
        id=record.id,
        extracted_data=data,
        created_at=record.created_at.isoformat() if record.created_at else "",
    )


@router.post(
    "/save-sleep",
    response_model=SleepExtractionResponse,
    summary="Save extracted sleep data from preview",
    responses={
        401: {"description": "Not authenticated"},
    },
)
async def save_sleep_from_preview(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    body: SleepExtractionResult,
) -> SleepExtractionResponse:
    """
    Save previously extracted sleep data (e.g. from analyze with save=false).
    """
    record, data = await save_sleep_result(session, user.id, body)
    await session.commit()
    await session.refresh(record)
    return SleepExtractionResponse(
        id=record.id,
        extracted_data=data,
        created_at=record.created_at.isoformat() if record.created_at else "",
    )


@router.post(
    "/sleep-extractions/{extraction_id}/reanalyze",
    response_model=SleepExtractionResponse,
    summary="Re-analyze sleep photo with user correction (premium)",
    responses={
        400: {"description": "No image for re-analysis"},
        401: {"description": "Not authenticated"},
        403: {"description": "Premium required"},
        404: {"description": "Extraction not found"},
        422: {"description": "Could not extract sleep data"},
        429: {"description": "Daily photo analysis limit exceeded"},
        502: {"description": "Sleep extraction failed"},
    },
)
async def reanalyze_sleep_extraction(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    locale: Annotated[str, Depends(get_request_locale)],
    extraction_id: Annotated[int, Path(description="Sleep extraction ID")],
    body: SleepReanalyzeRequest,
) -> SleepExtractionResponse:
    """Re-analyze stored sleep image with user correction; update extraction. Premium only."""
    await check_and_consume_photo_ai_limit(user.id, user.is_premium)
    if not user.is_premium:
        raise HTTPException(status_code=403, detail="Premium required for re-analysis.")
    result = await session.execute(
        select(SleepExtraction).where(
            SleepExtraction.id == extraction_id,
            SleepExtraction.user_id == user.id,
        )
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Extraction not found.")
    if not record.image_storage_path:
        raise HTTPException(status_code=400, detail="No image for re-analysis.")
    try:
        image_bytes = await download_image(record.image_storage_path)
    except Exception as e:
        logging.exception("Failed to download sleep image for extraction_id=%s", extraction_id)
        raise HTTPException(status_code=502, detail="Failed to load stored image.") from e
    image_bytes = await resize_image_for_ai_async(image_bytes)
    try:
        new_result = await extract_sleep_data(
            image_bytes, mode="lite", user_correction=body.correction, locale=locale
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception:
        logging.exception("Sleep reanalyze failed for extraction_id=%s", extraction_id)
        raise HTTPException(status_code=502, detail="Sleep extraction failed. Please try again.")
    data = await update_sleep_extraction_result(session, user.id, record, new_result)
    await log_action(
        session,
        user_id=user.id,
        action="reanalyze",
        resource="sleep_extraction",
        resource_id=str(record.id),
        details={"correction": body.correction},
    )
    await session.refresh(record)
    return SleepExtractionResponse(
        id=record.id,
        extracted_data=data,
        created_at=record.created_at.isoformat() if record.created_at else "",
    )


@router.delete(
    "/sleep-extractions/{extraction_id}",
    status_code=204,
    summary="Delete a sleep extraction",
    responses={
        401: {"description": "Not authenticated"},
        404: {"description": "Extraction not found"},
    },
)
async def delete_sleep_extraction(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    extraction_id: Annotated[int, Path(description="Sleep extraction ID")],
) -> None:
    """Delete a sleep extraction (from photo). Own records only."""
    result = await session.execute(
        select(SleepExtraction).where(
            SleepExtraction.id == extraction_id,
            SleepExtraction.user_id == user.id,
        )
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Extraction not found.")
    await session.delete(record)
    await session.commit()


@router.get(
    "/sleep-extractions",
    response_model=list[dict],
    summary="List sleep extractions",
    responses={
        401: {"description": "Not authenticated"},
    },
)
async def list_sleep_extractions(
    session: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    from_date: date | None = Query(None, description="YYYY-MM-DD"),
    to_date: date | None = Query(None, description="YYYY-MM-DD"),
    limit: int = Query(60, ge=1, le=90),
) -> list[dict]:
    """List sleep extractions (from photos) for dashboard. Returns created_at, sleep_date, sleep_hours, actual_sleep_hours."""
    uid = user.id
    end_date = to_date or date.today()
    start_date = from_date or (end_date - timedelta(days=limit))
    from_dt = datetime.combine(start_date, datetime.min.time()).replace(tzinfo=timezone.utc)
    to_dt = datetime.combine(end_date, datetime.max.time()).replace(tzinfo=timezone.utc)
    r = await session.execute(
        select(
            SleepExtraction.id,
            SleepExtraction.created_at,
            SleepExtraction.extracted_data,
            SleepExtraction.image_storage_path,
        ).where(
            SleepExtraction.user_id == uid,
            SleepExtraction.created_at >= from_dt,
            SleepExtraction.created_at <= to_dt,
        ).order_by(SleepExtraction.created_at.desc()).limit(limit)
    )
    out = []
    for row in r.all():
        ext_id, created_at, data_json, image_storage_path = row
        try:
            data = json.loads(data_json) if isinstance(data_json, str) else data_json
        except (json.JSONDecodeError, TypeError):
            continue
        sh = data.get("sleep_hours")
        ah = data.get("actual_sleep_hours")
        if sh is None and data.get("sleep_minutes") is not None:
            sh = round(data["sleep_minutes"] / 60.0, 2)
        if ah is None and data.get("actual_sleep_minutes") is not None:
            ah = round(data["actual_sleep_minutes"] / 60.0, 2)
        out.append({
            "id": ext_id,
            "created_at": created_at.isoformat() if created_at else "",
            "sleep_date": data.get("date"),
            "sleep_hours": sh,
            "actual_sleep_hours": ah,
            "quality_score": data.get("quality_score"),
            "can_reanalyze": bool(image_storage_path) and user.is_premium,
        })
    return out
