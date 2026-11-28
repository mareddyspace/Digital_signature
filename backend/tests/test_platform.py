"""Brand kit, designer, AI, compliance, banners, disclaimers, integrity, automation,
assignments, deployments and analytics."""
from conftest import ADMIN, ARJUN, SARA, as_user

from app import compliance, designer, integrity

KIRAN = as_user("kiran.patel@contoso.com")


def sig(client, headers, recipients, **extra):
    r = client.post("/api/addin/signature", json={"recipients": recipients, **extra}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def test_brand_kit_roundtrip_and_validation(client):
    brand = client.get("/api/brand", headers=ADMIN).json()
    assert brand["primary_color"].startswith("#") and brand["fonts"]
    body = {k: brand[k] for k in brand if k not in ("fonts", "updated_by", "updated_at")}
    bad = client.put("/api/brand", headers=ADMIN, json={**body, "website": "javascript:alert(1)"})
    assert bad.status_code == 422
    assert client.put("/api/brand", headers=SARA, json=body).status_code == 403
    ok = client.put("/api/brand", headers=ADMIN, json={**body, "logo_url": "https://cdn.contoso.com/logo.png"})
    assert ok.status_code == 200 and ok.json()["logo_url"].endswith("logo.png")


def test_designer_template_lifecycle(client):
    design = designer.starter("corporate")
    compiled = client.post("/api/designer/compile", headers=ARJUN, json={"design": design}).json()
    assert "{{name}}" in compiled["html"] and compiled["compliance"]["score"] > 0
    created = client.post("/api/templates", headers=ARJUN, json={"name": "Designer test", "html": compiled["html"], "design": design})
    assert created.status_code == 200, created.text
    t = created.json()
    assert t["latest"]["design"]["blocks"][0]["type"] == "logo"
    assert client.post(f"/api/templates/{t['id']}/submit", headers=ARJUN).status_code == 200
    live = client.post(f"/api/templates/{t['id']}/decide", headers=ADMIN, json={"decision": "approve"}).json()
    assert live["live_version"] == 1 and live["integrity"] is True
    seals = {s["name"]: s["status"] for s in client.get("/api/integrity/templates", headers=ADMIN).json()}
    assert seals["Designer test"] == "sealed"


def test_designer_rejects_unsafe_input():
    html = designer.compile_design({"blocks": [
        {"type": "button", "props": {"url": "javascript:alert(1)", "label": "x"}},
        {"type": "text", "props": {"text": "<script>alert(1)</script>"}},
        {"type": "name"},
    ]})
    assert "javascript:" not in html and "<script>" not in html and "&lt;script&gt;" in html
    try:
        designer.compile_design({"blocks": [{"type": "iframe"}]})
        raise AssertionError("unknown block accepted")
    except designer.DesignError:
        pass


def test_banner_and_disclaimer_added_by_audience(client):
    campaigns = client.get("/api/campaigns", headers=ADMIN).json()
    webinar = next(c for c in campaigns if c["name"] == "Q4 product webinar")
    before = webinar["impressions"]
    s = sig(client, SARA, ["buyer@fabrikam.com"])  # Sales, external
    assert s["campaign"] == "Q4 product webinar" and "Join our live product webinar" in s["html"]
    assert s["disclaimers"] == ["External confidentiality"] and "confidential" in s["html"]
    inside = sig(client, SARA, ["rahul.verma@contoso.com"])
    assert inside["campaign"] is None and inside["disclaimers"] == []
    after = next(c for c in client.get("/api/campaigns", headers=ADMIN).json() if c["id"] == webinar["id"])
    assert after["impressions"] == before + 1

    click = client.get(f"/r/c/{webinar['id']}", follow_redirects=False)
    assert click.status_code == 302 and click.headers["location"] == webinar["link_url"]
    assert client.get("/r/c/99999", follow_redirects=False).status_code == 404


def test_campaign_crud_validates(client):
    bad = client.post("/api/campaigns", headers=ADMIN, json={"name": "x", "link_url": "javascript:alert(1)"})
    assert bad.status_code == 422
    c = client.post("/api/campaigns", headers=ADMIN, json={
        "name": "Ended promo", "headline": "Old", "link_url": "https://example.com",
        "starts_at": "2020-01-01T00:00:00Z", "ends_at": "2020-02-01T00:00:00Z"}).json()
    assert c["state"] == "ended"
    ran = client.post("/api/automation/run", headers=ADMIN).json()
    assert ran["campaigns_ended"] >= 1
    assert client.delete(f"/api/campaigns/{c['id']}", headers=ADMIN).json()["ok"]


def test_disclaimer_crud(client):
    d = client.post("/api/disclaimers", headers=ADMIN, json={
        "name": "Finance regulatory", "text": "Contoso Finance Ltd is regulated.", "departments": "Finance"}).json()
    s = sig(client, as_user("david.chen@contoso.com"), ["vendor@northwind.com"])
    assert "Finance regulatory" in s["disclaimers"] and "is regulated" in s["html"]
    assert client.delete(f"/api/disclaimers/{d['id']}", headers=ADMIN).json()["ok"]


def test_signature_seal_detects_altered_details(client):
    s = sig(client, SARA, ["ceo@fabrikam.com"])
    code = s["verification_code"]
    ok = client.post("/api/verify/signature", json={"code": code, "signature": "Hi there\n" + s["html"]}).json()
    assert ok["result"] == "intact" and "text" not in ok
    forged = s["html"].replace("+91 80 4000 3002", "+44 20 7946 0000")
    bad = client.post("/api/verify/signature", json={"code": code, "signature": forged}).json()
    assert bad["result"] == "altered" and any("+44" in a["received"] for a in bad["altered"])
    assert client.post("/api/verify/signature", json={"code": "SG-AAAA-BBBB", "signature": "x"}).json()["result"] == "unknown_code"


def test_tampered_template_is_not_used(client):
    from app.db import SessionLocal
    from app.models import Template, TemplateVersion

    with SessionLocal() as db:
        t = db.query(Template).filter_by(name="Modern brand").one()
        v = db.get(TemplateVersion, t.live_version_id)
        original = v.html
        v.html = original.replace("{{name}}", "{{name}} - call +1 555 0100 for payments")
        db.commit()
    try:
        s = sig(client, KIRAN, ["client@fabrikam.com"])  # Marketing -> Modern brand normally
        assert s["template_name"] != "Modern brand" and any("integrity" in w for w in s["warnings"])
        status = {x["name"]: x["status"] for x in client.get("/api/integrity/templates", headers=ADMIN).json()}
        assert status["Modern brand"] == "tampered"
        found = client.get("/api/automation", headers=ADMIN).json()["insights"]
        assert found[0]["severity"] == "critical"
    finally:
        with SessionLocal() as db:
            t = db.query(Template).filter_by(name="Modern brand").one()
            db.get(TemplateVersion, t.live_version_id).html = original
            db.commit()
    assert sig(client, KIRAN, ["client@fabrikam.com"])["template_name"] == "Modern brand"


def test_ai_generation_rules_engine(client):
    r = client.post("/api/ai/signature", headers=ADMIN, json={"prompt": "modern two-column with photo, LinkedIn and a book a demo button"})
    assert r.status_code == 200
    body = r.json()
    assert body["engine"] == "rules" and len(body["variants"]) == 3
    first = body["variants"][0]
    assert first["design"]["settings"]["layout"] == "split"
    assert "{{verification_code}}" in first["html"] and first["compliance"]["score"] >= 80
    assert client.post("/api/ai/signature", headers=SARA, json={"prompt": "anything"}).status_code == 403


def test_compliance_rules():
    brand = {"primary_color": "#2878d0", "secondary_color": "#11263f", "font_family": "Arial, Helvetica, sans-serif", "require_logo": True}
    good = compliance.check(designer.compile_design(designer.starter("corporate", brand)), brand)
    assert good["score"] >= 90 and not good["blocking"]
    bad = compliance.check('<table><tr><td style="color:#ff00ff"><a href="javascript:x">{{name}}</a></td></tr></table>', brand)
    assert bad["blocking"] and bad["score"] < 50
    rules = {i["rule"] for i in bad["issues"]}
    assert {"email_safety", "required_fields", "logo", "brand_colors"} <= rules


def test_enforced_compliance_blocks_submission(client):
    brand = client.get("/api/brand", headers=ADMIN).json()
    body = {k: brand[k] for k in brand if k not in ("fonts", "updated_by", "updated_at")}
    client.put("/api/brand", headers=ADMIN, json={**body, "enforce_compliance": True, "min_compliance_score": 95})
    try:
        t = client.post("/api/templates", headers=ARJUN, json={"name": "Off brand", "html": '<table><tr><td style="color:#ff00ff">{{name}}</td></tr></table>'}).json()
        r = client.post(f"/api/templates/{t['id']}/submit", headers=ARJUN)
        assert r.status_code == 422 and "compliance" in r.text
    finally:
        client.put("/api/brand", headers=ADMIN, json=body)


def test_assignments_matrix(client):
    m = client.get("/api/assignments", headers=ADMIN).json()
    rows = {r["department"]: r["cells"] for r in m["rows"]}
    assert rows["Finance"]["external_new"]["template"] == "Finance external"
    assert rows["Sales"]["internal_new"]["template"] == "Short internal"
    assert rows["Sales"]["external_new"]["banner"] == "Q4 product webinar"
    assert rows["Marketing"]["external_new"]["template"] == "Modern brand"


def test_automation_finds_and_fixes_shadowed_policy(client):
    templates = client.get("/api/templates", headers=ADMIN).json()
    tid = next(t["id"] for t in templates if t["name"] == "Full external")
    p = client.post("/api/policies", headers=ADMIN, json={
        "name": "Sales outside (late)", "priority": 95, "departments": "Sales",
        "recipient_type": "external", "message_type": "new", "template_id": tid}).json()
    found = client.get("/api/automation", headers=ADMIN).json()["insights"]
    shadow = next(f for f in found if "Sales outside (late)" in f["title"])
    assert shadow["action"]["type"] == "disable_policy"
    assert client.post("/api/automation/apply", headers=ADMIN, json={"action": shadow["action"]}).json()["ok"]
    assert not next(x for x in client.get("/api/policies", headers=ADMIN).json() if x["id"] == p["id"])["enabled"]

    made = client.post("/api/automation/apply", headers=ADMIN, json={"action": {"type": "create_department_policy", "department": "Legal"}})
    assert made.status_code == 200 and "Legal to outside" in made.json()["message"]
    assert client.post("/api/automation/apply", headers=SARA, json={"action": {}}).status_code == 403
    sw = client.put("/api/automation/switches", headers=ADMIN, json={"key": "auto_department_policies", "enabled": True}).json()
    assert next(s for s in sw if s["key"] == "auto_department_policies")["enabled"]
    assert client.put("/api/automation/switches", headers=ADMIN, json={"key": "block_tampered_templates", "enabled": False}).status_code == 422


def test_deployments(client):
    g = client.post("/api/deployments", headers=ADMIN, json={"target": "google_workspace", "scope": "department", "scope_value": "Sales"})
    assert g.status_code == 200 and g.json()["mode"] == "simulated"
    done = client.get(f"/api/deployments/{g.json()['id']}", headers=ADMIN).json()
    assert done["status"] == "completed" and done["succeeded"] == 2
    assert all(i["status"] == "ok" for i in done["items"])

    m = client.post("/api/deployments", headers=ADMIN, json={"target": "microsoft_365"}).json()
    export = client.get(f"/api/deployments/{m['id']}/export", headers=ADMIN).json()
    assert len(export) == 8 and all("SG-XXXX" not in e["html"] for e in export)
    assert client.post("/api/deployments", headers=SARA, json={"target": "microsoft_365"}).status_code == 403
    status = client.get("/api/integrations", headers=ADMIN).json()
    assert status["google_workspace"]["connected"] is False and status["google_workspace"]["last_deployment"]


def test_analytics_and_trust_center(client):
    a = client.get("/api/analytics?days=7", headers=ADMIN).json()
    assert a["totals"]["signatures"] > 0 and len(a["series"]) == 7
    assert a["totals"]["banner_impressions"] >= 1
    assert any(t["name"] == "Full external" for t in a["by_template"])
    assert client.get("/api/analytics", headers=SARA).status_code == 403
    tc = client.get("/api/trust-center", headers=ADMIN).json()
    assert tc["tampered_templates"] == 0 and tc["signatures_today"] > 0


def test_integrity_text_compare():
    lines = integrity.visible_lines("<table><tr><td>A B</td></tr><tr><td>T +1 2</td></tr></table>")
    assert integrity.compare(lines, "x a b y\nt +1 2")["result"] == "intact"
    assert integrity.compare(lines, "a b\nt +1 23")["result"] == "altered"


def test_policy_reorder_and_tester_extras(client):
    policies = client.get("/api/policies", headers=ADMIN).json()
    ids = [p["id"] for p in policies]
    reversed_ids = list(reversed(ids))
    out = client.post("/api/policies/reorder", headers=ADMIN, json={"ids": reversed_ids})
    assert out.status_code == 200 and [p["id"] for p in out.json()] == reversed_ids
    assert [p["priority"] for p in out.json()] == [10 * (n + 1) for n in range(len(ids))]
    assert client.post("/api/policies/reorder", headers=ADMIN, json={"ids": ids[:1]}).status_code == 422
    assert client.post("/api/policies/reorder", headers=SARA, json={"ids": ids}).status_code == 403
    client.post("/api/policies/reorder", headers=ADMIN, json={"ids": ids})  # restore
    t = client.post("/api/policies/test", headers=ADMIN, json={"sender_email": "sara.khan@contoso.com", "recipients": ["x@fabrikam.com"]}).json()
    assert t["campaign"] == "Q4 product webinar" and "External confidentiality" in t["disclaimers"]


def test_my_signature_has_a_copyable_version_without_a_fake_code(client):
    r = client.get("/api/me/trust", headers={"X-Dev-User": "sara.khan@contoso.com"})
    assert r.status_code == 200
    body = r.json()
    html = body["signature_for_mail_apps"]
    assert "Sara Khan" in html
    assert "SG-XXXX" not in html  # previews show a placeholder code; the pasted copy must not


def test_emoji_element_offers_only_sun_night_cloud():
    from app import designer
    assert set(designer.EMOJIS) == {"sun", "night", "cloud"}
    base = {"settings": {}, "blocks": [{"type": "name"}]}
    for choice, entity in (("sun", "&#9728;"), ("night", "&#127769;"), ("cloud", "&#9729;")):
        d = {**base, "blocks": base["blocks"] + [{"type": "emoji", "props": {"emoji": choice}}]}
        assert entity in designer.compile_design(designer.normalize(d))
    # Anything else falls back to the sun, never arbitrary text.
    d = {**base, "blocks": [{"type": "emoji", "props": {"emoji": "<script>"}}]}
    out = designer.compile_design(designer.normalize(d))
    assert "&#9728;" in out and "<script>" not in out
