from datetime import UTC, datetime, timedelta

from conftest import ADMIN, ARJUN, DAVID, LENA, PRIYA, SARA

from app.rendering import check_template, render


def sig(client, headers, recipients, **extra):
    r = client.post("/api/addin/signature", json={"recipients": recipients, **extra}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def test_requires_identity(client):
    assert client.post("/api/addin/signature", json={}).status_code == 401
    assert client.post("/api/addin/signature", json={}, headers={"X-Dev-User": "nobody@x.com"}).status_code == 403


def test_external_gets_full_signature_with_code(client):
    s = sig(client, SARA, ["buyer@fabrikam.com"])
    assert s["template_name"] == "Full external"
    assert s["recipient_type"] == "external"
    assert s["verification_code"].startswith("SG-")
    assert "Sara Khan" in s["html"] and s["verification_code"] in s["html"]


def test_internal_gets_short_signature_without_code(client):
    s = sig(client, SARA, ["rahul.verma@contoso.com"])
    assert s["template_name"] == "Short internal"
    assert s["verification_code"] is None


def test_finance_policy_wins_for_finance(client):
    s = sig(client, DAVID, ["vendor@northwind.com"])
    assert s["template_name"] == "Finance external"
    assert "never ask you to change bank details" in s["html"]


def test_recipient_change_reuses_unsent_code(client):
    first = sig(client, SARA, ["a@fabrikam.com"])
    second = sig(client, SARA, ["a@fabrikam.com", "b@fabrikam.com"], previous_code=first["verification_code"])
    assert second["verification_code"] == first["verification_code"]


def test_verify_page_results(client):
    code = sig(client, SARA, ["buyer@fabrikam.com"])["verification_code"]
    ok = client.post("/api/verify", json={"code": code.lower().replace("-", " ")}).json()
    assert ok["result"] == "verified" and "Sara Khan" in ok["title"]
    mine = client.post("/api/verify", json={"code": code, "your_email": "BUYER@fabrikam.com"}).json()
    assert mine["result"] == "verified"
    other = client.post("/api/verify", json={"code": code, "your_email": "thief@evil.com"}).json()
    assert other["result"] == "warning" and "someone else" in other["title"]
    fake = client.post("/api/verify", json={"code": "SG-AAAA-BBBB"}).json()
    assert fake["result"] == "warning"
    assert client.get("/verify").status_code == 200


def test_unapproved_send_as_warns_and_uses_own_signature(client):
    s = sig(client, PRIYA, ["vendor@northwind.com"], from_email="arjun.rao@contoso.com")
    assert s["warnings"] and s["on_behalf_of"] is None
    assert "Priya Sharma" in s["html"] and "on behalf of" not in s["html"]
    alerts = client.get("/api/trust-center", headers=ADMIN).json()["alerts"]
    assert any(a["action"] == "signature.unapproved_send_as" for a in alerts)


def test_delegation_flow(client):
    now = datetime.now(UTC)
    req = client.post("/api/delegations", headers=PRIYA, json={
        "delegate_email": "priya.sharma@contoso.com", "owner_email": "arjun.rao@contoso.com",
        "reason": "Handle vendor emails during quarter close",
        "starts_at": (now - timedelta(minutes=1)).isoformat(), "ends_at": (now + timedelta(days=7)).isoformat(),
    })
    assert req.status_code == 200, req.text
    did = req.json()["id"]
    # The requester can't approve their own request, even via the API.
    assert client.post(f"/api/delegations/{did}/decide", headers=PRIYA, json={"decision": "approve"}).status_code == 403
    ok = client.post(f"/api/delegations/{did}/decide", headers=ARJUN, json={"decision": "approve"})
    assert ok.status_code == 200 and ok.json()["state"] == "active"

    s = sig(client, PRIYA, ["vendor@northwind.com"], from_email="arjun.rao@contoso.com")
    assert s["on_behalf_of"] == "Arjun Rao"
    assert "on behalf of Arjun Rao" in s["html"]
    assert s["template_name"] == "Finance external"  # follows the owner's department

    perms = client.get("/api/permissions", headers=ADMIN).json()
    priya = next(p for p in perms if p["mailbox"] == "arjun.rao@contoso.com" and p["trustee"] == "priya.sharma@contoso.com")
    assert "no_approval" not in priya["flags"]

    code = s["verification_code"]
    v = client.post("/api/verify", json={"code": code}).json()
    assert "on behalf of Arjun Rao" in v["message"]

    assert client.post(f"/api/delegations/{did}/revoke", headers=ARJUN).json()["status"] == "revoked"
    after = sig(client, PRIYA, ["vendor@northwind.com"], from_email="arjun.rao@contoso.com")
    assert after["on_behalf_of"] is None and after["warnings"]


def test_delegation_validation(client):
    now = datetime.now(UTC)
    too_long = client.post("/api/delegations", headers=PRIYA, json={
        "delegate_email": "priya.sharma@contoso.com", "owner_email": "arjun.rao@contoso.com", "reason": "Too long",
        "starts_at": now.isoformat(), "ends_at": (now + timedelta(days=200)).isoformat(),
    })
    assert too_long.status_code == 422
    not_mine = client.post("/api/delegations", headers=SARA, json={
        "delegate_email": "priya.sharma@contoso.com", "owner_email": "arjun.rao@contoso.com", "reason": "Not mine",
        "starts_at": now.isoformat(), "ends_at": (now + timedelta(days=2)).isoformat(),
    })
    assert not_mine.status_code == 403


def test_expired_delegation_is_closed(client):
    from app.db import SessionLocal
    from app.models import Delegation, utcnow
    from app import trust

    with SessionLocal() as db:
        d = Delegation(delegate_email="sara.khan@contoso.com", owner_email="rahul.verma@contoso.com",
                       reason="old", starts_at=utcnow() - timedelta(days=3), ends_at=utcnow() - timedelta(minutes=1),
                       status="approved", requested_by="sara.khan@contoso.com", exchange_state="simulated")
        db.add(d)
        db.commit()
        assert trust.expire_due(db) >= 1
        db.refresh(d)
        assert d.status == "expired" and d.exchange_state == "removed"


def test_permission_flags(client):
    perms = client.get("/api/permissions", headers=ADMIN).json()
    sara = next(p for p in perms if p["mailbox"] == "arjun.rao@contoso.com" and p["trustee"] == "sara.khan@contoso.com")
    assert set(sara["flags"]) == {"no_approval", "older_than_90_days", "unused_90_days"}
    assert client.get("/api/permissions", headers=SARA).status_code == 403
    done = client.post(f"/api/permissions/{sara['id']}/action", headers=ADMIN, json={"action": "remove"}).json()
    assert done["review_state"] == "removed" and done["flags"] == []


def test_template_approval_needs_second_person(client):
    t = next(t for t in client.get("/api/templates", headers=ADMIN).json() if t["name"] == "Full external")
    new_html = t["live_html"].replace("Phone:", "Tel:")
    edited = client.put(f"/api/templates/{t['id']}", headers=ARJUN, json={"html": new_html}).json()
    assert edited["latest"]["status"] == "draft" and edited["live_version"] == 1
    assert client.post(f"/api/templates/{t['id']}/submit", headers=ARJUN).json()["latest"]["status"] == "pending"
    assert client.post(f"/api/templates/{t['id']}/decide", headers=ARJUN, json={"decision": "approve"}).status_code == 403
    live = client.post(f"/api/templates/{t['id']}/decide", headers=ADMIN, json={"decision": "approve"}).json()
    assert live["live_version"] == 2
    assert "Tel:" in sig(client, SARA, ["x@fabrikam.com"])["html"]

    # An admin can't approve their own change either.
    client.put(f"/api/templates/{t['id']}", headers=ADMIN, json={"html": new_html + " "})
    client.post(f"/api/templates/{t['id']}/submit", headers=ADMIN)
    assert client.post(f"/api/templates/{t['id']}/decide", headers=ADMIN, json={"decision": "approve"}).status_code == 403


def test_submit_rejects_outlook_breaking_html(client):
    created = client.post("/api/templates", headers=ADMIN, json={"name": "Bad one", "html": "<svg></svg>{{nope}}"}).json()
    r = client.post(f"/api/templates/{created['id']}/submit", headers=ADMIN)
    assert r.status_code == 422


def test_rendering_escapes_and_sections():
    out = render("{{#phone}}P:{{phone}}{{/phone}}|{{name}}", {"name": "<b>x</b>", "phone": ""})
    assert out == "|&lt;b&gt;x&lt;/b&gt;"
    assert check_template("<table><tr><td>{{name}}</td></tr></table>") == []


def test_policy_tester_issues_no_codes(client):
    r = client.post("/api/policies/test", headers=ADMIN, json={"sender_email": "sara.khan@contoso.com", "recipients": ["x@fabrikam.com"]})
    assert r.status_code == 200 and "SG-XXXX-XXXX" in r.json()["html"]


def test_my_trust_and_audit_access(client):
    mine = client.get("/api/me/trust", headers=ARJUN).json()
    assert any(p["trustee"] == "priya.sharma@contoso.com" for p in mine["who_can_send_as_me"])
    assert client.get("/api/audit.csv", headers=LENA).status_code == 200
    assert client.get("/api/audit", headers=SARA).status_code == 403
    tc = client.get("/api/trust-center", headers=ADMIN).json()
    assert tc["employees"] == 8 and tc["employees_with_data_issues"] == 1


def test_duplicate_template_makes_a_draft_copy(client):
    src = next(t for t in client.get("/api/templates", headers=ADMIN).json() if t["name"] == "Full external")
    r = client.post(f"/api/templates/{src['id']}/duplicate", headers=ADMIN)
    assert r.status_code == 200
    copy = r.json()
    assert copy["name"].startswith("Full external (copy")
    assert copy["live_version"] is None and copy["latest"]["status"] == "draft"
    assert copy["latest"]["html"] == src["live_html"]
    # A second copy gets a new name, and a chosen name that is taken is refused.
    again = client.post(f"/api/templates/{src['id']}/duplicate", headers=ADMIN).json()
    assert again["name"] != copy["name"]
    assert client.post(f"/api/templates/{src['id']}/duplicate", headers=ADMIN, json={"name": "Full external"}).status_code == 409
    # People without editing rights can't copy.
    assert client.post(f"/api/templates/{src['id']}/duplicate", headers=SARA).status_code == 403
