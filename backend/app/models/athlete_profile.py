from __future__ import annotations

from datetime import date, datetime
from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base


class AthleteProfile(Base):
    __tablename__ = "athlete_profiles"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    weight_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    height_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    birth_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ftp: Mapped[int | None] = mapped_column(Integer, nullable=True)
    calorie_goal: Mapped[float | None] = mapped_column(Float, nullable=True)
    protein_goal: Mapped[float | None] = mapped_column(Float, nullable=True)
    fat_goal: Mapped[float | None] = mapped_column(Float, nullable=True)
    carbs_goal: Mapped[float | None] = mapped_column(Float, nullable=True)
    target_race_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    target_race_name: Mapped[str | None] = mapped_column(String(512), nullable=True)
    is_athlete: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    user: Mapped["User"] = relationship("User", back_populates="athlete_profile")
