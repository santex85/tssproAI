from __future__ import annotations

from datetime import datetime
from sqlalchemy import String, DateTime, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    push_token: Mapped[str | None] = mapped_column(String(512), nullable=True)
    push_platform: Mapped[str | None] = mapped_column(String(32), nullable=True)
    is_premium: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_superuser: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    stripe_customer_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    locale: Mapped[str | None] = mapped_column(String(10), nullable=True, default="ru")
    timezone: Mapped[str | None] = mapped_column(String(50), nullable=True, default="UTC")

    food_logs: Mapped[list["FoodLog"]] = relationship("FoodLog", back_populates="user")
    wellness_cache: Mapped[list["WellnessCache"]] = relationship("WellnessCache", back_populates="user")
    chat_messages: Mapped[list["ChatMessage"]] = relationship("ChatMessage", back_populates="user")
    chat_threads: Mapped[list["ChatThread"]] = relationship(
        "ChatThread", back_populates="user", cascade="all, delete-orphan"
    )
    intervals_credentials: Mapped["IntervalsCredentials | None"] = relationship(
        "IntervalsCredentials", back_populates="user", uselist=False
    )
    sleep_extractions: Mapped[list["SleepExtraction"]] = relationship(
        "SleepExtraction", back_populates="user", cascade="all, delete-orphan"
    )
    athlete_profile: Mapped["AthleteProfile | None"] = relationship(
        "AthleteProfile", back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
    workouts: Mapped[list["Workout"]] = relationship(
        "Workout", back_populates="user", cascade="all, delete-orphan"
    )
    refresh_tokens: Mapped[list["RefreshToken"]] = relationship(
        "RefreshToken", back_populates="user", cascade="all, delete-orphan"
    )
    subscription: Mapped["Subscription | None"] = relationship(
        "Subscription", back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
    daily_usage: Mapped[list["DailyUsage"]] = relationship(
        "DailyUsage", back_populates="user", cascade="all, delete-orphan"
    )
    retention_reminders_sent: Mapped[list["RetentionReminderSent"]] = relationship(
        "RetentionReminderSent", back_populates="user", cascade="all, delete-orphan"
    )
    weekly_summaries: Mapped[list["UserWeeklySummary"]] = relationship(
        "UserWeeklySummary", back_populates="user", cascade="all, delete-orphan"
    )
