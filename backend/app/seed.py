"""First-run data so the product can be explored without Microsoft 365."""
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import directory
from .config import settings
from .models import (
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
