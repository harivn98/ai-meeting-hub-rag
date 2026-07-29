# Project Talking Points: AI Meeting Hub → Tesla Factory Intelligence (Manufacturing Engineer) Interview

This maps a full-stack project I built — **AI Meeting Hub**, a multi-tenant SaaS app with AI summarization and retrieval-augmented Q&A — onto the core competencies in the JD: full-stack development, RESTful APIs, SQL/Python data pipelines, CI/CD & containerization, and analytics dashboards. The domain is different (meeting notes vs. factory OEE data), but the *architecture pattern* is the same one you'd use for factory intelligence tools: a web frontend, a backend API talking to a relational database, and a Python service doing heavier data/ML work — which is effectively what they're describing when they say "bridging operational data, engineering workflows, and factory systems."

---

## 1. One-line summary (elevator pitch)

"I built a full-stack multi-tenant platform — Next.js/TypeScript frontend, a Node.js/Express REST API backed by PostgreSQL, and a separate Python FastAPI microservice for AI workloads (embeddings + local LLM inference via Ollama). It does document ingestion, chunking, vector search, and retrieval-augmented generation — the same pipeline shape you'd use to pull SCADA/MES data, transform it, and serve it through APIs to a factory-facing dashboard."

---

## 2. Architecture overview

```
Next.js (web, :3000)  →  Express + TypeScript API (:4000)  →  PostgreSQL + pgvector (:5432)
                                    │
                                    ▼
                         FastAPI Python service (:8000)  →  Ollama (local LLM, :11434)
```

- **Frontend (Next.js/React + TypeScript)** — App Router, client-side auth context, form handling, polling for async job status.
- **Backend API (Node.js/Express + TypeScript)** — REST endpoints, JWT auth, role-based access control (RBAC), request validation (Zod), file upload handling (Multer), orchestration/proxying to the AI microservice.
- **Database (PostgreSQL + pgvector extension)** — Relational schema for orgs/users/meetings/documents, plus a vector column for embeddings and an HNSW index for fast similarity search.
- **AI/data service (Python + FastAPI)** — Text chunking, calling an embedding model, calling a generation model, and running the vector similarity query — this is the "Python data pipeline" piece.
- **Containerization** — Docker Compose for dev (bind-mounted, hot-reload) and a separate prod overlay (multi-stage builds, non-root users, no bind mounts).

This maps directly onto:
> "Design, develop, and maintain full-stack web applications... Build RESTful APIs connecting frontend applications to factory data sources... Manage database setup, schema design, and migration... Build SQL and Python data pipelines to extract, clean, and transform operational data"

---

## 3. Full-stack development (React/Node.js/JS equivalent)

- Frontend built with **Next.js (App Router)** — functionally the same skillset as React: component state (`useState`/`useEffect`), client-side routing, forms, and a shared **auth context** (React Context API) that persists a JWT + user object and gates protected routes (dashboard, analytics).
- Talking point for role-based UI: the `role` (owner/admin/member) returned from login determines whether a nav link (e.g. "Analytics") even renders — this is the same pattern you'd use to show/hide shopfloor vs. management views based on user role.
- Styled with Tailwind CSS utility classes — fast iteration, no separate CSS files to maintain across components.
- **Async UX pattern worth mentioning:** file uploads trigger a background ingestion job (extract → chunk → embed) on the server; the frontend polls a status endpoint every few seconds until the document flips from "pending" to "indexed" or "failed." This is directly relevant to factory dashboards where a job (e.g., a solver run, a data sync) completes asynchronously and the UI needs to reflect state without blocking.

---

## 4. RESTful API design (Node.js/Express)

- Standard REST resource structure: `/api/auth/*`, `/api/meetings`, `/api/meetings/:id`, `/api/meetings/:id/documents`, `/api/meetings/:id/ask`, `/api/meetings/analytics/summary`.
- **Middleware chain**: `requireAuth` (verifies JWT, attaches `req.auth`), `requireRole(...)` (restricts endpoints like analytics to owner/admin — an authorization/access-control layer), `upload.single("file")` (Multer, with MIME-type allowlisting and file size limits).
- **Validation**: Zod schemas validate request bodies before they touch the database — rejects malformed input early with structured error messages, rather than letting bad data reach SQL.
- **Multi-tenancy via row scoping**: every query filters by `org_id` pulled from the JWT, so one organization's data is never visible to another — the same isolation pattern you'd want between different factory sites/lines sharing one application.
- **Error handling**: try/catch per route + a global Express error-handling middleware as a safety net (catches Multer errors, uncaught exceptions) and returns consistent JSON error shapes.
- **Talking point on API design as integration layer**: the API doesn't do AI work itself — it's a thin orchestration layer that calls out to the Python service and persists results. This separation of concerns (API = orchestration/auth/data access; Python service = compute) is the same shape you'd want between a factory web app and a Python-based optimization/simulation engine (their CP-SAT/linear programming solvers, FlexSim calibration, etc.) — you don't want your web API blocked on a long-running solver call.

---

## 5. SQL / database schema design

- PostgreSQL schema with proper normalization: `organizations` → `users` → `meetings` → `documents` → `document_chunks`, with foreign keys and `ON DELETE CASCADE` so deleting a meeting cleans up its documents and chunks automatically.
- Indexes added deliberately, not by default: `idx_meetings_org`, `idx_documents_meeting`, and an **HNSW vector index** for approximate nearest-neighbor search on embeddings (`vector_cosine_ops`) — this is the kind of indexing decision that matters when you're querying time-series/operational data at scale (e.g., cycle-time or OEE tables keyed by line/station/timestamp).
- Migrations handled as a single idempotent `init.sql` using `CREATE TABLE IF NOT EXISTS` — for a real system I'd talk about moving to a proper migration tool (e.g., `node-pg-migrate`, Alembic, Flyway) for schema versioning across environments, which is exactly the "schema design and migration (MySQL)" bullet in the JD.
- Analytics queries use SQL aggregation directly (`date_trunc`, `GROUP BY`, `COUNT ... FILTER`) rather than pulling all rows into application code and aggregating in JS/Python — cheaper and more scalable, same principle you'd apply to OEE/JPH rollups.

---

## 6. Python data pipeline (the RAG/ingestion pipeline)

This is the strongest direct parallel to "Build SQL and Python data pipelines to extract, clean, and transform operational data":

1. **Extract** — API server extracts raw text from uploaded documents (PDF/DOCX/TXT).
2. **Transform/clean** — Python service chunks the text into overlapping, word-bounded segments (~220 words, 40-word overlap) — a deliberate trade-off: small enough for precise retrieval, large enough to keep context coherent. I'd talk about this the same way I'd talk about a windowing/aggregation strategy for time-series sensor data.
3. **Load** — Each chunk is embedded (vector representation) via a local embedding model and stored in Postgres/pgvector with `asyncpg`, inside a transaction, replacing any previous chunks for that document so re-ingestion is idempotent.
4. **Query/serve** — On a user question, the question itself is embedded and matched via cosine similarity (`embedding <=> $2 ... LIMIT k`) to retrieve the top-k relevant chunks, which get stitched into a prompt sent to a local LLM (Ollama) for the final answer — this is retrieval-augmented generation (RAG).

Talking point: this whole flow — async I/O with `asyncpg`, `httpx.AsyncClient` for outbound calls, `FastAPI`'s `async def` handlers, and a connection pool set up once at app startup via a `lifespan` context manager — demonstrates comfort with async Python and structuring a service around a data pipeline, not just scripting.

---

## 7. Analytics / KPI dashboard

- A dedicated analytics endpoint aggregates: meetings per week (12-week trend), top contributors, and summarization coverage — served to a role-gated dashboard page with simple, readable visual summaries (counts, trend lists).
- This is a direct, if simpler, analog to the "KPI dashboards, operational reporting, data visualization" requirement — the pattern (SQL aggregation → API → frontend chart/table, restricted by role) is identical; a factory version would swap "meetings per week" for OEE/JPH/cycle-time trends per line.

---

## 8. CI/CD, Docker, and deployment posture

- **Dev vs. prod separation**: `docker-compose.yml` (bind mounts, hot reload, `ts-node-dev`) plus a `docker-compose.prod.yml` overlay that swaps in multi-stage `Dockerfile.prod` builds — compiled TypeScript output only, `npm ci --omit=dev`, non-root container users, no source bind-mounts (image is the source of truth).
- **Networking decision I'd defend in an interview**: the AI/Python service intentionally runs on the host rather than in a container, because local LLM inference benefits from direct GPU/Metal access, which is painful to pass through into Docker (especially on macOS) — the API and web containers reach it via `host.docker.internal`. This is the kind of pragmatic infra trade-off (ease of GPU access vs. full containerization) they'll want to hear you reason through given they mention working toward Docker/Kubernetes for factory tools.
- Talking point on what I'd add for a "real" CI/CD pipeline (since this project doesn't include it, and the JD explicitly wants GitHub-based CI/CD): GitHub Actions running lint/typecheck/tests on PR, building and pushing the prod images, and a deploy step — I'd frame this as "the natural next step," showing I understand the gap between "runs locally" and "production-grade uptime."

---

## 9. Security / access control

- JWT-based auth with `bcrypt` password hashing, role-based middleware (`owner`/`admin`/`member`), and org-scoped queries as the tenant isolation boundary.
- File upload hardening: MIME-type allowlist, 25MB size cap, randomized filenames (avoids path traversal / filename collisions), extraction/ingestion wrapped in try/catch so a bad file can't crash the request pipeline.
- This maps to "production-grade uptime, security, and access control" and "IT governance experience (ARB, POC)" — even without formal ARB experience, you can show you *think* about access control and blast-radius the way that process demands.

---

## 10. Likely interview questions and how to answer with this project

**"Walk me through a full-stack project you built."**
→ Use the architecture diagram above; narrate request flow: browser → Next.js → Express API (auth + validation) → Postgres, and for AI features → FastAPI → Ollama → back through the chain.

**"How do you handle a slow/long-running backend task without blocking the UI?"**
→ Document ingestion example: API responds immediately after saving the file, then does extraction+embedding asynchronously in the background; frontend polls for status. Directly transferable to "a solver run takes 30 seconds, don't block the request."

**"How would you design a schema for [some operational data]?"**
→ Talk through the normalization decisions in `init.sql`: what's a foreign key vs. a denormalized field, why indexes were added where queries actually filter/sort, and the idempotent-migration approach (and what you'd upgrade to for a real migration history).

**"Tell me about a technical trade-off you made."**
→ The host-vs-container decision for the AI service (GPU access vs. full containerization), or the chunk-size/overlap trade-off (retrieval precision vs. context coherence) — good examples of reasoning about trade-offs rather than just implementing.

**"How do you connect a Python data/ML component to a web app?"**
→ FastAPI microservice pattern: the Node API treats it as just another HTTP service it calls and awaits, with its own independent scaling/deploy lifecycle — same shape as calling out to a Python optimization engine from a factory web tool.

---

## 11. Honest gaps to be upfront about (don't oversell)

- No formal CI/CD pipeline (GitHub Actions) is wired up yet — acknowledge this and describe what you'd add.
- No Kubernetes — Docker Compose only; fine to say you understand the K8s direction but haven't operated a cluster.
- No industrial systems experience (SCADA/Ignition/MES) — be honest that the *transferable* skill is the data pipeline/API/dashboard pattern, not domain knowledge of those specific systems, and express willingness to ramp up on Tesla's stack (WARP, FLUX, Coalesce, etc.).
- No discrete-event simulation (FlexSim) experience — if asked, don't claim it; pivot to your comfort with data pipelines and optimization-adjacent thinking (e.g., the retrieval/ranking logic here is conceptually similar to a constrained top-k selection problem).
