"""Tag each served signature with where the request came from (real Outlook or the simulator).

Existing rows are marked "unknown": before this change the simulator and the add-in were
indistinguishable, and no real Outlook mailbox had used the add-in yet.

Revision ID: 0004_signature_event_source
Revises: 0003_rule_conditions
Create Date: 2026-11-28
"""
from alembic import op
import sqlalchemy as sa

revision = "0004_signature_event_source"
down_revision = "0003_rule_conditions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("signature_events") as batch:
        batch.add_column(sa.Column("source", sa.String(20), nullable=False, server_default="unknown"))


def downgrade() -> None:
    with op.batch_alter_table("signature_events") as batch:
        batch.drop_column("source")
