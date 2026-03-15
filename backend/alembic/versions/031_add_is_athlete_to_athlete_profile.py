"""Add is_athlete to athlete_profiles.

Revision ID: 031
Revises: 030
Create Date: 2025-03-15

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "031"
down_revision: Union[str, None] = "030"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "athlete_profiles",
        sa.Column("is_athlete", sa.Boolean(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("athlete_profiles", "is_athlete")
