"""The two endpoints the Outlook add-in (and the mock compose page) call."""
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import audit, signature, verification
from ..auth import current_user
from ..db import get_db
from ..models import Employee, VerificationCode, utcnow

router = APIRouter(prefix="/api/addin", tags=["add-in"])


class SignatureRequest(BaseModel):
    recipients: list[str] = Field(default_factory=list, max_length=500)
    message_type: Literal["new", "reply", "forward"] = "new"
    from_email: str | None = None
    previous_code: str | None = None


class SignatureResponse(BaseModel):
    html: str
    template_name: str | None
    policy_name: str | None
    recipient_type: str
    reason: str
    verification_code: str | None
    on_behalf_of: str | None
    warnings: list[str]
    campaign: str | None = None
    disclaimers: list[str] = []


@router.post("/signature", response_model=SignatureResponse)
def get_signature(
    body: SignatureRequest,
    db: Session = Depends(get_db),
    user: Employee = Depends(current_user),
):
    result = signature.build(
        db, user, body.recipients, body.message_type, body.from_email, body.previous_code
    )
    return SignatureResponse(**{k: getattr(result, k) for k in SignatureResponse.model_fields})


class SentRequest(BaseModel):
    verification_code: str
    subject: str = ""


@router.post("/sent")
def mark_sent(
    body: SentRequest,
    db: Session = Depends(get_db),
    user: Employee = Depends(current_user),
):
    row = db.get(VerificationCode, verification.normalize(body.verification_code))
    if row is None or row.sender_email != user.email:
        return {"ok": False}
    if row.sent_at is None:
        row.sent_at = utcnow()
        row.subject_hash = verification.subject_hash(body.subject) if body.subject else None
        audit.record(db, user.email, "email.sent_with_code", "code", row.code)
        db.commit()
    return {"ok": True}
