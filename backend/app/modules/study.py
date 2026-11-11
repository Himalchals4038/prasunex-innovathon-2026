from datetime import date, timedelta
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Course, KnowledgeState, StudyPlanItem, User
from ..security import get_current_user

router = APIRouter(prefix="/api", tags=["Study support"])


class PlanRequest(BaseModel):
    available_hours_per_day: float = Field(default=1.0, ge=0.25, le=8)
    days: int = Field(default=7, ge=1, le=14)


@router.get("/study-plan")
def get_plan(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    items = db.query(StudyPlanItem, Course).join(
        Course, (Course.id == StudyPlanItem.course_id) & (Course.tenant_id == StudyPlanItem.tenant_id)
    ).filter(StudyPlanItem.tenant_id == user.tenant_id, StudyPlanItem.student_id == user.id).order_by(
        StudyPlanItem.scheduled_date, StudyPlanItem.id
    ).all()
    return [{"id": item.id, "date": item.scheduled_date, "course_id": item.course_id,
             "course_code": course.code, "course_title": course.title, "concept_code": item.concept_code,
             "duration_minutes": item.duration_minutes, "activity": item.activity, "completed": item.completed}
            for item, course in items]


@router.post("/study-plan/generate")
def generate_plan(payload: PlanRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Deterministic planner prioritises low BKT mastery; it is not a generative AI prediction.
    states = db.query(KnowledgeState, Course).join(
        Course, (Course.id == KnowledgeState.course_id) & (Course.tenant_id == KnowledgeState.tenant_id)
    ).filter(KnowledgeState.tenant_id == user.tenant_id, KnowledgeState.student_id == user.id).order_by(
        KnowledgeState.bkt_mastery.asc()
    ).all()
    if not states:
        raise HTTPException(status_code=404, detail="No course mastery data is available yet")
    db.query(StudyPlanItem).filter(StudyPlanItem.tenant_id == user.tenant_id,
                                   StudyPlanItem.student_id == user.id, StudyPlanItem.completed.is_(False)).delete()
    budget = max(1, int(payload.available_hours_per_day * 60))
    sessions_per_day = max(1, budget // 25)
    cap = min(payload.days * sessions_per_day, 28)
    today = date.today()
    created = []
    for index in range(cap):
        state, course = states[index % len(states)]
        day = today + timedelta(days=index // sessions_per_day)
        duration = min(40, max(15, budget // sessions_per_day))
        item = StudyPlanItem(
            id=f"plan-{uuid.uuid4().hex[:12]}", tenant_id=user.tenant_id, student_id=user.id,
            course_id=course.id, concept_code=state.concept_code, scheduled_date=day.isoformat(),
            duration_minutes=duration, activity=f"Review {state.concept_code} foundations, then solve 3 practice questions.",
        )
        db.add(item)
        created.append(item)
    db.commit()
    return {"model": "deterministic mastery-priority planner (demo)", "generated": len(created),
            "plan": get_plan(user, db)}


@router.patch("/study-plan/{item_id}/complete")
def complete_item(item_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    item = db.query(StudyPlanItem).filter(StudyPlanItem.id == item_id,
        StudyPlanItem.tenant_id == user.tenant_id, StudyPlanItem.student_id == user.id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Study activity not found")
    item.completed = not item.completed
    db.commit()
    return {"id": item.id, "completed": item.completed}


@router.get("/micro-drills")
def micro_drills(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    states = db.query(KnowledgeState, Course).join(
        Course, (Course.id == KnowledgeState.course_id) & (Course.tenant_id == KnowledgeState.tenant_id)
    ).filter(KnowledgeState.tenant_id == user.tenant_id, KnowledgeState.student_id == user.id).order_by(
        KnowledgeState.bkt_mastery.asc()
    ).limit(12).all()
    # Demo queue uses low mastery as a revision priority. No forgetting curve is trained here.
    return [{"course_id": course.id, "course_code": course.code, "course_title": course.title,
             "concept_code": state.concept_code, "mastery": round(state.bkt_mastery, 3),
             "difficulty": "Foundations" if state.bkt_mastery < .45 else "Practice",
             "prompt": f"Explain one key idea from {state.concept_code} in {course.title}, then check the course notes.",
             "schedule_basis": "mastery-priority demo queue; FSRS model not configured"}
            for state, course in states]
