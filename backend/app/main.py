import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from . import trust
from .config import settings
from .db import SessionLocal, engine
from . import automation, migrate
from .routers import addin, admin, integrations, outlook_files, platform, trust_routes, verify
from .seed import seed, seed_platform

log = logging.getLogger("signguard")


async def _expiry_loop() -> None:
    while True:
        await asyncio.sleep(60)
        try:
            with SessionLocal() as db:
                trust.expire_due(db)
                automation.run_scheduled(db)
        except Exception:  # keep the loop alive; the next tick retries
            log.exception("Delegation expiry check failed")


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Migrations are a deployment step (python -m app.migrate); here we only refuse to run on an
    # outdated schema, so no worker ever changes the database structure on its own.
    migrate.require_current(engine)
    with SessionLocal() as db:
        seed(db)
        seed_platform(db)
        trust.expire_due(db)
        automation.run_scheduled(db)
    task = asyncio.create_task(_expiry_loop())
    yield
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task


app = FastAPI(title="SignGuard API", version="0.2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)
# Requests a read-only demo still answers: previews and checks that compute a result, plus the
# public verification page (which only records rate-limit attempts).
DEMO_ALLOWED_WRITES = {
    "/api/templates/preview",
    "/api/policies/test",
    "/api/designer/compile",
    "/api/compliance/check",
    "/api/integrity/signature",
    "/api/ai/signature",
    "/api/verify",
    "/api/verify/signature",
}


@app.middleware("http")
async def demo_read_only(request: Request, call_next):
    if (
        settings.demo_read_only
        and request.method not in ("GET", "HEAD", "OPTIONS")
        and request.url.path.rstrip("/") not in DEMO_ALLOWED_WRITES
    ):
        return JSONResponse(
            {"detail": "This is a read-only demo, so changes aren't saved. Run SignGuard yourself to make changes."},
            status_code=403,
        )
    return await call_next(request)


app.include_router(addin.router)
app.include_router(admin.router)
app.include_router(trust_routes.router)
app.include_router(verify.router)
app.include_router(platform.router)
app.include_router(platform.public)
app.include_router(integrations.router)
app.include_router(outlook_files.router)


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "auth_mode": settings.auth_mode,
        "directory_source": settings.directory_source,
        "demo_read_only": settings.demo_read_only,
    }


# One-service deployments: serve the built admin web (admin-web/dist copied to ADMIN_STATIC_DIR)
# from the same origin as the API. Registered last, so every API and page route above wins.
_static = settings.admin_static_dir
if (_static / "index.html").is_file():
    _root = _static.resolve()

    @app.get("/{path:path}", include_in_schema=False)
    def admin_web(path: str):
        if path.startswith("api/"):
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        target = (_root / path).resolve()
        if path and target.is_file() and target.is_relative_to(_root):
            # MSAL's redirect bridge page must never be cached (Microsoft's MSAL v5 guidance).
            headers = {"Cache-Control": "no-store"} if target.name == "redirect.html" else None
            return FileResponse(target, headers=headers)
        return FileResponse(_root / "index.html")  # client-side routes
