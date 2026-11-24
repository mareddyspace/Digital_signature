"""Public sender-verification page. No sign-in; rate-limited; reveals nothing about other emails."""
import time
from collections import defaultdict, deque
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import audit, verification
from ..config import settings
from ..db import get_db
from ..models import Employee, VerificationCode, utcnow

router = APIRouter(tags=["verify"])

CODE_MAX_AGE_DAYS = 180
RATE_LIMIT = 20  # checks per IP per minute
_hits: dict[str, deque] = defaultdict(deque)


def _rate_limited(ip: str) -> bool:
    now = time.monotonic()
    q = _hits[ip]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= RATE_LIMIT:
        return True
    q.append(now)
    return False


class VerifyIn(BaseModel):
    code: str = Field(min_length=4, max_length=40)
    your_email: str | None = Field(default=None, max_length=320)


@router.post("/api/verify")
def check_code(body: VerifyIn, request: Request, db: Session = Depends(get_db)):
    ip = request.client.host if request.client else "unknown"
    if _rate_limited(ip):
        raise HTTPException(429, "Too many checks. Wait a minute and try again.")
    code = verification.normalize(body.code)
    row = db.get(VerificationCode, code)
    company = settings.company_name

    if row is None or utcnow() - row.created_at > timedelta(days=CODE_MAX_AGE_DAYS):
        audit.record(db, "public", "verify.failed", "code", code)
        db.commit()
        return {
            "result": "warning",
            "title": f"Not sent by {company}",
            "message": f"{company} did not issue this code, or it has expired. Do not reply, pay or "
                       "click links in this email. Forward it to your contact at the company using an "
                       "address you already know.",
        }

    sender = db.scalar(select(Employee).where(Employee.email == row.sender_email))
    owner = db.scalar(select(Employee).where(Employee.email == row.on_behalf_of_email)) if row.on_behalf_of_email else None
    if body.your_email and not verification.recipient_matches(row, body.your_email):
        audit.record(db, "public", "verify.wrong_recipient", "code", code, sender=row.sender_email)
        db.commit()
        return {
            "result": "warning",
            "title": "Code issued to someone else",
            "message": f"This is a real {company} code, but it was not issued for your email address. "
                       "The email may have been copied from another message. Check with the sender by phone.",
        }

    row.check_count += 1
    row.last_checked_at = utcnow()
    audit.record(db, "public", "verify.passed", "code", code, sender=row.sender_email)
    db.commit()
    who = sender.name if sender else row.sender_email
    details = {
        "sender": who,
        "job_title": sender.job_title if sender else "",
        "department": sender.department if sender else "",
        "on_behalf_of": f"{owner.name}, {owner.job_title}" if owner else None,
        "issued_at_utc": row.created_at.strftime("%d %b %Y, %H:%M UTC"),
        "matched_your_address": bool(body.your_email),
    }
    return {
        "result": "verified",
        "title": f"Verified: sent by {who}",
        "message": f"This code was issued by {company} to {who}"
                   + (f" ({details['job_title']}, {details['department']})" if sender else "")
                   + (f", sending on behalf of {details['on_behalf_of']}" if owner else "")
                   + f", on {details['issued_at_utc']}.",
        "details": details,
    }


@router.get("/verify", response_class=HTMLResponse)
def verify_page():
    return PAGE.replace("{{company}}", settings.company_name)


PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{{company}} sender verification</title>
<style>
:root{--bg:#f5f7fa;--card:#fff;--ink:#102a43;--quiet:#486581;--line:#d9e2ec;--ok:#0f7b45;--okbg:#e3f9ee;--bad:#b42318;--badbg:#fdecea;--accent:#1d4ed8}
@media (prefers-color-scheme:dark){:root{--bg:#0f1720;--card:#16202b;--ink:#e6edf3;--quiet:#9fb3c8;--line:#2a3a4a;--ok:#4ade80;--okbg:#10281b;--bad:#f87171;--badbg:#2d1414;--accent:#60a5fa}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:520px;margin:48px auto;padding:0 16px}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:24px}
h1{font-size:22px;margin:0 0 4px}p{color:var(--quiet);margin:0 0 16px}label{display:block;font-weight:600;margin:16px 0 6px}
input{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;font-size:16px;background:var(--bg);color:var(--ink)}
input#code{font-family:ui-monospace,Consolas,monospace;letter-spacing:1px;text-transform:uppercase}
small{color:var(--quiet)}button{margin-top:20px;width:100%;padding:12px;border:0;border-radius:8px;background:var(--accent);color:#fff;font-size:16px;font-weight:600;cursor:pointer}
.result{margin-top:20px;border-radius:10px;padding:16px;display:none}.result h2{font-size:18px;margin:0 0 6px}
.verified{display:block;background:var(--okbg);color:var(--ok)}.warning{display:block;background:var(--badbg);color:var(--bad)}.result p{color:var(--ink);margin:0}
.tip{margin-top:20px;font-size:14px}
</style></head><body><main><div class="card">
<h1>Check an email from {{company}}</h1>
<p>Emails from {{company}} end with a code like <b>SG-7K4P-Q2MX</b>. Enter it to confirm who really sent the email.</p>
<form id="f"><label for="code">Verification code</label><input id="code" required autocomplete="off" placeholder="SG-XXXX-XXXX">
<label for="email">Your email address <small>(optional, confirms the code was issued to you)</small></label>
<input id="email" type="email" autocomplete="email">
<button type="submit">Check</button></form>
<div id="r" class="result" role="status" aria-live="polite"><h2 id="rt"></h2><p id="rm"></p></div>
<p class="tip">Always type this page's address yourself. Don't trust a link in the email to take you here.</p>
</div></main>
<script>
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = document.getElementById('r');
  const body = {code: document.getElementById('code').value, your_email: document.getElementById('email').value || null};
  try {
    const res = await fetch('/api/verify', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Check failed');
    r.className = 'result ' + data.result;
    document.getElementById('rt').textContent = data.title;
    document.getElementById('rm').textContent = data.message;
  } catch (err) {
    r.className = 'result warning';
    document.getElementById('rt').textContent = 'Could not check the code';
    document.getElementById('rm').textContent = String(err.message || err);
  }
});
</script></body></html>"""
