"""Read-only demo mode: writes are refused server-side; previews and the public verify page still work."""
import dataclasses

from app import main

from conftest import ADMIN


def test_demo_blocks_writes_but_allows_previews(client, monkeypatch):
    monkeypatch.setattr(main, "settings", dataclasses.replace(main.settings, demo_read_only=True))
    assert client.get("/api/health").json()["demo_read_only"] is True
    before = client.get("/api/brand", headers=ADMIN)
    assert before.status_code == 200
    r = client.put("/api/brand", headers=ADMIN, json={**before.json(), "website": "https://changed.example"})
    assert r.status_code == 403 and "read-only demo" in r.json()["detail"]
    assert client.post("/api/policies/reorder", headers=ADMIN, json={"ids": []}).status_code == 403
    assert client.delete("/api/campaigns/1", headers=ADMIN).status_code == 403
    assert client.post("/api/addin/signature", headers=ADMIN, json={}).status_code == 403
    r = client.post("/api/designer/compile", headers=ADMIN, json={})
    assert r.status_code != 403
    # The brand really is unchanged.
    assert client.get("/api/brand", headers=ADMIN).json() == before.json()


def test_health_reports_demo_off_by_default(client):
    assert client.get("/api/health").json()["demo_read_only"] is False
