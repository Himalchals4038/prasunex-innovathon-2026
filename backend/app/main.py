from contextlib import asynccontextmanager
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi import Depends
from fastapi.middleware.cors import CORSMiddleware

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from .database import Base, engine
from .modules.auth_tenancy import router as auth_router
from .modules.grading import router as grading_router
from .modules.attendance import router as attendance_router
from .modules.accreditation import router as accreditation_router
from .modules.facilities import router as facilities_router
from .modules.network import router as network_router
from .modules.privacy import router as privacy_router
from .models import AttendanceRecord, College, Course, KnowledgeState, MaintenanceTicket, User
from .security import get_current_user
from .database import get_db
from sqlalchemy.orm import Session


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    from .seed import seed_database

    seed_database()
    yield


app = FastAPI(title="CAMPUS-NEXUS API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(grading_router)
app.include_router(attendance_router)
app.include_router(accreditation_router)
app.include_router(facilities_router)
app.include_router(network_router)
app.include_router(privacy_router)


@app.get("/health")
def health():
    return {"status": "ok", "service": "campus-nexus-api"}


@app.get("/api/dashboard/overview")
def dashboard_overview(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    college = db.query(College).filter(College.id == user.tenant_id).first()
    students = db.query(User).filter(User.tenant_id == user.tenant_id, User.role == "student").all()
    attendance = db.query(AttendanceRecord).filter(AttendanceRecord.tenant_id == user.tenant_id).all()
    tickets = db.query(MaintenanceTicket).filter(MaintenanceTicket.tenant_id == user.tenant_id, MaintenanceTicket.status != "Resolved").count()
    concepts = db.query(KnowledgeState).filter(KnowledgeState.tenant_id == user.tenant_id).all()
    average_attendance = round(sum(r.attended_classes / r.total_classes for r in attendance if r.total_classes) / max(1, len([r for r in attendance if r.total_classes])) * 100, 1)
    on_track = sum(1 for r in attendance if r.total_classes and r.attended_classes / r.total_classes >= 0.75)
    return {
        "college_name": college.name if college else user.tenant_id,
        "student_count": len(students),
        "average_attendance": average_attendance,
        "open_tickets": tickets,
        "average_mastery": round(sum(c.bkt_mastery for c in concepts) / max(1, len(concepts)) * 100, 1),
        "attendance_records_on_track": on_track,
        "courses": db.query(Course).filter(Course.tenant_id == user.tenant_id).count(),
    }


@app.get("/api/students")
def list_students(
    department: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(User).filter(User.tenant_id == user.tenant_id, User.role == "student")
    if department:
        query = query.filter(User.department == department)
    return [{"id": s.id, "full_name": s.full_name, "email": s.email, "department": s.department, "semester": s.semester, "cgpa": s.cgpa, "karma_points": s.karma_points, "opt_in_recruiter": s.opt_in_recruiter} for s in query.order_by(User.full_name).all()]
