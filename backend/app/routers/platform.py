"""Signature platform API: brand kit, designer, AI creation, compliance, banners, disclaimers,
department assignments, automation, integrity and analytics."""
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import ai, audit, automation, compliance, designer, extras, integrity, verification
from ..auth import ADMIN, ADMIN_OR_DEPT, CAN_READ_AUDIT, require_role
from ..db import get_db
from ..models import (
    AuditEvent,
    Campaign,
    Disclaimer,
    Employee,
    SignatureEvent,
    Template,
    TemplateVersion,
    utcnow,
)
from ..signature import match_policy
from .verify import _rate_limited

router = APIRouter(prefix="/api", tags=["platform"])
public = APIRouter(tags=["public"])
READERS = ("admin", "dept_admin", "auditor")


def _404(what: str = "Not found"):
    raise HTTPException(404, what)


def _check_url(v: str, field: str) -> str:
    v = (v or "").strip()
    if v and not v.lower().startswith(("https://", "http://")):
        raise ValueError(f"{field} must start with https://")
    return v


def _check_color(v: str) -> str:
    if not designer.HEX.match(v or ""):
        raise ValueError("Colours must look like #1a2b3c")
    return v.lower()


# ---------- brand kit ----------

class BrandIn(BaseModel):
    company_name: str = Field(default="", max_length=200)
    primary_color: str = "#2878d0"
    secondary_color: str = "#11263f"
    accent_color: str = "#16865b"
    palette: str = Field(default="", max_length=500)
    font_family: str = designer.SAFE_FONTS[0]
    logo_url: str = Field(default="", max_length=500)
    logo_width: int = Field(default=120, ge=40, le=300)
    website: str = Field(default="", max_length=300)
    address: str = Field(default="", max_length=300)
    linkedin_url: str = Field(default="", max_length=300)
    twitter_url: str = Field(default="", max_length=300)
    facebook_url: str = Field(default="", max_length=300)
    instagram_url: str = Field(default="", max_length=300)
    youtube_url: str = Field(default="", max_length=300)
    max_width: int = Field(default=600, ge=320, le=800)
    require_logo: bool = False
    enforce_compliance: bool = False
    min_compliance_score: int = Field(default=70, ge=0, le=100)

    @field_validator("primary_color", "secondary_color", "accent_color")
    @classmethod
    def _colors(cls, v: str) -> str:
        return _check_color(v)

    @field_validator("palette")
    @classmethod
    def _palette(cls, v: str) -> str:
        parts = [p.strip() for p in v.split(",") if p.strip()]
        return ",".join(_check_color(p) for p in parts)

    @field_validator("font_family")
    @classmethod
    def _font(cls, v: str) -> str:
        if v not in designer.SAFE_FONTS:
            raise ValueError("Choose one of the email-safe fonts")
        return v

    @field_validator("logo_url", "website", "linkedin_url", "twitter_url", "facebook_url", "instagram_url", "youtube_url")
    @classmethod
    def _urls(cls, v: str, info) -> str:
        return _check_url(v, info.field_name)


@router.get("/brand")
def get_brand(db: Session = Depends(get_db), _: Employee = Depends(require_role(*READERS))):
    b = extras.get_brand(db)
    db.commit()
    return extras.brand_dict(b) | {"fonts": list(designer.SAFE_FONTS)}


@router.put("/brand")
def put_brand(body: BrandIn, db: Session = Depends(get_db), user: Employee = Depends(require_role(*ADMIN))):
    b = extras.get_brand(db)
    changed = {k: v for k, v in body.model_dump().items() if getattr(b, k) != v}
    for k, v in body.model_dump().items():
        setattr(b, k, v)
    b.updated_by, b.updated_at = user.email, utcnow()
    audit.record(db, user.email, "brand.updated", "brand", 1, changed=sorted(changed))
    db.commit()
    return extras.brand_dict(b) | {"fonts": list(designer.SAFE_FONTS)}


# ---------- designer, AI and compliance ----------

class DesignIn(BaseModel):
    design: dict
    employee_email: str | None = None


@router.post("/designer/compile")
def compile_design(body: DesignIn, db: Session = Depends(get_db), _: Employee = Depends(require_role(*READERS))):
    try:
        html = designer.compile_design(body.design)
    except designer.DesignError as exc:
        raise HTTPException(422, str(exc)) from exc
    brand = extras.brand_dict(extras.get_brand(db))
    return {"html": html, "compliance": compliance.check(html, brand)}


@router.get("/designer/starters")
def starters(db: Session = Depends(get_db), _: Employee = Depends(require_role(*READERS))):
    brand = extras.brand_dict(extras.get_brand(db))
    return [{"id": k, "name": n, "design": designer.starter(k, brand)}
            for k, n in (("corporate", "Corporate"), ("split", "Modern two-column"), ("minimal", "Minimal"))]


class AiIn(BaseModel):
    prompt: str = Field(min_length=3, max_length=1000)


@router.post("/ai/signature")
def ai_signature(body: AiIn, db: Session = Depends(get_db), user: Employee = Depends(require_role(*ADMIN_OR_DEPT))):
    brand = extras.brand_dict(extras.get_brand(db))
    result = ai.generate(body.prompt, brand)
    for v in result["variants"]:
        v["html"] = designer.compile_design(v["design"])
        v["compliance"] = compliance.check(v["html"], brand)
    audit.record(db, user.email, "ai.signature_generated", "ai", result["engine"], prompt=body.prompt[:200])
    db.commit()
    return result


class ComplianceIn(BaseModel):
    html: str = Field(min_length=1, max_length=60_000)
    external: bool | None = None


@router.post("/compliance/check")
def compliance_check(body: ComplianceIn, db: Session = Depends(get_db), _: Employee = Depends(require_role(*READERS))):
    return compliance.check(body.html, extras.brand_dict(extras.get_brand(db)), external=body.external)


@router.get("/compliance/templates")
def compliance_templates(db: Session = Depends(get_db), _: Employee = Depends(require_role(*READERS))):
    brand = extras.brand_dict(extras.get_brand(db))
    out = []
    for t in db.scalars(select(Template).order_by(Template.name)):
        v = db.get(TemplateVersion, t.live_version_id) if t.live_version_id else None
        if v:
            r = compliance.check(v.html, brand)
            out.append({"template_id": t.id, "name": t.name, "version": v.number, "score": r["score"],
                        "grade": r["grade"], "issues": r["issues"]})
    return out


# ---------- campaigns (banners) ----------

class CampaignIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    headline: str = Field(default="", max_length=200)
    body: str = Field(default="", max_length=400)
    cta_text: str = Field(default="Learn more", max_length=60)
    link_url: str = Field(default="", max_length=500)
    image_url: str = Field(default="", max_length=500)
    alt_text: str = Field(default="", max_length=200)
    background: str = "#11263f"
    text_color: str = "#ffffff"
    departments: str = Field(default="", max_length=1000)
    recipient_type: Literal["internal", "external", "any"] = "external"
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    priority: int = Field(default=100, ge=1, le=10_000)
    enabled: bool = True

    @field_validator("background", "text_color")
    @classmethod
    def _colors(cls, v: str) -> str:
        return _check_color(v)

    @field_validator("link_url", "image_url")
    @classmethod
    def _urls(cls, v: str, info) -> str:
        v = _check_url(v, info.field_name)
        if info.field_name == "image_url" and v.lower().startswith("http://"):
            raise ValueError("Banner images must use https://")
        return v


def _naive_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is not None:
        from datetime import UTC

        dt = dt.astimezone(UTC).replace(tzinfo=None)
    return dt


def campaign_out(c: Campaign) -> dict:
    return {
        "id": c.id, "name": c.name, "headline": c.headline, "body": c.body, "cta_text": c.cta_text,
        "link_url": c.link_url, "image_url": c.image_url, "alt_text": c.alt_text, "background": c.background,
        "text_color": c.text_color, "departments": c.departments, "recipient_type": c.recipient_type,
        "starts_at": c.starts_at, "ends_at": c.ends_at, "priority": c.priority, "enabled": c.enabled,
        "impressions": c.impressions, "clicks": c.clicks,
        "ctr": round(100 * c.clicks / c.impressions, 1) if c.impressions else 0.0,
        "state": extras.campaign_state(c), "preview_html": extras.campaign_html(c),
        "created_by": c.created_by,
    }


@router.get("/campaigns")
def list_campaigns(db: Session = Depends(get_db), _: Employee = Depends(require_role(*READERS))):
    return [campaign_out(c) for c in db.scalars(select(Campaign).order_by(Campaign.priority, Campaign.id))]


def _apply_campaign(c: Campaign, body: CampaignIn) -> None:
    data = body.model_dump()
    data["starts_at"], data["ends_at"] = _naive_utc(body.starts_at), _naive_utc(body.ends_at)
    if data["starts_at"] and data["ends_at"] and data["ends_at"] <= data["starts_at"]:
        raise HTTPException(422, "The end date must be after the start date")
    for k, v in data.items():
        setattr(c, k, v)


@router.post("/campaigns")
def create_campaign(body: CampaignIn, db: Session = Depends(get_db), user: Employee = Depends(require_role(*ADMIN_OR_DEPT))):
    c = Campaign(created_by=user.email)
    _apply_campaign(c, body)
    db.add(c)
    db.flush()
    audit.record(db, user.email, "campaign.created", "campaign", c.id, name=c.name)
    db.commit()
    return campaign_out(c)


@router.put("/campaigns/{campaign_id}")
def update_campaign(campaign_id: int, body: CampaignIn, db: Session = Depends(get_db), user: Employee = Depends(require_role(*ADMIN_OR_DEPT))):
    c = db.get(Campaign, campaign_id) or _404()
    _apply_campaign(c, body)
    audit.record(db, user.email, "campaign.updated", "campaign", c.id, name=c.name)
    db.commit()
    return campaign_out(c)


@router.delete("/campaigns/{campaign_id}")
def delete_campaign(campaign_id: int, db: Session = Depends(get_db), user: Employee = Depends(require_role(*ADMIN))):
    c = db.get(Campaign, campaign_id) or _404()
    audit.record(db, user.email, "campaign.deleted", "campaign", c.id, name=c.name, impressions=c.impressions, clicks=c.clicks)
    db.delete(c)
    db.commit()
    return {"ok": True}


@public.get("/r/c/{campaign_id}")
def campaign_click(campaign_id: int, db: Session = Depends(get_db)):
    """Banner click: count it, then send the reader to the campaign's stored link (never a URL from the request)."""
    c = db.get(Campaign, campaign_id)
    if c is None or not c.link_url:
        raise HTTPException(404, "This link has expired")
    c.clicks += 1
    db.commit()
    return RedirectResponse(c.link_url, status_code=302)


# ---------- disclaimers ----------

class DisclaimerIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1, max_length=4000)
    departments: str = Field(default="", max_length=1000)
    recipient_type: Literal["internal", "external", "any"] = "external"
    priority: int = Field(default=100, ge=1, le=10_000)
    enabled: bool = True


def disclaimer_out(d: Disclaimer) -> dict:
    return {"id": d.id, "name": d.name, "text": d.text, "departments": d.departments,
            "recipient_type": d.recipient_type, "priority": d.priority, "enabled": d.enabled,
            "created_by": d.created_by}


@router.get("/disclaimers")
def list_disclaimers(db: Session = Depends(get_db), _: Employee = Depends(require_role(*READERS))):
    return [disclaimer_out(d) for d in db.scalars(select(Disclaimer).order_by(Disclaimer.priority, Disclaimer.id))]


@router.post("/disclaimers")
def create_disclaimer(body: DisclaimerIn, db: Session = Depends(get_db), user: Employee = Depends(require_role(*ADMIN))):
    d = Disclaimer(**body.model_dump(), created_by=user.email)
    db.add(d)
    db.flush()
    audit.record(db, user.email, "disclaimer.created", "disclaimer", d.id, name=d.name)
    db.commit()
    return disclaimer_out(d)


@router.put("/disclaimers/{disclaimer_id}")
def update_disclaimer(disclaimer_id: int, body: DisclaimerIn, db: Session = Depends(get_db), user: Employee = Depends(require_role(*ADMIN))):
    d = db.get(Disclaimer, disclaimer_id) or _404()
    for k, v in body.model_dump().items():
        setattr(d, k, v)
    audit.record(db, user.email, "disclaimer.updated", "disclaimer", d.id, name=d.name)
    db.commit()
    return disclaimer_out(d)


@router.delete("/disclaimers/{disclaimer_id}")
def delete_disclaimer(disclaimer_id: int, db: Session = Depends(get_db), user: Employee = Depends(require_role(*ADMIN))):
    d = db.get(Disclaimer, disclaimer_id) or _404()
    audit.record(db, user.email, "disclaimer.deleted", "disclaimer", d.id, name=d.name)
    db.delete(d)
    db.commit()
    return {"ok": True}


# ---------- department assignments ----------

CASES = (("external", "new"), ("external", "reply"), ("internal", "new"), ("internal", "reply"))


@router.get("/assignments")
def assignments(db: Session = Depends(get_db), _: Employee = Depends(require_role(*READERS))):
    """Which template each department gets, for each kind of email. Computed with the live policies."""
    people = db.scalars(select(Employee).where(Employee.active)).all()
    counts = Counter(e.department or "" for e in people)
    rows = []
    for dept in sorted(counts, key=lambda d: (d == "", d.lower())):
        cells = {}
        for rtype, mtype in CASES:
            m = match_policy(db, dept, rtype, mtype)
            cells[f"{rtype}_{mtype}"] = {
                "policy": m[0].name if m else None, "policy_id": m[0].id if m else None,
                "template": db.get(Template, m[1].template_id).name if m else None,
                "banner": (lambda c: c.name if c else None)(extras.pick_campaign(db, dept, rtype)),
                "disclaimers": len(extras.pick_disclaimers(db, dept, rtype)),
            }
        rows.append({"department": dept or "(no department)", "people": counts[dept], "cells": cells})
    return {"cases": [f"{r}_{m}" for r, m in CASES], "rows": rows}


# ---------- automation ----------

@router.get("/automation")
def automation_state(db: Session = Depends(get_db), _: Employee = Depends(require_role(*READERS))):
    found = automation.insights(db)
    return {"insights": found, "switches": automation.switches(db),
            "summary": dict(Counter(f["severity"] for f in found))}


class ApplyIn(BaseModel):
    action: dict


@router.post("/automation/apply")
def automation_apply(body: ApplyIn, db: Session = Depends(get_db), user: Employee = Depends(require_role(*ADMIN))):
    try:
        message = automation.apply(db, body.action, user.email)
    except (LookupError, ValueError, KeyError) as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"ok": True, "message": message}


class SwitchIn(BaseModel):
    key: str
    enabled: bool


@router.put("/automation/switches")
def automation_switch(body: SwitchIn, db: Session = Depends(get_db), user: Employee = Depends(require_role(*ADMIN))):
    if body.key == "block_tampered_templates" and not body.enabled:
        raise HTTPException(422, "Tampered templates are always blocked")
    try:
        automation.set_switch(db, body.key, body.enabled, user.email)
    except KeyError as exc:
        raise HTTPException(404, "Unknown switch") from exc
    db.commit()
    return automation.switches(db)


@router.post("/automation/run")
def automation_run(db: Session = Depends(get_db), user: Employee = Depends(require_role(*ADMIN))):
    done = automation.run_scheduled(db)
    audit.record(db, user.email, "automation.run", "automation", "", **done)
    db.commit()
    return done


# ---------- integrity ----------

@router.get("/integrity/templates")
def integrity_templates(db: Session = Depends(get_db), _: Employee = Depends(require_role(*READERS))):
    out = []
    for t in db.scalars(select(Template).order_by(Template.name)):
        v = db.get(TemplateVersion, t.live_version_id) if t.live_version_id else None
        if v:
            state = integrity.version_intact(db, v)
            out.append({"template_id": t.id, "name": t.name, "version": v.number,
                        "status": {True: "sealed", False: "tampered", None: "unsealed"}[state],
                        "sha256": integrity.sha256(v.html)})
    return out


class SignatureCheckIn(BaseModel):
    code: str = Field(min_length=4, max_length=40)
    signature: str = Field(min_length=1, max_length=60_000)


RESULT_TEXT = {
    "intact": ("verified", "Signature intact", "Every line of the signature matches what {company} issued with this code."),
    "altered": ("warning", "Signature was changed", "Some details differ from what {company} issued. Don't use the changed details: contact the sender using a number you already know."),
    "not_found": ("warning", "Signature not found", "None of the issued signature appears in what you pasted. Paste the signature block from the email."),
    "unknown_code": ("warning", "Unknown code", "{company} has no signature record for this code."),
    "record_tampered": ("warning", "Record can't be trusted", "The stored record failed its integrity check. Contact {company} security."),
}


def _signature_check(db: Session, body: SignatureCheckIn, actor: str) -> dict:
    code = verification.normalize(body.code)
    r = integrity.check_signature(db, code, body.signature)
    tone, title, msg = RESULT_TEXT[r["result"]]
    company = extras.get_brand(db).company_name or "the company"
    action = "integrity.signature_intact" if r["result"] == "intact" else "integrity.signature_mismatch"
    audit.record(db, actor, action, "code", code, result=r["result"])
    db.commit()
    return r | {"tone": tone, "title": title, "message": msg.format(company=company)}


@router.post("/integrity/signature")
def integrity_signature(body: SignatureCheckIn, db: Session = Depends(get_db), user: Employee = Depends(require_role(*READERS))):
    return _signature_check(db, body, user.email)


@public.post("/api/verify/signature")
def public_signature_check(body: SignatureCheckIn, request: Request, db: Session = Depends(get_db)):
    """Recipients paste the signature they received; rate-limited like the code check."""
    ip = request.client.host if request.client else "unknown"
    if _rate_limited(ip):
        raise HTTPException(429, "Too many checks. Wait a minute and try again.")
    r = _signature_check(db, body, "public")
    # Never reveal stored signature text publicly: only the lines the person pasted.
    # Unknown codes and tampered records have no comparison details. Keep the
    # public response shape stable without indexing keys those results lack.
    return {
        "result": r["result"],
        "tone": r["tone"],
        "title": r["title"],
        "message": r["message"],
        "altered": r.get("altered", []),
        "matched_lines": r.get("matched_lines", 0),
        "total_lines": r.get("total_lines", 0),
    }


# ---------- analytics ----------

@router.get("/analytics")
def analytics(days: int = 30, db: Session = Depends(get_db), _: Employee = Depends(require_role(*CAN_READ_AUDIT, "dept_admin"))):
    days = max(1, min(days, 365))
    now = utcnow()
    since = (now - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    all_events = db.scalars(select(SignatureEvent).where(SignatureEvent.created_at >= since)).all()
    # Only signatures served to real Outlook count; simulator previews and older untagged rows are reported apart.
    events = [e for e in all_events if e.source == "outlook"]
    not_outlook = len(all_events) - len(events)
    audits = db.scalars(select(AuditEvent).where(AuditEvent.created_at >= since, AuditEvent.action.startswith("verify."))).all()

    day_keys = [(since + timedelta(days=i)).date().isoformat() for i in range(days)]
    series = {k: {"date": k, "external": 0, "internal": 0, "verified": 0, "failed": 0} for k in day_keys}
    for e in events:
        k = e.created_at.date().isoformat()
        if k in series:
            series[k]["external" if e.recipient_type == "external" else "internal"] += 1
    for a in audits:
        k = a.created_at.date().isoformat()
        if k in series:
            series[k]["verified" if a.action == "verify.passed" else "failed"] += 1

    by_template = Counter(e.template_name for e in events)
    by_dept: dict[str, Counter] = defaultdict(Counter)
    for e in events:
        by_dept[e.department or "(none)"][e.recipient_type] += 1
    employees = db.scalar(select(func.count(Employee.id)).where(Employee.active)) or 0
    senders = {e.employee_email for e in events}
    campaigns = db.scalars(select(Campaign).order_by(Campaign.impressions.desc())).all()
    impressions = sum(c.impressions for c in campaigns)
    clicks = sum(c.clicks for c in campaigns)
    passed = sum(1 for a in audits if a.action == "verify.passed")
    failed = len(audits) - passed
    return {
        "days": days,
        "totals": {
            "signatures": len(events),
            "external": sum(1 for e in events if e.recipient_type == "external"),
            "internal": sum(1 for e in events if e.recipient_type != "external"),
            "on_behalf": sum(1 for e in events if e.on_behalf),
            "with_disclaimer": sum(1 for e in events if e.disclaimers),
            "active_senders": len(senders),
            "not_from_outlook": not_outlook,
            "employees": employees,
            "coverage_pct": round(100 * len(senders) / employees) if employees else 0,
            "banner_impressions": impressions,
            "banner_clicks": clicks,
            "banner_ctr": round(100 * clicks / impressions, 1) if impressions else 0.0,
            "verifications_passed": passed,
            "verifications_failed": failed,
        },
        "series": list(series.values()),
        "by_template": [{"name": n or "(none)", "count": c} for n, c in by_template.most_common()],
        "by_department": [{"department": d, "external": c["external"], "internal": c["internal"]}
                          for d, c in sorted(by_dept.items(), key=lambda kv: -sum(kv[1].values()))],
        "campaigns": [{"id": c.id, "name": c.name, "state": extras.campaign_state(c), "impressions": c.impressions,
                       "clicks": c.clicks, "ctr": round(100 * c.clicks / c.impressions, 1) if c.impressions else 0.0}
                      for c in campaigns],
    }
