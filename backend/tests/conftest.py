import os
import sys
import tempfile
from pathlib import Path

import pytest

# Settings are read at import time, so point them at a throwaway database first.
_db = Path(tempfile.mkdtemp()) / "test.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_db.as_posix()}"
os.environ["AUTH_MODE"] = "dev"
os.environ["DIRECTORY_SOURCE"] = "sample"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from app import migrate  # noqa: E402
from app.db import engine  # noqa: E402

migrate.upgrade(engine)  # the deployment step; the app itself only checks the schema

from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


def as_user(email: str) -> dict:
    return {"X-Dev-User": email}


ADMIN = as_user("meera.iyer@contoso.com")
ARJUN = as_user("arjun.rao@contoso.com")
PRIYA = as_user("priya.sharma@contoso.com")
DAVID = as_user("david.chen@contoso.com")
SARA = as_user("sara.khan@contoso.com")
LENA = as_user("lena.fischer@contoso.com")
