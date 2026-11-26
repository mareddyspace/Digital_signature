"""Add employees.role_source: where each person's SignGuard role came from.

Existing people get "local", so every current role keeps working exactly as before.

Revision ID: 0002_role_source
Revises: 0001_baseline
Create Date: 2026-11-27
"""
from alembic import op
import sqlalchemy as sa

revision = "0002_role_source"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("employees") as batch:
        batch.add_column(sa.Column("role_source", sa.String(10), nullable=False, server_default="local"))


def downgrade() -> None:
    with op.batch_alter_table("employees") as batch:
        batch.drop_column("role_source")
