import json
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from scipy.optimize import linear_sum_assignment
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import College, HackathonEvent, KnowledgeState, RecruiterInvite, StudyMatch, User
from ..security import get_current_user, require_feature, require_roles

router = APIRouter(prefix="/api", tags=["Peer Matching & Opportunities"])


class InviteRequest(BaseModel):
    student_id: str
    role_title: str = Field(min_length=2, max_length=160)
    message: str = Field(min_length=4, max_length=1200)
    ctc_lpa: float = Field(default=12.0, ge=0, le=500)


class ConsentRequest(BaseModel):
    opt_in: bool


class InviteResponse(BaseModel):
    status: str


@router.post("/peer-matcher/generate")
def generate_peer_matches(
    course_id: str | None = None,
    user: User = Depends(require_roles(["chancellor_dean", "professor_hod"])),
    _college: College = Depends(require_feature("peer_matcher")),
    db: Session = Depends(get_db),
):
    query = db.query(KnowledgeState).filter(KnowledgeState.tenant_id == user.tenant_id)
    if course_id:
        query = query.filter(KnowledgeState.course_id == course_id)
    states = query.all()
    groups = {}
    for state in states:
        groups.setdefault((state.course_id, state.concept_code), []).append(state)

    made = []
    for (group_course_id, concept_code), group in groups.items():
        tutors = [state for state in group if state.bkt_mastery >= 0.72]
        learners = [state for state in group if state.bkt_mastery <= 0.48]
        if not tutors or not learners:
            continue
        costs = [[abs(tutor.bkt_mastery - learner.bkt_mastery) for learner in learners] for tutor in tutors]
        tutor_idx, learner_idx = linear_sum_assignment([[-value for value in row] for row in costs])
        for ti, li in zip(tutor_idx, learner_idx):
            tutor, learner = tutors[ti], learners[li]
            if tutor.student_id == learner.student_id:
                continue
            existing = db.query(StudyMatch).filter(
                StudyMatch.tenant_id == user.tenant_id,
                StudyMatch.course_id == group_course_id,
                StudyMatch.concept_code == concept_code,
                StudyMatch.tutor_id == tutor.student_id,
                StudyMatch.learner_id == learner.student_id,
                StudyMatch.status == "Active",
            ).first()
            if not existing:
                match = StudyMatch(
                    tenant_id=user.tenant_id, course_id=group_course_id,
                    concept_code=concept_code, tutor_id=tutor.student_id,
                    learner_id=learner.student_id,
                    score=round(abs(tutor.bkt_mastery - learner.bkt_mastery), 3),
                )
                db.add(match)
                made.append(match)
    db.commit()
    return {"created": len(made), "algorithm": "Hungarian assignment by course and concept"}


@router.get("/peer-matcher/me")
def my_peer_matches(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    matches = db.query(StudyMatch).filter(
        StudyMatch.tenant_id == user.tenant_id,
        (StudyMatch.tutor_id == user.id) | (StudyMatch.learner_id == user.id),
        StudyMatch.status == "Active",
    ).all()
    partner_ids = {m.learner_id if m.tutor_id == user.id else m.tutor_id for m in matches}
    partners = {u.id: u for u in db.query(User).filter(User.tenant_id == user.tenant_id, User.id.in_(partner_ids)).all()} if partner_ids else {}
    return [{"course_id": m.course_id, "concept_code": m.concept_code, "role": "tutor" if m.tutor_id == user.id else "learner", "partner_name": partners[m.learner_id if m.tutor_id == user.id else m.tutor_id].full_name, "score": m.score} for m in matches if (m.learner_id if m.tutor_id == user.id else m.tutor_id) in partners]


@router.get("/opportunities")
def list_opportunities(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    events = db.query(HackathonEvent).filter(HackathonEvent.tenant_id == user.tenant_id).all()
    return [{"id": e.id, "title": e.title, "organizer": e.organizer, "deadline": e.deadline, "tags": json.loads(e.tags_json or "[]"), "source": e.source} for e in events]


@router.post("/opportunities/{event_id}/team")
def join_event_team(event_id: str, user: User = Depends(require_roles(["student"])), db: Session = Depends(get_db)):
    event = db.query(HackathonEvent).filter(HackathonEvent.id == event_id, HackathonEvent.tenant_id == user.tenant_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Opportunity not found")
    members = json.loads(event.teams_json or "[]")
    if user.id in members:
        return {"joined": True, "team_size": len(members)}
    if len(members) >= 4:
        raise HTTPException(status_code=409, detail="This demo team is full")
    members.append(user.id)
    event.teams_json = json.dumps(members)
    db.commit()
    return {"joined": True, "team_size": len(members), "message": "You joined the opportunity team finder."}


@router.patch("/recruiter/opt-in")
def update_recruiter_consent(payload: ConsentRequest, user: User = Depends(require_roles(["student"])), db: Session = Depends(get_db)):
    user.opt_in_recruiter = payload.opt_in
    db.commit()
    return {"opt_in": user.opt_in_recruiter}


@router.get("/recruiter/talent")
def recruiter_talent(
    concept_code: str | None = None,
    department: str | None = None,
    user: User = Depends(require_roles(["recruiter"])),
    _college: College = Depends(require_feature("recruiter_marketplace")),
    db: Session = Depends(get_db),
):
    query = db.query(User).filter(User.tenant_id == user.tenant_id, User.role == "student", User.opt_in_recruiter.is_(True))
    if department:
        query = query.filter(User.department == department)
    students = query.all()
    if concept_code:
        state_rows = db.query(KnowledgeState).filter(
            KnowledgeState.tenant_id == user.tenant_id,
            KnowledgeState.concept_code == concept_code,
            KnowledgeState.student_id.in_([s.id for s in students]),
        ).all() if students else []
        mastery = {s.student_id: max((r.bkt_mastery for r in state_rows if r.student_id == s.id), default=0) for s in students}
        students = sorted((s for s in students if mastery.get(s.id, 0) >= 0.5), key=lambda s: mastery.get(s.id, 0), reverse=True)
    return [{"student_id": s.id, "display_name": f"{s.full_name.split()[0]} {s.full_name.split()[-1][0]}.", "department": s.department, "semester": s.semester, "cgpa": s.cgpa, "karma_points": s.karma_points, "opted_in": True} for s in students]


@router.post("/recruiter/invites", status_code=201)
def create_recruiter_invite(
    payload: InviteRequest,
    user: User = Depends(require_roles(["recruiter"])),
    _college: College = Depends(require_feature("recruiter_marketplace")),
    db: Session = Depends(get_db),
):
    student = db.query(User).filter(User.id == payload.student_id, User.tenant_id == user.tenant_id, User.role == "student", User.opt_in_recruiter.is_(True)).first()
    if not student:
        raise HTTPException(status_code=404, detail="Opted-in student not found")
    invite = RecruiterInvite(
        tenant_id=user.tenant_id, recruiter_id=user.id, student_id=student.id,
        role_title=payload.role_title, ctc_lpa=payload.ctc_lpa, message=payload.message,
    )
    db.add(invite)
    db.commit()
    return {"id": invite.id, "status": invite.status, "message": "Invitation sent. Student contact details stay private until they respond."}


@router.get("/invites/me")
def my_invites(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.role == "student":
        rows = db.query(RecruiterInvite).filter(RecruiterInvite.tenant_id == user.tenant_id, RecruiterInvite.student_id == user.id).all()
    elif user.role == "recruiter":
        rows = db.query(RecruiterInvite).filter(RecruiterInvite.tenant_id == user.tenant_id, RecruiterInvite.recruiter_id == user.id).all()
    else:
        raise HTTPException(status_code=403, detail="Only students and recruiters can access invitations")
    return [{"id": row.id, "role_title": row.role_title, "message": row.message, "status": row.status, "ctc_lpa": row.ctc_lpa} for row in rows]


@router.patch("/invites/{invite_id}")
def respond_to_invite(invite_id: int, payload: InviteResponse, user: User = Depends(require_roles(["student"])), db: Session = Depends(get_db)):
    if payload.status not in {"Accepted", "Declined"}:
        raise HTTPException(status_code=400, detail="Status must be Accepted or Declined")
    invite = db.query(RecruiterInvite).filter(RecruiterInvite.id == invite_id, RecruiterInvite.tenant_id == user.tenant_id, RecruiterInvite.student_id == user.id).first()
    if not invite:
        raise HTTPException(status_code=404, detail="Invitation not found")
    invite.status = payload.status
    db.commit()
    return {"id": invite.id, "status": invite.status}
