import csv
import io
import json
from typing import Any

import numpy as np
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from scipy.stats import gaussian_kde, norm
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import AssessmentQuestion, Course, MarkRecord, User
from ..security import get_current_user, require_roles

router = APIRouter(prefix="/api/grading", tags=["Relative Grading Sandbox"])


class SandboxRequest(BaseModel):
    course_id: str
    mean_shift: float = 0.0
    std_scale: float = 1.0
    cutoffs: dict[str, float] | None = None
    save_grades: bool = False


DEFAULT_CUTOFFS = {"S": 1.5, "A": 0.75, "B": 0.0, "C": -0.75, "D": -1.5}


def _assign_grade(z: float, cutoffs: dict[str, float]) -> str:
    for grade in ["S", "A", "B", "C", "D"]:
        if z >= cutoffs.get(grade, DEFAULT_CUTOFFS[grade]):
            return grade
    return "F"


def _compute_irt_audit(records: list[MarkRecord], questions: list[AssessmentQuestion]) -> list[dict[str, Any]]:
    if not records:
        return []
    totals = np.array([r.total_score for r in records], dtype=float)
    q_map = {q.q_code: q for q in questions}

    # Discover all question keys present in mark records
    sample_scores = json.loads(records[0].question_scores_json or "{}")
    q_codes = list(sample_scores.keys())
    audit: list[dict[str, Any]] = []

    for qc in q_codes:
        scores = np.array([float(json.loads(r.question_scores_json or "{}").get(qc, 0.0)) for r in records], dtype=float)
        q_obj = q_map.get(qc)
        max_m = q_obj.max_marks if q_obj else max(float(scores.max()), 10.0)
        p_val = float(np.mean(scores) / max_m) if max_m > 0 else 0.0

        # Point-biserial / corrected item-total correlation as IRT discrimination proxy
        rest_total = totals - scores
        if np.std(scores) < 1e-6 or np.std(rest_total) < 1e-6:
            disc = 0.0
        else:
            disc = float(np.corrcoef(scores, rest_total)[0, 1])

        # 2PL difficulty b estimate on logit scale
        p_clamped = min(max(p_val, 0.02), 0.98)
        b_diff = float(-np.log(p_clamped / (1.0 - p_clamped)))

        flags = []
        if disc < 0.20:
            flags.append("Poor discrimination (<0.20)")
        if p_val < 0.20:
            flags.append("Too difficult (p<0.20)")
        elif p_val > 0.92:
            flags.append("Too easy (p>0.92)")

        audit.append(
            {
                "q_code": qc,
                "concept_code": q_obj.concept_code if q_obj else "GENERAL",
                "difficulty_p": round(p_val, 3),
                "irt_b": round(b_diff, 3),
                "discrimination": round(disc, 3),
                "flagged": len(flags) > 0,
                "flags": flags,
            }
        )
    return audit


@router.get("/courses")
def list_grading_courses(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    courses = db.query(Course).filter(Course.tenant_id == user.tenant_id).all()
    return [
        {
            "id": c.id,
            "code": c.code,
            "title": c.title,
            "department": c.department,
            "semester": c.semester,
        }
        for c in courses
    ]


@router.post("/upload-csv")
async def upload_marks_csv(
    course_id: str,
    file: UploadFile = File(...),
    user: User = Depends(require_roles(["professor_hod", "chancellor_dean"])),
    db: Session = Depends(get_db),
):
    course = db.query(Course).filter(Course.id == course_id, Course.tenant_id == user.tenant_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found in tenant")

    raw = (await file.read()).decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(raw))
    if not reader.fieldnames or "student_id" not in reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV must include 'student_id' and question columns (e.g. Q1,Q2,...)")

    q_cols = [c for c in reader.fieldnames if c != "student_id"]
    count = 0
    for row in reader:
        sid = row["student_id"].strip()
        if not sid:
            continue
        student = db.query(User).filter(User.id == sid, User.tenant_id == user.tenant_id).first()
        if not student:
            continue
        q_scores = {qc: float(row.get(qc) or 0.0) for qc in q_cols}
        total = sum(q_scores.values())
        rec = (
            db.query(MarkRecord)
            .filter(MarkRecord.tenant_id == user.tenant_id, MarkRecord.course_id == course_id, MarkRecord.student_id == sid)
            .first()
        )
        if not rec:
            rec = MarkRecord(tenant_id=user.tenant_id, course_id=course_id, student_id=sid)
            db.add(rec)
        rec.question_scores_json = json.dumps(q_scores)
        rec.total_score = total
        count += 1

    db.commit()
    return {"uploaded_rows": count, "question_columns": q_cols}


@router.post("/sandbox")
def run_grading_sandbox(
    payload: SandboxRequest,
    user: User = Depends(require_roles(["professor_hod", "chancellor_dean"])),
    db: Session = Depends(get_db),
):
    course = db.query(Course).filter(Course.id == payload.course_id, Course.tenant_id == user.tenant_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found in tenant")

    records = (
        db.query(MarkRecord)
        .filter(MarkRecord.tenant_id == user.tenant_id, MarkRecord.course_id == payload.course_id)
        .all()
    )
    if not records:
        raise HTTPException(status_code=404, detail="No mark records found for course")

    raw_scores = np.array([r.total_score for r in records], dtype=float)
    raw_mean = float(np.mean(raw_scores))
    raw_std = max(float(np.std(raw_scores)), 1.0)

    adj_mean = raw_mean + payload.mean_shift
    adj_std = max(raw_std * max(payload.std_scale, 0.25), 1.0)
    cutoffs = payload.cutoffs or DEFAULT_CUTOFFS

    # Histogram + Gaussian + KDE curve points
    x_grid = np.linspace(max(0.0, float(raw_scores.min()) - 10), min(100.0, float(raw_scores.max()) + 10), 40)
    gaussian_y = norm.pdf(x_grid, loc=adj_mean, scale=adj_std)
    try:
        kde = gaussian_kde(raw_scores + payload.mean_shift)
        kde_y = kde(x_grid)
    except Exception:
        kde_y = gaussian_y

    curve = [
        {"x": round(float(x), 1), "gaussian": round(float(g) * len(raw_scores) * 5, 3), "kde": round(float(k) * len(raw_scores) * 5, 3)}
        for x, g, k in zip(x_grid, gaussian_y, kde_y)
    ]

    dist = {"S": 0, "A": 0, "B": 0, "C": 0, "D": 0, "F": 0}
    student_rows = []
    students_map = {
        u.id: u.full_name
        for u in db.query(User).filter(User.tenant_id == user.tenant_id, User.role == "student").all()
    }

    for rec in records:
        shifted = min(100.0, max(0.0, rec.total_score + payload.mean_shift))
        z = (shifted - adj_mean) / adj_std
        grade = _assign_grade(z, cutoffs)
        dist[grade] += 1
        if payload.save_grades:
            rec.z_score = round(z, 3)
            rec.letter_grade = grade
        student_rows.append(
            {
                "student_id": rec.student_id,
                "student_name": students_map.get(rec.student_id, rec.student_id),
                "raw_score": round(rec.total_score, 2),
                "adjusted_score": round(shifted, 2),
                "z_score": round(z, 3),
                "grade": grade,
            }
        )

    if payload.save_grades:
        db.commit()

    questions = (
        db.query(AssessmentQuestion)
        .filter(AssessmentQuestion.tenant_id == user.tenant_id, AssessmentQuestion.course_id == payload.course_id)
        .all()
    )
    irt_audit = _compute_irt_audit(records, questions)

    return {
        "course_id": course.id,
        "course_code": course.code,
        "course_title": course.title,
        "count": len(records),
        "raw_mean": round(raw_mean, 2),
        "raw_std": round(raw_std, 2),
        "adjusted_mean": round(adj_mean, 2),
        "adjusted_std": round(adj_std, 2),
        "grade_distribution": [{"grade": g, "count": c} for g, c in dist.items()],
        "curve": curve,
        "irt_audit": irt_audit,
        "students": sorted(student_rows, key=lambda r: r["z_score"], reverse=True)[:40],
    }


@router.get("/export-csv/{course_id}")
def export_grades_csv(
    course_id: str,
    user: User = Depends(require_roles(["professor_hod", "chancellor_dean"])),
    db: Session = Depends(get_db),
):
    records = (
        db.query(MarkRecord)
        .filter(MarkRecord.tenant_id == user.tenant_id, MarkRecord.course_id == course_id)
        .all()
    )
    if not records:
        raise HTTPException(status_code=404, detail="No records to export")

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["student_id", "course_id", "total_score", "z_score", "letter_grade"])
    for r in records:
        writer.writerow([r.student_id, r.course_id, round(r.total_score, 2), round(r.z_score, 3), r.letter_grade])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="grades_{course_id}.csv"'},
    )
