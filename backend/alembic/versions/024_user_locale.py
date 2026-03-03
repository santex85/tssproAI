"""Add locale to users for language preference (UI, AI, push).

Revision ID: 024
Revises: 023
Create Date: 2025-02-27

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "024"
down_revision: Union[str, None] = "023"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("locale", sa.String(10), nullable=True, server_default="ru"))


def downgrade() -> None:
    op.drop_column("users", "locale")
