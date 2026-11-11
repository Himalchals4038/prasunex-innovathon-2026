import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    app_name: str = "CAMPUS-NEXUS"
    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./campus_nexus.db")
    redis_url: str = os.getenv("REDIS_URL", "")
    jwt_secret: str = os.getenv("JWT_SECRET", "campus-nexus-dev-secret-key-change-in-prod-2026")
    jwt_algorithm: str = "HS256"
    jwt_exp_minutes: int = 60 * 24
    upload_dir: str = os.getenv("UPLOAD_DIR", "./uploads")
    ml_dir: str = os.getenv("ML_DIR", "../ml/artifacts")


settings = Settings()

TIER_CONFIG = {
    "core": {
        "name": "Core",
        "price_per_student_yr": 0.0,
        "max_students": 500,
        "features": {
            "grading_sandbox": True,
            "attendance_forecaster": True,
            "dkt_diagnostics": False,
            "nba_naac": False,
            "peer_matcher": True,
            "vision_triage": False,
            "zk_grievance": False,
            "recruiter_marketplace": False,
        },
    },
    "cognitive": {
        "name": "Cognitive",
        "price_per_student_yr": 2.50,
        "max_students": 10000,
        "features": {
            "grading_sandbox": True,
            "attendance_forecaster": True,
            "dkt_diagnostics": True,
            "nba_naac": True,
            "peer_matcher": True,
            "vision_triage": False,
            "zk_grievance": False,
            "recruiter_marketplace": True,
        },
    },
    "autonomous_enterprise": {
        "name": "Autonomous Enterprise",
        "price_per_student_yr": 4.00,
        "max_students": 100000,
        "features": {
            "grading_sandbox": True,
            "attendance_forecaster": True,
            "dkt_diagnostics": True,
            "nba_naac": True,
            "peer_matcher": True,
            "vision_triage": True,
            "zk_grievance": True,
            "recruiter_marketplace": True,
        },
    },
}
