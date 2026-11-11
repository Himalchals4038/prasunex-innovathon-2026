import csv
import io
import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import AssessmentQuestion, Course, MarkRecord, User
from ..security import require_roles

router = APIRouter(prefix="/api/accreditation", tags=["NBA / NAAC Accreditation"])


@router.get("/outcomes")
def outcome_matrix(user: User = Depends(require_roles(["chancellor_dean", "professor_hod"])), db: Session = Depends(get_db)):
    courses = db.query(Course).filter(Course.tenant_id == user.tenant_id).all()
    result = []
    for course in courses:
        questions = db.query(AssessmentQuestion).filter(AssessmentQuestion.tenant_id == user.tenant_id, AssessmentQuestion.course_id == course.id).all()
        records = db.query(MarkRecord).filter(MarkRecord.tenant_id == user.tenant_id, MarkRecord.course_id == course.id).all()
        co_scores = {}
        po_scores = {}
        for question in questions:
            scores = [json.loads(record.question_scores_json or "{}").get(question.q_code, 0) for record in records]
            attainment = round(sum(scores) / (len(scores) * question.max_marks) * 100, 1) if scores and question.max_marks else 0.0
            co_scores.setdefault(question.co_code, []).append(attainment)
            for po_code in json.loads(question.po_codes_json or "[]"):
                po_scores.setdefault(po_code, []).append(attainment)
        result.append({
            "course_id": course.id, "course_code": course.code, "course_title": course.title,
            "students_assessed": len(records),
            "course_outcomes": [{"code": code, "attainment": round(sum(values) / len(values), 1), "evidence_questions": len(values)} for code, values in sorted(co_scores.items())],
            "program_outcomes": [{"code": code, "attainment": round(sum(values) / len(values), 1)} for code, values in sorted(po_scores.items())],
        })
    return result


@router.get("/sar.csv")
def export_sar_csv(user: User = Depends(require_roles(["chancellor_dean", "professor_hod"])), db: Session = Depends(get_db)):
    courses = db.query(Course).filter(Course.tenant_id == user.tenant_id).all()
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["College", "Course", "Course title", "Outcome type", "Outcome", "Attainment %", "Evidence questions", "Students assessed"])
    for course in courses:
        questions = db.query(AssessmentQuestion).filter(AssessmentQuestion.tenant_id == user.tenant_id, AssessmentQuestion.course_id == course.id).all()
        records = db.query(MarkRecord).filter(MarkRecord.tenant_id == user.tenant_id, MarkRecord.course_id == course.id).all()
        by_outcome = {}
        for question in questions:
            scores = [json.loads(record.question_scores_json or "{}").get(question.q_code, 0) for record in records]
            pct = sum(scores) / (len(scores) * question.max_marks) * 100 if scores and question.max_marks else 0
            by_outcome.setdefault(("CO", question.co_code), []).append(pct)
            for po in json.loads(question.po_codes_json or "[]"):
                by_outcome.setdefault(("PO", po), []).append(pct)
        for (kind, code), values in sorted(by_outcome.items()):
            writer.writerow([user.tenant_id, course.code, course.title, kind, code, round(sum(values) / len(values), 1), len(values), len(records)])
    filename = f"campus-nexus-sar-{user.tenant_id}.csv"
    return StreamingResponse(iter([buffer.getvalue()]), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/sar.pdf")
def export_sar_pdf(user: User = Depends(require_roles(["chancellor_dean", "professor_hod"])), db: Session = Depends(get_db)):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    outcomes = outcome_matrix(user, db)
    buffer = io.BytesIO()
    document = SimpleDocTemplate(buffer, pagesize=landscape(A4), title="CAMPUS-NEXUS SAR Evidence")
    styles = getSampleStyleSheet()
    elements = [Paragraph("CAMPUS-NEXUS · NBA / NAAC Outcome Evidence", styles["Title"]), Spacer(1, 12), Paragraph(f"Tenant: {user.tenant_id} · Generated from current question-level assessment records.", styles["BodyText"]), Spacer(1, 12)]
    rows = [["Course", "Outcome", "Attainment", "Evidence questions", "Students assessed"]]
    for course in outcomes:
        for co in course["course_outcomes"]:
            rows.append([f'{course["course_code"]} · {course["course_title"]}', co["code"], f'{co["attainment"]}%', co["evidence_questions"], course["students_assessed"]])
    table = Table(rows, repeatRows=1, colWidths=[300, 80, 90, 115, 105])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#173e32")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#dbe3dc")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f4f7f2")]),
        ("FONTSIZE", (0, 0), (-1, -1), 8), ("PADDING", (0, 0), (-1, -1), 6),
    ]))
    elements.append(table)
    document.build(elements)
    buffer.seek(0)
    return StreamingResponse(buffer, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="campus-nexus-sar-{user.tenant_id}.pdf"'})


@router.get("/sar.docx")
def export_sar_docx(user: User = Depends(require_roles(["chancellor_dean", "professor_hod"])), db: Session = Depends(get_db)):
    from docx import Document

    outcomes = outcome_matrix(user, db)
    document = Document()
    document.add_heading("CAMPUS-NEXUS · NBA / NAAC Outcome Evidence", 0)
    document.add_paragraph(f"Tenant: {user.tenant_id}. Generated from current question-level assessment records.")
    table = document.add_table(rows=1, cols=5)
    table.style = "Light Shading Accent 1"
    for cell, heading in zip(table.rows[0].cells, ["Course", "Outcome", "Attainment", "Evidence questions", "Students assessed"]):
        cell.text = heading
    for course in outcomes:
        for co in course["course_outcomes"]:
            cells = table.add_row().cells
            values = [f'{course["course_code"]} · {course["course_title"]}', co["code"], f'{co["attainment"]}%', str(co["evidence_questions"]), str(course["students_assessed"])]
            for cell, value in zip(cells, values):
                cell.text = value
    buffer = io.BytesIO()
    document.save(buffer)
    buffer.seek(0)
    return StreamingResponse(buffer, media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document", headers={"Content-Disposition": f'attachment; filename="campus-nexus-sar-{user.tenant_id}.docx"'})
