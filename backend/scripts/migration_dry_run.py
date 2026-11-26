"""Upgrade a COPY of a SignGuard database and check that no rows were lost.

Usage (from backend/):  python scripts/migration_dry_run.py C:\\path\\to\\copy-of-signguard.db
Never point this at the live database: it is modified in place.
"""
import os
import sqlite3
import sys
from pathlib import Path


def counts(path: str) -> dict[str, int]:
    with sqlite3.connect(path) as c:
        names = [r[0] for r in c.execute("select name from sqlite_master where type='table'")]
        return {n: c.execute(f'select count(*) from "{n}"').fetchone()[0] for n in names}


def main() -> int:
    path = Path(sys.argv[1]).resolve()
    os.environ["DATABASE_URL"] = f"sqlite:///{path.as_posix()}"
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from app import migrate  # imported after DATABASE_URL is set
    from app.db import engine

    before = counts(str(path))
    revision = migrate.upgrade(engine)
    after = counts(str(path))
    lost = {t: (n, after.get(t)) for t, n in before.items() if after.get(t) != n}
    print(f"revision: {revision}")
    print(f"tables before: {len(before)}, after: {len(after)}")
    if lost:
        print(f"ROW COUNTS CHANGED: {lost}")
        return 1
    print("row counts unchanged")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
