"""Admin API: directory, templates, policies, Trust Center, audit log."""
import csv
import io
import json
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import audit, automation, compliance, deployments, designer, directory, extras, integrity, signature, trust
from ..auth import ADMIN, ADMIN_OR_DEPT, APP_ROLES, CAN_READ_AUDIT, current_user, require_role
from ..db import get_db
from ..models import (
    AuditEvent,
    Delegation,
    Employee,
    Campaign,
    MailboxPermission,
    SignatureEvent,
    SignaturePolicy,
    Template,
    TemplateDesign,
    TemplateVersion,
    utcnow,
)
from ..rendering import check_template, place_extras, render
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
def me(request: Request, user: Employee = Depends(current_user)):
    """The signed-in person, their SignGuard role and where it came from."""
    claims = getattr(request.state, "token_claims", None) or {}
    return {
        **employee_out(user),
        "role_source": user.role_source,
        "auth_mode": settings.auth_mode,
        # Only in entra mode: what Microsoft said about this sign-in.
        "identity": {
            "object_id": claims.get("oid"),
            "tenant_id": claims.get("tid"),
            "sign_in_name": claims.get("preferred_username") or claims.get("upn"),
            "app_roles": [r for r in claims.get("roles") or [] if r in APP_ROLES],
        } if claims else None,
    }


@router.get("/auth/config")
def auth_config():
    """Public sign-in settings for the admin web (identifiers only; never secrets)."""
    if settings.auth_mode != "entra":
        return {"mode": settings.auth_mode}
    return {
        "mode": "entra",
        "tenant_id": settings.entra_tenant_id,
        "client_id": settings.entra_spa_client_id,
        "scopes": [settings.entra_api_scope],
    }


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
def sync_directory(force: bool = False, db: Session = Depends(get_db),
                   user: Employee = Depends(require_role(*ADMIN))):
    """force=true applies a sync that would deactivate an unusually large share of people."""
    try:
        return directory.sync(db, actor=user.email, force=force)
    except directory.EmptyDirectory as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    except directory.SyncHeldBack as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc


# ---------- templates ----------

class TemplateIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = ""
    html: str = Field(min_length=1)
    # Optional designer layout; when given, html must be what the designer compiled from it.
    design: dict | None = None


class TemplateUpdate(BaseModel):
    html: str = Field(min_length=1)
    description: str | None = None
    design: dict | None = None


def _save_design(db: Session, version_id: int, design: dict | None) -> None:
    row = db.get(TemplateDesign, version_id)
    if design is None:
        if row is not None:
            db.delete(row)  # hand-edited HTML: the old layout no longer matches
        return
    try:
        clean = designer.normalize(design)
    except designer.DesignError as exc:
        raise HTTPException(422, str(exc)) from exc
    if row is None:
        db.add(TemplateDesign(version_id=version_id, design_json=json.dumps(clean)))
    else:
        row.design_json = json.dumps(clean)


def _design(db: Session, version_id: int | None) -> dict | None:
    row = db.get(TemplateDesign, version_id) if version_id else None
    return json.loads(row.design_json) if row else None


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
            "design": _design(db, latest.id),
        } if latest else None,
        "integrity": (integrity.version_intact(db, live) if live else None),
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
    v = TemplateVersion(template_id=t.id, number=1, html=body.html, created_by=user.email)
    db.add(v)
    db.flush()
    _save_design(db, v.id, body.design)
    audit.record(db, user.email, "template.created", "template", t.id, name=t.name, designer=body.design is not None)
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
        target = latest
    else:
        target = TemplateVersion(
            template_id=t.id, number=(latest.number + 1) if latest else 1,
            html=body.html, created_by=user.email,
        )
        db.add(target)
        db.flush()
    _save_design(db, target.id, body.design)
    if body.description is not None:
        t.description = body.description
    audit.record(db, user.email, "template.edited", "template", t.id, name=t.name)
    db.commit()
    return template_out(db, t)


class DuplicateIn(BaseModel):
    name: str | None = Field(default=None, max_length=200)


def _copy_name(db: Session, base: str) -> str:
    n = 1
    while True:
        name = f"{base} (copy)" if n == 1 else f"{base} (copy {n})"
        if not db.scalar(select(Template).where(Template.name == name)):
            return name[:200]
        n += 1


@router.post("/templates/{template_id}/duplicate")
def duplicate_template(template_id: int, body: DuplicateIn | None = None, db: Session = Depends(get_db), user: Employee = Depends(require_role(*ADMIN_OR_DEPT))):
    """Start a new template from an existing one. The copy is a draft: it goes through approval like any new template."""
    src = db.get(Template, template_id) or _404()
    source = db.get(TemplateVersion, src.live_version_id) if src.live_version_id else latest_version(db, src.id)
    if not source:
        raise HTTPException(409, "This template has no content to copy")
    name = (body.name.strip() if body and body.name else "") or _copy_name(db, src.name)
    if db.scalar(select(Template).where(Template.name == name)):
        raise HTTPException(409, "A template with this name already exists")
    t = Template(name=name, description=src.description, created_by=user.email)
    db.add(t)
    db.flush()
    v = TemplateVersion(template_id=t.id, number=1, html=source.html, created_by=user.email)
    db.add(v)
    db.flush()
    _save_design(db, v.id, _design(db, source.id))
    audit.record(db, user.email, "template.duplicated", "template", t.id, name=t.name, source=src.id, source_version=source.number)
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
    brand = extras.get_brand(db)
    report = compliance.check(latest.html, extras.brand_dict(brand))
    if brand.enforce_compliance and report["score"] < brand.min_compliance_score:
        raise HTTPException(422, {"problems": [
            f"Brand compliance score {report['score']} is below the required {brand.min_compliance_score}"
        ] + [i["message"] for i in report["issues"] if i["severity"] in ("critical", "error")]})
    latest.status = "pending"
    audit.record(db, user.email, "template.submitted", "template", t.id, version=latest.number)
    if automation.approval_mode(db) == "off":
        # Approvals switched off by an admin: the change goes live now, still sealed and audit-logged.
        _make_live(db, t, latest, user.email, note="approval switched off")
    db.commit()
    return template_out(db, t)


def _make_live(db: Session, t: Template, version: TemplateVersion, actor: str, note: str = "") -> None:
    version.decided_by, version.decided_at = actor, utcnow()
    if t.live_version_id:
        old = db.get(TemplateVersion, t.live_version_id)
        if old:
            old.status = "retired"
    version.status = "live"
    t.live_version_id = version.id
    integrity.seal_version(db, version, actor)
    audit.record(db, actor, "template.approved", "template", t.id, version=version.number, note=note)


class Decision(BaseModel):
    decision: Literal["approve", "reject"]
    note: str = ""


@router.post("/templates/{template_id}/decide")
def decide_template(template_id: int, body: Decision, background: BackgroundTasks, db: Session = Depends(get_db), user: Employee = Depends(require_role(*ADMIN))):
    t = db.get(Template, template_id) or _404()
    latest = latest_version(db, t.id)
    if not latest or latest.status != "pending":
        raise HTTPException(409, "Nothing is waiting for approval")
    if body.decision == "approve" and latest.created_by == user.email and automation.approval_mode(db) == "two_admins":
        raise HTTPException(403, "You can't approve your own change; another admin must do it")
    if body.decision == "approve":
        _make_live(db, t, latest, user.email, note=body.note)
    else:
        latest.decided_by, latest.decided_at = user.email, utcnow()
        latest.status = "rejected"
        audit.record(db, user.email, "template.rejected", "template", t.id, version=latest.number, note=body.note)
    db.commit()
    if body.decision == "approve" and settings.google_configured and automation.get_switch(db, "auto_deploy_on_approval"):
        d = deployments.create(db, "google_workspace", "all", "", "system")
        background.add_task(deployments.run, d.id)
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
    # Add the banner and disclaimers this person would get for an external email.
    with_extras: bool = True


@router.post("/templates/preview")
def preview_template(body: PreviewIn, db: Session = Depends(get_db), _: Employee = Depends(require_role(*READERS))):
    e = db.scalar(select(Employee).where(Employee.email == body.employee_email.lower())) or _404()
    owner = db.scalar(select(Employee).where(Employee.email == (body.on_behalf_of_email or "").lower())) if body.on_behalf_of_email else None
    brand = extras.get_brand(db)
    values = {
        **extras.brand_values(brand),
        "name": e.name, "job_title": e.job_title, "department": e.department, "phone": e.phone,
        "mobile": e.mobile, "email": e.email, "photo_url": e.photo_url,
        "verify_url": settings.verify_url.split("://", 1)[-1],
        "verification_code": "SG-7K4P-Q2MX" if body.with_code else "",
    }
    if owner:
        values.update(on_behalf_of=owner.name, on_behalf_title=owner.job_title, on_behalf_email=owner.email)
    if not brand.company_name:
        values["company"] = settings.company_name
    rendered = render(body.html, values)
    width = min(brand.max_width or 600, 600) - 40
    if body.with_extras:
        c = extras.pick_campaign(db, e.department, "external")
        rendered = place_extras(rendered, extras.campaign_html(c, width) if c else "",
                                extras.disclaimer_html(extras.pick_disclaimers(db, e.department, "external"), width))
    else:
        rendered = place_extras(rendered)
    return {"html": rendered, "problems": check_template(body.html),
            "compliance": compliance.check(body.html, extras.brand_dict(brand))}


# ---------- approval setting ----------

class ApprovalIn(BaseModel):
    mode: Literal["two_admins", "one_admin", "off"]


@router.get("/settings/approval")
def get_approval(db: Session = Depends(get_db), _: Employee = Depends(require_role(*READERS))):
    return {"mode": automation.approval_mode(db), "modes": automation.APPROVAL_MODES}


@router.put("/settings/approval")
def put_approval(body: ApprovalIn, db: Session = Depends(get_db), user: Employee = Depends(require_role(*ADMIN))):
    automation.set_approval_mode(db, body.mode, user.email)
    db.commit()
    return {"mode": automation.approval_mode(db), "modes": automation.APPROVAL_MODES}


# ---------- policies ----------

class PolicyIn(BaseModel):
    name: str = Field(min_length=1)
    priority: int = 100
    departments: str = ""
    recipient_type: Literal["internal", "external", "any"] = "any"
    message_type: Literal["new", "reply", "any"] = "any"
    template_id: int
    enabled: bool = True
    people: str = Field(default="", max_length=20000)
    exclude_people: str = Field(default="", max_length=20000)
    recipient_domains: str = Field(default="", max_length=1000)
    starts_at: datetime | None = None
    ends_at: datetime | None = None

    @field_validator("people", "exclude_people")
    @classmethod
    def _emails(cls, v: str) -> str:
        items = [x.strip().lower() for x in v.split(",") if x.strip()]
        bad = [x for x in items if "@" not in x or " " in x]
        if bad:
            raise ValueError(f"Not an email address: {', '.join(bad[:3])}")
        return ", ".join(dict.fromkeys(items))

    @field_validator("recipient_domains")
    @classmethod
    def _domains(cls, v: str) -> str:
        items = [x.strip().lower().lstrip("@") for x in v.split(",") if x.strip()]
        bad = [x for x in items if "." not in x or " " in x or "@" in x]
        if bad:
            raise ValueError(f"Not a domain: {', '.join(bad[:3])}")
        return ", ".join(dict.fromkeys(items))

    @field_validator("starts_at", "ends_at")
    @classmethod
    def _naive_utc(cls, v: datetime | None) -> datetime | None:
        if v is not None and v.tzinfo is not None:
            v = v.astimezone(timezone.utc).replace(tzinfo=None)
        return v

    @model_validator(mode="after")
    def _window(self):
        if self.starts_at and self.ends_at and self.ends_at <= self.starts_at:
            raise ValueError("The end date must be after the start date")
        return self


def policy_out(db: Session, p: SignaturePolicy) -> dict:
    t = db.get(Template, p.template_id)
    return {
        "id": p.id, "name": p.name, "priority": p.priority, "departments": p.departments,
        "recipient_type": p.recipient_type, "message_type": p.message_type,
        "template_id": p.template_id, "template_name": t.name if t else None, "enabled": p.enabled,
        "people": p.people, "exclude_people": p.exclude_people, "recipient_domains": p.recipient_domains,
        "starts_at": p.starts_at, "ends_at": p.ends_at,
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
    audit.record(db, user.email, "policy.created", "policy", p.id, **body.model_dump(mode="json"))
    db.commit()
    return policy_out(db, p)


@router.put("/policies/{policy_id}")
def update_policy(policy_id: int, body: PolicyIn, db: Session = Depends(get_db), user: Employee = Depends(require_role(*ADMIN))):
    p = db.get(SignaturePolicy, policy_id) or _404()
    db.get(Template, body.template_id) or _404()
    for k, v in body.model_dump().items():
        setattr(p, k, v)
    audit.record(db, user.email, "policy.updated", "policy", p.id, **body.model_dump(mode="json"))
    db.commit()
    return policy_out(db, p)


@router.delete("/policies/{policy_id}")
def delete_policy(policy_id: int, db: Session = Depends(get_db), user: Employee = Depends(require_role(*ADMIN))):
    p = db.get(SignaturePolicy, policy_id) or _404()
    audit.record(db, user.email, "policy.deleted", "policy", p.id, name=p.name)
    db.delete(p)
    db.commit()
    return {"ok": True}


class PolicyOrder(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=1000)


@router.post("/policies/reorder")
def reorder_policies(body: PolicyOrder, db: Session = Depends(get_db), user: Employee = Depends(require_role(*ADMIN))):
    """Set processing order in one step: the first id gets priority 10, the next 20, and so on."""
    rows = {p.id: p for p in db.scalars(select(SignaturePolicy))}
    if set(body.ids) != set(rows) or len(body.ids) != len(rows):
        raise HTTPException(422, "Send every policy id exactly once")
    for n, pid in enumerate(body.ids, start=1):
        rows[pid].priority = n * 10
    audit.record(db, user.email, "policy.reordered", "policy", "", order=body.ids)
    db.commit()
    return [policy_out(db, rows[i]) for i in body.ids]


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
        "warnings": r.warnings, "campaign": r.campaign, "disclaimers": r.disclaimers,
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

    alert_actions = ("verify.failed", "verify.wrong_recipient", "signature.unapproved_send_as",
                     "integrity.template_tampered", "integrity.signature_mismatch")
    alerts = db.scalars(
        select(AuditEvent).where(AuditEvent.action.in_(alert_actions)).order_by(AuditEvent.id.desc()).limit(10)
    )
    pending_templates = db.scalar(select(func.count(TemplateVersion.id)).where(TemplateVersion.status == "pending")) or 0
    tampered = 0
    for t in db.scalars(select(Template).where(Template.live_version_id.is_not(None))):
        v = db.get(TemplateVersion, t.live_version_id)
        if v and integrity.version_intact(db, v) is False:
            tampered += 1
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
        "tampered_templates": tampered,
        "signatures_today": db.scalar(select(func.count(SignatureEvent.id)).where(SignatureEvent.created_at >= day_start)) or 0,
        "live_campaigns": sum(1 for c in db.scalars(select(Campaign)) if extras.campaign_state(c, now) == "live"),
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
