"""Push signatures into mail systems.

google_workspace: live when a service account is configured (Gmail API), otherwise simulated.
microsoft_365:    the Outlook add-in already applies signatures per email with no push needed.
                  A deployment additionally renders static signatures for Outlook on the web and
                  mobile; workers/deploy-outlook-signatures.ps1 applies the export (mode "script").
"""
from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import audit, signature
from .config import settings
from .db import SessionLocal
from .models import Deployment, DeploymentItem, Employee, utcnow

log = logging.getLogger("signguard.deploy")
TARGETS = ("google_workspace", "microsoft_365")
STATIC_RECIPIENT = "recipient@external.invalid"  # makes policies pick the external signature


def mode_for(target: str) -> str:
    if target == "google_workspace":
        return "live" if settings.google_configured else "simulated"
    return "script"


def people_in_scope(db: Session, scope: str, value: str) -> list[Employee]:
    q = select(Employee).where(Employee.active).order_by(Employee.name)
    people = db.scalars(q).all()
    if scope == "department":
        wanted = {d.strip().lower() for d in value.split(",") if d.strip()}
        return [e for e in people if e.department.lower() in wanted]
    if scope == "people":
        wanted = {d.strip().lower() for d in value.replace(";", ",").split(",") if d.strip()}
        return [e for e in people if e.email in wanted]
    return list(people)


def create(db: Session, target: str, scope: str, value: str, actor: str) -> Deployment:
    if target not in TARGETS:
        raise ValueError("Unknown target")
    if scope not in ("all", "department", "people"):
        raise ValueError("Unknown scope")
    d = Deployment(target=target, scope=scope, scope_value=value, mode=mode_for(target), created_by=actor,
                   total=len(people_in_scope(db, scope, value)))
    db.add(d)
    db.flush()
    audit.record(db, actor, "deployment.started", "deployment", d.id, target=target, scope=scope,
                 value=value, mode=d.mode, people=d.total)
    db.commit()
    return d


def run(deployment_id: int) -> None:
    """Runs in the background with its own database session."""
    with SessionLocal() as db:
        d = db.get(Deployment, deployment_id)
        if d is None or d.status not in ("queued",):
            return
        d.status = "running"
        db.commit()
        ok = failed = 0
        for e in people_in_scope(db, d.scope, d.scope_value):
            try:
                r = signature.build(db, e, [STATIC_RECIPIENT], "new", static=True)
                if not r.html:
                    db.add(DeploymentItem(deployment_id=d.id, employee_email=e.email, status="skipped",
                                          message=r.reason))
                    continue
                if d.mode == "live" and d.target == "google_workspace":
                    from . import google_workspace

                    google_workspace.set_signature(e.email, r.html)
                    msg = "Gmail signature updated"
                elif d.mode == "simulated":
                    msg = "Rendered (Google Workspace isn't connected, so nothing was sent)"
                else:
                    msg = "Ready for deploy-outlook-signatures.ps1; the Outlook add-in applies it per email"
                db.add(DeploymentItem(deployment_id=d.id, employee_email=e.email, status="ok", message=msg,
                                      template_name=r.template_name or "", html=r.html))
                ok += 1
            except Exception as exc:  # one person's failure must not stop the run
                log.warning("Deployment %s failed for %s: %s", d.id, e.email, exc)
                db.add(DeploymentItem(deployment_id=d.id, employee_email=e.email, status="failed",
                                      message=str(exc)[:900]))
                failed += 1
            db.commit()
        d.succeeded, d.failed = ok, failed
        d.status = "completed" if not failed else ("partial" if ok else "failed")
        d.finished_at = utcnow()
        audit.record(db, "system", "deployment.finished", "deployment", d.id, status=d.status,
                     succeeded=ok, failed=failed)
        db.commit()
