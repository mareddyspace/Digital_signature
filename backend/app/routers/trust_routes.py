"""Delegations, mailbox-permission audit and the employee's own trust page."""
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .. import audit, signature, trust
from ..auth import ADMIN, current_user, require_role
from ..config import settings
from ..db import get_db
from ..models import Delegation, Employee, MailboxPermission, utcnow

router = APIRouter(prefix="/api", tags=["trust"])


def _names(db: Session) -> dict[str, str]:
    return {e.email: e.name for e in db.scalars(select(Employee))}


# ---------- delegations ----------

def delegation_out(d: Delegation, names: dict[str, str]) -> dict:
    return {
        "id": d.id,
        "delegate_email": d.delegate_email, "delegate_name": names.get(d.delegate_email, d.delegate_email),
        "owner_email": d.owner_email, "owner_name": names.get(d.owner_email, d.owner_email),
        "reason": d.reason, "starts_at": d.starts_at, "ends_at": d.ends_at,
        "status": d.status, "state": trust.delegation_state(d),
        "requested_by": d.requested_by, "decided_by": d.decided_by, "decided_at": d.decided_at,
        "exchange_state": d.exchange_state, "created_at": d.created_at,
    }


class DelegationIn(BaseModel):
    delegate_email: str
    owner_email: str
    reason: str = Field(min_length=3, max_length=500)
    starts_at: datetime
    ends_at: datetime


@router.get("/delegations")
def list_delegations(db: Session = Depends(get_db), user: Employee = Depends(current_user)):
    trust.expire_due(db)
    q = select(Delegation).order_by(Delegation.id.desc())
    if user.role not in ("admin", "auditor"):
        q = q.where(or_(Delegation.delegate_email == user.email, Delegation.owner_email == user.email))
    names = _names(db)
    return [delegation_out(d, names) for d in db.scalars(q)]


@router.post("/delegations")
def request_delegation(body: DelegationIn, db: Session = Depends(get_db), user: Employee = Depends(current_user)):
    delegate, owner = body.delegate_email.lower(), body.owner_email.lower()
    if user.email not in (delegate, owner) and user.role != "admin":
        raise HTTPException(403, "You can only request delegations that involve you")
    if delegate == owner:
        raise HTTPException(422, "Delegate and mailbox owner must be different people")
    for email in (delegate, owner):
        if not db.scalar(select(Employee).where(Employee.email == email, Employee.active)):
            raise HTTPException(422, f"{email} is not in the directory")
    starts, ends = _to_utc(body.starts_at), _to_utc(body.ends_at)
    if ends <= starts:
        raise HTTPException(422, "End date must be after start date")
    if ends - starts > timedelta(days=trust.MAX_DELEGATION_DAYS):
        raise HTTPException(422, f"Delegations can last at most {trust.MAX_DELEGATION_DAYS} days")
    if ends <= utcnow():
        raise HTTPException(422, "End date is in the past")
    d = Delegation(
        delegate_email=delegate, owner_email=owner, reason=body.reason,
        starts_at=starts, ends_at=ends, requested_by=user.email,
    )
    db.add(d)
    db.flush()
    audit.record(db, user.email, "delegation.requested", "delegation", d.id,
                 delegate=delegate, owner=owner, ends_at=ends, reason=body.reason)
    db.commit()
    return delegation_out(d, _names(db))


class DelegationDecision(BaseModel):
    decision: Literal["approve", "reject"]
    note: str = ""


@router.post("/delegations/{delegation_id}/decide")
def decide_delegation(delegation_id: int, body: DelegationDecision, db: Session = Depends(get_db), user: Employee = Depends(current_user)):
    d = db.get(Delegation, delegation_id) or _404()
    if d.status != "pending":
        raise HTTPException(409, f"This request is already {d.status}")
    if user.email not in (d.owner_email,) and user.role != "admin":
        raise HTTPException(403, "Only the mailbox owner or an admin can decide")
    if user.email == d.requested_by or user.email == d.delegate_email:
        raise HTTPException(403, "You can't approve a delegation you requested or would receive")
    d.decided_by, d.decided_at = user.email, utcnow()
    if body.decision == "approve":
        d.status = "approved"
        # Real Exchange changes run in workers/apply-delegation.ps1; here we record the intent.
        d.exchange_state = "simulated"
    else:
        d.status = "rejected"
    audit.record(db, user.email, f"delegation.{body.decision}d", "delegation", d.id,
                 delegate=d.delegate_email, owner=d.owner_email, note=body.note)
    db.commit()
    return delegation_out(d, _names(db))


@router.post("/delegations/{delegation_id}/revoke")
def revoke_delegation(delegation_id: int, db: Session = Depends(get_db), user: Employee = Depends(current_user)):
    d = db.get(Delegation, delegation_id) or _404()
    if user.email not in (d.owner_email, d.delegate_email) and user.role != "admin":
        raise HTTPException(403, "Only the owner, the delegate or an admin can revoke")
    if d.status not in ("approved", "pending"):
        raise HTTPException(409, f"This delegation is already {d.status}")
    d.status = "revoked"
    d.decided_by, d.decided_at = user.email, utcnow()
    if d.exchange_state in ("granted", "simulated"):
        d.exchange_state = "removed"
    audit.record(db, user.email, "delegation.revoked", "delegation", d.id,
                 delegate=d.delegate_email, owner=d.owner_email)
    db.commit()
    return delegation_out(d, _names(db))


# ---------- mailbox permission audit ----------

def permission_out(db: Session, p: MailboxPermission, names: dict[str, str]) -> dict:
    return {
        "id": p.id, "mailbox": p.mailbox, "mailbox_name": names.get(p.mailbox, p.mailbox),
        "trustee": p.trustee, "trustee_name": names.get(p.trustee, p.trustee),
        "type": p.type, "granted_at": p.granted_at, "last_used": p.last_used,
        "first_seen": p.first_seen, "source": p.source, "review_state": p.review_state,
        "flags": trust.permission_flags(db, p),
    }


@router.get("/permissions")
def list_permissions(db: Session = Depends(get_db), _: Employee = Depends(require_role("admin", "auditor"))):
    trust.expire_due(db)
    names = _names(db)
    rows = db.scalars(select(MailboxPermission).order_by(MailboxPermission.mailbox, MailboxPermission.trustee))
    out = [permission_out(db, p, names) for p in rows]
    out.sort(key=lambda r: (r["review_state"] == "removed", -len(r["flags"])))
    return out


class PermissionImport(BaseModel):
    mailbox: str
    trustee: str
    type: Literal["full_access", "send_as", "send_on_behalf"]
    granted_at: datetime | None = None
    last_used: datetime | None = None


@router.post("/permissions/import")
def import_permissions(rows: list[PermissionImport], db: Session = Depends(get_db), user: Employee = Depends(require_role(*ADMIN))):
    """Load the JSON written by workers/export-mailbox-permissions.ps1."""
    existing = {(p.mailbox, p.trustee, p.type): p for p in db.scalars(select(MailboxPermission))}
    seen = set()
    added = 0
    for r in rows:
        key = (r.mailbox.lower(), r.trustee.lower(), r.type)
        seen.add(key)
        p = existing.get(key)
        if p is None:
            p = MailboxPermission(mailbox=key[0], trustee=key[1], type=r.type, source="import")
            db.add(p)
            added += 1
        p.granted_at = _to_utc(r.granted_at) if r.granted_at else p.granted_at
        p.last_used = _to_utc(r.last_used) if r.last_used else p.last_used
        if p.review_state == "removed":
            p.review_state = "open"  # it came back
    gone = 0
    for key, p in existing.items():
        if p.source == "import" and key not in seen and p.review_state != "removed":
            p.review_state = "removed"
            gone += 1
    audit.record(db, user.email, "permissions.imported", "permissions", "", rows=len(rows), added=added, gone=gone)
    db.commit()
    return {"rows": len(rows), "added": added, "no_longer_present": gone}


class PermissionAction(BaseModel):
    action: Literal["accept", "remove", "convert"]
    days: int = Field(default=30, ge=1, le=trust.MAX_DELEGATION_DAYS)


@router.post("/permissions/{permission_id}/action")
def act_on_permission(permission_id: int, body: PermissionAction, db: Session = Depends(get_db), user: Employee = Depends(require_role(*ADMIN))):
    p = db.get(MailboxPermission, permission_id) or _404()
    result: dict = {}
    if body.action == "accept":
        p.review_state = "accepted"
    elif body.action == "remove":
        # Real removal runs in workers/apply-delegation.ps1; here we record the decision.
        p.review_state = "removed"
    else:
        if not db.scalar(select(Employee).where(Employee.email == p.mailbox)):
            raise HTTPException(422, "Shared mailboxes can't be delegated; accept or remove the grant instead")
        now = utcnow()
        d = Delegation(
            delegate_email=p.trustee, owner_email=p.mailbox,
            reason=f"Review of existing {p.type.replace('_', ' ')} grant",
            starts_at=now, ends_at=now + timedelta(days=body.days), requested_by=user.email,
        )
        db.add(d)
        db.flush()
        audit.record(db, user.email, "delegation.requested", "delegation", d.id,
                     delegate=p.trustee, owner=p.mailbox, from_permission=p.id)
        result["delegation_id"] = d.id
    audit.record(db, user.email, f"permission.{body.action}", "permission", p.id,
                 mailbox=p.mailbox, trustee=p.trustee, type=p.type)
    db.commit()
    return {**permission_out(db, p, _names(db)), **result}


# ---------- my trust ----------

@router.get("/me/trust")
def my_trust(db: Session = Depends(get_db), user: Employee = Depends(current_user)):
    trust.expire_due(db)
    names = _names(db)
    external = signature.build(db, user, ["customer@example.com"], "new", dry_run=True)
    internal = signature.build(db, user, [f"colleague@{settings.internal_domains[0]}"], "new", dry_run=True) if settings.internal_domains else None
    perms = db.scalars(select(MailboxPermission).where(
        MailboxPermission.mailbox == user.email, MailboxPermission.review_state != "removed"))
    delegations = db.scalars(select(Delegation).where(
        or_(Delegation.owner_email == user.email, Delegation.delegate_email == user.email)
    ).order_by(Delegation.id.desc()))
    return {
        "me": {"name": user.name, "email": user.email, "job_title": user.job_title, "department": user.department},
        "signature_external": external.html,
        "signature_internal": internal.html if internal else "",
        "who_can_send_as_me": [permission_out(db, p, names) for p in perms],
        "delegations": [delegation_out(d, names) for d in delegations],
    }


def _to_utc(dt: datetime) -> datetime:
    """Store naive UTC; times without a zone are taken as UTC."""
    return dt.replace(tzinfo=None) if dt.tzinfo is None else dt.astimezone(UTC).replace(tzinfo=None)


def _404():
    raise HTTPException(404, "Not found")
