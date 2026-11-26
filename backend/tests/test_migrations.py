"""Database migrations: fresh databases, databases made before migrations existed, and model drift."""
import sqlite3
import tempfile
from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect, text

pytest.importorskip("alembic")

from alembic.autogenerate import compare_metadata  # noqa: E402
from alembic.runtime.migration import MigrationContext  # noqa: E402

from app import migrate  # noqa: E402
from app.db import Base  # noqa: E402


def _engine():
    path = Path(tempfile.mkdtemp()) / "m.db"
    return create_engine(f"sqlite:///{path.as_posix()}")


def test_fresh_database_upgrades_to_head_and_matches_models():
    engine = _engine()
    assert migrate.upgrade(engine) == "0001_baseline"
    with engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
    # Empty means the migrations build exactly what the models describe. If this fails after a
    # model change, add a migration: alembic revision --autogenerate -m "..."
    assert diff == []


def test_existing_database_without_history_is_stamped_and_keeps_its_data():
    engine = _engine()
    Base.metadata.create_all(engine)  # how SignGuard made databases before migrations
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('k', 'kept', 'test', CURRENT_TIMESTAMP)"))
    assert migrate.upgrade(engine) == "0001_baseline"
    with engine.connect() as conn:
        assert conn.execute(text("SELECT value FROM settings WHERE key='k'")).scalar() == "kept"
    assert "alembic_version" in inspect(engine).get_table_names()


def test_upgrade_is_safe_to_run_twice():
    engine = _engine()
    migrate.upgrade(engine)
    assert migrate.upgrade(engine) == "0001_baseline"


def test_app_refuses_an_outdated_schema_until_migrated():
    engine = _engine()
    with pytest.raises(migrate.SchemaOutOfDate, match="python -m app.migrate"):
        migrate.require_current(engine)  # brand-new, empty database
    migrate.upgrade(engine)
    migrate.require_current(engine)  # no error once upgraded


def test_check_command_reports_pending_upgrade(monkeypatch, capsys):
    engine = _engine()
    monkeypatch.setattr("app.db.engine", engine)
    assert migrate.main(["--check"]) == 1
    assert migrate.main([]) == 0
    assert migrate.main(["--check"]) == 0
