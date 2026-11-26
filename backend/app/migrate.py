"""Database migrations, run as an explicit deployment step.

    cd backend
    .venv\\Scripts\\python -m app.migrate          # upgrade to the newest schema
    .venv\\Scripts\\python -m app.migrate --check  # exit 1 if an upgrade is pending

The application never migrates by itself: at startup it only checks that the schema is current
and refuses to start otherwise, so several workers can never race to change the database.

Databases created before migrations existed (by Base.metadata.create_all) already match the
baseline exactly, so `python -m app.migrate` marks them as 0001_baseline, keeping every row,
before upgrading. Use this command rather than plain `alembic upgrade head`, which would try to
create the existing tables again.
"""
from __future__ import annotations

import argparse
import logging
from pathlib import Path

from sqlalchemy import Engine, inspect

log = logging.getLogger("signguard.migrate")

BACKEND_DIR = Path(__file__).resolve().parent.parent
BASELINE = "0001_baseline"
UPGRADE_COMMAND = "python -m app.migrate"


class SchemaOutOfDate(RuntimeError):
    pass


def _config(connection=None):
    try:
        from alembic.config import Config
    except ImportError as exc:  # pragma: no cover - only when requirements weren't reinstalled
        raise RuntimeError(
            "SignGuard needs Alembic for database migrations. Run: pip install -r requirements.txt"
        ) from exc
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    if connection is not None:
        cfg.attributes["connection"] = connection
    return cfg


def head_revision() -> str:
    from alembic.script import ScriptDirectory

    return ScriptDirectory.from_config(_config()).get_current_head() or ""


def current_revision(engine: Engine) -> str | None:
    from alembic.runtime.migration import MigrationContext

    with engine.connect() as connection:
        return MigrationContext.configure(connection).get_current_revision()


def upgrade(engine: Engine) -> str:
    """Upgrade to the newest revision. Returns the revision the database is now at."""
    from alembic import command

    with engine.begin() as connection:
        tables = set(inspect(connection).get_table_names())
        cfg = _config(connection)
        if "alembic_version" not in tables and "employees" in tables:
            log.info("Existing database without migration history: marking it as %s", BASELINE)
            command.stamp(cfg, BASELINE)
        command.upgrade(cfg, "head")
    return current_revision(engine) or ""


def require_current(engine: Engine) -> None:
    """Startup check. Raises SchemaOutOfDate, with the command to run, unless the schema is current."""
    current, head = current_revision(engine), head_revision()
    if current != head:
        state = "has no schema yet" if current is None else f"is at {current}"
        raise SchemaOutOfDate(
            f"The database {state}, but this version of SignGuard needs {head}. "
            f"Back up the database, then run `{UPGRADE_COMMAND}` from the backend folder."
        )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog=UPGRADE_COMMAND, description="Upgrade the SignGuard database schema.")
    parser.add_argument("--check", action="store_true", help="only report; exit 1 if an upgrade is pending")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    from .db import engine

    if args.check:
        try:
            require_current(engine)
        except SchemaOutOfDate as exc:
            print(exc)
            return 1
        print(f"Database schema is current ({head_revision()}).")
        return 0
    before = current_revision(engine)
    after = upgrade(engine)
    print(f"Database schema: {before or 'none'} -> {after}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
