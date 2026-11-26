"""Who is calling the API.

AUTH_MODE=dev   -> the caller names themselves in the X-Dev-User header (local development only).
AUTH_MODE=entra -> the caller sends a Microsoft Entra ID access token for the SignGuard API.

Entra tokens are validated as Microsoft's claims-validation guidance asks: signature (tenant
keys), audience, issuer, tenant (tid), expiry, and the delegated scope. People are identified by
their immutable object ID (oid), never by email or preferred_username. Roles come from the app
roles in the token (the `roles` claim), so they are managed in Entra ID.
https://learn.microsoft.com/entra/identity-platform/claims-validation
"""
from __future__ import annotations

from functools import lru_cache
from typing import Any

import jwt
from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import audit
from .config import settings
from .db import get_db
from .models import Employee

# App role values defined on the SignGuard API app registration -> SignGuard roles.
# People with none of them are employees. Highest role wins when several are assigned.
APP_ROLES: dict[str, str] = {
    "SignGuard.Admin": "admin",
    "SignGuard.DepartmentAdmin": "dept_admin",
    "SignGuard.Auditor": "auditor",
}
ROLE_ORDER = ("admin", "dept_admin", "auditor", "employee")
CLOCK_SKEW_SECONDS = 120


def _unauthorized(message: str) -> HTTPException:
    return HTTPException(status.HTTP_401_UNAUTHORIZED, message, headers={"WWW-Authenticate": "Bearer"})


@lru_cache
def _jwks_client() -> jwt.PyJWKClient:
    # Tenant-specific keys: only keys Microsoft uses for this tenant can sign accepted tokens.
    url = f"https://login.microsoftonline.com/{settings.entra_tenant_id}/discovery/v2.0/keys"
    return jwt.PyJWKClient(url, cache_keys=True, lifespan=3600)


def _signing_key(token: str):
    return _jwks_client().get_signing_key_from_jwt(token).key


def validate_token(token: str) -> dict[str, Any]:
    """Validate an access token for the SignGuard API and return its claims, or raise 401.

    Accepts v2 tokens (audience = the API's client ID, e.g. from the admin web) and v1 tokens
    (audience = the Application ID URI), both issued by our tenant to a signed-in user.
    """
    tenant = settings.entra_tenant_id
    try:
        claims = jwt.decode(
            token,
            _signing_key(token),
            algorithms=["RS256"],
            audience=[settings.entra_api_audience, settings.entra_api_client_id],
            issuer=[
                f"https://login.microsoftonline.com/{tenant}/v2.0",
                f"https://sts.windows.net/{tenant}/",
            ],
            leeway=CLOCK_SKEW_SECONDS,
            options={"require": ["exp", "iss", "aud", "iat"]},
        )
    except jwt.PyJWTError as exc:
        raise _unauthorized(f"Invalid token: {exc}") from exc
    if claims.get("tid") != tenant:
        raise _unauthorized("Token is from another tenant")
    if not claims.get("oid"):
        raise _unauthorized("Token has no object ID (oid)")
    # Delegated tokens carry scp; app-only tokens (no signed-in user) don't, and are refused.
    if settings.entra_scope_name not in (claims.get("scp") or "").split():
        raise _unauthorized(f"Token is not a signed-in user's token for SignGuard (missing scope {settings.entra_scope_name})")
    return claims


def role_from_claims(claims: dict[str, Any]) -> str | None:
    """The highest SignGuard role among the token's app roles, or None if it has none of ours."""
    mapped = {APP_ROLES[r] for r in claims.get("roles") or [] if r in APP_ROLES}
    return next((r for r in ROLE_ORDER if r in mapped), None)


def _sign_in_name(claims: dict[str, Any]) -> str:
    return str(claims.get("preferred_username") or claims.get("upn") or claims.get("oid"))


def employee_for_token(db: Session, claims: dict[str, Any]) -> Employee:
    """Find the signed-in person by object ID and bring their role in line with Entra."""
    oid = claims["oid"]
    user = db.scalar(select(Employee).where(Employee.entra_object_id == oid))
    if user is None and settings.entra_link_by_email:
        # Opt-in bridge for records that predate directory sync; links once, then oid rules.
        email = str(claims.get("preferred_username") or claims.get("upn") or "").lower()
        candidate = db.scalar(select(Employee).where(Employee.email == email)) if email else None
        if candidate is not None and candidate.entra_object_id is None:
            candidate.entra_object_id = oid
            audit.record(db, email, "auth.linked", "employee", candidate.id, oid=oid)
            user = candidate
    if user is None or not user.active:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            f"{_sign_in_name(claims)} signed in, but isn't an active SignGuard user. "
            "An admin needs to sync the directory first.",
        )

    entra_role = role_from_claims(claims)
    before = (user.role, user.role_source)
    if entra_role is not None:
        user.role, user.role_source = entra_role, "entra"
    elif user.role_source == "entra":
        # The app role was removed in Entra ID: the person is an ordinary employee again.
        user.role = "employee"
    # role_source "local" with no app role: the role set in SignGuard stays (database fallback).
    if (user.role, user.role_source) != before:
        audit.record(db, user.email, "auth.role_changed", "employee", user.id,
                     old_role=before[0], new_role=user.role, source="entra" if entra_role else before[1])
    if db.dirty or db.new:
        db.commit()
    return user


def current_user(
    request: Request,
    db: Session = Depends(get_db),
    authorization: str | None = Header(default=None),
    x_dev_user: str | None = Header(default=None),
) -> Employee:
    if settings.auth_mode == "entra":
        if x_dev_user is not None:
            # Refuse rather than ignore, so a client still sending it is noticed and fixed.
            raise _unauthorized("X-Dev-User is not accepted when AUTH_MODE=entra; sign in with Microsoft")
        if not authorization or not authorization.lower().startswith("bearer "):
            raise _unauthorized("Missing bearer token")
        claims = validate_token(authorization.split(" ", 1)[1].strip())
        user = employee_for_token(db, claims)
        request.state.token_claims = claims
        return user

    if not x_dev_user:
        raise _unauthorized("Missing X-Dev-User header")
    email = x_dev_user.strip().lower()
    user = db.scalar(select(Employee).where(Employee.email == email, Employee.active))
    if user is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"{email} is not a SignGuard user")
    return user


def require_role(*roles: str):
    def checker(user: Employee = Depends(current_user)) -> Employee:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You don't have permission for this")
        return user

    return checker


ADMIN = ("admin",)
ADMIN_OR_DEPT = ("admin", "dept_admin")
CAN_READ_AUDIT = ("admin", "auditor")
