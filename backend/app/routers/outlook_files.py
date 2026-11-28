"""Serves the Outlook add-in from the same origin as the API, for one-service hosting (Render).

Locally, outlook-addin/serve.js does the same job on https://localhost:3000. Here the add-in lives
under /addin/ so it can't collide with the admin web, which owns every other path.
"""
import json
from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, JSONResponse, Response

from ..config import settings

router = APIRouter(include_in_schema=False)

# Files Outlook may load. Nothing else under outlook-addin/src is served.
ALLOWED = {"commands.html", "taskpane.html", "taskpane.js", "help.html"}
ICONS = {"icon-16.png", "icon-32.png", "icon-64.png", "icon-80.png", "icon-128.png"}
LOCAL_BASE = "https://localhost:3000"


def _public() -> str:
    return settings.base_url.rstrip("/")


def _addin_base() -> str:
    return f"{_public()}/addin"


@router.get("/.well-known/microsoft-officeaddins-allowed.json")
def allowed_scripts():
    # Classic Outlook on Windows only lets event code sign in and call the API when the add-in's
    # origin lists the script here (Microsoft: "Use SSO or CORS in your event-based add-in").
    return JSONResponse({"allowed": [f"{_addin_base()}/launchevent.js"]}, headers={"Cache-Control": "no-store"})


@router.get("/addin/manifest.xml")
def manifest():
    path = settings.addin_dir / "manifest.xml"
    if not path.is_file():
        raise HTTPException(404)
    origin = f"{urlparse(_public()).scheme}://{urlparse(_public()).netloc}"
    xml = path.read_text(encoding="utf-8")
    # AppDomain takes an origin; every other URL points into /addin/.
    xml = xml.replace(f"<AppDomain>{LOCAL_BASE}</AppDomain>", f"<AppDomain>{origin}</AppDomain>")
    xml = xml.replace(LOCAL_BASE, _addin_base())
    return Response(xml, media_type="application/xml",
                    headers={"Content-Disposition": "attachment; filename=signguard-manifest.xml"})


@router.get("/addin/launchevent.js")
def launch_event():
    # One file for classic Outlook's event runtime: MSAL, then the API origin, then the handlers.
    lib, src = settings.msal_bundle, settings.addin_dir / "src" / "launchevent.js"
    if not lib.is_file() or not src.is_file():
        raise HTTPException(503, "Add-in script or MSAL library missing from this deployment")
    body = "\n;\n".join([
        lib.read_text(encoding="utf-8"),
        f"var SIGNGUARD_ORIGIN = {json.dumps(_public())};",
        src.read_text(encoding="utf-8"),
    ])
    return Response(body, media_type="text/javascript", headers={"Cache-Control": "no-store"})


@router.get("/addin/assets/{name}")
def asset(name: str):
    path = settings.addin_dir / "src" / "assets" / name
    if name not in ICONS or not path.is_file():
        raise HTTPException(404)
    return FileResponse(path)


@router.get("/addin/{name}")
def addin_file(name: str):
    path: Path = settings.addin_dir / "src" / name
    if name not in ALLOWED or not path.is_file():
        raise HTTPException(404)
    return FileResponse(path, headers={"Cache-Control": "no-store"})
