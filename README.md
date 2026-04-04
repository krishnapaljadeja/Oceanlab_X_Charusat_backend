# OceanLab Backend

Express + TypeScript API for repository intelligence and developer onboarding. It analyzes GitHub repositories, stores user-scoped summaries in PostgreSQL via Prisma, indexes RAG chunks for QA, and serves endpoints used by the OceanLab frontend.

## Tech Stack

- Node.js + Express 5
- TypeScript
- Prisma + PostgreSQL
- Supabase Auth token verification
- Gemini and/or Ollama for generation
- Python gitingest bridge for repo digest extraction

## What This Service Does

- Repository analysis pipeline with cached storage (`/api/analyze`, `/api/analyze/refresh`)
- Historical analysis list per authenticated user (`/api/history`)
- Commit activity heatmap derived from saved analysis (`/api/heatmap/:owner/:repo`)
- Contributor deep profile generation (`/api/contributors/profile`)
- RAG-powered repository QA (`/api/qa`)
- Repo digest fetch + README generation from digest (`/api/ingest/fetch`, `/api/ingest/readme`)
- AI onboarding guide generation (`/api/onboard`)
- Health and provider status routes (`/api/health`, `/api/status`)

## Prerequisites

- Node.js 20+
- npm 10+
- PostgreSQL 14+ (pgvector extension is created by migrations)
- A Supabase project for auth tokens
- A Gemini API key (or Ollama running locally if you use Ollama provider)
- Python 3.10+ with `gitingest` installed

Install gitingest in the same Python environment used by the backend child process:

```bash
pip install gitingest
```

If needed, force a specific Python executable using `GITINGEST_PYTHON_BIN`.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` in `Backend/`:

```env
# Core runtime
PORT=4000
FRONTEND_URL=http://localhost:5173
REQUEST_BODY_LIMIT=8mb

# Database (Prisma)
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DB?schema=public
DIRECT_URL=postgresql://USER:PASSWORD@HOST:5432/DB?schema=public

# External APIs
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxx
GEMINI_API_KEY=AIzaxxxxxxxxxxxxxxxx

# Supabase auth validation
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY

# Optional: choose LLM provider/circuit behavior
LLM_PROVIDER=gemini
LLM_MAX_FAILURES=3
LLM_COOLDOWN_MS=300000
GEMINI_MODEL=gemini-flash-lite-latest
GEMINI_MAX_OUTPUT_TOKENS=2048
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1

# Optional: embeddings model fallback chain
GEMINI_EMBED_MODEL_PRIMARY=gemini-embedding-001
GEMINI_EMBED_MODEL_SECONDARY=gemini-embedding-2-preview
GEMINI_EMBED_MODEL_FALLBACK=gemini-embedding-exp-03-07

# Optional: analysis/cache tuning
MIN_COMMITS_REQUIRED=10
MAX_COMMITS_TO_FETCH=1000
MAX_DETAILED_COMMITS=50
STALE_THRESHOLD_COMMITS=5
CACHE_TTL_SECONDS=3600

# Optional: gitingest Python runtime override
GITINGEST_PYTHON_BIN=C:/Path/To/python.exe
```

3. Run Prisma migrations and generate client:

```bash
npx prisma migrate dev
npx prisma generate
```

4. Start development server:

```bash
npm run dev
```

Server starts at `http://localhost:4000` by default.

## Scripts

- `npm run dev` start with nodemon + ts-node
- `npm run build` compile TypeScript to `dist/`
- `npm run python-deps` install Python dependencies from `requirements.txt`
- `npm run build:render` install Python deps then compile TypeScript (recommended Render build command)
- `npm run start` run compiled build

## Render Deployment

Use these backend service settings so the Python bridge dependency is available at runtime:

- Build Command: `npm install && npm run build:render`
- Start Command: `npm run start`

If your Render image does not expose `python3` by default, set:

- `GITINGEST_PYTHON_BIN=python`

or point it to a specific interpreter path in environment variables.

## API Routes

All routes are mounted under `/api`.

Public routes:

- `GET /health`
- `GET /status`

Authenticated routes (require `Authorization: Bearer <supabase_access_token>`):

- `POST /analyze`
- `POST /analyze/refresh`
- `POST /analyze/preview`
- `GET /history`
- `GET /heatmap/:owner/:repo`
- `POST /contributors/profile`
- `POST /qa`
- `POST /ingest/fetch`
- `POST /ingest/readme`
- `POST /onboard`

## Notes on Auth

- Token verification is done with Supabase `auth.getUser(token)`.
- If Supabase env vars are missing, protected endpoints fail with auth configuration errors.
- Data is stored per user (`user_id`), so analyses are user-scoped.

## Troubleshooting

- Prisma schema mismatch errors: rerun `npx prisma migrate dev`, `npx prisma generate`, then restart server.
- gitingest errors on Windows: set `GITINGEST_PYTHON_BIN` to the Python interpreter that has `gitingest` installed.
- QA or narrative failures: verify `GEMINI_API_KEY`, model names, and provider settings.
- CORS issues in local dev: ensure `FRONTEND_URL` matches your frontend origin.

## Project Structure

```text
Backend/
	prisma/
		schema.prisma
		migrations/
	scripts/
		gitingest_runner.py
	src/
		db/
		middleware/
		routes/
		services/
		utils/
		index.ts
```
