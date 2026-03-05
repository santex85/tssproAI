"""Add sleep_source to wellness_cache (manual | photo | sync).

Revision ID: 028
Revises: 027
Create Date: 2025-03-05

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "028"
down_revision: Union[str, None] = "027"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "wellness_cache",
        sa.Column("sleep_source", sa.String(20), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("wellness_cache", "sleep_source")
