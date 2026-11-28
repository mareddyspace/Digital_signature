"""Automated policy management.

insights(db) looks at policies, templates, campaigns and the directory and returns findings, each
with an optional one-click fix. run_scheduled(db) runs on startup and every minute: it ends expired
campaigns and, when switched on, creates starter policies for new departments.
Switches live in the settings table so admins can change them without a restart.
"""
from __future__ import annotations

import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import audit, compliance, extras, integrity
from .models import (
    Campaign,
    Employee,
    Setting,
    SignaturePolicy,
    Template,
    TemplateVersion,
    utcnow,
)

SWITCHES: dict[str, tuple[bool, str]] = {
    "auto_end_campaigns": (True, "Turn off banners automatically when their end date passes"),
    "auto_department_policies": (False, "Create a disabled starter policy when a new department appears in the directory"),
    "block_tampered_templates": (True, "Never use a template whose integrity seal is broken (always on)"),
    "auto_deploy_on_approval": (False, "Push signatures to Google Workspace when a template version is approved"),
}


def get_switch(db: Session, key: str) -> bool:
    row = db.get(Setting, f"auto.{key}")
    if row is None:
        return SWITCHES[key][0]
    return row.value == "true"


def set_switch(db: Session, key: str, value: bool, actor: str) -> None:
    if key not in SWITCHES:
        raise KeyError(key)
    row = db.get(Setting, f"auto.{key}")
    if row is None:
        row = Setting(key=f"auto.{key}")
        db.add(row)
    row.value = "true" if value else "false"
    row.updated_by = actor
    row.updated_at = utcnow()
    audit.record(db, actor, "automation.switch_changed", "setting", key, value=value)


APPROVAL_MODES = {
    "two_admins": "A second admin approves every change (nobody approves their own)",
    "one_admin": "Any admin approves, including their own change",
    "off": "Changes go live when submitted (checks still run)",
}


def approval_mode(db: Session) -> str:
    row = db.get(Setting, "approval.mode")
    return row.value if row is not None and row.value in APPROVAL_MODES else "two_admins"


def set_approval_mode(db: Session, mode: str, actor: str) -> None:
    if mode not in APPROVAL_MODES:
        raise KeyError(mode)
    before = approval_mode(db)
    row = db.get(Setting, "approval.mode")
    if row is None:
        row = Setting(key="approval.mode")
        db.add(row)
    row.value, row.updated_by, row.updated_at = mode, actor, utcnow()
    audit.record(db, actor, "approval.mode_changed", "setting", "approval.mode", before=before, after=mode)


def switches(db: Session) -> list[dict]:
    return [{"key": k, "label": label, "enabled": get_switch(db, k), "locked": k == "block_tampered_templates"}
            for k, (_, label) in SWITCHES.items()]


def _depts(p: SignaturePolicy) -> set[str]:
    return {d.strip().lower() for d in p.departments.split(",") if d.strip()}


def _covers(a: SignaturePolicy, b: SignaturePolicy) -> bool:
    """True when every email b matches is already matched by a (so b can never win)."""
    # A rule narrowed to people, domains, exceptions or dates doesn't match everything: never call it covering.
    if a.people.strip() or a.exclude_people.strip() or a.recipient_domains.strip() or a.starts_at or a.ends_at:
        return False
    if b.people.strip() and not b.departments.strip() and a.departments.strip():
        return False
    da, db_ = _depts(a), _depts(b)
    dept_ok = not da or (bool(db_) and db_ <= da)
    r_ok = a.recipient_type == "any" or a.recipient_type == b.recipient_type
    m_ok = a.message_type == "any" or a.message_type == b.message_type
    return dept_ok and r_ok and m_ok


def departments(db: Session) -> list[str]:
    names = {e.department for e in db.scalars(select(Employee).where(Employee.active)) if e.department}
    return sorted(names)


def insights(db: Session) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []

    def add(severity: str, title: str, detail: str, action: dict | None = None, area: str = "policies") -> None:
        found.append({"id": f"f{len(found) + 1}", "severity": severity, "title": title, "detail": detail,
                      "action": action, "area": area})

    policies = db.scalars(select(SignaturePolicy).order_by(SignaturePolicy.priority, SignaturePolicy.id)).all()
    enabled = [p for p in policies if p.enabled]
    templates = {t.id: t for t in db.scalars(select(Template))}

    # Integrity first: the most serious finding.
    for t in templates.values():
        if t.live_version_id:
            v = db.get(TemplateVersion, t.live_version_id)
            if v and integrity.version_intact(db, v) is False:
                add("critical", f"Template \"{t.name}\" was changed outside the approval workflow",
                    "Its live HTML no longer matches the sealed, approved version. It is not being used. "
                    "Submit a new version for approval to restore it.", area="integrity")

    # Policies that can never match because an earlier policy already catches everything they would.
    for i, p in enumerate(enabled):
        for earlier in enabled[:i]:
            if _covers(earlier, p):
                add("warning", f"Policy \"{p.name}\" never applies",
                    f"\"{earlier.name}\" (priority {earlier.priority}) matches every email it would. "
                    "Give it a lower priority number or turn it off.",
                    {"type": "disable_policy", "policy_id": p.id, "label": "Turn it off"})
                break

    # Policies pointing at templates that aren't live.
    for p in enabled:
        t = templates.get(p.template_id)
        if t is None or not t.live_version_id:
            add("error", f"Policy \"{p.name}\" uses a template that isn't live",
                "Emails it matches fall through to the next policy. Approve a version of the template or change the policy.")

    # Departments with no signature for outside email.
    from .signature import match_policy  # local import: signature imports this package's modules

    for dept in departments(db):
        if match_policy(db, dept, "external", "new") is None:
            add("error", f"{dept} has no signature for outside email",
                "People in this department send external email without a signature or verification code.",
                {"type": "create_department_policy", "department": dept, "label": "Create a policy"})
        elif not any(dept.lower() in _depts(p) for p in enabled):
            add("info", f"{dept} uses the company-wide signature",
                "Add a department policy if this team needs its own layout, banner or disclaimer.",
                {"type": "create_department_policy", "department": dept, "label": "Create a draft policy"})

    # Live templates without a verification code for external mail.
    for p in enabled:
        if p.recipient_type in ("external", "any"):
            t = templates.get(p.template_id)
            v = db.get(TemplateVersion, t.live_version_id) if t and t.live_version_id else None
            if v and "{{verification_code}}" not in v.html:
                add("warning", f"\"{t.name}\" goes outside without a verification code",
                    f"Policy \"{p.name}\" sends it to external recipients, who can't check the sender.", area="templates")

    # Brand compliance of live templates.
    brand = extras.brand_dict(extras.get_brand(db))
    for t in templates.values():
        if t.live_version_id:
            v = db.get(TemplateVersion, t.live_version_id)
            if v:
                r = compliance.check(v.html, brand)
                if r["score"] < (brand.get("min_compliance_score") or 70):
                    add("warning", f"\"{t.name}\" scores {r['score']}/100 for brand compliance",
                        "; ".join(i["message"] for i in r["issues"][:3]), area="templates")

    used = {p.template_id for p in policies}
    for t in templates.values():
        if t.id not in used and t.live_version_id:
            add("info", f"Template \"{t.name}\" isn't used by any policy",
                "It is live but no policy sends it.", area="templates")

    # Campaigns.
    now = utcnow()
    for c in db.scalars(select(Campaign)):
        state = extras.campaign_state(c, now)
        if state == "ended" and c.enabled:
            add("info", f"Banner \"{c.name}\" has ended", "It is no longer shown. Turn it off to tidy up.",
                {"type": "disable_campaign", "campaign_id": c.id, "label": "Turn it off"}, area="campaigns")
        if state == "live" and not c.link_url:
            add("info", f"Banner \"{c.name}\" has no link", "Clicks can't be measured without a link.", area="campaigns")

    # Directory data that leaves gaps in signatures.
    missing = [e for e in db.scalars(select(Employee).where(Employee.active)) if not (e.job_title and e.department and e.phone)]
    if missing:
        add("info", f"{len(missing)} {'person has' if len(missing) == 1 else 'people have'} incomplete directory details",
            "Their signatures leave out the missing lines. Fix the data in Microsoft 365 or Google Workspace, then sync.",
            area="directory")

    order = {"critical": 0, "error": 1, "warning": 2, "info": 3}
    found.sort(key=lambda f: order[f["severity"]])
    return found


def apply(db: Session, action: dict, actor: str) -> str:
    kind = action.get("type")
    if kind == "disable_policy":
        p = db.get(SignaturePolicy, int(action["policy_id"]))
        if p is None:
            raise LookupError("Policy not found")
        p.enabled = False
        audit.record(db, actor, "automation.policy_disabled", "policy", p.id, name=p.name)
        db.commit()
        return f"Turned off \"{p.name}\""
    if kind == "disable_campaign":
        c = db.get(Campaign, int(action["campaign_id"]))
        if c is None:
            raise LookupError("Banner not found")
        c.enabled = False
        audit.record(db, actor, "automation.campaign_disabled", "campaign", c.id, name=c.name)
        db.commit()
        return f"Turned off \"{c.name}\""
    if kind == "create_department_policy":
        dept = str(action["department"])[:200]
        p = create_department_policy(db, dept, actor, enabled=bool(action.get("enabled", False)))
        db.commit()
        return f"Created \"{p.name}\" ({'on' if p.enabled else 'off until you review it'})"
    raise ValueError("Unknown action")


def create_department_policy(db: Session, dept: str, actor: str, enabled: bool = False) -> SignaturePolicy:
    """Starter policy: the department's external email uses the template the company-wide rule uses."""
    from .signature import match_policy

    matched = match_policy(db, "", "external", "new")
    template = None
    if matched:
        template = db.get(Template, matched[1].template_id)
    if template is None:
        template = db.scalar(select(Template).where(Template.live_version_id.is_not(None)).order_by(Template.id))
    if template is None:
        raise LookupError("There is no live template to use")
    top = min([p.priority for p in db.scalars(select(SignaturePolicy))] or [100])
    p = SignaturePolicy(name=f"{dept} to outside", priority=max(1, top - 1) if enabled else 30,
                        departments=dept, recipient_type="external", message_type="any",
                        template_id=template.id, enabled=enabled)
    db.add(p)
    db.flush()
    audit.record(db, actor, "automation.policy_created", "policy", p.id, department=dept, enabled=enabled)
    return p


def run_scheduled(db: Session) -> dict:
    done = {"campaigns_ended": 0, "policies_created": 0}
    now = utcnow()
    if get_switch(db, "auto_end_campaigns"):
        for c in db.scalars(select(Campaign).where(Campaign.enabled, Campaign.ends_at.is_not(None))):
            if c.ends_at <= now:
                c.enabled = False
                audit.record(db, "system", "automation.campaign_ended", "campaign", c.id, name=c.name)
                done["campaigns_ended"] += 1
    if get_switch(db, "auto_department_policies"):
        known_row = db.get(Setting, "auto.known_departments")
        known = set(json.loads(known_row.value)) if known_row and known_row.value else None
        current = set(departments(db))
        if known is not None:
            for dept in sorted(current - known):
                if not any(dept.lower() in _depts(p) for p in db.scalars(select(SignaturePolicy))):
                    try:
                        create_department_policy(db, dept, "system", enabled=False)
                        done["policies_created"] += 1
                    except LookupError:
                        pass
        if known_row is None:
            known_row = Setting(key="auto.known_departments")
            db.add(known_row)
        known_row.value = json.dumps(sorted(current))
    if any(done.values()) or db.new or db.dirty:
        db.commit()
    return done
