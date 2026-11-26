"""Google Workspace: read the directory and set Gmail signatures.

Uses a service account with domain-wide delegation (no user passwords, no per-user consent).
In the Google Admin console, authorise the service account's client ID for these scopes:
    https://www.googleapis.com/auth/gmail.settings.basic        (set signatures)
    https://www.googleapis.com/auth/admin.directory.user.readonly (directory sync)
Then set GOOGLE_SERVICE_ACCOUNT_FILE (the key JSON) and GOOGLE_ADMIN_EMAIL.
"""
from __future__ import annotations

import json
import time
from functools import lru_cache
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx
import jwt

from .config import settings

TOKEN_URL = "https://oauth2.googleapis.com/token"
GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.settings.basic"
DIRECTORY_SCOPE = "https://www.googleapis.com/auth/admin.directory.user.readonly"
MAX_SIGNATURE_BYTES = 10_000  # Gmail rejects longer signatures


class GoogleError(RuntimeError):
    pass


@lru_cache
def _key() -> dict[str, Any]:
    path = Path(settings.google_service_account_file)
    data = json.loads(path.read_text(encoding="utf-8"))
    for f in ("client_email", "private_key"):
        if f not in data:
            raise GoogleError(f"Service account file has no {f}")
    return data


def _token(subject: str, scope: str) -> str:
    key = _key()
    now = int(time.time())
    assertion = jwt.encode(
        {"iss": key["client_email"], "sub": subject, "scope": scope, "aud": TOKEN_URL, "iat": now, "exp": now + 3600},
        key["private_key"], algorithm="RS256",
    )
    resp = httpx.post(TOKEN_URL, data={"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assertion}, timeout=30)
    if resp.status_code != 200:
        raise GoogleError(f"Google sign-in failed for {subject}: {resp.text[:300]}")
    return resp.json()["access_token"]


def set_signature(email: str, html: str) -> None:
    """Replace the signature on the user's primary send-as address."""
    if len(html.encode("utf-8")) > MAX_SIGNATURE_BYTES:
        raise GoogleError(f"Signature is larger than Gmail's {MAX_SIGNATURE_BYTES} byte limit")
    token = _token(email, GMAIL_SCOPE)
    url = f"https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs/{quote(email)}"
    resp = httpx.patch(url, headers={"Authorization": f"Bearer {token}"}, json={"signature": html}, timeout=30)
    if resp.status_code >= 300:
        raise GoogleError(f"Gmail refused the signature ({resp.status_code}): {resp.text[:300]}")


def load_directory() -> list[dict[str, Any]]:
    """Same shape as directory.load_graph()."""
    token = _token(settings.google_admin_email, DIRECTORY_SCOPE)
    people: list[dict[str, Any]] = []
    page = None
    with httpx.Client(timeout=30) as client:
        while True:
            params = {"customer": settings.google_customer_id, "maxResults": 500, "projection": "full"}
            if page:
                params["pageToken"] = page
            resp = client.get("https://admin.googleapis.com/admin/directory/v1/users",
                              headers={"Authorization": f"Bearer {token}"}, params=params)
            if resp.status_code >= 300:
                raise GoogleError(f"Directory read failed ({resp.status_code}): {resp.text[:300]}")
            body = resp.json()
            for u in body.get("users", []):
                if u.get("suspended") or u.get("archived"):
                    continue
                org = (u.get("organizations") or [{}])[0]
                phones = u.get("phones") or []
                work = next((p.get("value") for p in phones if p.get("type") == "work"), "")
                mobile = next((p.get("value") for p in phones if p.get("type") == "mobile"), "")
                manager = next((r.get("value") for r in (u.get("relations") or []) if r.get("type") == "manager"), "")
                people.append({
                    "entra_object_id": None,
                    "name": (u.get("name") or {}).get("fullName") or u["primaryEmail"],
                    "email": u["primaryEmail"],
                    "job_title": org.get("title") or "",
                    "department": org.get("department") or "",
                    "phone": work or "",
                    "mobile": mobile or "",
                    "manager_email": manager or "",
                    "photo_url": u.get("thumbnailPhotoUrl") or "",
                })
            page = body.get("nextPageToken")
            if not page:
                break
    return people
