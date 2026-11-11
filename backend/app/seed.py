import json
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from .database import SessionLocal
from .models import (
    AssessmentQuestion,
    AttendanceRecord,
    College,
    ConceptNode,
    Course,
    HackathonEvent,
    KnowledgeState,
    MaintenanceTicket,
    MarkRecord,
    User,
)
from .security import hash_password

COLLEGES = [
    ("northstar", "Northstar Institute of Technology", "NITX", "autonomous_enterprise", 120),
    ("riverbend", "Riverbend College of Engineering", "RBCE", "cognitive", 80),
]
COURSE_CATALOG = [
    ("CS301", "Data Structures & Algorithms", "CSE"),
    ("CS302", "Database Systems", "CSE"),
    ("CS303", "Computer Networks", "CSE"),
    ("CS304", "Machine Learning", "CSE"),
    ("EC301", "Digital Signal Processing", "ECE"),
    ("EC302", "Embedded Systems", "ECE"),
    ("ME301", "Thermodynamics", "ME"),
    ("ME302", "Manufacturing Processes", "ME"),
    ("IT301", "Web Application Engineering", "IT"),
    ("IT302", "Information Security", "IT"),
]


def seed_database(db: Session | None = None):
    own_session = db is None
    db = db or SessionLocal()
    try:
        if db.query(College).first():
            demo_profiles = {
                "admin@nitx.demo": "Campus Administrator",
                "professor@nitx.demo": "Professor Demo",
                "technician@nitx.demo": "Facilities Technician",
                "recruiter@nitx.demo": "Recruiter Demo",
                "student001@nitx.demo": "Student Demo",
            }
            for email, display_name in demo_profiles.items():
                profile = db.query(User).filter(User.email == email).first()
                if profile:
                    profile.full_name = display_name
            db.commit()
            return

        colleges = []
        for college_id, name, code, tier, count in COLLEGES:
            college = College(id=college_id, name=name, code=code, tier=tier, student_count=count)
            db.add(college)
            colleges.append((college, count))
        db.flush()

        for college, student_count in colleges:
            college_users = []
            demo_roles = [
                ("admin", "admin", "Campus Administrator", "chancellor_dean"),
                ("professor", "professor", "Professor Demo", "professor_hod"),
                ("technician", "technician", "Facilities Technician", "technician_warden"),
                ("recruiter", "recruiter", "Recruiter Demo", "recruiter"),
            ]
            for local_id, (username, password, full_name, role) in enumerate(demo_roles, start=1):
                user = User(
                    id=f"{college.id}-{username}", tenant_id=college.id,
                    email=f"{username}@{college.code.lower()}.demo",
                    hashed_password=hash_password(password), full_name=full_name,
                    role=role, department="CSE", semester=5, cgpa=8.2,
                )
                db.add(user)
                college_users.append(user)

            student_count = min(student_count, 120)
            for index in range(student_count):
                first_names = ["Aarav", "Isha", "Kabir", "Meera", "Rehan", "Anika", "Dev", "Sana", "Arjun", "Tara"]
                last_names = ["Sharma", "Kapoor", "Nair", "Shah", "Das", "Reddy", "Patel", "Khan", "Iyer", "Joshi"]
                department = ["CSE", "ECE", "ME", "IT"][(index // 3) % 4]
                student = User(
                    id=f"{college.id}-student-{index+1:03d}", tenant_id=college.id,
                    email=f"student{index+1:03d}@{college.code.lower()}.demo",
                    hashed_password=hash_password("student123"),
                    full_name="Student Demo" if college.code == "NITX" and index == 0 else f"{first_names[index % 10]} {last_names[(index * 3) % 10]}",
                    role="student", department=department, semester=5,
                    cgpa=round(6.1 + ((index * 17) % 39) / 10, 2),
                    karma_points=(index * 13) % 120,
                )
                db.add(student)
                college_users.append(student)

            db.flush()
            students = [u for u in college_users if u.role == "student"]
            for index, (code, title, dept) in enumerate(COURSE_CATALOG):
                course = Course(
                    id=f"{college.id}-{code.lower()}", tenant_id=college.id,
                    code=code, title=title, department=dept, semester=5,
                    professor_id=f"{college.id}-professor",
                    co_po_config_json=json.dumps({"CO1": ["PO1", "PO2"], "CO2": ["PO1", "PO3"], "CO3": ["PO2", "PO4"]}),
                )
                db.add(course)
                db.flush()
                concepts = [
                    ("C1", "Core foundations", []),
                    ("C2", "Applied problem solving", ["C1"]),
                    ("C3", "System design", ["C1", "C2"]),
                ]
                for concept_code, concept_name, prereqs in concepts:
                    db.add(ConceptNode(
                        tenant_id=college.id, course_id=course.id,
                        concept_code=concept_code, name=concept_name,
                        prereq_codes_json=json.dumps(prereqs),
                    ))
                db.flush()
                for q_num in range(1, 4):
                    db.add(AssessmentQuestion(
                        tenant_id=college.id, course_id=course.id,
                        q_code=f"Q{q_num}", prompt=f"{title}: sample question {q_num}",
                        concept_code=f"C{q_num}", co_code=f"CO{q_num}",
                        bloom_level=["L2", "L3", "L4"][q_num - 1],
                        po_codes_json=json.dumps(["PO1", f"PO{q_num+1}"]), max_marks=10,
                    ))

                course_students = [s for s in students if s.department == dept][:30]
                for student_index, student in enumerate(course_students):
                    attendance_total = 24
                    attended = 14 + ((student_index * 7 + index) % 11)
                    db.add(AttendanceRecord(
                        tenant_id=college.id, student_id=student.id, course_id=course.id,
                        attended_classes=attended, total_classes=attendance_total,
                        remaining_classes=12,
                    ))
                    q_scores = {
                        f"Q{q}": float(max(0, min(10, ((student_index * 7 + q * 11 + index * 3) % 12))))
                        for q in range(1, 4)
                    }
                    total = sum(q_scores.values())
                    db.add(MarkRecord(
                        tenant_id=college.id, student_id=student.id, course_id=course.id,
                        question_scores_json=json.dumps(q_scores), total_score=total,
                    ))
                    for c_idx, (concept_code, _, _) in enumerate(concepts):
                        mastery = min(0.95, max(0.1, (q_scores[f"Q{c_idx+1}"] / 10) + 0.12))
                        db.add(KnowledgeState(
                            tenant_id=college.id, student_id=student.id, course_id=course.id,
                            concept_code=concept_code, bkt_mastery=mastery, dkt_mastery=mastery,
                            attempts=4 + student_index % 5, correct_count=round(mastery * 5),
                        ))

            db.add_all([
                MaintenanceTicket(
                    id=f"{college.id}-ticket-001", tenant_id=college.id,
                    reporter_id=f"{college.id}-student-001", title="Oscilloscope display is not powering on",
                    description="The display stays blank when connected to the bench supply.",
                    location="Electronics Lab 2", vision_category="it_hardware", vision_confidence=0.72,
                    priority="High", status="Open", sla_deadline=datetime.now(timezone.utc) + timedelta(hours=36),
                ),
                MaintenanceTicket(
                    id=f"{college.id}-ticket-002", tenant_id=college.id,
                    reporter_id=f"{college.id}-student-002", title="Water leaking near east corridor",
                    description="Water is pooling near the corridor washroom.", location="Block C, Ground floor",
                    vision_category="plumbing", vision_confidence=0.84, priority="Medium", status="In progress",
                    sla_deadline=datetime.now(timezone.utc) + timedelta(hours=16),
                ),
            ])
            for event_index, (title, organizer, deadline, tags) in enumerate([
                ("Smart India Hackathon", "Ministry of Education", "2026-12-15", ["AI", "Civic tech"]),
                ("Code for Good", "TechTogether India", "2026-12-01", ["Web", "Social impact"]),
                ("Student Research Fellowship", "Campus Research Office", "2027-01-10", ["Research", "Mentored"]),
            ], start=1):
                db.add(HackathonEvent(
                    id=f"{college.id}-event-{event_index}", tenant_id=college.id,
                    title=title, organizer=organizer, deadline=deadline,
                    tags_json=json.dumps(tags), teams_json="[]",
                ))
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        if own_session:
            db.close()
