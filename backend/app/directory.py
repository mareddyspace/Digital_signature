"""Employee directory: sample JSON for local work, Microsoft Graph for a real tenant."""
import json
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import audit
from .config import settings
from .models import Employee, utcnow

SAMPLE_FILE = Path(__file__).resolve().parent.parent / "sample_data" / "employees.json"
GRAPH_USERS_URL = (
    "https://graph.microsoft.com/v1.0/users"
    "?$select=id,displayName,mail,userPrincipalName,jobTitle,department,"
    "businessPhones,mobilePhone,accountEnabled"
    "&$expand=manager($select=mail)&$top=999"
)


def load_sample() -> list[dict[str, Any]]:
    return json.loads(SAMPLE_FILE.read_text(encoding="utf-8"))


def _graph_token() -> str:
    resp = httpx.post(
        f"https://login.microsoftonline.com/{settings.entra_tenant_id}/oauth2/v2.0/token",
        data={
            "grant_type": "client_credentials",
            "client_id": settings.entra_api_client_id,
            "client_secret": settings.entra_api_client_secret,
            "scope": "https://graph.microsoft.com/.default",
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


def load_graph() -> list[dict[str, Any]]:
    """Needs the Graph application permission User.Read.All with admin consent."""
    headers = {"Authorization": f"Bearer {_graph_token()}"}
    url: str | None = GRAPH_USERS_URL
    people: list[dict[str, Any]] = []
    with httpx.Client(timeout=30) as client:
        while url:
            resp = client.get(url, headers=headers)
            resp.raise_for_status()
            body = resp.json()
            for u in body.get("value", []):
                email = u.get("mail") or u.get("userPrincipalName")
                if not email or not u.get("accountEnabled", True):
                    continue
                people.append(
                    {
                        "entra_object_id": u["id"],
                        "name": u.get("displayName") or email,
                        "email": email,
                        "job_title": u.get("jobTitle") or "",
                        "department": u.get("department") or "",
                        "phone": (u.get("businessPhones") or [""])[0],
                        "mobile": u.get("mobilePhone") or "",
                        "manager_email": (u.get("manager") or {}).get("mail") or "",
                    }
                )
            url = body.get("@odata.nextLink")
    return people


SYNCED_FIELDS = (
    "entra_object_id", "name", "job_title", "department", "phone", "mobile",
    "manager_email", "photo_url",
)


def sync(db: Session, actor: str = "system") -> dict[str, int]:
    """Upsert employees by email; mark missing ones inactive. Roles are kept."""
    people = load_graph() if settings.directory_source == "graph" else load_sample()
    existing = {e.email: e for e in db.scalars(select(Employee))}
    seen: set[str] = set()
    created = updated = 0
    for p in people:
        email = p["email"].lower()
        seen.add(email)
        emp = existing.get(email)
        if emp is None:
            emp = Employee(email=email, role=p.get("role", "employee"))
            db.add(emp)
            created += 1
        else:
            updated += 1
        for f in SYNCED_FIELDS:
            if f in p:
                setattr(emp, f, p[f] or ("" if f != "entra_object_id" else None))
        if p.get("manager_email"):
            emp.manager_email = p["manager_email"].lower()
        if "scope_department" in p:
            emp.scope_department = p["scope_department"]
        if email in settings.bootstrap_admins:
            emp.role = "admin"
        emp.active = True
        emp.synced_at = utcnow()
    deactivated = 0
    for email, emp in existing.items():
        if email not in seen and emp.active:
            emp.active = False
            deactivated += 1
    result = {"created": created, "updated": updated, "deactivated": deactivated}
    audit.record(db, actor, "directory.synced", "directory", settings.directory_source, **result)
    db.commit()
    return result
