"""Add user_weekly_summaries table for RAG weekly coach memory.

Revision ID: 027
Revises: 026
Create Date: 2025-03-04

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "027"
down_revision: Union[str, None] = "026"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "user_weekly_summaries" in inspector.get_table_names():
        return  # table already exists (e.g. 027 was applied when it had down_revision=025)
    op.create_table(
        "user_weekly_summaries",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("week_start_date", sa.Date(), nullable=False),
        sa.Column("summary_text", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "week_start_date", name="uq_user_weekly_summary_user_week"),
    )
    op.create_index(
        "ix_user_weekly_summaries_user_id",
        "user_weekly_summaries",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "ix_user_weekly_summaries_week_start_date",
        "user_weekly_summaries",
        ["week_start_date"],
        unique=False,
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "user_weekly_summaries" not in inspector.get_table_names():
        return
    op.drop_index("ix_user_weekly_summaries_week_start_date", table_name="user_weekly_summaries")
    op.drop_index("ix_user_weekly_summaries_user_id", table_name="user_weekly_summaries")
    op.drop_table("user_weekly_summaries")
