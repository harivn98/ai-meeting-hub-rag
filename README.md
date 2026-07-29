# AI Meeting Hub

A full-stack, multi-tenant SaaS platform for managing, searching, and
summarizing meeting notes across teams — with AI-generated summaries and
Q&A over transcripts powered by a **local** LLM via [Ollama](https://ollama.com)
(no external API keys, no data leaves your machine).

Status: **feature-complete scaffold**. Every item on the original roadmap is
implemented — auth, org dashboard, search/pagination, document upload,
AI summarization, transcript Q&A, analytics, role-based UI gating, and
production Docker images.

---

## Table of contents

1. [Architecture](#architecture)
2. [Prerequisites](#prerequisites)
3. [Quick start (Docker, recommended)](#quick-start-docker-recommended)
4. [Running each service manually (no Docker)](#running-each-service-manually-no-docker)
5. [Environment variables](#environment-variables)
6. [Database schema](#database-schema)
7. [API reference](#api-reference)
8. [AI service reference](#ai-service-reference)
9. [Using the app](#using-the-app)
10. [Production build & deployment](#production-build--deployment)
11. [Project structure](#project-structure)
12. [Troubleshooting](#troubleshooting)
13. [Security notes](#security-notes)

---

## Architecture

```
┌─────────────┐      HTTP/JSON       ┌─────────────┐      HTTP/JSON      ┌──────────────┐
│  apps/web   │  ───────────────►    │  apps/api   │  ──────────────►    │ apps/ai-     │
│  Next.js 14 │  ◄───────────────    │  Express+TS │  ◄──────────────    │ service      │
│  (port 3000)│                      │  (port 4000)│                     │ FastAPI      │
└─────────────┘                      └──────┬──────┘                     │ (port 8000)  │
                                             │ SQL                        └──────┬───────┘
                                             ▼                                   │ HTTP
                                      ┌─────────────┐                            ▼
                                      │  Postgres   │                     ┌─────────────┐
                                      │ + pgvector  │                     │   Ollama     │
                                      │ (port 5432) │                     │ (port 11434) │
                                      └─────────────┘                     └─────────────┘
```

| Component | Tech | Responsibility |
|---|---|---|
| `apps/web` | Next.js 14 (App Router) + TypeScript + Tailwind CSS | Auth pages, org dashboard, meeting detail, analytics, file upload UI |
| `apps/api` | Express + TypeScript | REST API: auth (JWT), orgs, meetings, documents, analytics, proxies AI calls, extracts document text |
| `apps/ai-service` | FastAPI (Python) | `/summarize`, `/ask`, and `/documents/ingest`; talks to a local Ollama model for both generation and embeddings |
| `postgres` | PostgreSQL 16 + [pgvector](https://github.com/pgvector/pgvector) | Relational schema: organizations, users, meetings, documents, participants, plus `document_chunks` for embeddings |
| `packages/shared-types` | TypeScript | Shared interfaces used by `web` (conceptually; each app currently keeps its own copy for zero cross-package build coupling) |
| Ollama | External local process | Runs the chat model (e.g. `llama3.2`) and the embedding model (`nomic-embed-text`) that the ai-service calls |

**Why Ollama runs on the host, not in Docker:** LLM inference benefits from
direct GPU/Metal access, which is painful to pass through into a container
(especially on macOS). The `ai-service` FastAPI process also runs on the
host by default so it can reach `localhost:11434` with zero networking
config; the `api` and `web` containers reach it via
`host.docker.internal:8000`. If you'd rather containerize the ai-service too,
see the commented block in `docker-compose.yml`.

### Document Q&A (retrieval-augmented generation)

Uploading a document (txt/pdf/docx) triggers an ingestion pipeline so
questions can be answered from its contents, not just the pasted
transcript:

```
Upload document
        │
        ▼
Extract text (TXT/PDF/DOCX)         apps/api/src/utils/extractText.ts
        │
        ▼
Create embeddings                   apps/ai-service, Ollama "nomic-embed-text"
        │
        ▼
Store in pgvector                   document_chunks table
        │
        ▼
User asks a question
        │
        ▼
Retrieve relevant document chunks   cosine similarity search (pgvector <=>)
        │
        ▼
Transcript + Retrieved Chunks
        │
        ▼
FastAPI AI Service                  builds the augmented prompt
        │
        ▼
Ollama                               chat model generates the answer
```

Text extraction happens synchronously in `apps/api` right after upload (it
already has the file on disk); chunking, embedding, and storage happen in
`apps/ai-service` via `POST /documents/ingest`, called asynchronously so the
upload response isn't blocked by embedding latency. Each document's
`ingestion_status` (`pending` → `indexed`/`failed`, or `skipped` for
non-text files like audio) is visible in the UI and polled while pending.

If a meeting has no documents indexed, `/ask` falls back to answering from
the transcript alone, exactly as before.

### What each roadmap step delivers

| # | Feature | Where |
|---|---|---|
| 1 | Monorepo + Docker skeleton | root `docker-compose.yml`, all `apps/*` |
| 2 | Auth pages wired to `/api/auth` | `apps/web/app/{login,register}/page.tsx`, `apps/web/lib/auth-context.tsx` |
| 3 | Org dashboard: list, create, search, pagination | `apps/web/app/dashboard/page.tsx` |
| 4 | Document upload (multer, local disk) | `apps/api/src/middleware/upload.ts`, `POST /api/meetings/:id/documents` |
| 5 | Summarize button → `/api/meetings/:id/summarize` | `apps/web/app/dashboard/meetings/[id]/page.tsx` |
| 6 | Q&A over transcript + uploaded documents (RAG) | same page, `POST /api/meetings/:id/ask`, `apps/ai-service/app/main.py` |
| 7 | Dashboard analytics (meetings/week, top contributors) | `apps/web/app/dashboard/analytics/page.tsx`, `GET /api/meetings/analytics/summary` |
| 8 | Role-based UI gating (owner/admin/member) | Analytics link/page hidden from `member` role |
| 9 | Production Dockerfiles (multi-stage) | `apps/api/Dockerfile.prod`, `apps/web/Dockerfile.prod`, `docker-compose.prod.yml` |

---

## Prerequisites

- **Docker** ≥ 24 and **Docker Compose** v2 (`docker compose version`)
- **Node.js** ≥ 20 and npm (only needed if running services outside Docker)
- **Python** ≥ 3.11 (only needed if running the ai-service outside Docker)
- **[Ollama](https://ollama.com)** installed locally, with a chat model and
  an embedding model pulled:
  ```bash
  ollama pull llama3.2
  ollama pull nomic-embed-text
  ```
  Ollama runs its own server on `localhost:11434` — start it with:
  ```bash
  ollama serve
  ```
  (On macOS/Windows, the Ollama desktop app does this for you automatically.)

---

## Quick start (Docker, recommended)

This runs Postgres, the API, and the web app in Docker, while Ollama and the
ai-service run on your host machine (see architecture note above).

```bash
# 1. Clone / unzip the project, then from the repo root:
cd ai-meeting-hub

# 2. Start Ollama and pull the models (one-time)
ollama pull llama3.2
ollama pull nomic-embed-text
ollama serve            # leave this running in its own terminal

# 3. Set up environment files
cp apps/api/.env.example apps/api/.env
# Edit apps/api/.env and set a real JWT_SECRET (see "Environment variables" below)

# 4. Start Postgres + API + web via Docker Compose
docker compose up --build
# leave this running in its own terminal

# 5. Start the ai-service on the host (talks to Ollama, and to the Postgres
#    container above via localhost:5432 -- start it *after* step 4 so the
#    database it connects to on startup is already up)
cd apps/ai-service
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
export DATABASE_URL="postgresql://meetinghub:meetinghub_dev_password@localhost:5432/meetinghub"
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
cd ../..
```

Once everything is up:

- **Web app**: http://localhost:3000
- **API health check**: http://localhost:4000/health
- **AI service health check**: http://localhost:8000/health
- **Postgres**: `localhost:5432` (user `meetinghub`, db `meetinghub`, password `meetinghub_dev_password`)

Open http://localhost:3000, click **Sign up**, create a workspace (this
creates an `organization` and an `owner` user), and you're in.

To stop everything: `Ctrl+C` in the compose terminal, then
`docker compose down` (add `-v` to also wipe the Postgres volume).

### Rebuilding after dependency changes

```bash
docker compose up --build          # rebuilds images if package.json changed
docker compose up --build --force-recreate   # nuke and recreate containers
```

---

## Running each service manually (no Docker)

Useful for debugging one service in isolation, or if you don't want Docker
at all.

### 1. Postgres

Install Postgres 16 locally, or run just the DB container:

```bash
docker compose up postgres
```

This automatically runs `postgres/init.sql` on first boot (creates all
tables). If you're using your own Postgres instance instead, run it
manually:

```bash
psql "postgresql://<user>:<password>@localhost:5432/<db>" -f postgres/init.sql
```

### 2. API (Express)

```bash
cd apps/api
cp .env.example .env        # edit JWT_SECRET
npm install
export DATABASE_URL="postgres://meetinghub:meetinghub_dev_password@localhost:5432/meetinghub"
export AI_SERVICE_URL="http://localhost:8000"
npm run dev                 # ts-node-dev, auto-reloads on save
```

The API listens on `http://localhost:4000` (override with `PORT`).

### 3. AI service (FastAPI)

```bash
cd apps/ai-service
python3 -m venv venv
source venv/bin/activate    # Windows: venv\Scripts\activate
pip install -r requirements.txt
export OLLAMA_BASE_URL="http://localhost:11434"
export OLLAMA_MODEL="llama3.2"
export OLLAMA_EMBED_MODEL="nomic-embed-text"
export DATABASE_URL="postgresql://meetinghub:meetinghub_dev_password@localhost:5432/meetinghub"
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Interactive API docs (Swagger UI) are auto-generated at
http://localhost:8000/docs.

### 4. Web (Next.js)

```bash
cd apps/web
npm install
export NEXT_PUBLIC_API_URL="http://localhost:4000"
npm run dev
```

Visit http://localhost:3000.

---

## Environment variables

### `apps/api/.env` (copy from `.env.example`)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4000` | Port the API listens on |
| `JWT_SECRET` | *(placeholder — change this!)* | Secret used to sign/verify JWTs. Generate one with `openssl rand -base64 48` |
| `JWT_EXPIRES_IN` | `7d` | Token lifetime (any [ms](https://github.com/vercel/ms) string or seconds) |
| `DATABASE_URL` | set by `docker-compose.yml` | Postgres connection string. Only needed manually if not using Docker |
| `AI_SERVICE_URL` | set by `docker-compose.yml` (`http://host.docker.internal:8000`) | Base URL of the FastAPI ai-service |
| `UPLOAD_DIR` | `./uploads` (relative to the API process cwd) | Where uploaded meeting documents are stored on disk |
| `DOCUMENT_TEXT_MAX_CHARS` | `300000` | Caps extracted document text before it's sent to the ai-service for chunking/embedding |

### `apps/ai-service` (shell env, no `.env` file by default)

| Variable | Default | Description |
|---|---|---|
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Where Ollama's HTTP API is reachable |
| `OLLAMA_MODEL` | `llama3.2` | Model tag used for summarization/Q&A generation (must be pulled first: `ollama pull <model>`) |
| `OLLAMA_EMBED_MODEL` | `nomic-embed-text` | Embedding model used to embed document chunks and questions for retrieval (`ollama pull nomic-embed-text`) |
| `DATABASE_URL` | `postgresql://meetinghub:meetinghub_dev_password@localhost:5432/meetinghub` | Postgres connection string, used to store/query `document_chunks` (pgvector) |
| `RAG_TOP_K` | `5` | Number of document chunks retrieved per question |

### `apps/web` (build/runtime env)

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | Base URL the browser uses to call the API. **Baked in at build time** for production builds — see the [production section](#production-build--deployment) |

---

## Database schema

Defined in `postgres/init.sql`, applied automatically by the `postgres`
Docker service on first boot.

```
organizations
├── id (uuid, pk)
├── name
└── created_at

users
├── id (uuid, pk)
├── org_id (fk → organizations)
├── email (unique)
├── password_hash (bcrypt)
├── role ('owner' | 'admin' | 'member')
└── created_at

meetings
├── id (uuid, pk)
├── org_id (fk → organizations)
├── title
├── meeting_date
├── transcript_text
├── summary
├── created_by (fk → users)
└── created_at

documents
├── id (uuid, pk)
├── meeting_id (fk → meetings)
├── file_url         -- e.g. /uploads/<random-hex>.pdf, served by the API
├── file_type         -- MIME type
├── uploaded_by (fk → users)
├── ingestion_status  -- 'pending' | 'indexed' | 'failed' | 'skipped'
├── ingestion_error   -- set when ingestion_status = 'failed'
└── created_at

document_chunks        -- chunked + embedded document text, used for RAG
├── id (uuid, pk)
├── document_id (fk → documents)
├── meeting_id (fk → meetings)   -- denormalized for fast per-meeting retrieval
├── chunk_index
├── content
├── embedding (vector(768))      -- pgvector column, cosine-similarity indexed (hnsw)
└── created_at

meeting_participants   -- join table (defined for future use, not yet exposed in the UI)
├── meeting_id (fk → meetings)
└── user_id (fk → users)
```

All tenant-scoped tables filter by `org_id` (or by joining through
`meetings.org_id`) so one organization can never read another's data — every
query in `apps/api/src/routes/*.ts` includes the `org_id` from the caller's
JWT in its `WHERE` clause.

To inspect the DB directly:

```bash
docker exec -it meetinghub-postgres psql -U meetinghub -d meetinghub
```

---

## API reference

Base URL: `http://localhost:4000`. All `yes`-auth routes require
`Authorization: Bearer <token>` (the token returned from register/login).

| Method | Route | Auth | Description |
|---|---|---|---|
| GET | `/health` | no | Liveness check |
| POST | `/api/auth/register` | no | Body: `{ orgName, email, password }`. Creates an organization + `owner` user, returns `{ token, user }` |
| POST | `/api/auth/login` | no | Body: `{ email, password }`. Returns `{ token, user }` |
| GET | `/api/meetings` | yes | Query: `search`, `page`, `pageSize` (max 50). Lists meetings for the caller's org |
| POST | `/api/meetings` | yes | Body: `{ title, meetingDate?, transcriptText? }`. Creates a meeting |
| GET | `/api/meetings/:id` | yes | Fetch one meeting (must belong to caller's org) |
| POST | `/api/meetings/:id/summarize` | yes | Calls the ai-service `/summarize` endpoint with the meeting's transcript, saves and returns the updated meeting |
| POST | `/api/meetings/:id/ask` | yes | Body: `{ question }`. Calls the ai-service `/ask` endpoint against the meeting's transcript **and** any indexed documents (RAG), returns `{ answer, sources }` (not persisted). Works even with no transcript, as long as at least one document is indexed |
| POST | `/api/meetings/:id/documents` | yes | `multipart/form-data`, field `file`. Uploads a document (pdf/txt/md/docx/mp3/wav/m4a, ≤25MB), stores it on disk, returns the document record immediately with `ingestion_status: "pending"` (or `"skipped"` for audio). Text extraction + embedding continue asynchronously; poll `GET .../documents` for status |
| GET | `/api/meetings/:id/documents` | yes | Lists documents attached to a meeting, including `ingestion_status`/`ingestion_error` |
| GET | `/api/meetings/analytics/summary` | yes, `owner`/`admin` only | Returns `{ meetingsPerWeek, topContributors, totals }` for the caller's org |

Uploaded files are served back at `GET /uploads/<filename>` (static, no
auth — see security notes).

### Example: register → create meeting → summarize

```bash
# Register
curl -s -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"orgName":"Acme Inc","email":"you@acme.com","password":"supersecret1"}' | tee /tmp/auth.json

TOKEN=$(python3 -c "import json;print(json.load(open('/tmp/auth.json'))['token'])")

# Create a meeting with a transcript
curl -s -X POST http://localhost:4000/api/meetings \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Weekly sync","transcriptText":"Alice: We shipped the login page. Bob: Great, next week let'\''s tackle billing."}' \
  | tee /tmp/meeting.json

MEETING_ID=$(python3 -c "import json;print(json.load(open('/tmp/meeting.json'))['id'])")

# Generate an AI summary (requires Ollama + ai-service running)
curl -s -X POST http://localhost:4000/api/meetings/$MEETING_ID/summarize \
  -H "Authorization: Bearer $TOKEN"

# Ask a question about the transcript
curl -s -X POST http://localhost:4000/api/meetings/$MEETING_ID/ask \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"question":"What is planned for next week?"}'
```

---

## AI service reference

Base URL: `http://localhost:8000`.

| Method | Route | Body | Description |
|---|---|---|---|
| GET | `/health` | — | Returns `{ status, model, embed_model }` |
| POST | `/summarize` | `{ transcript }` | Returns `{ summary }` — structured into key points, decisions, action items |
| POST | `/ask` | `{ transcript, question, meeting_id? }` | Returns `{ answer, sources }`. When `meeting_id` is given, the question is embedded and matched against that meeting's `document_chunks` (top `RAG_TOP_K` by cosine similarity); the retrieved excerpts (`sources`) are combined with the transcript in the prompt. Without `meeting_id`, answers strictly from the transcript, same as before |
| POST | `/documents/ingest` | `{ document_id, meeting_id, text }` | Chunks `text`, embeds each chunk via Ollama's `/api/embeddings` (`OLLAMA_EMBED_MODEL`), and stores the vectors in `document_chunks`. Re-ingesting a `document_id` replaces its previous chunks. Called by `apps/api` after text extraction, not by the frontend directly |

Internally `/summarize` and `/ask` call Ollama's `/api/generate` endpoint
(`OLLAMA_BASE_URL/api/generate`) with `stream: false` and a 120s timeout;
`/documents/ingest` and the retrieval step of `/ask` call
`/api/embeddings`. If Ollama isn't running or the relevant model isn't
pulled, these return `502`.

---

## Using the app

1. **Sign up** (`/register`) — creates an organization and your `owner`
   account.
2. **Dashboard** (`/dashboard`) — search meetings, paginate, or click
   **New meeting** to create one (paste a transcript directly, or leave it
   blank and upload a file afterward).
3. **Meeting detail** (`/dashboard/meetings/:id`):
   - View the transcript.
   - Click **Generate summary** to call the AI service (requires a
     transcript and a running Ollama + ai-service).
   - Ask ad-hoc questions about the transcript in the Q&A box. Once a
     document finishes indexing (see below), answers also draw on its
     content, and the box shows which excerpts were used.
   - Upload supporting documents (pdf/txt/md/docx/audio) — they're listed
     with a direct download link and an indexing status badge
     (`Indexing…` → `Indexed for Q&A`, or `Indexing failed`/`Not indexed`
     for unsupported types like audio).
4. **Analytics** (`/dashboard/analytics`, visible to `owner`/`admin` only)
   — meetings created per week (last 12 weeks) and top contributors by
   meeting count.

### Roles

- `owner` — created automatically on registration; full access.
- `admin`, `member` — not yet creatable from the UI (no "invite teammate"
  flow exists yet); create them directly via SQL or a future admin
  endpoint if you want to test role gating:
  ```sql
  INSERT INTO users (org_id, email, password_hash, role)
  VALUES ('<org-id>', 'member@acme.com', '<bcrypt-hash>', 'member');
  ```
  The web app hides the **Analytics** link/page from `member` accounts as
  an example of role-based UI gating (step 8 of the roadmap).

---

## Production build & deployment

Multi-stage, non-root Dockerfiles are provided for `api` and `web`
(`Dockerfile.prod` in each app), separate from the dev `Dockerfile`s used by
the default `docker-compose.yml` (which bind-mount source for hot reload).

```bash
# Build and run the production images alongside Postgres:
NEXT_PUBLIC_API_URL=https://api.yourdomain.com \
  docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
```

What changes in production mode:

- **api**: TypeScript is compiled (`npm run build`) in a build stage;
  the runtime stage installs only production dependencies and runs
  `node dist/index.js` as a non-root `app` user. No source bind-mounts.
- **web**: `next build` runs in a build stage with `NEXT_PUBLIC_API_URL`
  baked in via a build `ARG` (Next.js inlines `NEXT_PUBLIC_*` vars into the
  client bundle at build time — you cannot change this by setting an env
  var on the running container). The runtime stage runs `next start` as a
  non-root user.
- Uploaded files persist in the named volume `api_uploads` regardless of
  container restarts.

Before deploying for real, also:

1. Set a strong, unique `JWT_SECRET` (`openssl rand -base64 48`) and store
   it as a secret (not committed to git — `apps/api/.env` is gitignored
   except `.env.example`).
2. Put the API and web app behind TLS (a reverse proxy like Caddy, Nginx, or
   a managed load balancer).
3. Point `DATABASE_URL` at a managed/production Postgres instance and run
   `postgres/init.sql` against it once (or adopt a migration tool —
   there isn't one wired up yet; schema changes are currently manual SQL).
4. Decide where the ai-service + Ollama run in production. Options:
   - A GPU-equipped host/VM running `ollama serve` + the FastAPI service
     directly (recommended for real LLM latency).
   - Point `OLLAMA_BASE_URL`/`AI_SERVICE_URL` at a hosted Ollama-compatible
     endpoint if you don't want to manage inference infrastructure yourself.
5. Consider moving uploaded documents from local disk to S3-compatible
   object storage for multi-instance/horizontally-scaled deployments (local
   disk + a Docker volume only works for a single API instance).

---

## Project structure

```
ai-meeting-hub/
├── apps/
│   ├── web/                     # Next.js 14 frontend
│   │   ├── app/
│   │   │   ├── page.tsx                     # Landing page
│   │   │   ├── login/page.tsx
│   │   │   ├── register/page.tsx
│   │   │   └── dashboard/
│   │   │       ├── page.tsx                 # Meeting list, search, pagination, create
│   │   │       ├── analytics/page.tsx       # Role-gated analytics
│   │   │       └── meetings/[id]/page.tsx   # Detail: transcript, summary, Q&A, uploads
│   │   ├── lib/
│   │   │   ├── api.ts            # Typed fetch client for the API
│   │   │   └── auth-context.tsx  # React auth context (localStorage-persisted JWT)
│   │   ├── Dockerfile            # Dev image (bind-mounted, npm run dev)
│   │   └── Dockerfile.prod       # Production multi-stage image
│   ├── api/                      # Express + TypeScript REST API
│   │   ├── src/
│   │   │   ├── index.ts          # App entrypoint, static /uploads, error handler
│   │   │   ├── config/db.ts      # pg Pool
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts       # JWT verification + role guard
│   │   │   │   └── upload.ts     # multer disk storage config
│   │   │   ├── routes/
│   │   │   │   ├── auth.ts       # register/login
│   │   │   │   └── meetings.ts   # CRUD, documents, ask, summarize, analytics, RAG ingestion trigger
│   │   │   └── utils/
│   │   │       └── extractText.ts # TXT/PDF/DOCX text extraction for RAG
│   │   ├── Dockerfile
│   │   └── Dockerfile.prod
│   └── ai-service/                # FastAPI microservice
│       ├── app/
│       │   ├── main.py            # /health, /summarize, /ask, /documents/ingest
│       │   ├── db.py              # asyncpg pool + pgvector codec
│       │   └── chunking.py        # word-based chunker for ingestion
│       ├── requirements.txt
│       └── Dockerfile
├── packages/shared-types/         # Shared TS interfaces (reference types)
├── postgres/init.sql              # Schema (auto-applied by the postgres container)
├── docker-compose.yml             # Dev stack: postgres + api + web
├── docker-compose.prod.yml        # Production overlay (multi-stage builds)
└── README.md
```

---

## Troubleshooting

- **"Couldn't reach the server" in the UI** — the API isn't running or
  `NEXT_PUBLIC_API_URL` doesn't match where it's listening. Check
  `curl http://localhost:4000/health`.
- **Summarize/Ask returns a 502** — the ai-service can't reach Ollama.
  Confirm `ollama serve` is running and the model is pulled
  (`ollama list`), then check `curl http://localhost:8000/health`.
- **`docker compose up` can't reach `host.docker.internal`** — this works
  out of the box on Docker Desktop (macOS/Windows). On native Linux Docker,
  the compose file already adds `extra_hosts: host.docker.internal:host-gateway`
  for the `api` service, which requires Docker Engine ≥ 20.10.
- **Postgres container unhealthy / API can't connect** — first boot can
  take a few seconds to apply `init.sql`; the `api` service's
  `depends_on: condition: service_healthy` should wait for it
  automatically. If it still fails, check `docker compose logs postgres`.
- **File upload rejected with 400** — only pdf, txt, md, docx, mpeg/wav/mp4
  audio are allowed, and files are capped at 25MB (see
  `apps/api/src/middleware/upload.ts`).
- **Document status stuck on "Indexing failed"** — hover the badge for the
  error. Most common causes: the ai-service can't reach Postgres
  (`DATABASE_URL` unset/wrong when running it manually), or the embedding
  model isn't pulled (`ollama pull nomic-embed-text`). Check the ai-service
  terminal logs for the underlying error.
- **`CREATE EXTENSION vector` fails / pgvector errors** — you're running
  plain `postgres:16-alpine` instead of `pgvector/pgvector:pg16`. Pull the
  new image (`docker compose pull postgres`) and recreate the container; if
  you already had a volume from before this change, run
  `docker compose down -v` once to drop it and re-apply `init.sql` (this
  wipes local dev data).
- **Changed `.env` but nothing happened** — restart the API process (or
  `docker compose restart api`); env vars are read once at startup.

---

## Security notes

This is a portfolio/reference-grade scaffold, not a hardened production
system. Known gaps to be aware of before using it for anything real:

- **`/uploads` is served without authentication.** Anyone with a file URL
  can download it. For production, put uploads behind an authenticated
  route or use signed URLs from object storage instead of `express.static`.
- **No rate limiting** on auth endpoints — add something like
  `express-rate-limit` before exposing this publicly.
- **No email verification / password reset flow.**
- **JWT has no revocation** — logout is purely client-side (clears
  `localStorage`); a leaked token remains valid until it expires.
- Default `JWT_SECRET` and Postgres password in this repo are **placeholders
  for local development only** — always replace them before deploying.
