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
