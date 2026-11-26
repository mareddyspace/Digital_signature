"""Alembic environment. Uses SignGuard's own engine and models, so there is one source of settings."""
from alembic import context

from app.db import Base, engine
import app.models  # noqa: F401  (registers every table on Base.metadata)

target_metadata = Base.metadata


def _run(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        # SQLite can't ALTER most things; batch mode rebuilds the table instead.
        render_as_batch=connection.dialect.name == "sqlite",
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    context.configure(url=str(engine.url), target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    # app.migrate passes the connection it opened; the CLI opens its own.
    connection = context.config.attributes.get("connection")
    if connection is not None:
        _run(connection)
    else:
        with engine.begin() as conn:
            _run(conn)
