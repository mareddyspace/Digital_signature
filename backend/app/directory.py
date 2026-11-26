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
    "businessPhones,mobilePhone,accountEnabled,userType"
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
                if is_guest(u):
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


def is_guest(u: dict[str, Any]) -> bool:
    """Guests from other organisations get no company signature."""
    return u.get("userType") == "Guest" or "#EXT#" in (u.get("userPrincipalName") or "")


# A sync that would deactivate more than this share of active people (and more than
# MIN_BLOCKED people) is held back: a broken or empty directory response must not
# switch off everyone's signature. An admin can confirm it with force=True.
MAX_DEACTIVATE_SHARE = 0.2
MIN_BLOCKED = 5


class EmptyDirectory(Exception):
    """The directory returned nobody. Never applied, not even with force: that is a broken
    connection or a permission problem, not a company with no staff."""

    def __init__(self, active: int):
        self.active = active
        super().__init__(
            f"The directory returned no people, so nothing was changed and all {active} active people "
            "keep their signatures. Check the directory connection and its permissions."
        )


class SyncHeldBack(Exception):
    def __init__(self, would_deactivate: int, active: int):
        self.would_deactivate, self.active = would_deactivate, active
        super().__init__(
            f"This sync would deactivate {would_deactivate} of {active} active people, so nothing was "
            "changed. Check the directory connection. To apply it anyway, use Sync directory on the "
            "People page and confirm."
        )


SYNCED_FIELDS = (
    "entra_object_id", "name", "job_title", "department", "phone", "mobile",
    "manager_email", "photo_url",
)


def sync(db: Session, actor: str = "system", force: bool = False) -> dict[str, int]:
    """Upsert employees and mark missing ones inactive. Roles are kept.

    People are matched by their Entra object ID when the directory supplies one, so a changed
    email address updates the same person instead of creating a second one; otherwise by email.
    Changes nothing when the result looks broken: EmptyDirectory when it lists nobody (never
    overridable), SyncHeldBack when it would deactivate an unusually large share (force=True
    applies it). A directory error while loading raises before anything is touched.
    """
    if settings.directory_source == "graph":
        people = load_graph()
    elif settings.directory_source == "google":
        from . import google_workspace

        people = google_workspace.load_directory()
    else:
        people = load_sample()
    rows = list(db.scalars(select(Employee)))
    if not people:
        audit.record(db, actor, "directory.sync_empty", "directory", settings.directory_source,
                     active=sum(1 for e in rows if e.active))
        db.commit()
        raise EmptyDirectory(sum(1 for e in rows if e.active))
    by_email = {e.email: e for e in rows}
    by_oid = {e.entra_object_id: e for e in rows if e.entra_object_id}

    matched: list[tuple[dict[str, Any], Employee | None]] = []
    seen_ids: set[int] = set()
    for p in people:
        email = p["email"].lower()
        oid = p.get("entra_object_id")
        emp = by_oid.get(oid) if oid else None
        if emp is None:
            emp = by_email.get(email)
            # An address that now belongs to a different directory object is a different person.
            if emp is not None and oid and emp.entra_object_id and emp.entra_object_id != oid:
                emp = None
        matched.append((p, emp))
        if emp is not None:
            seen_ids.add(emp.id)

    leaving = [e for e in rows if e.active and e.id not in seen_ids]
    active = sum(1 for e in rows if e.active)
    if (not force and len(leaving) > MIN_BLOCKED and len(leaving) > MAX_DEACTIVATE_SHARE * active):
        audit.record(db, actor, "directory.sync_held", "directory", settings.directory_source,
                     would_deactivate=len(leaving), active=active)
        db.commit()
        raise SyncHeldBack(len(leaving), active)

    created = updated = renamed = 0
    for p, emp in matched:
        email = p["email"].lower()
        if emp is None:
            if email in by_email:  # address reused by a new directory object: free it first
                old = by_email.pop(email)
                old.email = f"{old.email}.replaced-{old.id}"
                old.active = False
                db.flush()  # free the address before another row takes it (unique email)
            emp = Employee(email=email, role=p.get("role", "employee"))
            db.add(emp)
            by_email[email] = emp
            created += 1
        else:
            updated += 1
            if emp.email != email:
                if email in by_email and by_email[email] is not emp:
                    # Another row holds the new address (a person who left); keep it as history.
                    other = by_email.pop(email)
                    other.email = f"{other.email}.replaced-{other.id}"
                    other.active = False
                    db.flush()
                audit.record(db, actor, "directory.renamed", "employee", emp.id, old=emp.email, new=email)
                by_email.pop(emp.email, None)
                emp.email = email
                by_email[email] = emp
                renamed += 1
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
    for emp in leaving:
        emp.active = False
    result = {"created": created, "updated": updated, "deactivated": len(leaving), "renamed": renamed}
    audit.record(db, actor, "directory.synced", "directory", settings.directory_source, **result)
    db.commit()
    return result
