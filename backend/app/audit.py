import json
from typing import Any

from sqlalchemy.orm import Session

from .models import AuditEvent


def record(
    db: Session,
    actor: str,
    action: str,
    target_type: str = "",
    target_id: Any = "",
    **details: Any,
) -> AuditEvent:
    """Add an audit event to the session. The caller commits."""
    event = AuditEvent(
        actor=actor,
        action=action,
        target_type=target_type,
        target_id=str(target_id),
        details=json.dumps(details, default=str),
    )
    db.add(event)
    return event
