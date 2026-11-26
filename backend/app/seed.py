"""First-run data so the product can be explored without Microsoft 365."""
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

import json

from . import designer, directory, integrity
from .config import settings
from .models import (
    BrandKit,
    Campaign,
    Disclaimer,
    Setting,
    TemplateDesign,
    Employee,
    MailboxPermission,
    SignaturePolicy,
    Template,
    TemplateVersion,
    utcnow,
)

FULL = """<table cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:18px;color:#1f2933;">
<tr><td style="font-size:15px;font-weight:bold;color:#102a43;">{{name}}</td></tr>
{{#on_behalf_of}}<tr><td style="color:#486581;">on behalf of {{on_behalf_of}}, {{on_behalf_title}}</td></tr>{{/on_behalf_of}}
<tr><td style="color:#486581;">{{job_title}} | {{department}} | {{company}}</td></tr>
{{#phone}}<tr><td>Phone: {{phone}}</td></tr>{{/phone}}
{{#mobile}}<tr><td>Mobile: {{mobile}}</td></tr>{{/mobile}}
<tr><td><a href="mailto:{{email}}" style="color:#1d4ed8;text-decoration:none;">{{email}}</a></td></tr>
{{#verification_code}}<tr><td style="padding-top:8px;font-size:11px;color:#486581;">Verify this email: <b>{{verification_code}}</b> at {{verify_url}}</td></tr>{{/verification_code}}
</table>"""

SHORT = """<table cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#1f2933;">
<tr><td><b>{{name}}</b> | {{job_title}}{{#phone}} | {{phone}}{{/phone}}</td></tr>
{{#on_behalf_of}}<tr><td style="color:#486581;">on behalf of {{on_behalf_of}}</td></tr>{{/on_behalf_of}}
</table>"""

FINANCE = FULL.replace(
    "</table>",
    """<tr><td style="padding-top:8px;font-size:11px;color:#7b8794;max-width:520px;">{{company}} Finance will never ask you to change bank details by email alone. Check the verification code above before acting on any payment request.</td></tr>
</table>""",
)

TEMPLATES = [
    ("Full external", "Standard signature for customers and partners", FULL),
    ("Short internal", "One line for colleagues", SHORT),
    ("Finance external", "Full signature plus payment-safety notice", FINANCE),
]

POLICIES = [
    # name, priority, departments, recipient_type, message_type, template name
    ("Finance to outside", 10, "Finance", "external", "any", "Finance external"),
    ("Everyone to colleagues", 50, "", "internal", "any", "Short internal"),
    ("Everyone to outside", 90, "", "external", "any", "Full external"),
]


def seed(db: Session) -> None:
    if db.scalar(select(Employee.id).limit(1)) is None:
        directory.sync(db, actor="seed")

    if db.scalar(select(Template.id).limit(1)) is None:
        now = utcnow()
        by_name = {}
        for name, desc, html in TEMPLATES:
            t = Template(name=name, description=desc, created_by="seed")
            db.add(t)
            db.flush()
            v = TemplateVersion(
                template_id=t.id, number=1, html=html, status="live",
                created_by="seed", decided_by="seed", decided_at=now,
            )
            db.add(v)
            db.flush()
            t.live_version_id = v.id
            by_name[name] = t
        for name, prio, depts, rtype, mtype, tname in POLICIES:
            db.add(SignaturePolicy(
                name=name, priority=prio, departments=depts, recipient_type=rtype,
                message_type=mtype, template_id=by_name[tname].id,
            ))
        db.commit()

    if settings.directory_source == "sample" and db.scalar(select(MailboxPermission.id).limit(1)) is None:
        now = utcnow()
        d = lambda days: now - timedelta(days=days)  # noqa: E731
        sample = [
            ("arjun.rao@contoso.com", "priya.sharma@contoso.com", "send_on_behalf", d(60), d(1)),
            ("arjun.rao@contoso.com", "sara.khan@contoso.com", "send_as", d(200), None),
            ("rahul.verma@contoso.com", "sara.khan@contoso.com", "send_on_behalf", d(20), d(3)),
            ("finance@contoso.com", "david.chen@contoso.com", "full_access", d(400), d(1)),
            ("finance@contoso.com", "priya.sharma@contoso.com", "full_access", d(45), d(2)),
        ]
        for mailbox, trustee, ptype, granted, used in sample:
            db.add(MailboxPermission(
                mailbox=mailbox, trustee=trustee, type=ptype, granted_at=granted,
                last_used=used, first_seen=granted, source="sample",
            ))
        db.commit()


PLATFORM_SEED_KEY = "seed.platform_v2"

EXTERNAL_DISCLAIMER = (
    "This email and any attachments are confidential and intended only for the named recipients. "
    "If you received it by mistake, please tell the sender and delete it. {company} never asks for "
    "passwords or payment changes by email."
)


def seed_platform(db: Session) -> None:
    """Brand kit, a designer-built template, a disclaimer and a banner. Runs once per database,
    including databases created before these features existed."""
    if db.get(Setting, PLATFORM_SEED_KEY) is not None:
        integrity.seal_unsealed_live_versions(db)
        return
    company = settings.company_name
    if db.get(BrandKit, 1) is None:
        sample = settings.directory_source == "sample"
        db.add(BrandKit(
            id=1, company_name=company, primary_color="#2878d0", secondary_color="#11263f",
            accent_color="#16865b", palette="#eaf3ff", font_family="Arial, Helvetica, sans-serif",
            website="https://www.contoso.com" if sample else "",
            linkedin_url="https://www.linkedin.com/company/contoso" if sample else "",
            address="Prestige Tech Park, Bengaluru 560103" if sample else "",
        ))

    # A template made in the designer, so the drag-and-drop editor has something to open.
    if db.scalar(select(Template.id).where(Template.name == "Modern brand")) is None:
        design = designer.starter("split", {"primary_color": "#2878d0", "secondary_color": "#11263f"})
        html = designer.compile_design(design)
        now = utcnow()
        t = Template(name="Modern brand", description="Two-column design with social links and banner slot (made in the designer)", created_by="seed")
        db.add(t)
        db.flush()
        v = TemplateVersion(template_id=t.id, number=1, html=html, status="live", created_by="seed",
                            decided_by="seed", decided_at=now)
        db.add(v)
        db.flush()
        t.live_version_id = v.id
        db.add(TemplateDesign(version_id=v.id, design_json=json.dumps(design)))
        if settings.directory_source == "sample":
            db.add(SignaturePolicy(name="Marketing to outside", priority=20, departments="Marketing",
                                   recipient_type="external", message_type="any", template_id=t.id))

    if db.scalar(select(Disclaimer.id).limit(1)) is None:
        db.add(Disclaimer(name="External confidentiality", text=EXTERNAL_DISCLAIMER.format(company=company),
                          recipient_type="external", priority=50))
    if settings.directory_source == "sample" and db.scalar(select(Campaign.id).limit(1)) is None:
        db.add(Campaign(
            name="Q4 product webinar", headline="Join our live product webinar",
            body="See what's new in the Contoso platform. 30 minutes, with Q&A.",
            cta_text="Register", link_url="https://www.contoso.com/webinar",
            departments="Sales", recipient_type="external",
            starts_at=utcnow() - timedelta(days=1), ends_at=utcnow() + timedelta(days=60),
        ))
    db.add(Setting(key=PLATFORM_SEED_KEY, value="done", updated_by="seed"))
    db.commit()
    integrity.seal_unsealed_live_versions(db)
