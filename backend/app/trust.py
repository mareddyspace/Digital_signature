"""Delegation lifecycle and mailbox-permission flags."""
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import audit
from .config import settings
from .models import Delegation, MailboxPermission, utcnow

MAX_DELEGATION_DAYS = 90


def delegation_state(d: Delegation) -> str:
    """Status shown to people: approved delegations are 'scheduled' or 'active'."""
    if d.status != "approved":
        return d.status
    now = utcnow()
    if d.starts_at > now:
        return "scheduled"
    return "active" if d.ends_at > now else "expired"


def expire_due(db: Session) -> int:
    """Expire approved delegations whose end date has passed. Returns how many."""
    now = utcnow()
    due = db.scalars(
        select(Delegation).where(Delegation.status == "approved", Delegation.ends_at <= now)
    ).all()
    for d in due:
        d.status = "expired"
        if d.exchange_state in ("granted", "simulated"):
            d.exchange_state = "removed"
        audit.record(
            db, "system", "delegation.expired", "delegation", d.id,
            delegate=d.delegate_email, owner=d.owner_email,
        )
    if due:
        db.commit()
    return len(due)


def permission_flags(db: Session, p: MailboxPermission) -> list[str]:
    if p.review_state == "removed":
        return []
    now = utcnow()
    flags = []
    covered = db.scalar(
        select(Delegation.id).where(
            Delegation.delegate_email == p.trustee,
            Delegation.owner_email == p.mailbox,
            Delegation.status == "approved",
            Delegation.ends_at > now,
        )
    )
    if not covered and p.review_state != "accepted":
        flags.append("no_approval")
    since = p.granted_at or p.first_seen
    if since and now - since > timedelta(days=settings.stale_grant_days):
        flags.append(f"older_than_{settings.stale_grant_days}_days")
    if p.last_used is None or now - p.last_used > timedelta(days=90):
        flags.append("unused_90_days")
    return flags
