# CAMPUS-NEXUS v2

From a mark to a decision. A local-first campus intelligence demo for Prasunex Innovathon 2026.

## Run locally

Requirements: Python 3.11+, Node.js 18+, npm. PostgreSQL and Redis are optional for the local demo; the API uses SQLite by default.

```sh
# Terminal 1: API
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Terminal 2: web app
cd frontend
npm install
npm run dev
```

Open http://localhost:3000. API health: http://localhost:8000/health. On first API startup, the database is created and seeded with two synthetic college tenants and 200 synthetic students.

## Judge accounts

Choose a role on the sign-in screen; credentials are prefilled for Northstar Institute (`NITX`).

| Role | Email | Password |
|---|---|---|
| Administrator | `admin@nitx.demo` | `admin` |
| Professor | `professor@nitx.demo` | `professor` |
| Student | `student001@nitx.demo` | `student123` |
| Technician | `technician@nitx.demo` | `technician` |
| Recruiter | `recruiter@nitx.demo` | `recruiter` |

The same demo identities are available for `RBCE` by replacing `nitx` in the email. These credentials and the default JWT secret are for local demonstration only.

## Docker Compose

From the project root, run `docker compose up --build`. This starts the web app, FastAPI, PostgreSQL with pgvector, and Redis. The compose database credentials are development defaults; change them before using a shared or deployed environment.

## What works in this demo

- JWT login, role checks, tenant-scoped queries, subscription tiers, and billing estimate.
- CSV mark import, relative-grade scenarios, grade export, question-quality indicators.
- BKT mastery updates, early-warning and attendance forecasts, study-plan generation and completion, mastery-priority revision queue.
- NBA/NAAC attainment exports, peer matching, opportunities, recruiter consent and invitations.
- Facilities tickets, duplicate suggestions, technician status changes, and audit history.
- Blind-signature eligibility demonstration and encrypted anonymous-report submission flow.

Predictions and generated study/revision suggestions use deterministic demo logic. They are labelled in the interface and are not trained production models. The demo grievance flow is not ready for real sensitive reporting: key custody, operational controls, external security review, and production-grade cryptographic protocols are still required. Synthetic records are not institutional data.

## Environment variables

The API reads `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `UPLOAD_DIR`, and `ML_DIR`. Defaults are suitable only for a local demo. For PostgreSQL, use a SQLAlchemy URL such as `postgresql+psycopg://campus:password@localhost:5432/campus_nexus`. The frontend uses `API_INTERNAL_URL` for its Next.js API rewrite (default `http://localhost:8000`).

## Layout

- `frontend/app`: Next.js App Router UI and styles.
- `backend/app`: FastAPI API, SQLAlchemy schema, seed data, and feature routers.
- `ml`: model inference and artifact scaffolding.
- `compose.yaml`: local multi-service stack.
