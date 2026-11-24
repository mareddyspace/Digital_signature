import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import trust
from .config import settings
from .db import Base, SessionLocal, engine
from .routers import addin, admin, trust_routes, verify
from .seed import seed

log = logging.getLogger("signguard")


async def _expiry_loop() -> None:
    while True:
        await asyncio.sleep(60)
        try:
            with SessionLocal() as db:
                trust.expire_due(db)
        except Exception:  # keep the loop alive; the next tick retries
            log.exception("Delegation expiry check failed")


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        seed(db)
        trust.expire_due(db)
    task = asyncio.create_task(_expiry_loop())
    yield
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task


app = FastAPI(title="SignGuard API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(addin.router)
app.include_router(admin.router)
app.include_router(trust_routes.router)
app.include_router(verify.router)


@app.get("/api/health")
def health():
    return {"ok": True, "auth_mode": settings.auth_mode, "directory_source": settings.directory_source}
