"""Per-email verification codes.

A code is tied to its sender and to keyed hashes (HMAC) of each recipient address, so the
verify page can tell a recipient whether the code was issued to them without SignGuard
storing who emailed whom.
"""
import hashlib
import hmac
import secrets

from sqlalchemy.orm import Session

from .config import settings
from .models import VerificationCode, utcnow

# No 0/O, 1/I/L, so codes are easy to read and type.
ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"


def _hmac(value: str) -> str:
    return hmac.new(
        settings.code_secret.encode(), value.strip().lower().encode(), hashlib.sha256
    ).hexdigest()


def recipient_hashes(recipients: list[str]) -> str:
    return ",".join(sorted({_hmac(r) for r in recipients if r.strip()}))


def subject_hash(subject: str) -> str:
    return _hmac(subject)


def recipient_matches(code: VerificationCode, email: str) -> bool:
    return _hmac(email) in code.recipient_hash.split(",")


def new_code() -> str:
    raw = "".join(secrets.choice(ALPHABET) for _ in range(8))
    return f"SG-{raw[:4]}-{raw[4:]}"


def normalize(code: str) -> str:
    raw = "".join(ch for ch in code.upper() if ch.isalnum())
    if raw.startswith("SG"):
        raw = raw[2:]
    return f"SG-{raw[:4]}-{raw[4:8]}" if len(raw) == 8 else code.strip().upper()


def issue(
    db: Session,
    sender_email: str,
    recipients: list[str],
    on_behalf_of: str | None,
    previous_code: str | None = None,
) -> VerificationCode:
    """Create a code, or reuse the draft's unsent code when recipients change."""
    hashes = recipient_hashes(recipients)
    if previous_code:
        existing = db.get(VerificationCode, normalize(previous_code))
        if existing and existing.sender_email == sender_email and existing.sent_at is None:
            existing.recipient_hash = hashes
            existing.on_behalf_of_email = on_behalf_of
            return existing
    code = new_code()
    while db.get(VerificationCode, code) is not None:
        code = new_code()
    row = VerificationCode(
        code=code,
        sender_email=sender_email,
        on_behalf_of_email=on_behalf_of,
        recipient_hash=hashes,
        created_at=utcnow(),
    )
    db.add(row)
    return row
