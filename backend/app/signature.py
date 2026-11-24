"""Choose and build the signature for one email being written."""
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import audit, verification
from .config import settings
from .models import (
    Delegation,
    Employee,
    SignaturePolicy,
    Template,
    TemplateVersion,
    utcnow,
)
from .rendering import render


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


def match_policy(
    db: Session, department: str, rtype: str, message_type: str
) -> tuple[SignaturePolicy, TemplateVersion] | None:
    policies = db.scalars(
        select(SignaturePolicy)
        .where(SignaturePolicy.enabled)
        .order_by(SignaturePolicy.priority, SignaturePolicy.id)
    )
    for p in policies:
        depts = [d.strip().lower() for d in p.departments.split(",") if d.strip()]
        if depts and department.lower() not in depts:
            continue
        if p.recipient_type not in ("any", rtype):
            continue
        if p.message_type not in ("any", message_type):
            continue
        template = db.get(Template, p.template_id)
        if template and template.live_version_id:
            version = db.get(TemplateVersion, template.live_version_id)
            if version:
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
) -> SignatureResult:
    """dry_run=True (policy tester, previews) never issues codes or writes audit events."""
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
    department = (owner or sender).department if delegation else sender.department
    matched = match_policy(db, department, rtype, message_type)
    if matched is None:
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

    values = {
        "name": sender.name,
        "job_title": sender.job_title,
        "department": sender.department,
        "phone": sender.phone,
        "mobile": sender.mobile,
        "email": sender.email,
        "company": settings.company_name,
        "photo_url": sender.photo_url,
        "verify_url": settings.verify_url.split("://", 1)[-1],
        "verification_code": code_row.code if code_row else ("SG-XXXX-XXXX" if dry_run and rtype == "external" else ""),
    }
    if delegation and owner:
        values.update(
            on_behalf_of=owner.name,
            on_behalf_title=owner.job_title,
            on_behalf_email=owner.email,
        )

    reason_bits.insert(0, f"policy \"{policy.name}\" ({rtype}, {message_type}, {department or 'no department'})")
    if not dry_run:
        db.commit()
    return SignatureResult(
        html=render(version.html, values),
        template_name=template.name if template else None,
        policy_name=policy.name,
        recipient_type=rtype,
        reason="; ".join(reason_bits),
        verification_code=code_row.code if code_row else None,
        on_behalf_of=owner.name if delegation and owner else None,
        delegation_id=delegation.id if delegation else None,
        warnings=warnings,
    )
