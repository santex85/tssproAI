# tssproAI (ИИ-Тренер) MVP

Cross-platform AI sports coach: nutrition from plate photos (Gemini), Intervals.icu (wellness, events), manual and FIT workouts, and an AI orchestrator that suggests Go/Modify/Skip for daily training. State and load (CTL/ATL/TSB) are based on Intervals/wellness and local workouts; Strava is no longer used.

## Structure

- **backend/** — FastAPI, PostgreSQL, Gemini (nutrition + orchestrator), Intervals.icu client, sync job, chat API
- **frontend/** — Expo (React Native): dashboard, camera FAB, AI coach chat

## Quick start

### Run with Docker (recommended)

1. Copy env and set secrets:
   ```bash
   cp .env.example .env
   # Edit .env: set POSTGRES_PASSWORD, GOOGLE_GEMINI_API_KEY (and optionally ENCRYPTION_KEY, SECRET_KEY)
   ```
2. Build and start:
   ```bash
   make build
   make up
   make migrate
   ```
3. Open http://localhost (frontend). API is at http://localhost/api/v1/ (proxied via nginx).
4. Optional: create a user in the DB (see backend/README.md) so the app has a user for nutrition and chat.
5. **Production:** When deploying behind HTTPS, set `ENABLE_HSTS=true` in `.env` so the API adds the `Strict-Transport-Security` header (see [docs/DEPLOY.md](docs/DEPLOY.md)).

Make targets: `make build`, `make up`, `make down`, `make logs`, `make migrate`, `make shell-backend`, `make ps`, `make logs-backend`, `make logs-frontend`, `make logs-db`.

### Production deploy

Copy `deploy.env.example` to `deploy.env`, set `DEPLOY_HOST` and `DEPLOY_TARGET=prod`, then run `make deploy`. See [docs/DEPLOY.md](docs/DEPLOY.md): Phase 0 (server analysis and cleanup), then git clone, `.env` from `.env.production.example`, Caddy HTTPS.

### Backend (local)

```bash
cd backend
cp .env.example .env   # set DATABASE_URL, GOOGLE_GEMINI_API_KEY
pip install -r requirements.txt   # or uv sync
alembic upgrade head
# Create a user (see backend/README.md)
uvicorn app.main:app --reload
```

### Frontend (local)

```bash
cd frontend
npm install
# Set EXPO_PUBLIC_API_URL in .env (e.g. http://localhost:8000)
npx expo start
```

## API overview

- `POST /api/v1/nutrition/analyze` — upload meal photo → Gemini → JSON (name, calories, macros), saved to `food_log`
- `POST /api/v1/intervals/link` — store Intervals.icu athlete_id + API key (encrypted)
- `GET /api/v1/intervals/events`, `GET /api/v1/intervals/activities` — planned events and activities from Intervals
- `GET /api/v1/wellness`, `PUT /api/v1/wellness` — wellness (sleep, RHR, HRV) and optional CTL/ATL/TSB
- `GET /api/v1/workouts`, `POST /api/v1/workouts`, `PATCH /api/v1/workouts/{id}`, `DELETE /api/v1/workouts/{id}` — manual and FIT workouts
- `GET /api/v1/workouts/fitness` — CTL/ATL/TSB computed from workouts
- `POST /api/v1/workouts/upload-fit` — upload a .fit file (dedupe by checksum)
- `GET /api/v1/chat/history`, `POST /api/v1/chat/send` — chat with AI coach
- `POST /api/v1/chat/orchestrator/run` — run daily decision (Go/Modify/Skip) from wellness + workouts + Intervals events

## Web (production)

- **robots.txt** and **favicon**: in `frontend/public/` (robots.txt, favicon.svg). For Expo web build, copy these to the served root if your setup does not use a public folder.
- **Gzip**: Caddy and nginx enable gzip by default for static assets. For a custom server, enable gzip for `application/javascript` and text MIME types to reduce JS bundle transfer size.

## Roadmap (done in this repo)

- Sprint 1: Backend + Gemini nutrition
- Sprint 2: Intervals.icu client, sync, wellness cache
- Sprint 3: AI Orchestrator (3-level hierarchy, structured output)
- Sprint 4: Frontend (dashboard, camera, chat)
