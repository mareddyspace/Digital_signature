"""Signature integrity.

Two protections:

1. Template seals. When a template version is approved, SignGuard stores an HMAC of its HTML.
   Before a live version is used, the seal is checked; a version whose HTML was changed outside
   the approval workflow (for example directly in the database) is not used and raises an alert.

2. Signature seals. When an external email gets a verification code, SignGuard keeps the visible
   text of the signature it issued. A recipient (or the security team) can paste the signature
   they received and see whether any line, such as a phone number or bank detail, was altered:
   the classic business-email-compromise trick.
"""
from __future__ import annotations

import hashlib
import hmac
import html as htmllib
import re
from difflib import SequenceMatcher

from .config import settings

BLOCK_TAGS = re.compile(r"<\s*(br|/tr|/p|/div|/li|/h\d|/table)\b[^>]*>", re.I)
TAGS = re.compile(r"<[^>]+>")
COMMENTS = re.compile(r"<!--.*?-->", re.S)
SPACES = re.compile(r"[ \t ]+")


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def mac(kind: str, ref: str, digest: str) -> str:
    return hmac.new(settings.code_secret.encode(), f"{kind}:{ref}:{digest}".encode(), hashlib.sha256).hexdigest()


def visible_lines(markup_or_text: str) -> list[str]:
    """What a reader sees, one entry per line, lower-cased with single spaces."""
    t = COMMENTS.sub("", markup_or_text)
    t = BLOCK_TAGS.sub("\n", t)
    t = TAGS.sub(" ", t)
    t = htmllib.unescape(t)
    lines = []
    for raw in t.splitlines():
        line = SPACES.sub(" ", raw).strip().lower()
        if line:
            lines.append(line)
    return lines


def compare(original_lines: list[str], received: str) -> dict:
    """Is the issued signature intact inside what the recipient pasted?

    The pasted text may contain the whole email, so we only ask that every original line appears.
    Lines that appear only in the pasted signature area and resemble an original line are reported
    as altered (e.g. a changed phone number); missing lines are reported as removed.
    """
    got = visible_lines(received)
    got_set = set(got)

    def present(line: str) -> bool:
        if line in got_set:
            return True
        pattern = re.compile(r"(^|\s)" + re.escape(line) + r"($|\s)")
        return any(pattern.search(g) for g in got)

    missing = [line for line in original_lines if not present(line)]
    originals = set(original_lines)
    candidates = [g for g in got if g not in originals]
    altered = []
    for m in missing:
        best, ratio = None, 0.0
        for g in candidates:
            r = SequenceMatcher(None, m, g).ratio()
            if r > ratio:
                best, ratio = g, r
        if best and ratio >= 0.5:
            altered.append({"received": best, "similarity": round(ratio, 2)})
    if not missing:
        result = "intact"
    elif len(missing) == len(original_lines):
        result = "not_found"
    else:
        result = "altered"
    return {
        "result": result,
        "matched_lines": len(original_lines) - len(missing),
        "total_lines": len(original_lines),
        "altered": altered,
        "removed_count": len(missing) - len(altered),
    }


# ---------- database operations ----------

def seal_version(db, version, actor: str):
    from .models import TemplateSeal, utcnow

    digest = sha256(version.html)
    row = db.get(TemplateSeal, version.id)
    if row is None:
        row = TemplateSeal(version_id=version.id, html_sha256=digest, seal="", sealed_by=actor)
        db.add(row)
    row.html_sha256 = digest
    row.seal = mac("tpl", str(version.id), digest)
    row.sealed_by = actor
    row.sealed_at = utcnow()
    return row


def version_intact(db, version) -> bool | None:
    """True if sealed and unchanged, False if tampered, None if never sealed."""
    from .models import TemplateSeal

    row = db.get(TemplateSeal, version.id)
    if row is None:
        return None
    digest = sha256(version.html)
    return hmac.compare_digest(row.seal, mac("tpl", str(version.id), digest)) and row.html_sha256 == digest


def seal_unsealed_live_versions(db) -> int:
    """Trust-on-first-use for versions that went live before sealing existed."""
    from sqlalchemy import select

    from .models import Template, TemplateSeal, TemplateVersion

    n = 0
    for t in db.scalars(select(Template).where(Template.live_version_id.is_not(None))):
        if db.get(TemplateSeal, t.live_version_id) is None:
            v = db.get(TemplateVersion, t.live_version_id)
            if v:
                seal_version(db, v, "system")
                n += 1
    if n:
        db.commit()
    return n


def seal_signature(db, code: str, version_id: int | None, sender: str, rendered_html: str):
    from .models import SignatureSeal

    lines = visible_lines(rendered_html)
    text = "\n".join(lines)
    digest = sha256(text)
    row = db.get(SignatureSeal, code)
    if row is None:
        row = SignatureSeal(code=code, sender_email=sender, text="", text_sha256="", seal="")
        db.add(row)
    row.version_id = version_id
    row.text = text
    row.text_sha256 = digest
    row.seal = mac("sig", code, digest)
    return row


def check_signature(db, code: str, received: str) -> dict:
    from .models import SignatureSeal

    row = db.get(SignatureSeal, code)
    if row is None:
        return {"result": "unknown_code"}
    if not hmac.compare_digest(row.seal, mac("sig", code, sha256(row.text))):
        return {"result": "record_tampered"}
    return compare(row.text.split("\n"), received)
