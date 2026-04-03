# Git History Teller — Backend

Express + TypeScript REST API that powers the Git History Teller. It fetches GitHub commit history, runs AI-driven analysis, persists results to PostgreSQL, serves commit heatmap data derived from stored summaries, and answers natural-language questions about any analyzed repository.

---

## Tech Stack

| Layer       | Technology                         |
| ----------- | ---------------------------------- |
| Runtime     | Node.js 18+                        |
| Language    | TypeScript 5                       |
| Framework   | Express 5                          |
| Database    | PostgreSQL + Prisma ORM v5         |
| AI (cloud)  | Google Gemini (`gemini-2.5-flash`) |
| AI (local)  | Ollama (any local model)           |
| GitHub Data | GitHub REST API v3                 |

---

## Project Structure

```
backend/
├── prisma/
│   └── schema.prisma          # Prisma schema (Analysis model)
├── src/
│   ├── index.ts               # Express app entry point
│   ├── db/
│   │   ├── client.ts          # Prisma singleton + connection test
│   │   └── queries.ts         # All DB operations (get, save, list, delete)
│   ├── middleware/
│   │   └── errorHandler.ts    # Global Express error handler
│   ├── routes/
│   │   ├── analyze.ts         # Analysis, history, heatmap route handlers
│   │   └── qa.ts              # Natural Language Q&A route handler
│   ├── services/
│   │   ├── commitAnalyzer.ts  # Processes raw commits into structured data
│   │   ├── commitFetcher.ts   # Fetches commits from GitHub API
│   │   ├── githubClient.ts    # Axios instance + rate limit helpers
│   │   ├── milestoneDetector.ts
│   │   ├── phaseDetector.ts
│   │   ├── repoFetcher.ts     # Fetches repo meta + contributors + tags
│   │   └── llm/
│   │       ├── index.ts       # LLM provider router
│   │       ├── prompt.ts      # Prompt builder for narrative generation
│   │       └── adapters/
│   │           ├── gemini.ts  # Google Gemini adapter
│   │           └── ollama.ts  # Ollama adapter
│   ├── types/
│   │   └── index.ts           # All shared TypeScript interfaces
│   └── utils/
│       ├── botFilter.ts
│       ├── cache.ts
│       ├── stalenessChecker.ts  # Compares current vs stored commit count
│       └── urlParser.ts
├── .env                       # Environment variables (not committed)
├── nodemon.json
├── package.json
└── tsconfig.json
```

---

## Prerequisites

- **Node.js** 18 or higher
- **PostgreSQL** 14 or higher (running locally or remote)
- **GitHub Personal Access Token** — [create one here](https://github.com/settings/tokens) with `public_repo` scope
- **Google Gemini API Key** — [get one here](https://aistudio.google.com/app/apikey) _(or use Ollama locally)_
- **Ollama** _(optional)_ — for fully local AI inference

---

## Setup

### 1. Install dependencies

```bash
cd backend
npm install
```

### 2. Configure environment variables

Create a `.env` file in the `backend/` directory:

```env
# Server
PORT=4000
FRONTEND_URL=http://localhost:5173

# GitHub
GITHUB_TOKEN=ghp_your_token_here

# AI Provider — choose "gemini" or "ollama"
LLM_PROVIDER=gemini
GEMINI_API_KEY=your_gemini_api_key_here

# Ollama (only needed when LLM_PROVIDER=ollama)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1

# Database
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/gitstory"

# Analysis settings
STALE_THRESHOLD_COMMITS=1
MAX_COMMITS_TO_FETCH=1000
MAX_DETAILED_COMMITS=50
MIN_COMMITS_REQUIRED=10
CACHE_TTL_SECONDS=3600
```

> **STALE_THRESHOLD_COMMITS** — number of new commits required to mark an analysis as stale. Set to `1` to flag any new commit.

### 3. Create the database

```bash
psql -U postgres -c "CREATE DATABASE gitstory;"
```

### 4. Run Prisma migration

```bash
npx prisma migrate dev --name init
```

This creates the `analyses` table in your database.

### 5. Start the development server

```bash
npm run dev
```

The API will be available at `http://localhost:4000`.

---

## API Reference

All routes are prefixed with `/api`.

### `POST /api/analyze`

Analyze a GitHub repository. Returns a cached result from the database if one exists; otherwise runs the full analysis pipeline and saves to DB.

**Request body:**

```json
{ "repoUrl": "https://github.com/owner/repo" }
```

**Response:**

```json
{
  "success": true,
  "repoMeta": { ... },
  "summary": { ... },
  "narrative": { ... },
  "analyzedAt": "2026-03-10T12:00:00.000Z",
  "fromCache": false,
  "staleness": { "isStale": false, "newCommitsSince": 0, ... },
  "analysisVersion": "1.0.0"
}
```

### `POST /api/analyze/refresh`

Force a fresh analysis, discarding the cached database record.

**Request body:**

```json
{ "repoUrl": "https://github.com/owner/repo" }
```

### `GET /api/history`

Returns a list of all previously analyzed repositories.

### `GET /api/heatmap/:owner/:repo`

Returns a 52-week × 7-day commit activity grid derived entirely from the stored analysis data (no GitHub API call).

**Response:**

```json
{
  "success": true,
  "year": 2025,
  "owner": "expressjs",
  "repo": "express",
  "weeks": [
    {
      "days": [
        { "date": "2024-12-29", "count": 0, "level": 0 },
        ...
      ]
    },
    ...
  ],
  "stats": {
    "totalCommits": 312,
    "activeDays": 89,
    "longestStreak": 14,
    "currentStreak": 3,
    "mostActiveDay": "2025-07-14",
    "mostActiveDayCount": 12,
    "mostActiveDayOfWeek": "Wednesday",
    "averageCommitsPerActiveDay": 3.5
  }
}
```

**Level thresholds** are calculated dynamically based on the maximum single-day commit count:

| Level | Condition              |
| ----- | ---------------------- |
| 0     | 0 commits              |
| 1     | > 0 and ≤ 25% of max   |
| 2     | > 25% and ≤ 50% of max |
| 3     | > 50% and ≤ 75% of max |
| 4     | > 75% of max           |

Returns `404` if the repository has not been analyzed yet.

### `POST /api/qa`

Answer a natural-language question about a repository using its stored analysis as context. The LLM is explicitly instructed not to invent information beyond what the stored data contains.

**Request body:**

```json
{
  "owner": "expressjs",
  "repo": "express",
  "question": "Who are the most active contributors?",
  "history": [
    { "role": "user", "content": "...", "timestamp": "..." },
    { "role": "assistant", "content": "...", "timestamp": "..." }
  ]
}
```

- `question` must be a non-empty string, 500 characters or fewer
- `history` is an optional array of previous messages (last 5 are sent to the LLM as context)

**Response:**

```json
{
  "success": true,
  "answer": "The most active contributor is ...",
  "timestamp": "2026-03-12T10:00:00.000Z"
}
```

Returns `404` if the repository has not been analyzed, `400` for invalid input.

### `GET /api/status`

Returns the current GitHub API rate limit status.

### `GET /api/health`

Simple health check — returns `200 OK`.

---

## Scripts

| Command         | Description                       |
| --------------- | --------------------------------- |
| `npm run dev`   | Start with hot-reload via nodemon |
| `npm run build` | Compile TypeScript to `dist/`     |
| `npm start`     | Run compiled production build     |

---

## Database Schema

```prisma
model Analysis {
  id          Int      @id @default(autoincrement())
  owner       String
  repo        String
  fullName    String
  analyzedAt  DateTime @default(now())
  commitCount Int
  repoMeta    Json
  summary     Json
  narrative   Json

  @@unique([owner, repo])
  @@map("analyses")
}
```

Each `owner + repo` combination is unique. Running a fresh analysis upserts the record.

---

## Analysis Pipeline

```
GitHub API
  └── fetchRepoMeta + fetchContributors + fetchTags   (parallel)
  └── fetchAllCommitMetadata  (up to MAX_COMMITS_TO_FETCH)
        └── selectSignificantCommits
        └── fetchCommitDetails  (up to MAX_DETAILED_COMMITS)

Local Processing
  └── processCommits → ProcessedCommit[]
  └── normalizeContributors
  └── detectPhases
  └── detectMilestones
  └── calculateOverallQuality
  └── getTypeBreakdown

LLM (Gemini or Ollama)
  └── buildPrompt(summary)
  └── generateNarrative → GeneratedNarrative

PostgreSQL
  └── saveAnalysis (upsert)
```

---

## Staleness Detection

After returning a cached result, the backend calls `checkStaleness()` which:

1. Hits `GET /repos/{owner}/{repo}/commits?per_page=1`
2. Reads the `Link` header to extract the total commit count
3. Compares against the stored `commitCount`
4. Sets `staleness.isStale = true` if the difference ≥ `STALE_THRESHOLD_COMMITS`

The frontend's **FreshnessBanner** reads this and prompts the user to re-analyze.

---

## LLM Providers

### Google Gemini (default)

Set `LLM_PROVIDER=gemini` and provide `GEMINI_API_KEY`. Uses `gemini-2.5-flash`.

### Ollama (local, fully offline)

1. Install [Ollama](https://ollama.ai)
2. Pull a model: `ollama pull llama3.1`
3. Set in `.env`:
   ```env
   LLM_PROVIDER=ollama
   OLLAMA_BASE_URL=http://localhost:11434
   OLLAMA_MODEL=llama3.1
   ```

Both the narrative generation pipeline and the Q&A endpoint use the same provider, controlled by `LLM_PROVIDER`.

---

## Tech Stack

| Layer       | Technology                         |
| ----------- | ---------------------------------- |
| Runtime     | Node.js 18+                        |
| Language    | TypeScript 5                       |
| Framework   | Express 5                          |
| Database    | PostgreSQL + Prisma ORM v5         |
| AI (cloud)  | Google Gemini (`gemini-2.0-flash`) |
| AI (local)  | Ollama (any local model)           |
| GitHub Data | GitHub REST API v3                 |

---

## Project Structure

```
backend/
├── prisma/
│   └── schema.prisma          # Prisma schema (Analysis model)
├── src/
│   ├── index.ts               # Express app entry point
│   ├── db/
│   │   ├── client.ts          # Prisma singleton + connection test
│   │   └── queries.ts         # All DB operations (get, save, list, delete)
│   ├── middleware/
│   │   └── errorHandler.ts    # Global Express error handler
│   ├── routes/
│   │   └── analyze.ts         # All API route handlers
│   ├── services/
│   │   ├── commitAnalyzer.ts  # Processes raw commits into structured data
│   │   ├── commitFetcher.ts   # Fetches commits from GitHub API
│   │   ├── githubClient.ts    # Axios instance + rate limit helpers
│   │   ├── milestoneDetector.ts
│   │   ├── phaseDetector.ts
│   │   ├── repoFetcher.ts     # Fetches repo meta + contributors + tags
│   │   └── llm/
│   │       ├── index.ts       # LLM provider router
│   │       ├── prompt.ts      # Prompt templates
│   │       └── adapters/
│   │           ├── gemini.ts
│   │           └── ollama.ts
│   ├── types/
│   │   └── index.ts           # All shared TypeScript interfaces
│   └── utils/
│       ├── botFilter.ts
│       ├── cache.ts
│       ├── stalenessChecker.ts  # Compares current vs stored commit count
│       └── urlParser.ts
├── .env                       # Environment variables (not committed)
├── nodemon.json
├── package.json
└── tsconfig.json
```

---

## Prerequisites

- **Node.js** 18 or higher
- **PostgreSQL** 14 or higher (running locally or remote)
- **GitHub Personal Access Token** — [create one here](https://github.com/settings/tokens) with `public_repo` scope
- **Google Gemini API Key** — [get one here](https://aistudio.google.com/app/apikey) _(or use Ollama locally)_
- **Ollama** _(optional)_ — for fully local AI inference

---

## Setup

### 1. Install dependencies

```bash
cd backend
npm install
```

### 2. Configure environment variables

Create a `.env` file in the `backend/` directory:

```env
# Server
PORT=4000
FRONTEND_URL=http://localhost:5173

# GitHub
GITHUB_TOKEN=ghp_your_token_here

# AI Provider — choose "gemini" or "ollama"
LLM_PROVIDER=gemini
GEMINI_API_KEY=your_gemini_api_key_here

# Ollama (only needed when LLM_PROVIDER=ollama)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1

# Database
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/gitstory"

# Analysis settings
STALE_THRESHOLD_COMMITS=1
MAX_COMMITS_TO_FETCH=1000
MAX_DETAILED_COMMITS=50
MIN_COMMITS_REQUIRED=10
CACHE_TTL_SECONDS=3600
```

> **STALE_THRESHOLD_COMMITS** — number of new commits required to mark an analysis as stale. Set to `1` to flag any new commit.

### 3. Create the database

```bash
# Connect to PostgreSQL and create the database
psql -U postgres -c "CREATE DATABASE gitstory;"
```

### 4. Run Prisma migration

```bash
npx prisma migrate dev --name init
```

This creates the `analyses` table in your database.

### 5. Start the development server

```bash
npm run dev
```

The API will be available at `http://localhost:4000`.

---

## API Reference

All routes are prefixed with `/api`.

### `POST /api/analyze`

Analyze a GitHub repository. Returns a cached result from the database if one exists; otherwise runs the full analysis pipeline and saves to DB.

**Request body:**

```json
{ "repoUrl": "https://github.com/owner/repo" }
```

**Response:**

```json
{
  "success": true,
  "repoMeta": { ... },
  "summary": { ... },
  "narrative": { ... },
  "analyzedAt": "2026-03-10T12:00:00.000Z",
  "fromCache": false,
  "staleness": {
    "isStale": false,
    "newCommitsSince": 0,
    "lastAnalyzedAt": "2026-03-10T12:00:00.000Z",
    "storedCommitCount": 142,
    "currentCommitCount": 142
  },
  "analysisVersion": "2.0"
}
```

### `POST /api/analyze/refresh`

Force a fresh analysis, discarding the cached database record.

**Request body:**

```json
{ "repoUrl": "https://github.com/owner/repo" }
```

### `GET /api/history`

Returns a list of all previously analyzed repositories.

**Response:**

```json
[
  {
    "owner": "facebook",
    "repo": "react",
    "fullName": "facebook/react",
    "analyzedAt": "2026-03-10T12:00:00.000Z",
    "commitCount": 18000,
    "language": "JavaScript",
    "description": "...",
    "stars": 230000
  }
]
```

### `GET /api/status`

Returns the current GitHub API rate limit status.

### `GET /api/health`

Simple health check — returns `200 OK`.

---

## Scripts

| Command         | Description                       |
| --------------- | --------------------------------- |
| `npm run dev`   | Start with hot-reload via nodemon |
| `npm run build` | Compile TypeScript to `dist/`     |
| `npm start`     | Run compiled production build     |

---

## Database Schema

```prisma
model Analysis {
  id          Int      @id @default(autoincrement())
  owner       String
  repo        String
  fullName    String
  analyzedAt  DateTime @default(now())
  commitCount Int
  repoMeta    Json
  summary     Json
  narrative   Json

  @@unique([owner, repo])
  @@map("analyses")
}
```

Each `owner + repo` combination is unique. Running a fresh analysis upserts the record.

---

## Staleness Detection

After returning a cached result, the backend calls `checkStaleness()` which:

1. Hits `GET /repos/{owner}/{repo}/commits?per_page=1`
2. Reads the `Link` header to extract the total commit count (last page number)
3. Compares against the stored `commitCount`
4. Sets `staleness.isStale = true` if the difference ≥ `STALE_THRESHOLD_COMMITS`

The frontend's `FreshnessBanner` reads this and prompts the user to re-analyze.

---

## LLM Providers

### Google Gemini (default)

Set `LLM_PROVIDER=gemini` and provide your `GEMINI_API_KEY`. Uses `gemini-2.0-flash` model.

### Ollama (local, fully offline)

1. Install [Ollama](https://ollama.ai)
2. Pull a model: `ollama pull llama3.1`
3. Set in `.env`:
   ```env
   LLM_PROVIDER=ollama
   OLLAMA_BASE_URL=http://localhost:11434
   OLLAMA_MODEL=llama3.1
   ```
