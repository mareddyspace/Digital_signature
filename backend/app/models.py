"""Database tables. All timestamps are naive UTC (see utcnow)."""
from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class Employee(Base):
    __tablename__ = "employees"
    id: Mapped[int] = mapped_column(primary_key=True)
    entra_object_id: Mapped[str | None] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    job_title: Mapped[str] = mapped_column(String(200), default="")
    department: Mapped[str] = mapped_column(String(200), default="")
    phone: Mapped[str] = mapped_column(String(50), default="")
    mobile: Mapped[str] = mapped_column(String(50), default="")
    manager_email: Mapped[str] = mapped_column(String(320), default="")
    photo_url: Mapped[str] = mapped_column(String(500), default="")
    # admin | dept_admin | auditor | employee
    role: Mapped[str] = mapped_column(String(20), default="employee")
    # Where `role` came from: "local" (set in SignGuard, e.g. sample data or BOOTSTRAP_ADMINS)
    # or "entra" (an app role in the person's access token, re-checked on every sign-in).
    role_source: Mapped[str] = mapped_column(String(10), default="local", server_default="local")
    # For dept_admin: the department they manage.
    scope_department: Mapped[str] = mapped_column(String(200), default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Template(Base):
    __tablename__ = "templates"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), unique=True)
    description: Mapped[str] = mapped_column(String(500), default="")
    live_version_id: Mapped[int | None] = mapped_column(Integer)
    created_by: Mapped[str] = mapped_column(String(320))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class TemplateVersion(Base):
    """Never edited after submission: every edit creates a new version."""

    __tablename__ = "template_versions"
    id: Mapped[int] = mapped_column(primary_key=True)
    template_id: Mapped[int] = mapped_column(ForeignKey("templates.id"), index=True)
    number: Mapped[int] = mapped_column(Integer)
    html: Mapped[str] = mapped_column(Text)
    # draft | pending | live | retired | rejected
    status: Mapped[str] = mapped_column(String(20), default="draft")
    created_by: Mapped[str] = mapped_column(String(320))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    decided_by: Mapped[str | None] = mapped_column(String(320))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime)


class SignaturePolicy(Base):
    """Picks a template. Lowest priority number that matches wins."""

    __tablename__ = "signature_policies"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    priority: Mapped[int] = mapped_column(Integer, default=100)
    # Comma-separated department names; empty = any department.
    departments: Mapped[str] = mapped_column(String(1000), default="")
    # internal | external | any
    recipient_type: Mapped[str] = mapped_column(String(10), default="any")
    # new | reply | any
    message_type: Mapped[str] = mapped_column(String(10), default="any")
    template_id: Mapped[int] = mapped_column(ForeignKey("templates.id"))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    # Comma-separated sender emails. A rule with departments and people matches either.
    people: Mapped[str] = mapped_column(Text, default="", server_default="")
    # Comma-separated sender emails this rule never applies to.
    exclude_people: Mapped[str] = mapped_column(Text, default="", server_default="")
    # Comma-separated domains; when set, at least one recipient must be in one (subdomains included).
    recipient_domains: Mapped[str] = mapped_column(String(1000), default="", server_default="")
    # Optional schedule (UTC). Outside it the rule is skipped.
    starts_at: Mapped[datetime | None] = mapped_column(DateTime)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime)


class Delegation(Base):
    __tablename__ = "delegations"
    id: Mapped[int] = mapped_column(primary_key=True)
    delegate_email: Mapped[str] = mapped_column(String(320), index=True)
    owner_email: Mapped[str] = mapped_column(String(320), index=True)
    reason: Mapped[str] = mapped_column(String(500), default="")
    starts_at: Mapped[datetime] = mapped_column(DateTime)
    ends_at: Mapped[datetime] = mapped_column(DateTime)
    # pending | approved | rejected | revoked | expired
    status: Mapped[str] = mapped_column(String(20), default="pending")
    requested_by: Mapped[str] = mapped_column(String(320))
    decided_by: Mapped[str | None] = mapped_column(String(320))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime)
    # not_granted | simulated | granted | removed  (real grants come from workers/*.ps1)
    exchange_state: Mapped[str] = mapped_column(String(20), default="not_granted")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class MailboxPermission(Base):
    __tablename__ = "mailbox_permissions"
    id: Mapped[int] = mapped_column(primary_key=True)
    mailbox: Mapped[str] = mapped_column(String(320), index=True)
    trustee: Mapped[str] = mapped_column(String(320), index=True)
    # full_access | send_as | send_on_behalf
    type: Mapped[str] = mapped_column(String(20))
    granted_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_used: Mapped[datetime | None] = mapped_column(DateTime)
    first_seen: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    # sample | import
    source: Mapped[str] = mapped_column(String(20), default="import")
    # open | accepted | removed
    review_state: Mapped[str] = mapped_column(String(20), default="open")


class VerificationCode(Base):
    __tablename__ = "verification_codes"
    code: Mapped[str] = mapped_column(String(20), primary_key=True)
    sender_email: Mapped[str] = mapped_column(String(320), index=True)
    on_behalf_of_email: Mapped[str | None] = mapped_column(String(320))
    # Comma-separated HMACs of each recipient; the addresses themselves are never stored.
    recipient_hash: Mapped[str] = mapped_column(Text, default="")
    subject_hash: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime)
    check_count: Mapped[int] = mapped_column(Integer, default=0)
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime)


class AuditEvent(Base):
    """Append-only: the API never updates or deletes rows here."""

    __tablename__ = "audit_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    actor: Mapped[str] = mapped_column(String(320))
    action: Mapped[str] = mapped_column(String(100), index=True)
    target_type: Mapped[str] = mapped_column(String(50), default="")
    target_id: Mapped[str] = mapped_column(String(100), default="")
    details: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


# ---------------------------------------------------------------------------
# Signature platform tables (brand, designer, campaigns, disclaimers, integrity,
# analytics, deployments). All new tables, so existing databases upgrade by
# create_all() on startup with no column changes.
# ---------------------------------------------------------------------------


class BrandKit(Base):
    """One row (id=1): the company's brand rules used by the designer and compliance checks."""

    __tablename__ = "brand_kit"
    id: Mapped[int] = mapped_column(primary_key=True)
    company_name: Mapped[str] = mapped_column(String(200), default="")
    primary_color: Mapped[str] = mapped_column(String(9), default="#2878d0")
    secondary_color: Mapped[str] = mapped_column(String(9), default="#11263f")
    accent_color: Mapped[str] = mapped_column(String(9), default="#16865b")
    # Extra approved colours, comma-separated hex values.
    palette: Mapped[str] = mapped_column(String(500), default="")
    font_family: Mapped[str] = mapped_column(String(200), default="Arial, Helvetica, sans-serif")
    logo_url: Mapped[str] = mapped_column(String(500), default="")
    logo_width: Mapped[int] = mapped_column(Integer, default=120)
    website: Mapped[str] = mapped_column(String(300), default="")
    address: Mapped[str] = mapped_column(String(300), default="")
    linkedin_url: Mapped[str] = mapped_column(String(300), default="")
    twitter_url: Mapped[str] = mapped_column(String(300), default="")
    facebook_url: Mapped[str] = mapped_column(String(300), default="")
    instagram_url: Mapped[str] = mapped_column(String(300), default="")
    youtube_url: Mapped[str] = mapped_column(String(300), default="")
    max_width: Mapped[int] = mapped_column(Integer, default=600)
    require_logo: Mapped[bool] = mapped_column(Boolean, default=False)
    # When on, a template version below min_compliance_score can't be submitted.
    enforce_compliance: Mapped[bool] = mapped_column(Boolean, default=False)
    min_compliance_score: Mapped[int] = mapped_column(Integer, default=70)
    updated_by: Mapped[str] = mapped_column(String(320), default="seed")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class TemplateDesign(Base):
    """Designer blocks (JSON) behind a template version, so it can be re-opened in the designer."""

    __tablename__ = "template_designs"
    version_id: Mapped[int] = mapped_column(ForeignKey("template_versions.id"), primary_key=True)
    design_json: Mapped[str] = mapped_column(Text)


class TemplateSeal(Base):
    """HMAC over an approved version's HTML, written at approval. A mismatch means tampering."""

    __tablename__ = "template_seals"
    version_id: Mapped[int] = mapped_column(ForeignKey("template_versions.id"), primary_key=True)
    html_sha256: Mapped[str] = mapped_column(String(64))
    seal: Mapped[str] = mapped_column(String(64))
    sealed_by: Mapped[str] = mapped_column(String(320))
    sealed_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Campaign(Base):
    """Marketing banner shown under signatures that match its audience and dates."""

    __tablename__ = "campaigns"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    headline: Mapped[str] = mapped_column(String(200), default="")
    body: Mapped[str] = mapped_column(String(400), default="")
    cta_text: Mapped[str] = mapped_column(String(60), default="Learn more")
    link_url: Mapped[str] = mapped_column(String(500), default="")
    # Optional image banner; when empty a text banner (works everywhere, no image blocking) is used.
    image_url: Mapped[str] = mapped_column(String(500), default="")
    alt_text: Mapped[str] = mapped_column(String(200), default="")
    background: Mapped[str] = mapped_column(String(9), default="#11263f")
    text_color: Mapped[str] = mapped_column(String(9), default="#ffffff")
    departments: Mapped[str] = mapped_column(String(1000), default="")
    # internal | external | any
    recipient_type: Mapped[str] = mapped_column(String(10), default="external")
    starts_at: Mapped[datetime | None] = mapped_column(DateTime)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime)
    priority: Mapped[int] = mapped_column(Integer, default=100)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    impressions: Mapped[int] = mapped_column(Integer, default=0)
    clicks: Mapped[int] = mapped_column(Integer, default=0)
    created_by: Mapped[str] = mapped_column(String(320), default="seed")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Disclaimer(Base):
    """Legal text added under signatures that match. Every matching disclaimer is added, by priority."""

    __tablename__ = "disclaimers"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    text: Mapped[str] = mapped_column(Text)
    departments: Mapped[str] = mapped_column(String(1000), default="")
    recipient_type: Mapped[str] = mapped_column(String(10), default="external")
    priority: Mapped[int] = mapped_column(Integer, default=100)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by: Mapped[str] = mapped_column(String(320), default="seed")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class SignatureSeal(Base):
    """What an email's signature said when SignGuard issued it, keyed by its verification code."""

    __tablename__ = "signature_seals"
    code: Mapped[str] = mapped_column(String(20), primary_key=True)
    version_id: Mapped[int | None] = mapped_column(Integer)
    sender_email: Mapped[str] = mapped_column(String(320))
    # Visible text, normalised (lower case, single spaces), one line per row of the signature.
    text: Mapped[str] = mapped_column(Text)
    text_sha256: Mapped[str] = mapped_column(String(64))
    seal: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class SignatureEvent(Base):
    """One signature served to a real email (add-in or compose page). Used for analytics."""

    __tablename__ = "signature_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    employee_email: Mapped[str] = mapped_column(String(320), index=True)
    department: Mapped[str] = mapped_column(String(200), default="")
    template_name: Mapped[str] = mapped_column(String(200), default="")
    policy_name: Mapped[str] = mapped_column(String(200), default="")
    recipient_type: Mapped[str] = mapped_column(String(10), default="")
    message_type: Mapped[str] = mapped_column(String(10), default="")
    campaign_id: Mapped[int | None] = mapped_column(Integer)
    disclaimers: Mapped[int] = mapped_column(Integer, default=0)
    on_behalf: Mapped[bool] = mapped_column(Boolean, default=False)
    # Where the request came from: "outlook" (the add-in in a real mailbox) or "simulator" (the admin
    # web's Outlook preview). Rows from before this column existed are "unknown". Usage figures count
    # only "outlook", so a test in the simulator never looks like Outlook adoption.
    source: Mapped[str] = mapped_column(String(20), default="outlook", server_default="unknown")


class Deployment(Base):
    __tablename__ = "deployments"
    id: Mapped[int] = mapped_column(primary_key=True)
    # google_workspace | microsoft_365
    target: Mapped[str] = mapped_column(String(30))
    # all | department | people
    scope: Mapped[str] = mapped_column(String(20), default="all")
    scope_value: Mapped[str] = mapped_column(String(2000), default="")
    # live (calls the provider) | simulated (provider not configured: renders only)
    mode: Mapped[str] = mapped_column(String(12), default="simulated")
    # queued | running | completed | partial | failed
    status: Mapped[str] = mapped_column(String(12), default="queued")
    total: Mapped[int] = mapped_column(Integer, default=0)
    succeeded: Mapped[int] = mapped_column(Integer, default=0)
    failed: Mapped[int] = mapped_column(Integer, default=0)
    notes: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[str] = mapped_column(String(320))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime)


class DeploymentItem(Base):
    __tablename__ = "deployment_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    deployment_id: Mapped[int] = mapped_column(ForeignKey("deployments.id"), index=True)
    employee_email: Mapped[str] = mapped_column(String(320))
    # ok | failed | skipped
    status: Mapped[str] = mapped_column(String(10))
    message: Mapped[str] = mapped_column(String(1000), default="")
    template_name: Mapped[str] = mapped_column(String(200), default="")
    html: Mapped[str] = mapped_column(Text, default="")


class Setting(Base):
    """Small key/value store for automation switches (no secrets: those stay in environment variables)."""

    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")
    updated_by: Mapped[str] = mapped_column(String(320), default="system")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
