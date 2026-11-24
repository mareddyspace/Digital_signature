"""Admin API: directory, templates, policies, Trust Center, audit log."""
import csv
import io
import json
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import audit, directory, signature, trust
from ..auth import ADMIN, ADMIN_OR_DEPT, CAN_READ_AUDIT, current_user, require_role
from ..db import get_db
from ..models import (
    AuditEvent,
    Delegation,
    Employee,
    MailboxPermission,
    SignaturePolicy,
    Template,
    TemplateVersion,
    utcnow,
)
from ..rendering import check_template, render
from ..config import settings

router = APIRouter(prefix="/api", tags=["admin"])
READERS = ("admin", "dept_admin", "auditor")


# ---------- people ----------

def employee_out(e: Employee) -> dict:
    issues = [f for f, v in (("job title", e.job_title), ("department", e.department), ("phone", e.phone)) if not v]
    return {
        "id": e.id, "name": e.name, "email": e.email, "job_title": e.job_title,
        "department": e.department, "phone": e.phone, "mobile": e.mobile,
        "manager_email": e.manager_email, "role": e.role, "active": e.active,
        "synced_at": e.synced_at, "data_issues": [f"missing {i}" for i in issues],
    }


@router.get("/me")
def me(user: Employee = Depends(current_user)):
    return employee_out(user)


@router.get("/employees")
def list_employees(db: Session = Depends(get_db), _: Employee = Depends(require_role(*READERS))):
    rows = db.scalars(select(Employee).where(Employee.active).order_by(Employee.name))
    return [employee_out(e) for e in rows]


@router.get("/dev/users")
def dev_users(db: Session = Depends(get_db)):
    """Only in AUTH_MODE=dev: the user switcher in the admin app."""
    if settings.auth_mode != "dev":
        raise HTTPException(404)
    rows = db.scalars(select(Employee).where(Employee.active).order_by(Employee.name))
    return [{"email": e.email, "name": e.name, "role": e.role} for e in rows]


@router.post("/directory/sync")
def sync_directory(db: Session = Depends(get_db), user: Employee = Depends(require_role(*ADMIN))):
    return directory.sync(db, actor=user.email)


# ---------- templates ----------

class TemplateIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = ""
    html: str = Field(min_length=1)


class TemplateUpdate(BaseModel):
    html: str = Field(min_length=1)
    description: str | None = None


def latest_version(db: Session, template_id: int) -> TemplateVersion | None:
    return db.scalar(
        select(TemplateVersion)
        .where(TemplateVersion.template_id == template_id)
        .order_by(TemplateVersion.number.desc())
        .limit(1)
    )


def template_out(db: Session, t: Template) -> dict:
    latest = latest_version(db, t.id)
    live = db.get(TemplateVersion, t.live_version_id) if t.live_version_id else None
    return {
        "id": t.id, "name": t.name, "description": t.description,
        "live_version": live.number if live else None,
        "live_html": live.html if live else None,
        "latest": {
            "id": latest.id, "number": latest.number, "status": latest.status,
            "html": latest.html, "created_by": latest.created_by,
            "created_at": latest.created_at,
        } if latest else None,
    }


@router.get("/templates")
def list_templates(db: Session = Depends(get_db), _: Employee = Depends(require_role(*READERS))):
    return [template_out(db, t) for t in db.scalars(select(Template).order_by(Template.name))]


@router.post("/templates")
def create_template(body: TemplateIn, db: Session = Depends(get_db), user: Employee = Depends(require_role(*ADMIN_OR_DEPT))):
    if db.scalar(select(Template).where(Template.name == body.name)):
        raise HTTPException(409, "A template with this name already exists")
    t = Template(name=body.name, description=body.description, created_by=user.email)
    db.add(t)
    db.flush()
    db.add(TemplateVersion(template_id=t.id, number=1, html=body.html, created_by=user.email))
    audit.record(db, user.email, "template.created", "template", t.id, name=t.name)
    db.commit()
    return template_out(db, t)


@router.put("/templates/{template_id}")
def update_template(template_id: int, body: TemplateUpdate, db: Session = Depends(get_db), user: Employee = Depends(require_role(*ADMIN_OR_DEPT))):
    t = db.get(Template, template_id) or _404()
    latest = latest_version(db, t.id)
    if latest and latest.status == "pending":
        raise HTTPException(409, "This template is waiting for approval; approve or reject it first")
    if latest and latest.status == "draft":
        latest.html = body.html  # drafts can be edited in place
        latest.created_by = user.email
    else:
        db.add(TemplateVersion(
            template_id=t.id, number=(latest.number + 1) if latest else 1,
            html=body.html, created_by=user.email,
        ))
    if body.description is not None:
        t.description = body.description
    audit.record(db, user.email, "template.edited", "template", t.id, name=t.name)
    db.commit()
    return template_out(db, t)


@router.post("/templates/{template_id}/submit")
def submit_template(template_id: int, db: Session = Depends(get_db), user: Employee = Depends(require_role(*ADMIN_OR_DEPT))):
    t = db.get(Template, template_id) or _404()
    latest = latest_version(db, t.id)
    if not latest or latest.status != "draft":
        raise HTTPException(409, "There is no draft to submit")
    problems = check_template(latest.html)
    if problems:
        raise HTTPException(422, {"problems": problems})
    latest.status = "pending"
    audit.record(db, user.email, "template.submitted", "template", t.id, version=latest.number)
    db.commit()
    return template_out(db, t)


class Decision(BaseModel):
    decision: Literal["approve", "reject"]
    note: str = ""


@router.post("/templates/{template_id}/decide")
def decide_template(template_id: int, body: Decision, db: Session = Depends(get_db), user: Employee = Depends(require_role(*ADMIN))):
    t = db.get(Template, template_id) or _404()
    latest = latest_version(db, t.id)
    if not latest or latest.status != "pending":
        raise HTTPException(409, "Nothing is waiting for approval")
    if latest.created_by == user.email:
        raise HTTPException(403, "You can't approve your own change; another admin must do it")
    latest.decided_by, latest.decided_at = user.email, utcnow()
    if body.decision == "approve":
        if t.live_version_id:
            old = db.get(TemplateVersion, t.live_version_id)
            if old:
                old.status = "retired"
        latest.status = "live"
        t.live_version_id = latest.id
    else:
        latest.status = "rejected"
    audit.record(db, user.email, f"template.{body.decision}d", "template", t.id, version=latest.number, note=body.note)
    db.commit()
    return template_out(db, t)


@router.get("/templates/{template_id}/versions")
def template_versions(template_id: int, db: Session = Depends(get_db), _: Employee = Depends(require_role(*READERS))):
    rows = db.scalars(
        select(TemplateVersion).where(TemplateVersion.template_id == template_id).order_by(TemplateVersion.number.desc())
    )
    return [
        {"id": v.id, "number": v.number, "status": v.status, "created_by": v.created_by,
         "created_at": v.created_at, "decided_by": v.decided_by, "decided_at": v.decided_at}
        for v in rows
    ]


class PreviewIn(BaseModel):
    html: str
    employee_email: str
    with_code: bool = True
    on_behalf_of_email: str | None = None


@router.post("/templates/preview")
def preview_template(body: PreviewIn, db: Session = Depends(get_db), _: Employee = Depends(require_role(*READERS))):
    e = db.scalar(select(Employee).where(Employee.email == body.employee_email.lower())) or _404()
    owner = db.scalar(select(Employee).where(Employee.email == (body.on_behalf_of_email or "").lower())) if body.on_behalf_of_email else None
    values = {
        "name": e.name, "job_title": e.job_title, "department": e.department, "phone": e.phone,
        "mobile": e.mobile, "email": e.email, "company": settings.company_name, "photo_url": e.photo_url,
        "verify_url": settings.verify_url.split("://", 1)[-1],
        "verification_code": "SG-7K4P-Q2MX" if body.with_code else "",
    }
    if owner:
        values.update(on_behalf_of=owner.name, on_behalf_title=owner.job_title, on_behalf_email=owner.email)
    return {"html": render(body.html, values), "problems": check_template(body.html)}


# ---------- policies ----------

class PolicyIn(BaseModel):
    name: str = Field(min_length=1)
    priority: int = 100
    departments: str = ""
    recipient_type: Literal["internal", "external", "any"] = "any"
    message_type: Literal["new", "reply", "any"] = "any"
    template_id: int
    enabled: bool = True


def policy_out(db: Session, p: SignaturePolicy) -> dict:
    t = db.get(Template, p.template_id)
    return {
        "id": p.id, "name": p.name, "priority": p.priority, "departments": p.departments,
        "recipient_type": p.recipient_type, "message_type": p.message_type,
        "template_id": p.template_id, "template_name": t.name if t else None, "enabled": p.enabled,
    }


@router.get("/policies")
def list_policies(db: Session = Depends(get_db), _: Employee = Depends(require_role(*READERS))):
    rows = db.scalars(select(SignaturePolicy).order_by(SignaturePolicy.priority, SignaturePolicy.id))
    return [policy_out(db, p) for p in rows]


@router.post("/policies")
def create_policy(body: PolicyIn, db: Session = Depends(get_db), user: Employee = Depends(require_role(*ADMIN))):
    db.get(Template, body.template_id) or _404()
    p = SignaturePolicy(**body.model_dump())
    db.add(p)
    db.flush()
    audit.record(db, user.email, "policy.created", "policy", p.id, **body.model_dump())
    db.commit()
    return policy_out(db, p)


@router.put("/policies/{policy_id}")
def update_policy(policy_id: int, body: PolicyIn, db: Session = Depends(get_db), user: Employee = Depends(require_role(*ADMIN))):
    p = db.get(SignaturePolicy, policy_id) or _404()
    db.get(Template, body.template_id) or _404()
    for k, v in body.model_dump().items():
        setattr(p, k, v)
    audit.record(db, user.email, "policy.updated", "policy", p.id, **body.model_dump())
    db.commit()
    return policy_out(db, p)


@router.delete("/policies/{policy_id}")
def delete_policy(policy_id: int, db: Session = Depends(get_db), user: Employee = Depends(require_role(*ADMIN))):
    p = db.get(SignaturePolicy, policy_id) or _404()
    audit.record(db, user.email, "policy.deleted", "policy", p.id, name=p.name)
    db.delete(p)
    db.commit()
    return {"ok": True}


class PolicyTest(BaseModel):
    sender_email: str
    recipients: list[str] = Field(default_factory=list)
    message_type: Literal["new", "reply", "forward"] = "new"
    from_email: str | None = None


@router.post("/policies/test")
def test_policy(body: PolicyTest, db: Session = Depends(get_db), _: Employee = Depends(require_role(*READERS))):
    sender = db.scalar(select(Employee).where(Employee.email == body.sender_email.lower())) or _404()
    r = signature.build(db, sender, body.recipients, body.message_type, body.from_email, dry_run=True)
    return {
        "html": r.html, "template_name": r.template_name, "policy_name": r.policy_name,
        "recipient_type": r.recipient_type, "reason": r.reason, "on_behalf_of": r.on_behalf_of,
        "warnings": r.warnings,
    }


# ---------- Trust Center ----------

@router.get("/trust-center")
def trust_center(db: Session = Depends(get_db), _: Employee = Depends(require_role(*READERS))):
    trust.expire_due(db)
    now = utcnow()
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    employees = db.scalars(select(Employee).where(Employee.active)).all()
    with_issues = [e for e in employees if not (e.job_title and e.department and e.phone)]
    perms = db.scalars(select(MailboxPermission).where(MailboxPermission.review_state != "removed")).all()
    flagged = [p for p in perms if trust.permission_flags(db, p)]
    delegations = db.scalars(select(Delegation)).all()
    states = [trust.delegation_state(d) for d in delegations]

    def count(action: str, since=day_start) -> int:
        return db.scalar(select(func.count(AuditEvent.id)).where(AuditEvent.action == action, AuditEvent.created_at >= since)) or 0

    alert_actions = ("verify.failed", "verify.wrong_recipient", "signature.unapproved_send_as")
    alerts = db.scalars(
        select(AuditEvent).where(AuditEvent.action.in_(alert_actions)).order_by(AuditEvent.id.desc()).limit(10)
    )
    pending_templates = db.scalar(select(func.count(TemplateVersion.id)).where(TemplateVersion.status == "pending")) or 0
    return {
        "employees": len(employees),
        "employees_with_data_issues": len(with_issues),
        "live_templates": db.scalar(select(func.count(Template.id)).where(Template.live_version_id.is_not(None))) or 0,
        "pending_template_approvals": pending_templates,
        "pending_delegations": states.count("pending"),
        "active_delegations": states.count("active"),
        "flagged_permissions": len(flagged),
        "total_permissions": len(perms),
        "verifications_today": count("verify.passed") + count("verify.failed") + count("verify.wrong_recipient"),
        "failed_verifications_today": count("verify.failed") + count("verify.wrong_recipient"),
        "unapproved_send_as_7d": count("signature.unapproved_send_as", now - timedelta(days=7)),
        "alerts": [audit_out(a) for a in alerts],
    }


# ---------- audit ----------

def audit_out(a: AuditEvent) -> dict:
    return {
        "id": a.id, "actor": a.actor, "action": a.action, "target_type": a.target_type,
        "target_id": a.target_id, "details": json.loads(a.details or "{}"), "created_at": a.created_at,
    }


def _audit_query(action: str | None, actor: str | None, limit: int):
    q = select(AuditEvent).order_by(AuditEvent.id.desc()).limit(min(limit, 5000))
    if action:
        q = q.where(AuditEvent.action.startswith(action))
    if actor:
        q = q.where(AuditEvent.actor == actor.lower())
    return q


@router.get("/audit")
def list_audit(action: str | None = None, actor: str | None = None, limit: int = 200,
               db: Session = Depends(get_db), _: Employee = Depends(require_role(*CAN_READ_AUDIT))):
    return [audit_out(a) for a in db.scalars(_audit_query(action, actor, limit))]


@router.get("/audit.csv")
def export_audit(action: str | None = None, actor: str | None = None, limit: int = 5000,
                 db: Session = Depends(get_db), user: Employee = Depends(require_role(*CAN_READ_AUDIT))):
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "created_at_utc", "actor", "action", "target_type", "target_id", "details"])
    for a in db.scalars(_audit_query(action, actor, limit)):
        w.writerow([a.id, a.created_at.isoformat(), a.actor, a.action, a.target_type, a.target_id, a.details])
    audit.record(db, user.email, "audit.exported", "audit", "", filter_action=action, filter_actor=actor)
    db.commit()
    return StreamingResponse(
        iter([buf.getvalue()]), media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=signguard-audit.csv"},
    )


def _404():
    raise HTTPException(404, "Not found")
