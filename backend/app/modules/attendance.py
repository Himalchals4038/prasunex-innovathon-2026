from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import AttendanceRecord, Course, KnowledgeState, User
from ..security import get_current_user, require_roles

router = APIRouter(prefix="/api", tags=["Attendance & Learning"])


class AttemptRequest(BaseModel):
    course_id: str
    concept_code: str
    correct: bool


def attendance_forecast(record: AttendanceRecord, threshold: float = 0.75):
    total = record.total_classes
    attended = record.attended_classes
    remaining = record.remaining_classes
    projected = attended / total if total else 0.0
    remaining_gap = threshold * (total + remaining) - attended
    required = max(0, int(remaining_gap + 0.999999)) if remaining else 0
    max_skips = max(0, int((attended / threshold) - total)) if threshold else 0
    return {
        "course_id": record.course_id,
        "attended_classes": attended,
        "total_classes": total,
        "remaining_classes": remaining,
        "current_percentage": round(projected * 100, 1),
        "projected_percentage_if_all_attended": round((attended + remaining) / max(total + remaining, 1) * 100, 1),
        "classes_to_attend": min(remaining, required),
        "classes_can_skip": min(remaining, max_skips),
        "at_risk": projected < threshold,
        "threshold": int(threshold * 100),
    }


@router.get("/attendance/me")
def my_attendance(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(AttendanceRecord, Course).join(
        Course, (Course.id == AttendanceRecord.course_id) & (Course.tenant_id == AttendanceRecord.tenant_id)
    ).filter(AttendanceRecord.tenant_id == user.tenant_id, AttendanceRecord.student_id == user.id).all()
    return [
        {"course_code": course.code, "course_title": course.title, **attendance_forecast(row)}
        for row, course in rows
    ]


@router.get("/attendance/early-warning")
def early_warning(user: User = Depends(require_roles(["chancellor_dean", "professor_hod"])), db: Session = Depends(get_db)):
    rows = db.query(AttendanceRecord, User, Course).join(
        User, (User.id == AttendanceRecord.student_id) & (User.tenant_id == AttendanceRecord.tenant_id)
    ).join(Course, (Course.id == AttendanceRecord.course_id) & (Course.tenant_id == AttendanceRecord.tenant_id)).filter(
        AttendanceRecord.tenant_id == user.tenant_id, User.role == "student"
    ).all()
    alerts = []
    for attendance, student, course in rows:
        forecast = attendance_forecast(attendance)
        if forecast["at_risk"]:
            alerts.append({"student_id": student.id, "student_name": student.full_name, "department": student.department, "course_code": course.code, **forecast})
    return sorted(alerts, key=lambda item: item["current_percentage"])


@router.get("/knowledge/me")
def my_knowledge(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(KnowledgeState, Course).join(
        Course, (Course.id == KnowledgeState.course_id) & (Course.tenant_id == KnowledgeState.tenant_id)
    ).filter(KnowledgeState.tenant_id == user.tenant_id, KnowledgeState.student_id == user.id).all()
    return [
        {"course_id": course.id, "course_code": course.code, "course_title": course.title,
         "concept_code": state.concept_code, "mastery": round(state.bkt_mastery, 3),
         "attempts": state.attempts, "correct_count": state.correct_count}
        for state, course in rows
    ]


@router.post("/knowledge/attempts")
def submit_attempt(payload: AttemptRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    course = db.query(Course).filter(Course.id == payload.course_id, Course.tenant_id == user.tenant_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found in this college")
    state = db.query(KnowledgeState).filter(
        KnowledgeState.tenant_id == user.tenant_id,
        KnowledgeState.student_id == user.id,
        KnowledgeState.course_id == payload.course_id,
        KnowledgeState.concept_code == payload.concept_code,
    ).first()
    if not state:
        raise HTTPException(status_code=404, detail="Concept not found for this student and course")
    prior = min(max(state.bkt_mastery, 0.02), 0.98)
    p_transit, p_slip, p_guess = 0.18, 0.10, 0.20
    if payload.correct:
        numerator = prior * (1 - p_slip)
        denominator = numerator + (1 - prior) * p_guess
    else:
        numerator = prior * p_slip
        denominator = numerator + (1 - prior) * (1 - p_guess)
    posterior = numerator / max(denominator, 1e-6)
    state.bkt_mastery = round(min(max(posterior + (1 - posterior) * p_transit, 0.05), 0.99), 4)
    state.dkt_mastery = state.bkt_mastery
    state.attempts += 1
    state.correct_count += int(payload.correct)
    db.commit()
    return {"concept_code": state.concept_code, "mastery": state.bkt_mastery, "attempts": state.attempts, "correct_count": state.correct_count, "model": "Bayesian Knowledge Tracing (demo)"}


@router.get("/students/{student_id}/risk")
def student_risk(student_id: str, user: User = Depends(require_roles(["chancellor_dean", "professor_hod"])), db: Session = Depends(get_db)):
    student = db.query(User).filter(User.id == student_id, User.tenant_id == user.tenant_id, User.role == "student").first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    records = db.query(AttendanceRecord).filter(AttendanceRecord.tenant_id == user.tenant_id, AttendanceRecord.student_id == student.id).all()
    forecasts = [attendance_forecast(row) for row in records]
    weak_concepts = db.query(KnowledgeState).filter(KnowledgeState.tenant_id == user.tenant_id, KnowledgeState.student_id == student.id, KnowledgeState.bkt_mastery < 0.5).all()
    return {"student_id": student.id, "attendance_risk_courses": [f for f in forecasts if f["at_risk"]], "weak_concepts": [{"course_id": k.course_id, "concept_code": k.concept_code, "mastery": k.bkt_mastery} for k in weak_concepts], "risk_level": "high" if any(f["at_risk"] for f in forecasts) and weak_concepts else "watch" if any(f["at_risk"] for f in forecasts) or weak_concepts else "on_track"}
