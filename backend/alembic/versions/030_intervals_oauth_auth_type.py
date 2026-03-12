"""Add auth_type to intervals_credentials for OAuth vs API key.

Revision ID: 030
Revises: 029
Create Date: 2025-03-12

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "030"
down_revision: Union[str, None] = "029"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "intervals_credentials",
        sa.Column("auth_type", sa.String(16), nullable=False, server_default="api_key"),
    )


def downgrade() -> None:
    op.drop_column("intervals_credentials", "auth_type")
