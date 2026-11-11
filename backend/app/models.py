from datetime import datetime, timezone
from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from .database import Base


def utcnow():
    return datetime.now(timezone.utc)


class College(Base):
    __tablename__ = "colleges"

    id = Column(String(64), primary_key=True)
    name = Column(String(200), nullable=False)
    code = Column(String(32), unique=True, nullable=False)
    tier = Column(String(40), nullable=False, default="core")
    student_count = Column(Integer, nullable=False, default=100)
    rsa_n = Column(Text, nullable=True)
    rsa_e = Column(Text, nullable=True)
    rsa_d = Column(Text, nullable=True)
    icc_rsa_n = Column(Text, nullable=True)
    icc_rsa_e = Column(Text, nullable=True)
    icc_rsa_d = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)


class User(Base):
    __tablename__ = "users"

    id = Column(String(64), primary_key=True)
    tenant_id = Column(String(64), ForeignKey("colleges.id"), nullable=False, index=True)
    email = Column(String(200), nullable=False, index=True)
    hashed_password = Column(String(256), nullable=False)
    full_name = Column(String(160), nullable=False)
    role = Column(String(40), nullable=False)  # chancellor_dean, professor_hod, student, technician_warden, recruiter
    department = Column(String(80), nullable=False, default="CSE")
    semester = Column(Integer, nullable=False, default=5)
    cgpa = Column(Float, nullable=False, default=8.0)
    karma_points = Column(Integer, nullable=False, default=0)
    opt_in_recruiter = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)


class Course(Base):
    __tablename__ = "courses"

    id = Column(String(64), primary_key=True)
    tenant_id = Column(String(64), ForeignKey("colleges.id"), nullable=False, index=True)
    code = Column(String(32), nullable=False)
    title = Column(String(200), nullable=False)
    credits = Column(Integer, nullable=False, default=4)
    department = Column(String(80), nullable=False, default="CSE")
    semester = Column(Integer, nullable=False, default=5)
    professor_id = Column(String(64), ForeignKey("users.id"), nullable=True)
    co_po_config_json = Column(Text, nullable=False, default="{}")


class ConceptNode(Base):
    __tablename__ = "concept_nodes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(String(64), ForeignKey("colleges.id"), nullable=False, index=True)
    course_id = Column(String(64), ForeignKey("courses.id"), nullable=False, index=True)
    concept_code = Column(String(40), nullable=False)
    name = Column(String(160), nullable=False)
    prereq_codes_json = Column(Text, nullable=False, default="[]")


class AssessmentQuestion(Base):
    __tablename__ = "assessment_questions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(String(64), ForeignKey("colleges.id"), nullable=False, index=True)
    course_id = Column(String(64), ForeignKey("courses.id"), nullable=False, index=True)
    q_code = Column(String(32), nullable=False)
    prompt = Column(Text, nullable=False)
    options_json = Column(Text, nullable=False, default="[]")
    correct_idx = Column(Integer, nullable=False, default=0)
    concept_code = Column(String(40), nullable=False)
    co_code = Column(String(16), nullable=False, default="CO1")
    bloom_level = Column(String(16), nullable=False, default="L2")
    po_codes_json = Column(Text, nullable=False, default='["PO1","PO2"]')
    max_marks = Column(Float, nullable=False, default=10.0)


class MarkRecord(Base):
    __tablename__ = "mark_records"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(String(64), ForeignKey("colleges.id"), nullable=False, index=True)
    course_id = Column(String(64), ForeignKey("courses.id"), nullable=False, index=True)
    student_id = Column(String(64), ForeignKey("users.id"), nullable=False, index=True)
    question_scores_json = Column(Text, nullable=False, default="{}")
    total_score = Column(Float, nullable=False, default=0.0)
    z_score = Column(Float, nullable=False, default=0.0)
    letter_grade = Column(String(8), nullable=False, default="B")
    created_at = Column(DateTime(timezone=True), default=utcnow)


class KnowledgeState(Base):
    __tablename__ = "knowledge_states"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(String(64), ForeignKey("colleges.id"), nullable=False, index=True)
    student_id = Column(String(64), ForeignKey("users.id"), nullable=False, index=True)
    course_id = Column(String(64), ForeignKey("courses.id"), nullable=False, index=True)
    concept_code = Column(String(40), nullable=False)
    bkt_mastery = Column(Float, nullable=False, default=0.5)
    dkt_mastery = Column(Float, nullable=False, default=0.5)
    attempts = Column(Integer, nullable=False, default=0)
    correct_count = Column(Integer, nullable=False, default=0)
    updated_at = Column(DateTime(timezone=True), default=utcnow)


class AttendanceRecord(Base):
    __tablename__ = "attendance_records"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(String(64), ForeignKey("colleges.id"), nullable=False, index=True)
    student_id = Column(String(64), ForeignKey("users.id"), nullable=False, index=True)
    course_id = Column(String(64), ForeignKey("courses.id"), nullable=False, index=True)
    attended_classes = Column(Integer, nullable=False, default=0)
    total_classes = Column(Integer, nullable=False, default=0)
    remaining_classes = Column(Integer, nullable=False, default=15)
    updated_at = Column(DateTime(timezone=True), default=utcnow)


class MaintenanceTicket(Base):
    __tablename__ = "maintenance_tickets"

    id = Column(String(64), primary_key=True)
    tenant_id = Column(String(64), ForeignKey("colleges.id"), nullable=False, index=True)
    reporter_id = Column(String(64), ForeignKey("users.id"), nullable=False)
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=False)
    location = Column(String(160), nullable=False, default="Main Lab Block")
    photo_path = Column(String(300), nullable=True)
    vision_category = Column(String(64), nullable=False, default="general")
    vision_confidence = Column(Float, nullable=False, default=0.0)
    embedding_json = Column(Text, nullable=False, default="[]")
    merged_into_id = Column(String(64), nullable=True)
    merged_count = Column(Integer, nullable=False, default=1)
    assigned_to_id = Column(String(64), ForeignKey("users.id"), nullable=True)
    priority = Column(String(24), nullable=False, default="Medium")
    status = Column(String(32), nullable=False, default="Open")
    sla_deadline = Column(DateTime(timezone=True), nullable=False)
    resolution_notes = Column(Text, nullable=True)
    resolution_photo = Column(String(300), nullable=True)
    audit_ledger_json = Column(Text, nullable=False, default="[]")
    created_at = Column(DateTime(timezone=True), default=utcnow)


class ZKReport(Base):
    __tablename__ = "zk_reports"

    id = Column(String(64), primary_key=True)
    tenant_id = Column(String(64), ForeignKey("colleges.id"), nullable=False, index=True)
    tracking_code = Column(String(32), unique=True, nullable=False)
    category = Column(String(64), nullable=False)
    encrypted_body = Column(Text, nullable=False)
    key_share_dean = Column(Text, nullable=False)
    key_share_icc = Column(Text, nullable=False)
    status = Column(String(32), nullable=False, default="Submitted")
    thread_json = Column(Text, nullable=False, default="[]")
    created_at = Column(DateTime(timezone=True), default=utcnow)


class ZKTokenNonce(Base):
    __tablename__ = "zk_token_nonces"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(String(64), ForeignKey("colleges.id"), nullable=False, index=True)
    token_hash = Column(String(128), unique=True, nullable=False)
    used_at = Column(DateTime(timezone=True), default=utcnow)


class StudyMatch(Base):
    __tablename__ = "study_matches"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(String(64), ForeignKey("colleges.id"), nullable=False, index=True)
    course_id = Column(String(64), ForeignKey("courses.id"), nullable=False)
    concept_code = Column(String(40), nullable=False)
    tutor_id = Column(String(64), ForeignKey("users.id"), nullable=False)
    learner_id = Column(String(64), ForeignKey("users.id"), nullable=False)
    score = Column(Float, nullable=False, default=0.0)
    status = Column(String(24), nullable=False, default="Active")
    created_at = Column(DateTime(timezone=True), default=utcnow)


class HackathonEvent(Base):
    __tablename__ = "hackathon_events"

    id = Column(String(64), primary_key=True)
    tenant_id = Column(String(64), ForeignKey("colleges.id"), nullable=False, index=True)
    title = Column(String(200), nullable=False)
    organizer = Column(String(120), nullable=False)
    deadline = Column(String(32), nullable=False)
    source = Column(String(40), nullable=False, default="Seeded")
    tags_json = Column(Text, nullable=False, default="[]")
    teams_json = Column(Text, nullable=False, default="[]")


class RecruiterInvite(Base):
    __tablename__ = "recruiter_invites"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tenant_id = Column(String(64), ForeignKey("colleges.id"), nullable=False, index=True)
    recruiter_id = Column(String(64), ForeignKey("users.id"), nullable=False)
    student_id = Column(String(64), ForeignKey("users.id"), nullable=False)
    role_title = Column(String(160), nullable=False)
    ctc_lpa = Column(Float, nullable=False, default=12.0)
    message = Column(Text, nullable=False)
    status = Column(String(24), nullable=False, default="Sent")
    created_at = Column(DateTime(timezone=True), default=utcnow)
