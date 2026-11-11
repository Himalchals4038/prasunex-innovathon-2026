import json
import os
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models import College, MaintenanceTicket, User
from ..security import get_current_user, require_roles
from ml.inference import classify_defect_image, cosine_similarity, embed_text

router = APIRouter(prefix="/api/facilities", tags=["Facilities & Maintenance"])
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_IMAGE_BYTES = 5 * 1024 * 1024


def _audit(ticket: MaintenanceTicket, event: str, actor_id: str, note: str = ""):
    entries = json.loads(ticket.audit_ledger_json or "[]")
    entries.append({"at": datetime.now(timezone.utc).isoformat(), "event": event, "actor_id": actor_id, "note": note})
    ticket.audit_ledger_json = json.dumps(entries)


@router.get("/tickets")
def list_tickets(status: str | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    query = db.query(MaintenanceTicket).filter(MaintenanceTicket.tenant_id == user.tenant_id)
    if status:
        query = query.filter(MaintenanceTicket.status == status)
    tickets = query.order_by(MaintenanceTicket.created_at.desc()).all()
    return [
        {"id": t.id, "title": t.title, "description": t.description, "location": t.location,
         "category": t.vision_category, "confidence": t.vision_confidence, "priority": t.priority,
         "status": t.status, "sla_deadline": t.sla_deadline.isoformat(), "merged_count": t.merged_count,
         "photo_url": f"/api/facilities/photos/{os.path.basename(t.photo_path)}" if t.photo_path else None,
         "audit": json.loads(t.audit_ledger_json or "[]")}
        for t in tickets
    ]


@router.post("/tickets", status_code=201)
async def create_ticket(
    title: str = Form(...), description: str = Form(""), location: str = Form("Main Lab Block"),
    priority: str = Form("Medium"), photo: UploadFile | None = File(None),
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    if not title.strip():
        raise HTTPException(status_code=400, detail="Ticket title is required")
    if priority not in {"Low", "Medium", "High", "Urgent"}:
        raise HTTPException(status_code=400, detail="Unsupported priority")
    college = db.query(College).filter(College.id == user.tenant_id).first()
    has_vision = college.tier == "autonomous_enterprise"
    image_bytes = None
    saved_photo = None
    if photo:
        if photo.content_type not in ALLOWED_IMAGE_TYPES:
            raise HTTPException(status_code=415, detail="Photo must be JPEG, PNG, or WebP")
        image_bytes = await photo.read(MAX_IMAGE_BYTES + 1)
        if len(image_bytes) > MAX_IMAGE_BYTES:
            raise HTTPException(status_code=413, detail="Photo must be 5 MB or smaller")
        if not has_vision:
            raise HTTPException(status_code=402, detail="Photo triage requires the Autonomous Enterprise tier")
        os.makedirs(settings.upload_dir, exist_ok=True)
        filename = f"{uuid.uuid4().hex}.{photo.filename.rsplit('.', 1)[-1].lower()}"
        saved_photo = os.path.join(settings.upload_dir, filename)
        with open(saved_photo, "wb") as target:
            target.write(image_bytes)

    category, confidence = classify_defect_image(image_bytes, f"{title} {description}")
    vector = embed_text(f"{title} {description} {location}")
    open_tickets = db.query(MaintenanceTicket).filter(
        MaintenanceTicket.tenant_id == user.tenant_id,
        MaintenanceTicket.status.in_(["Open", "In progress"]),
        MaintenanceTicket.merged_into_id.is_(None),
    ).all()
    duplicate = None
    for existing in open_tickets:
        existing_vec = json.loads(existing.embedding_json or "[]")
        if existing_vec and cosine_similarity(vector, existing_vec) >= 0.82:
            duplicate = existing
            break

    ticket_id = f"ticket-{uuid.uuid4().hex[:12]}"
    sla = datetime.now(timezone.utc) + timedelta(hours=48)
    ticket = MaintenanceTicket(
        id=ticket_id, tenant_id=user.tenant_id, reporter_id=user.id,
        title=title.strip()[:200], description=description.strip(), location=location.strip()[:160],
        photo_path=saved_photo, vision_category=category, vision_confidence=confidence,
        embedding_json=json.dumps(vector), priority=priority, status="Open",
        sla_deadline=sla, merged_into_id=duplicate.id if duplicate else None,
    )
    _audit(ticket, "created", user.id, f"category={category}; confidence={confidence}")
    db.add(ticket)
    if duplicate:
        duplicate.merged_count += 1
        _audit(duplicate, "duplicate_merged", user.id, f"merged ticket {ticket_id} (similarity >= 0.82)")
    else:
        technician = db.query(User).filter(User.tenant_id == user.tenant_id, User.role == "technician_warden").first()
        if technician:
            ticket.assigned_to_id = technician.id
            _audit(ticket, "auto_dispatched", technician.id, category)
    db.commit()
    return {"id": ticket.id, "category": category, "confidence": confidence, "merged_into": ticket.merged_into_id, "sla_deadline": sla.isoformat(), "status": ticket.status}


@router.patch("/tickets/{ticket_id}")
def update_ticket(
    ticket_id: str, status: str = Form(...), resolution_notes: str = Form(""),
    user: User = Depends(require_roles(["technician_warden", "chancellor_dean"])), db: Session = Depends(get_db),
):
    ticket = db.query(MaintenanceTicket).filter(MaintenanceTicket.id == ticket_id, MaintenanceTicket.tenant_id == user.tenant_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if status not in {"Open", "In progress", "Resolved"}:
        raise HTTPException(status_code=400, detail="Status must be Open, In progress, or Resolved")
    ticket.status = status
    if resolution_notes:
        ticket.resolution_notes = resolution_notes[:2000]
    _audit(ticket, "status_changed", user.id, status)
    db.commit()
    return {"id": ticket.id, "status": ticket.status, "audit": json.loads(ticket.audit_ledger_json or "[]")}


@router.get("/photos/{filename}")
def get_ticket_photo(filename: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from fastapi.responses import FileResponse

    if filename != os.path.basename(filename):
        raise HTTPException(status_code=400, detail="Invalid photo path")
    ticket = db.query(MaintenanceTicket).filter(MaintenanceTicket.tenant_id == user.tenant_id, MaintenanceTicket.photo_path.endswith(filename)).first()
    if not ticket or not ticket.photo_path or not os.path.isfile(ticket.photo_path):
        raise HTTPException(status_code=404, detail="Photo not found")
    return FileResponse(ticket.photo_path)
