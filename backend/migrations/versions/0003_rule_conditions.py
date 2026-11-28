"""Richer rule conditions: specific people, exceptions, recipient domains and a schedule.

Every new column is empty or null by default, so existing rules match exactly as before.

Revision ID: 0003_rule_conditions
Revises: 0002_role_source
Create Date: 2026-11-27
"""
from alembic import op
import sqlalchemy as sa

revision = "0003_rule_conditions"
down_revision = "0002_role_source"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("signature_policies") as batch:
        batch.add_column(sa.Column("people", sa.Text(), nullable=False, server_default=""))
        batch.add_column(sa.Column("exclude_people", sa.Text(), nullable=False, server_default=""))
        batch.add_column(sa.Column("recipient_domains", sa.String(1000), nullable=False, server_default=""))
        batch.add_column(sa.Column("starts_at", sa.DateTime(), nullable=True))
        batch.add_column(sa.Column("ends_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("signature_policies") as batch:
        for col in ("ends_at", "starts_at", "recipient_domains", "exclude_people", "people"):
            batch.drop_column(col)
