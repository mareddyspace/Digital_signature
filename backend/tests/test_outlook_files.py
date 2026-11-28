"""The Outlook add-in served by the backend for one-service hosting (Render)."""
from app.config import settings


def _set(name, value):
    old = getattr(settings, name)
    object.__setattr__(settings, name, value)  # Settings is frozen; tests swap one path and restore it
    return old


def test_classic_outlook_allow_list_names_the_event_script(client):
    r = client.get("/.well-known/microsoft-officeaddins-allowed.json")
    assert r.status_code == 200
    assert r.json() == {"allowed": [f"{settings.base_url}/addin/launchevent.js"]}


def test_manifest_points_at_this_deployment(client):
    r = client.get("/addin/manifest.xml")
    assert r.status_code == 200
    xml = r.text
    assert "localhost:3000" not in xml
    assert f"{settings.base_url}/addin/commands.html" in xml
    assert f"{settings.base_url}/addin/launchevent.js" in xml
    assert "<AppDomain>http://localhost:8000</AppDomain>" in xml or "<AppDomain>https://" in xml


def test_event_script_is_one_file_with_msal_and_origin(client, tmp_path):
    lib = tmp_path / "msal.min.js"
    lib.write_text("var msal = {};", encoding="utf-8")
    old = _set("msal_bundle", lib)
    try:
        r = client.get("/addin/launchevent.js")
        assert r.status_code == 200
        body = r.text
        assert body.startswith("var msal = {};")
        assert f'var SIGNGUARD_ORIGIN = "{settings.base_url}";' in body
        assert "onNewMessageComposeHandler" in body
    finally:
        _set("msal_bundle", old)
    _set("msal_bundle", tmp_path / "missing.js")
    try:
        assert client.get("/addin/launchevent.js").status_code == 503
    finally:
        _set("msal_bundle", old)


def test_only_add_in_files_are_served(client):
    assert client.get("/addin/taskpane.html").status_code == 200
    assert client.get("/addin/assets/icon-32.png").status_code == 200
    for bad in ("/addin/serve.js", "/addin/../manifest.xml", "/addin/assets/../../serve.js", "/addin/package.json"):
        assert client.get(bad).status_code == 404, bad
