"""Add timezone to users for correct daily aggregation (food, workouts, wellness).

Revision ID: 029
Revises: 028
Create Date: 2025-03-06

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "029"
down_revision: Union[str, None] = "028"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("timezone", sa.String(50), nullable=True, server_default="UTC"),
    )


def downgrade() -> None:
    op.drop_column("users", "timezone")
