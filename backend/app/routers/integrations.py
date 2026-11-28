"""Microsoft 365 and Google Workspace connections, and signature deployments."""
import json
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import deployments
from ..auth import ADMIN, require_role
from ..config import settings
from ..db import get_db
from ..models import AuditEvent, Deployment, DeploymentItem, Employee, SignatureEvent, utcnow

router = APIRouter(prefix="/api", tags=["integrations"])
READERS = ("admin", "dept_admin", "auditor")


def _last(db: Session, action: str, target_id: str | None = None):
    q = select(AuditEvent).where(AuditEvent.action == action)
    if target_id is not None:
        q = q.where(AuditEvent.target_id == target_id)
    return db.scalar(q.order_by(AuditEvent.id.desc()).limit(1))


@router.get("/integrations")
def integrations(db: Session = Depends(get_db), _: Employee = Depends(require_role(*READERS))):
    now = utcnow()
    employees = db.scalar(select(func.count(Employee.id)).where(Employee.active)) or 0
    active_senders = db.scalar(
        select(func.count(func.distinct(SignatureEvent.employee_email))).where(
            SignatureEvent.created_at >= now - timedelta(days=7), SignatureEvent.source == "outlook")
    ) or 0
    sync = _last(db, "directory.synced")

    def last_deploy(target: str):
        d = db.scalar(select(Deployment).where(Deployment.target == target).order_by(Deployment.id.desc()).limit(1))
        return deployment_out(d) if d else None

    return {
        "directory": {
            "source": settings.directory_source,
            "last_sync": sync.created_at if sync else None,
            "last_sync_details": json.loads(sync.details or "{}") if sync else None,
            "employees": employees,
        },
        "microsoft_365": {
            "connected": settings.m365_configured,
            "directory": settings.directory_source == "graph",
            "auth_mode": settings.auth_mode,
            "tenant_id": settings.entra_tenant_id or None,
            "addin_manifest": "outlook-addin/manifest.xml",
            "addin_active_senders_7d": active_senders,
            "addin_coverage_pct": round(100 * active_senders / employees) if employees else 0,
            "deploy_mode": deployments.mode_for("microsoft_365"),
            "last_deployment": last_deploy("microsoft_365"),
            "setup": [
                "Register 'SignGuard API' in Entra ID with Microsoft Graph User.Read.All (application) and admin consent",
                "Set ENTRA_TENANT_ID, ENTRA_API_CLIENT_ID, ENTRA_API_CLIENT_SECRET and DIRECTORY_SOURCE=graph",
                "Deploy outlook-addin/manifest.xml from the Microsoft 365 admin center (Integrated apps) to everyone",
                "Optional: run workers/deploy-outlook-signatures.ps1 with a deployment export for Outlook on the web and mobile",
            ],
        },
        "google_workspace": {
            "connected": settings.google_configured,
            "directory": settings.directory_source == "google",
            "admin_email": settings.google_admin_email or None,
            "deploy_mode": deployments.mode_for("google_workspace"),
            "last_deployment": last_deploy("google_workspace"),
            "setup": [
                "Create a service account in Google Cloud and enable the Gmail API and Admin SDK API",
                "In the Google Admin console, Security > API controls > Domain-wide delegation: add its client ID with the gmail.settings.basic and admin.directory.user.readonly scopes",
                "Set GOOGLE_SERVICE_ACCOUNT_FILE (key JSON path) and GOOGLE_ADMIN_EMAIL; optionally DIRECTORY_SOURCE=google",
                "Run a deployment: SignGuard writes each person's Gmail signature",
            ],
        },
    }


def deployment_out(d: Deployment) -> dict:
    return {
        "id": d.id, "target": d.target, "scope": d.scope, "scope_value": d.scope_value, "mode": d.mode,
        "status": d.status, "total": d.total, "succeeded": d.succeeded, "failed": d.failed,
        "created_by": d.created_by, "created_at": d.created_at, "finished_at": d.finished_at,
    }


class DeploymentIn(BaseModel):
    target: Literal["google_workspace", "microsoft_365"]
    scope: Literal["all", "department", "people"] = "all"
    scope_value: str = Field(default="", max_length=2000)


@router.post("/deployments")
def start_deployment(body: DeploymentIn, background: BackgroundTasks, db: Session = Depends(get_db),
                     user: Employee = Depends(require_role(*ADMIN))):
    if body.scope != "all" and not body.scope_value.strip():
        raise HTTPException(422, "Choose the departments or people to deploy to")
    d = deployments.create(db, body.target, body.scope, body.scope_value, user.email)
    if d.total == 0:
        d.status, d.finished_at = "completed", utcnow()
        db.commit()
    else:
        background.add_task(deployments.run, d.id)
    return deployment_out(d)


@router.get("/deployments")
def list_deployments(db: Session = Depends(get_db), _: Employee = Depends(require_role(*READERS))):
    rows = db.scalars(select(Deployment).order_by(Deployment.id.desc()).limit(100))
    return [deployment_out(d) for d in rows]


@router.get("/deployments/{deployment_id}")
def get_deployment(deployment_id: int, db: Session = Depends(get_db), _: Employee = Depends(require_role(*READERS))):
    d = db.get(Deployment, deployment_id)
    if d is None:
        raise HTTPException(404, "Not found")
    items = db.scalars(select(DeploymentItem).where(DeploymentItem.deployment_id == d.id).order_by(DeploymentItem.id))
    return deployment_out(d) | {"items": [
        {"employee_email": i.employee_email, "status": i.status, "message": i.message, "template_name": i.template_name}
        for i in items
    ]}


@router.get("/deployments/{deployment_id}/export")
def export_deployment(deployment_id: int, db: Session = Depends(get_db), _: Employee = Depends(require_role(*ADMIN))):
    """Input for workers/deploy-outlook-signatures.ps1: [{email, html}]."""
    items = db.scalars(select(DeploymentItem).where(DeploymentItem.deployment_id == deployment_id, DeploymentItem.status == "ok"))
    return [{"email": i.employee_email, "html": i.html} for i in items]
