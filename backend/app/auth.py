"""Who is calling the API.

AUTH_MODE=dev   -> the caller names themselves in the X-Dev-User header (local development only).
AUTH_MODE=entra -> the caller sends an Entra ID access token for the SignGuard API.
"""
from functools import lru_cache

import jwt
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import Employee


@lru_cache
def _jwks_client() -> jwt.PyJWKClient:
    url = f"https://login.microsoftonline.com/{settings.entra_tenant_id}/discovery/v2.0/keys"
    return jwt.PyJWKClient(url)


def _email_from_token(token: str) -> str:
    try:
        key = _jwks_client().get_signing_key_from_jwt(token).key
        claims = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            audience=settings.entra_api_audience or settings.entra_api_client_id,
            issuer=[
                f"https://login.microsoftonline.com/{settings.entra_tenant_id}/v2.0",
                f"https://sts.windows.net/{settings.entra_tenant_id}/",
            ],
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Invalid token: {exc}") from exc
    email = claims.get("preferred_username") or claims.get("upn") or claims.get("email")
    if not email:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token has no user name claim")
    return email.lower()


def current_user(
    db: Session = Depends(get_db),
    authorization: str | None = Header(default=None),
    x_dev_user: str | None = Header(default=None),
) -> Employee:
    if settings.auth_mode == "entra":
        if not authorization or not authorization.lower().startswith("bearer "):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
        email = _email_from_token(authorization.split(" ", 1)[1])
    else:
        if not x_dev_user:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing X-Dev-User header")
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
