"""Choose and build the signature for one email being written."""
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import audit, extras, integrity, verification
from .config import settings
from .models import (
    Delegation,
    Employee,
    SignatureEvent,
    SignaturePolicy,
    Template,
    TemplateVersion,
    utcnow,
)
from .rendering import place_extras, render


@dataclass
class SignatureResult:
    html: str
    template_name: str | None
    policy_name: str | None
    recipient_type: str
    reason: str
    verification_code: str | None = None
    on_behalf_of: str | None = None
    delegation_id: int | None = None
    warnings: list[str] = field(default_factory=list)
    campaign: str | None = None
    disclaimers: list[str] = field(default_factory=list)
    template_version_id: int | None = None


def domain(email: str) -> str:
    return email.rsplit("@", 1)[-1].lower() if "@" in email else ""


def recipient_type(recipients: list[str]) -> str:
    """'internal' only when every recipient is in an internal domain.

    With no recipients yet we assume external, so a customer never gets the short signature.
    """
    real = [r for r in recipients if r.strip()]
    if not real:
        return "external"
    return "internal" if all(domain(r) in settings.internal_domains for r in real) else "external"


def active_delegation(db: Session, delegate: str, owner: str) -> Delegation | None:
    now = utcnow()
    return db.scalar(
        select(Delegation).where(
            Delegation.delegate_email == delegate,
            Delegation.owner_email == owner,
            Delegation.status == "approved",
            Delegation.starts_at <= now,
            Delegation.ends_at > now,
        )
    )


def _list(value: str | None) -> set[str]:
    return {x.strip().lower() for x in (value or "").split(",") if x.strip()}


def _domain_matches(recipient_domain: str, wanted: set[str]) -> bool:
    return any(recipient_domain == w or recipient_domain.endswith("." + w) for w in wanted)


def policy_matches_sender(p: SignaturePolicy, department: str, email: str) -> bool:
    """Senders: no departments and no people means everyone; otherwise either list can match."""
    if email.lower() in _list(p.exclude_people):
        return False
    depts, people = _list(p.departments), _list(p.people)
    if not depts and not people:
        return True
    return department.lower() in depts or email.lower() in people


def match_policy(
    db: Session, department: str, rtype: str, message_type: str,
    tampered: list[str] | None = None, sender_email: str = "", recipients: list[str] | None = None,
    now: datetime | None = None,
) -> tuple[SignaturePolicy, TemplateVersion] | None:
    """First enabled policy that matches. Live versions whose integrity seal is broken are skipped
    (their names are appended to `tampered`) so an altered template never reaches anyone's email."""
    now = now or utcnow()
    domains = {domain(r) for r in (recipients or []) if r.strip()}
    policies = db.scalars(
        select(SignaturePolicy)
        .where(SignaturePolicy.enabled)
        .order_by(SignaturePolicy.priority, SignaturePolicy.id)
    )
    for p in policies:
        if not policy_matches_sender(p, department, sender_email):
            continue
        if (p.starts_at and now < p.starts_at) or (p.ends_at and now >= p.ends_at):
            continue
        wanted = _list(p.recipient_domains)
        if wanted and not any(_domain_matches(d, wanted) for d in domains):
            continue
        if p.recipient_type not in ("any", rtype):
            continue
        if p.message_type not in ("any", message_type):
            continue
        template = db.get(Template, p.template_id)
        if template and template.live_version_id:
            version = db.get(TemplateVersion, template.live_version_id)
            if version:
                if integrity.version_intact(db, version) is False:
                    if tampered is not None:
                        tampered.append(template.name)
                    continue
                return p, version
    return None


def build(
    db: Session,
    sender: Employee,
    recipients: list[str],
    message_type: str = "new",
    from_email: str | None = None,
    previous_code: str | None = None,
    dry_run: bool = False,
    static: bool = False,
    source: str = "outlook",
) -> SignatureResult:
    """dry_run=True (policy tester, previews) never issues codes or writes audit events.

    static=True renders a signature to store in a mail system (Gmail, Outlook on the web) where
    there is no per-email code; it implies dry_run.
    """
    if static:
        dry_run = True
    message_type = "reply" if message_type in ("reply", "forward") else "new"
    rtype = recipient_type(recipients)
    warnings: list[str] = []
    owner: Employee | None = None
    delegation: Delegation | None = None
    reason_bits: list[str] = []

    from_email = (from_email or sender.email).lower()
    if from_email != sender.email:
        owner = db.scalar(select(Employee).where(Employee.email == from_email))
        if owner is None:
            reason_bits.append(f"sending from shared mailbox {from_email}")
        else:
            delegation = active_delegation(db, sender.email, owner.email)
            if delegation:
                reason_bits.append(
                    f"approved delegation #{delegation.id} until {delegation.ends_at:%d %b %Y}"
                )
            else:
                warnings.append(
                    f"You have no approved delegation to send for {owner.name}. "
                    "Request one in SignGuard; this email will use your own signature."
                )
                if not dry_run:
                    audit.record(
                        db, sender.email, "signature.unapproved_send_as", "mailbox",
                        owner.email, recipients=len(recipients),
                    )
                owner = None

    # Policies follow the department of the person the email is sent for.
    governing = (owner or sender) if delegation else sender
    department = governing.department
    tampered: list[str] = []
    matched = match_policy(db, department, rtype, message_type, tampered, governing.email, recipients)
    for name in tampered:
        warnings.append(f"Template \"{name}\" failed its integrity check and was not used.")
        if not dry_run:
            audit.record(db, "system", "integrity.template_tampered", "template", name, sender=sender.email)
    if matched is None:
        if tampered and not dry_run:
            db.commit()
        return SignatureResult(
            html="", template_name=None, policy_name=None, recipient_type=rtype,
            reason="No signature policy matches this email", warnings=warnings,
        )
    policy, version = matched
    template = db.get(Template, version.template_id)

    code_row = None
    real_recipients = [r for r in recipients if r.strip()]
    if rtype == "external" and real_recipients and not dry_run:
        code_row = verification.issue(
            db, sender.email, real_recipients,
            owner.email if delegation and owner else None, previous_code,
        )

    brand = extras.get_brand(db)
    values = {
        **extras.brand_values(brand),
        "name": sender.name,
        "job_title": sender.job_title,
        "department": sender.department,
        "phone": sender.phone,
        "mobile": sender.mobile,
        "email": sender.email,
        "photo_url": sender.photo_url,
        "verify_url": settings.verify_url.split("://", 1)[-1],
        "verification_code": code_row.code if code_row else (
            "SG-XXXX-XXXX" if dry_run and not static and rtype == "external" else ""),
    }
    if not brand.company_name:
        values["company"] = settings.company_name
    if delegation and owner:
        values.update(
            on_behalf_of=owner.name,
            on_behalf_title=owner.job_title,
            on_behalf_email=owner.email,
        )

    reason_bits.insert(0, f"policy \"{policy.name}\" ({rtype}, {message_type}, {department or 'no department'})")

    width = min(brand.max_width or 600, 600) - 40
    campaign = extras.pick_campaign(db, department, rtype)
    disclaimers = extras.pick_disclaimers(db, department, rtype)
    html_out = place_extras(
        render(version.html, values),
        extras.campaign_html(campaign, width) if campaign else "",
        extras.disclaimer_html(disclaimers, width),
    )
    if campaign:
        reason_bits.append(f"banner \"{campaign.name}\"")
    if disclaimers:
        reason_bits.append(f"{len(disclaimers)} disclaimer(s)")

    if not dry_run:
        if code_row:
            integrity.seal_signature(db, code_row.code, version.id, sender.email, html_out)
        if campaign and source == "outlook":
            campaign.impressions += 1
        db.add(SignatureEvent(
            employee_email=sender.email, department=department or "",
            template_name=template.name if template else "", policy_name=policy.name,
            recipient_type=rtype, message_type=message_type,
            campaign_id=campaign.id if campaign else None, disclaimers=len(disclaimers),
            on_behalf=bool(delegation), source=source,
        ))
        db.commit()
    return SignatureResult(
        html=html_out,
        template_name=template.name if template else None,
        policy_name=policy.name,
        recipient_type=rtype,
        reason="; ".join(reason_bits),
        verification_code=code_row.code if code_row else None,
        on_behalf_of=owner.name if delegation and owner else None,
        delegation_id=delegation.id if delegation else None,
        warnings=warnings,
        campaign=campaign.name if campaign else None,
        disclaimers=[d.name for d in disclaimers],
        template_version_id=version.id,
    )
