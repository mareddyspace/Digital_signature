"""Rule conditions (people, exceptions, recipient domains, schedule) and the approval setting."""
from datetime import datetime, timedelta, timezone

from conftest import ADMIN, ARJUN, SARA


def sig(client, who, recipients):
    return client.post("/api/policies/test", headers=ADMIN, json={"sender_email": who, "recipients": recipients}).json()


def _template_id(client, name):
    return next(t["id"] for t in client.get("/api/templates", headers=ADMIN).json() if t["name"] == name)


def _top_rule(client, **fields):
    body = {"name": fields.pop("name", "Test rule"), "priority": 1, "template_id": _template_id(client, "Short internal"),
            "recipient_type": "any", "message_type": "any", **fields}
    r = client.post("/api/policies", headers=ADMIN, json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _drop(client, rule):
    assert client.delete(f"/api/policies/{rule['id']}", headers=ADMIN).status_code == 200


def test_rule_for_specific_people_and_exceptions(client):
    rule = _top_rule(client, people="Sara.Khan@contoso.com, sara.khan@contoso.com")
    try:
        assert rule["people"] == "sara.khan@contoso.com"  # cleaned and de-duplicated
        assert sig(client, "sara.khan@contoso.com", ["x@fabrikam.com"])["policy_name"] == "Test rule"
        assert sig(client, "david.chen@contoso.com", ["x@fabrikam.com"])["policy_name"] != "Test rule"
        upd = {**rule, "people": "", "exclude_people": "sara.khan@contoso.com"}
        client.put(f"/api/policies/{rule['id']}", headers=ADMIN, json=upd)
        assert sig(client, "sara.khan@contoso.com", ["x@fabrikam.com"])["policy_name"] != "Test rule"
        assert sig(client, "david.chen@contoso.com", ["x@fabrikam.com"])["policy_name"] == "Test rule"
    finally:
        _drop(client, rule)


def test_rule_for_recipient_domains_includes_subdomains(client):
    rule = _top_rule(client, recipient_domains="@Fabrikam.com")
    try:
        assert rule["recipient_domains"] == "fabrikam.com"
        assert sig(client, "sara.khan@contoso.com", ["a@fabrikam.com"])["policy_name"] == "Test rule"
        assert sig(client, "sara.khan@contoso.com", ["a@eu.fabrikam.com"])["policy_name"] == "Test rule"
        assert sig(client, "sara.khan@contoso.com", ["a@notfabrikam.com"])["policy_name"] != "Test rule"
    finally:
        _drop(client, rule)


def test_scheduled_rule_only_applies_inside_its_dates(client):
    now = datetime.now(timezone.utc)
    future = _top_rule(client, name="Future", starts_at=(now + timedelta(days=1)).isoformat())
    past = _top_rule(client, name="Past", ends_at=(now - timedelta(days=1)).isoformat())
    live = _top_rule(client, name="Now", starts_at=(now - timedelta(hours=1)).isoformat(), ends_at=(now + timedelta(hours=1)).isoformat())
    try:
        assert sig(client, "sara.khan@contoso.com", ["x@fabrikam.com"])["policy_name"] == "Now"
    finally:
        for r in (future, past, live):
            _drop(client, r)


def test_bad_rule_input_is_refused(client):
    tid = _template_id(client, "Short internal")
    base = {"name": "Bad", "template_id": tid}
    assert client.post("/api/policies", headers=ADMIN, json={**base, "people": "not-an-email"}).status_code == 422
    assert client.post("/api/policies", headers=ADMIN, json={**base, "recipient_domains": "nodot"}).status_code == 422
    assert client.post("/api/policies", headers=ADMIN, json={**base, "starts_at": "2026-12-02T00:00:00Z", "ends_at": "2026-12-01T00:00:00Z"}).status_code == 422


def _new_draft(client, who, name):
    t = client.post("/api/templates", headers=who, json={"name": name, "html": "<table><tr><td>{{name}}</td></tr></table>"}).json()
    assert client.post(f"/api/templates/{t['id']}/submit", headers=who).json()["latest"]["status"] == "pending"
    return t


def test_approval_setting(client):
    assert client.get("/api/settings/approval", headers=ADMIN).json()["mode"] == "two_admins"
    # Only admins change it.
    assert client.put("/api/settings/approval", headers=SARA, json={"mode": "off"}).status_code == 403
    assert client.put("/api/settings/approval", headers=ADMIN, json={"mode": "everyone"}).status_code == 422
    try:
        assert client.put("/api/settings/approval", headers=ADMIN, json={"mode": "one_admin"}).json()["mode"] == "one_admin"
        t = _new_draft(client, ADMIN, "Approval one-admin test")
        r = client.post(f"/api/templates/{t['id']}/decide", headers=ADMIN, json={"decision": "approve"})
        assert r.status_code == 200 and r.json()["live_version"] == 1

        client.put("/api/settings/approval", headers=ADMIN, json={"mode": "off"})
        t2 = client.post("/api/templates", headers=ARJUN, json={"name": "Approval off test", "html": "<table><tr><td>{{name}}</td></tr></table>"}).json()
        live = client.post(f"/api/templates/{t2['id']}/submit", headers=ARJUN).json()
        assert live["live_version"] == 1 and live["integrity"] is True  # still sealed
    finally:
        client.put("/api/settings/approval", headers=ADMIN, json={"mode": "two_admins"})
    t3 = _new_draft(client, ADMIN, "Approval two-admin test")
    assert client.post(f"/api/templates/{t3['id']}/decide", headers=ADMIN, json={"decision": "approve"}).status_code == 403
    events = client.get("/api/audit", headers=ADMIN, params={"action": "approval.mode_changed"}).json()
    text = str(events)
    assert "approval.mode_changed" in text
