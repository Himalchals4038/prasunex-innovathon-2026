import hashlib
import json
import secrets
from datetime import datetime, timezone

from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import College, ZKReport, ZKTokenNonce, User
from ..security import get_current_user, require_feature, require_roles

router = APIRouter(prefix="/api/privacy", tags=["Anonymous Reporting"])


class BlindSignatureRequest(BaseModel):
    blinded_message: str = Field(min_length=1, max_length=1024)


class ReportRequest(BaseModel):
    college_code: str = Field(min_length=2, max_length=32)
    token: str = Field(min_length=16, max_length=256)
    signature: str = Field(min_length=1, max_length=1024)
    category: str = Field(min_length=1, max_length=64)
    encrypted_body: str = Field(min_length=1, max_length=100000)
    key_share_dean: str = Field(min_length=1, max_length=4096)
    key_share_icc: str = Field(min_length=1, max_length=4096)


class EncryptedReply(BaseModel):
    encrypted_body: str = Field(min_length=1, max_length=100000)


def _college_rsa_key(college: College, db: Session, custodian: str = "dean"):
    fields = ("rsa_n", "rsa_e", "rsa_d") if custodian == "dean" else ("icc_rsa_n", "icc_rsa_e", "icc_rsa_d")
    n_field, e_field, d_field = fields
    if not getattr(college, n_field) or not getattr(college, e_field) or not getattr(college, d_field):
        private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        numbers = private.private_numbers()
        setattr(college, n_field, format(numbers.public_numbers.n, "x"))
        setattr(college, e_field, format(numbers.public_numbers.e, "x"))
        setattr(college, d_field, format(numbers.d, "x"))
        db.commit()
    return int(getattr(college, n_field), 16), int(getattr(college, e_field), 16), int(getattr(college, d_field), 16)


def _token_digest(token: str, modulus: int) -> int:
    return int.from_bytes(hashlib.sha256(token.encode("utf-8")).digest(), "big") % modulus


@router.get("/blind-key")
def blind_key(
    user: User = Depends(get_current_user),
    _college: College = Depends(require_feature("zk_grievance")),
    db: Session = Depends(get_db),
):
    college = db.query(College).filter(College.id == user.tenant_id).first()
    n, e, _ = _college_rsa_key(college, db, "dean")
    icc_n, icc_e, _ = _college_rsa_key(college, db, "icc")
    return {
        "algorithm": "RSA blind signature + dual-recipient key wrapping (demo)",
        "modulus": format(n, "x"), "exponent": format(e, "x"), "hash": "SHA-256",
        "dean_encryption_key": {"modulus": format(n, "x"), "exponent": format(e, "x")},
        "icc_encryption_key": {"modulus": format(icc_n, "x"), "exponent": format(icc_e, "x")},
    }


@router.post("/blind-sign")
def blind_sign(
    payload: BlindSignatureRequest,
    user: User = Depends(get_current_user),
    _college: College = Depends(require_feature("zk_grievance")),
    db: Session = Depends(get_db),
):
    if user.role != "student":
        raise HTTPException(status_code=403, detail="Only enrolled students can request an eligibility token")
    college = db.query(College).filter(College.id == user.tenant_id).first()
    n, _, d = _college_rsa_key(college, db)
    try:
        blinded = int(payload.blinded_message, 16)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="blinded_message must be hexadecimal") from exc
    if not 0 < blinded < n:
        raise HTTPException(status_code=400, detail="Invalid blinded message range")
    return {"blinded_signature": format(pow(blinded, d, n), "x")}


@router.post("/reports", status_code=201)
def submit_anonymous_report(
    payload: ReportRequest,
    db: Session = Depends(get_db),
):
    college = db.query(College).filter(College.code == payload.college_code.strip().upper()).first()
    if not college:
        raise HTTPException(status_code=404, detail="College code not found")
    from ..config import TIER_CONFIG
    tier = TIER_CONFIG.get(college.tier, TIER_CONFIG["core"])
    if not tier["features"].get("zk_grievance", False):
        raise HTTPException(status_code=402, detail="Anonymous reporting requires Autonomous Enterprise")
    n, e, _ = _college_rsa_key(college, db, "dean")
    try:
        signature = int(payload.signature, 16)
        token = payload.token
        if pow(signature, e, n) != _token_digest(token, n):
            raise HTTPException(status_code=400, detail="Eligibility token signature is invalid")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Malformed eligibility token") from exc

    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    if db.query(ZKTokenNonce).filter(ZKTokenNonce.tenant_id == college.id, ZKTokenNonce.token_hash == token_hash).first():
        raise HTTPException(status_code=409, detail="Eligibility token has already been used")
    tracking_code = secrets.token_urlsafe(18)
    report = ZKReport(
        id=f"report-{secrets.token_hex(8)}", tenant_id=college.id,
        tracking_code=tracking_code, category=payload.category,
        encrypted_body=payload.encrypted_body,
        key_share_dean=payload.key_share_dean,
        key_share_icc=payload.key_share_icc,
        status="Submitted", thread_json="[]",
    )
    db.add(ZKTokenNonce(tenant_id=college.id, token_hash=token_hash))
    db.add(report)
    db.commit()
    return {"tracking_code": tracking_code, "status": report.status, "message": "Report received without storing student identity."}


@router.get("/reports/{tracking_code}")
def track_report(tracking_code: str, db: Session = Depends(get_db)):
    report = db.query(ZKReport).filter(ZKReport.tracking_code == tracking_code).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    return {"tracking_code": report.tracking_code, "category": report.category, "status": report.status, "thread": json.loads(report.thread_json or "[]"), "created_at": report.created_at}


@router.post("/reports/{tracking_code}/messages")
def anonymous_reply(tracking_code: str, payload: EncryptedReply, db: Session = Depends(get_db)):
    report = db.query(ZKReport).filter(ZKReport.tracking_code == tracking_code).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    thread = json.loads(report.thread_json or "[]")
    thread.append({"at": datetime.now(timezone.utc).isoformat(), "encrypted_body": payload.encrypted_body})
    report.thread_json = json.dumps(thread)
    db.commit()
    return {"tracking_code": report.tracking_code, "message_count": len(thread)}


@router.get("/reports")
def admin_report_queue(
    user: User = Depends(require_roles(["chancellor_dean"])),
    _college: College = Depends(require_feature("zk_grievance")),
    db: Session = Depends(get_db),
):
    reports = db.query(ZKReport).filter(ZKReport.tenant_id == user.tenant_id).order_by(ZKReport.created_at.desc()).all()
    return [{"tracking_code": r.tracking_code, "category": r.category, "status": r.status, "created_at": r.created_at} for r in reports]
