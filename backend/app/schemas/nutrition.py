from pydantic import BaseModel, Field


class NutritionAnalysisResult(BaseModel):
    """Structured output from Gemini for food photo analysis."""

    name: str = Field(..., description="Short name of the dish")
    portion_grams: float = Field(..., ge=0, le=10000, description="Estimated portion weight in grams")
    calories: float = Field(..., ge=0, le=10000, description="Estimated calories")
    protein_g: float = Field(..., ge=0, le=500, description="Protein in grams")
    fat_g: float = Field(..., ge=0, le=500, description="Fat in grams")
    carbs_g: float = Field(..., ge=0, le=1000, description="Carbohydrates in grams")


class NutritionAnalyzeResponse(BaseModel):
    name: str
    portion_grams: float
    calories: float
    protein_g: float
    fat_g: float
    carbs_g: float
    id: int | None = None
    extended_nutrients: dict | None = None


class CreateFoodEntryRequest(BaseModel):
    """Body for POST /nutrition/entries (create one entry from preview or manual)."""

    name: str = Field(..., min_length=1, max_length=512)
    portion_grams: float = Field(..., ge=0, le=10000)
    calories: float = Field(..., ge=0, le=10000)
    protein_g: float = Field(..., ge=0, le=500)
    fat_g: float = Field(..., ge=0, le=500)
    carbs_g: float = Field(..., ge=0, le=1000)
    meal_type: str | None = None
    date: str | None = Field(None, description="YYYY-MM-DD; default today")


class ReanalyzeRequest(BaseModel):
    """Body for POST /nutrition/entries/{id}/reanalyze (premium). Uses current name/portion if not provided."""

    name: str | None = Field(None, min_length=1, max_length=512)
    portion_grams: float | None = Field(None, ge=0, le=10000)
    correction: str | None = Field(None, max_length=512)


class AddFoodFromTextRequest(BaseModel):
    """Body for POST /nutrition/entries/add-from-text. AI analyzes by name and portion, saves to food_log."""

    name: str = Field(..., min_length=1, max_length=512)
    portion_grams: float = Field(..., ge=0, le=10000)
    meal_type: str | None = None
    date: str | None = Field(None, description="YYYY-MM-DD; default today")


class NutritionEntryUpdate(BaseModel):
    """Optional fields for PATCH; same bounds as NutritionAnalysisResult."""

    name: str | None = Field(None, min_length=1, max_length=512)
    portion_grams: float | None = Field(None, ge=0, le=10000)
    calories: float | None = Field(None, ge=0, le=10000)
    protein_g: float | None = Field(None, ge=0, le=500)
    fat_g: float | None = Field(None, ge=0, le=500)
    carbs_g: float | None = Field(None, ge=0, le=1000)
    meal_type: str | None = None


class NutritionDayEntry(BaseModel):
    id: int
    name: str
    portion_grams: float
    calories: float
    protein_g: float
    fat_g: float
    carbs_g: float
    meal_type: str
    timestamp: str
    extended_nutrients: dict | None = None
    can_reanalyze: bool = False


class NutritionDayTotals(BaseModel):
    calories: float
    protein_g: float
    fat_g: float
    carbs_g: float


class NutritionDayResponse(BaseModel):
    date: str
    entries: list[NutritionDayEntry]
    totals: NutritionDayTotals
