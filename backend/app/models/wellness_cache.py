from datetime import date
from sqlalchemy import Float, Date, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON
from app.db.base import Base


class WellnessCache(Base):
    __tablename__ = "wellness_cache"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    sleep_hours: Mapped[float | None] = mapped_column(Float, nullable=True)
    sleep_source: Mapped[str | None] = mapped_column(String(20), nullable=True)  # 'manual' | 'photo' | 'sync'
    rhr: Mapped[float | None] = mapped_column(Float, nullable=True)  # resting heart rate
    hrv: Mapped[float | None] = mapped_column(Float, nullable=True)
    ctl: Mapped[float | None] = mapped_column(Float, nullable=True)  # chronic training load
    atl: Mapped[float | None] = mapped_column(Float, nullable=True)  # acute training load
    tsb: Mapped[float | None] = mapped_column(Float, nullable=True)  # training stress balance
    weight_kg: Mapped[float | None] = mapped_column(Float, nullable=True)  # from Intervals or manual
    sport_info: Mapped[list | dict | None] = mapped_column(JSON, nullable=True)  # Intervals sportInfo: [{type, eftp, wPrime, pMax}]

    user: Mapped["User"] = relationship("User", back_populates="wellness_cache")
