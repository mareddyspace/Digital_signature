"""Microsoft Entra ID sign-in: token validation, object-ID identity, app roles, and dev mode."""
import dataclasses
import time
import uuid

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app import auth
from app.db import SessionLocal
from app.models import AuditEvent, Employee
from app.routers import admin
from conftest import as_user

TENANT = "11111111-1111-1111-1111-111111111111"
API_ID = "22222222-2222-2222-2222-222222222222"
SPA_ID = "33333333-3333-3333-3333-333333333333"
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
OTHER_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


def entra_settings(**extra):
    return dataclasses.replace(
        auth.settings, auth_mode="entra", entra_tenant_id=TENANT, entra_api_client_id=API_ID,
        entra_spa_client_id=SPA_ID, entra_api_audience_setting=f"api://{API_ID}", **extra)


@pytest.fixture
def entra(monkeypatch):
    """Switch the API to AUTH_MODE=entra with a test signing key, for one test."""
    s = entra_settings()
    monkeypatch.setattr(auth, "settings", s)
    monkeypatch.setattr(admin, "settings", s)
    monkeypatch.setattr(auth, "_signing_key", lambda token: KEY.public_key())
    return s


def token(key=KEY, **overrides):
    now = int(time.time())
    claims = {
        "aud": API_ID, "iss": f"https://login.microsoftonline.com/{TENANT}/v2.0", "tid": TENANT,
        "oid": "oid-meera", "scp": "access_as_user", "preferred_username": "meera.iyer@contoso.com",
        "iat": now, "nbf": now, "exp": now + 3600, "roles": ["SignGuard.Admin"],
    }
    claims.update(overrides)
    claims = {k: v for k, v in claims.items() if v is not None}
    return jwt.encode(claims, key, algorithm="RS256", headers={"kid": "test"})


def bearer(t):
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture
def meera_linked():
    """Give Meera (sample admin) an Entra object ID, and put her back afterwards."""
    with SessionLocal() as db:
        e = db.query(Employee).filter_by(email="meera.iyer@contoso.com").one()
        saved = (e.entra_object_id, e.role, e.role_source)
        e.entra_object_id = "oid-meera"
        db.commit()
    yield
    with SessionLocal() as db:
        e = db.query(Employee).filter_by(email="meera.iyer@contoso.com").one()
        e.entra_object_id, e.role, e.role_source = saved
        db.commit()


def test_valid_token_returns_identity_and_roles(client, entra, meera_linked):
    r = client.get("/api/me", headers=bearer(token()))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["email"] == "meera.iyer@contoso.com" and body["role"] == "admin"
    assert body["role_source"] == "entra" and body["auth_mode"] == "entra"
    assert body["identity"] == {"object_id": "oid-meera", "tenant_id": TENANT,
                                "sign_in_name": "meera.iyer@contoso.com", "app_roles": ["SignGuard.Admin"]}


def test_v1_token_with_app_id_uri_audience_is_accepted(client, entra, meera_linked):
    t = token(aud=f"api://{API_ID}", iss=f"https://sts.windows.net/{TENANT}/")
    assert client.get("/api/me", headers=bearer(t)).status_code == 200


@pytest.mark.parametrize("bad, reason", [
    (dict(aud=SPA_ID), "audience"),
    (dict(aud="https://graph.microsoft.com"), "audience"),
    (dict(iss="https://login.microsoftonline.com/99999999-9999-9999-9999-999999999999/v2.0"), "issuer"),
    (dict(tid="99999999-9999-9999-9999-999999999999"), "another tenant"),
    (dict(exp=int(time.time()) - 600, iat=int(time.time()) - 4000, nbf=int(time.time()) - 4000), "expired"),
    (dict(scp=None), "missing scope"),
    (dict(scp="User.Read"), "missing scope"),
    (dict(oid=None), "object id"),
])
def test_bad_tokens_are_rejected(client, entra, meera_linked, bad, reason):
    r = client.get("/api/me", headers=bearer(token(**bad)))
    assert r.status_code == 401 and reason in r.json()["detail"].lower()


def test_token_signed_by_another_key_is_rejected(client, entra, meera_linked):
    r = client.get("/api/me", headers=bearer(token(key=OTHER_KEY)))
    assert r.status_code == 401 and "Signature" in r.json()["detail"]


def test_hs256_token_is_rejected(client, entra, meera_linked):
    forged = jwt.encode({"aud": API_ID, "tid": TENANT}, "a-shared-secret-of-at-least-32-bytes!!", algorithm="HS256")
    assert client.get("/api/me", headers=bearer(forged)).status_code == 401


def test_x_dev_user_is_rejected_in_entra_mode(client, entra, meera_linked):
    assert client.get("/api/me", headers=as_user("meera.iyer@contoso.com")).status_code == 401
    both = {**bearer(token()), **as_user("arjun.rao@contoso.com")}
    r = client.get("/api/me", headers=both)
    assert r.status_code == 401 and "X-Dev-User" in r.json()["detail"]
    assert client.get("/api/dev/users").status_code == 404


def test_missing_token_is_rejected(client, entra):
    assert client.get("/api/me").status_code == 401
    assert client.get("/api/policies").status_code == 401


def test_unknown_person_is_refused_and_email_is_not_trusted(client, entra):
    # Same address as a SignGuard user, but an object ID SignGuard doesn't know.
    r = client.get("/api/me", headers=bearer(token(oid="oid-stranger")))
    assert r.status_code == 403 and "sync the directory" in r.json()["detail"]


def test_link_by_email_is_opt_in_and_links_once(client, monkeypatch, meera_linked):
    s = entra_settings(entra_link_by_email=True)
    monkeypatch.setattr(auth, "settings", s)
    monkeypatch.setattr(admin, "settings", s)
    monkeypatch.setattr(auth, "_signing_key", lambda token: KEY.public_key())
    with SessionLocal() as db:
        arjun = db.query(Employee).filter_by(email="arjun.rao@contoso.com").one()
        saved = (arjun.entra_object_id, arjun.role, arjun.role_source)
        arjun.entra_object_id = None
        db.commit()
    try:
        t = token(oid="oid-arjun", preferred_username="arjun.rao@contoso.com", roles=None)
        assert client.get("/api/me", headers=bearer(t)).json()["email"] == "arjun.rao@contoso.com"
        # Already linked: another account with Arjun's address can't take the record over.
        t2 = token(oid="oid-impostor", preferred_username="arjun.rao@contoso.com", roles=None)
        assert client.get("/api/me", headers=bearer(t2)).status_code == 403
        with SessionLocal() as db:
            assert db.query(AuditEvent).filter_by(action="auth.linked").count() >= 1
    finally:
        with SessionLocal() as db:
            arjun = db.query(Employee).filter_by(email="arjun.rao@contoso.com").one()
            arjun.entra_object_id, arjun.role, arjun.role_source = saved
            db.commit()


def test_app_roles_drive_access_and_removal_takes_effect(client, entra, meera_linked):
    admin_t = token()
    assert client.get("/api/audit", headers=bearer(admin_t)).status_code == 200
    auditor_t = token(roles=["SignGuard.Auditor"])
    assert client.get("/api/me", headers=bearer(auditor_t)).json()["role"] == "auditor"
    assert client.get("/api/audit", headers=bearer(auditor_t)).status_code == 200
    assert client.post("/api/policies/reorder", headers=bearer(auditor_t), json={"ids": []}).status_code == 403
    none_t = token(roles=None)  # every app role removed in Entra ID
    me = client.get("/api/me", headers=bearer(none_t)).json()
    assert (me["role"], me["role_source"]) == ("employee", "entra")
    assert client.get("/api/audit", headers=bearer(none_t)).status_code == 403


def test_highest_app_role_wins_and_unknown_roles_are_ignored(client, entra, meera_linked):
    t = token(roles=["Something.Else", "SignGuard.Auditor", "SignGuard.DepartmentAdmin"])
    me = client.get("/api/me", headers=bearer(t)).json()
    assert me["role"] == "dept_admin" and me["identity"]["app_roles"] == ["SignGuard.Auditor", "SignGuard.DepartmentAdmin"]


def test_local_role_is_kept_when_token_has_no_app_role(client, entra, meera_linked):
    # Meera's admin role is local (sample data / BOOTSTRAP_ADMINS): database fallback.
    me = client.get("/api/me", headers=bearer(token(roles=None))).json()
    assert (me["role"], me["role_source"]) == ("admin", "local")


def test_auth_config_exposes_only_public_identifiers(client, entra):
    cfg = client.get("/api/auth/config").json()
    assert cfg == {"mode": "entra", "tenant_id": TENANT, "client_id": SPA_ID,
                   "scopes": [f"api://{API_ID}/access_as_user"]}
    assert "secret" not in str(cfg).lower()


def test_dev_mode_is_unchanged(client):
    assert client.get("/api/auth/config").json() == {"mode": "dev"}
    me = client.get("/api/me", headers=as_user("arjun.rao@contoso.com")).json()
    assert me["email"] == "arjun.rao@contoso.com" and me["identity"] is None and me["auth_mode"] == "dev"
    assert client.get("/api/me", headers=bearer(token())).status_code == 401  # tokens mean nothing in dev mode


def test_entra_mode_requires_its_settings():
    from app.config import problems
    s = dataclasses.replace(auth.settings, auth_mode="entra", entra_tenant_id="", entra_spa_client_id="")
    found = " ".join(problems(s))
    assert "ENTRA_TENANT_ID" in found and "ENTRA_SPA_CLIENT_ID" in found


def test_settings_ignore_spaces_and_line_breaks_around_pasted_values(monkeypatch):
    from app.config import _env
    monkeypatch.setenv("ENTRA_TENANT_ID", "  c62ac658-5fab-40fd-8221-e11077ac376d\n")
    monkeypatch.setenv("ENTRA_API_CLIENT_SECRET", "secret-value\r\n")
    monkeypatch.setenv("ENTRA_SPA_CLIENT_ID", "   ")
    assert _env("ENTRA_TENANT_ID", "") == "c62ac658-5fab-40fd-8221-e11077ac376d"
    assert _env("ENTRA_API_CLIENT_SECRET", "") == "secret-value"
    assert _env("ENTRA_SPA_CLIENT_ID", "") == ""  # blank counts as not set
    assert _env("NOT_SET_AT_ALL", "fallback") == "fallback"
