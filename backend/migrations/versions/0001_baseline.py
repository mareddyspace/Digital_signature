"""Baseline: the SignGuard schema as of version 0.2 (18 tables).

Frozen on purpose. It must never import the models: later model changes belong in new
migrations, and this file has to keep producing exactly the schema that existing databases have.

Revision ID: 0001_baseline
Revises:
Create Date: 2026-11-26
"""
from alembic import op
import sqlalchemy as sa

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "audit_events",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("actor", sa.String(320), nullable=False),
        sa.Column("action", sa.String(100), nullable=False),
        sa.Column("target_type", sa.String(50), nullable=False),
        sa.Column("target_id", sa.String(100), nullable=False),
        sa.Column("details", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_audit_events_action", "audit_events", ["action"], unique=False)
    op.create_index("ix_audit_events_created_at", "audit_events", ["created_at"], unique=False)
    op.create_table(
        "brand_kit",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("company_name", sa.String(200), nullable=False),
        sa.Column("primary_color", sa.String(9), nullable=False),
        sa.Column("secondary_color", sa.String(9), nullable=False),
        sa.Column("accent_color", sa.String(9), nullable=False),
        sa.Column("palette", sa.String(500), nullable=False),
        sa.Column("font_family", sa.String(200), nullable=False),
        sa.Column("logo_url", sa.String(500), nullable=False),
        sa.Column("logo_width", sa.Integer(), nullable=False),
        sa.Column("website", sa.String(300), nullable=False),
        sa.Column("address", sa.String(300), nullable=False),
        sa.Column("linkedin_url", sa.String(300), nullable=False),
        sa.Column("twitter_url", sa.String(300), nullable=False),
        sa.Column("facebook_url", sa.String(300), nullable=False),
        sa.Column("instagram_url", sa.String(300), nullable=False),
        sa.Column("youtube_url", sa.String(300), nullable=False),
        sa.Column("max_width", sa.Integer(), nullable=False),
        sa.Column("require_logo", sa.Boolean(), nullable=False),
        sa.Column("enforce_compliance", sa.Boolean(), nullable=False),
        sa.Column("min_compliance_score", sa.Integer(), nullable=False),
        sa.Column("updated_by", sa.String(320), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "campaigns",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("headline", sa.String(200), nullable=False),
        sa.Column("body", sa.String(400), nullable=False),
        sa.Column("cta_text", sa.String(60), nullable=False),
        sa.Column("link_url", sa.String(500), nullable=False),
        sa.Column("image_url", sa.String(500), nullable=False),
        sa.Column("alt_text", sa.String(200), nullable=False),
        sa.Column("background", sa.String(9), nullable=False),
        sa.Column("text_color", sa.String(9), nullable=False),
        sa.Column("departments", sa.String(1000), nullable=False),
        sa.Column("recipient_type", sa.String(10), nullable=False),
        sa.Column("starts_at", sa.DateTime(), nullable=True),
        sa.Column("ends_at", sa.DateTime(), nullable=True),
        sa.Column("priority", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("impressions", sa.Integer(), nullable=False),
        sa.Column("clicks", sa.Integer(), nullable=False),
        sa.Column("created_by", sa.String(320), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "delegations",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("delegate_email", sa.String(320), nullable=False),
        sa.Column("owner_email", sa.String(320), nullable=False),
        sa.Column("reason", sa.String(500), nullable=False),
        sa.Column("starts_at", sa.DateTime(), nullable=False),
        sa.Column("ends_at", sa.DateTime(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("requested_by", sa.String(320), nullable=False),
        sa.Column("decided_by", sa.String(320), nullable=True),
        sa.Column("decided_at", sa.DateTime(), nullable=True),
        sa.Column("exchange_state", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_delegations_delegate_email", "delegations", ["delegate_email"], unique=False)
    op.create_index("ix_delegations_owner_email", "delegations", ["owner_email"], unique=False)
    op.create_table(
        "deployments",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("target", sa.String(30), nullable=False),
        sa.Column("scope", sa.String(20), nullable=False),
        sa.Column("scope_value", sa.String(2000), nullable=False),
        sa.Column("mode", sa.String(12), nullable=False),
        sa.Column("status", sa.String(12), nullable=False),
        sa.Column("total", sa.Integer(), nullable=False),
        sa.Column("succeeded", sa.Integer(), nullable=False),
        sa.Column("failed", sa.Integer(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("created_by", sa.String(320), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
    )
    op.create_table(
        "disclaimers",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("departments", sa.String(1000), nullable=False),
        sa.Column("recipient_type", sa.String(10), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("created_by", sa.String(320), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "employees",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("entra_object_id", sa.String(64), nullable=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("job_title", sa.String(200), nullable=False),
        sa.Column("department", sa.String(200), nullable=False),
        sa.Column("phone", sa.String(50), nullable=False),
        sa.Column("mobile", sa.String(50), nullable=False),
        sa.Column("manager_email", sa.String(320), nullable=False),
        sa.Column("photo_url", sa.String(500), nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("scope_department", sa.String(200), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("synced_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("entra_object_id"),
    )
    op.create_index("ix_employees_email", "employees", ["email"], unique=True)
    op.create_table(
        "mailbox_permissions",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("mailbox", sa.String(320), nullable=False),
        sa.Column("trustee", sa.String(320), nullable=False),
        sa.Column("type", sa.String(20), nullable=False),
        sa.Column("granted_at", sa.DateTime(), nullable=True),
        sa.Column("last_used", sa.DateTime(), nullable=True),
        sa.Column("first_seen", sa.DateTime(), nullable=False),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("review_state", sa.String(20), nullable=False),
    )
    op.create_index("ix_mailbox_permissions_mailbox", "mailbox_permissions", ["mailbox"], unique=False)
    op.create_index("ix_mailbox_permissions_trustee", "mailbox_permissions", ["trustee"], unique=False)
    op.create_table(
        "settings",
        sa.Column("key", sa.String(100), primary_key=True, nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column("updated_by", sa.String(320), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "signature_events",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("employee_email", sa.String(320), nullable=False),
        sa.Column("department", sa.String(200), nullable=False),
        sa.Column("template_name", sa.String(200), nullable=False),
        sa.Column("policy_name", sa.String(200), nullable=False),
        sa.Column("recipient_type", sa.String(10), nullable=False),
        sa.Column("message_type", sa.String(10), nullable=False),
        sa.Column("campaign_id", sa.Integer(), nullable=True),
        sa.Column("disclaimers", sa.Integer(), nullable=False),
        sa.Column("on_behalf", sa.Boolean(), nullable=False),
    )
    op.create_index("ix_signature_events_created_at", "signature_events", ["created_at"], unique=False)
    op.create_index("ix_signature_events_employee_email", "signature_events", ["employee_email"], unique=False)
    op.create_table(
        "signature_seals",
        sa.Column("code", sa.String(20), primary_key=True, nullable=False),
        sa.Column("version_id", sa.Integer(), nullable=True),
        sa.Column("sender_email", sa.String(320), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("text_sha256", sa.String(64), nullable=False),
        sa.Column("seal", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "templates",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.String(500), nullable=False),
        sa.Column("live_version_id", sa.Integer(), nullable=True),
        sa.Column("created_by", sa.String(320), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("name"),
    )
    op.create_table(
        "verification_codes",
        sa.Column("code", sa.String(20), primary_key=True, nullable=False),
        sa.Column("sender_email", sa.String(320), nullable=False),
        sa.Column("on_behalf_of_email", sa.String(320), nullable=True),
        sa.Column("recipient_hash", sa.Text(), nullable=False),
        sa.Column("subject_hash", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("sent_at", sa.DateTime(), nullable=True),
        sa.Column("check_count", sa.Integer(), nullable=False),
        sa.Column("last_checked_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_verification_codes_sender_email", "verification_codes", ["sender_email"], unique=False)
    op.create_table(
        "deployment_items",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("deployment_id", sa.Integer(), sa.ForeignKey("deployments.id"), nullable=False),
        sa.Column("employee_email", sa.String(320), nullable=False),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("message", sa.String(1000), nullable=False),
        sa.Column("template_name", sa.String(200), nullable=False),
        sa.Column("html", sa.Text(), nullable=False),
    )
    op.create_index("ix_deployment_items_deployment_id", "deployment_items", ["deployment_id"], unique=False)
    op.create_table(
        "signature_policies",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False),
        sa.Column("departments", sa.String(1000), nullable=False),
        sa.Column("recipient_type", sa.String(10), nullable=False),
        sa.Column("message_type", sa.String(10), nullable=False),
        sa.Column("template_id", sa.Integer(), sa.ForeignKey("templates.id"), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
    )
    op.create_table(
        "template_versions",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("template_id", sa.Integer(), sa.ForeignKey("templates.id"), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("html", sa.Text(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("created_by", sa.String(320), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("decided_by", sa.String(320), nullable=True),
        sa.Column("decided_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_template_versions_template_id", "template_versions", ["template_id"], unique=False)
    op.create_table(
        "template_designs",
        sa.Column("version_id", sa.Integer(), sa.ForeignKey("template_versions.id"), primary_key=True, nullable=False),
        sa.Column("design_json", sa.Text(), nullable=False),
    )
    op.create_table(
        "template_seals",
        sa.Column("version_id", sa.Integer(), sa.ForeignKey("template_versions.id"), primary_key=True, nullable=False),
        sa.Column("html_sha256", sa.String(64), nullable=False),
        sa.Column("seal", sa.String(64), nullable=False),
        sa.Column("sealed_by", sa.String(320), nullable=False),
        sa.Column("sealed_at", sa.DateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("template_seals")
    op.drop_table("template_designs")
    op.drop_table("template_versions")
    op.drop_table("signature_policies")
    op.drop_table("deployment_items")
    op.drop_table("verification_codes")
    op.drop_table("templates")
    op.drop_table("signature_seals")
    op.drop_table("signature_events")
    op.drop_table("settings")
    op.drop_table("mailbox_permissions")
    op.drop_table("employees")
    op.drop_table("disclaimers")
    op.drop_table("deployments")
    op.drop_table("delegations")
    op.drop_table("campaigns")
    op.drop_table("brand_kit")
    op.drop_table("audit_events")
