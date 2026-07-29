# Running AI Meeting Hub on your computer

This is a step-by-step guide to get the whole stack running locally:
web app, API, AI service, Postgres, and Ollama. It assumes no prior setup —
follow it top to bottom.

Two paths are covered:

- **Path A — Docker for Postgres/API/web, Ollama on your host** (recommended,
  matches how the project is designed to run)
- **Path B — Everything manual, no Docker** (if you don't have/want Docker)

Pick one. Don't mix them (e.g. don't run Postgres via Docker *and* manually
at the same time — they'll fight over port 5432).

---

## 0. What you need installed first

| Tool | Why | Check you have it |
|---|---|---|
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Path A only) | Runs Postgres, API, web in containers | `docker --version` and `docker compose version` |
| [Node.js 20+](https://nodejs.org/) | Runs the API and web app | `node --version` |
| [Python 3.11+](https://www.python.org/downloads/) | Runs the AI service | `python3 --version` |
| [Ollama](https://ollama.com/download) | Runs the local LLM used for summaries and Q&A | `ollama --version` |
| [PostgreSQL 16](https://www.postgresql.org/download/) (Path B only) | Database, if not using Docker | `psql --version` |

If any command above says "command not found", install that tool first.

---

## 1. Get the project onto your machine

Unzip the project archive you were given, then open a terminal and `cd`
into it:

```bash
cd ai-meeting-hub
```

Everything below assumes your terminal's current directory is the project
root (`ai-meeting-hub/`) unless a step tells you to `cd` somewhere else.

---

## 2. Install and start Ollama (needed for both paths)

This is what actually generates the AI summaries and answers — without it,
the app still works, but "Generate summary" and "Ask a question" will
return an error.

1. Install Ollama from https://ollama.com/download (macOS/Windows: download
   the app and open it once, which starts its background server
   automatically. Linux: follow the install script on that page.)

2. Pull a model (one-time download, ~2GB), plus the small embedding model
   used for document Q&A (RAG):
   ```bash
   ollama pull llama3.2
   ollama pull nomic-embed-text
   ```

3. Confirm Ollama is running and reachable:
   ```bash
   curl http://localhost:11434/api/tags
   ```
   You should see JSON listing `llama3.2`. If this fails, run
   `ollama serve` in its own terminal window and leave it running.

Keep Ollama running for the rest of this guide.

---

## Path A: Docker for Postgres/API/web (recommended)

### A.1 Configure environment variables

```bash
cp apps/api/.env.example apps/api/.env
```

Open `apps/api/.env` in a text editor and set a real secret:

```
JWT_SECRET=<paste a random string here>
```

Generate one with:
```bash
openssl rand -base64 48
```
(No `openssl`? Any long random string works for local dev — just don't use
the placeholder value in production.)

### A.2 Start Postgres, API, and web with Docker Compose

At the project root:

```bash
docker compose up --build
```

The first run will take a minute or two (downloads base images, installs
dependencies, applies the database schema automatically -- including the
`pgvector` extension and the `document_chunks` table used for document
Q&A). Watch the logs — you're looking for lines like:

```
meetinghub-api       | API listening on port 4000
meetinghub-web       | ✓ Ready in ...
```

Leave this terminal running.

### A.3 Start the AI service on your host

The AI service needs to run outside Docker so it can reach Ollama on
`localhost:11434` without extra networking setup. It also connects to the
Postgres container above (via `localhost:5432`, exposed by Docker Compose)
to store and search document embeddings — start it *after* A.2 so that
connection succeeds on startup.

Open a **new terminal window** and run:

```bash
cd ai-meeting-hub/apps/ai-service
python3 -m venv venv

# macOS/Linux:
source venv/bin/activate
# Windows (PowerShell):
# venv\Scripts\Activate.ps1

pip install -r requirements.txt
export DATABASE_URL="postgresql://meetinghub:meetinghub_dev_password@localhost:5432/meetinghub"
# Windows (PowerShell): $env:DATABASE_URL="postgresql://meetinghub:meetinghub_dev_password@localhost:5432/meetinghub"
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Leave this terminal running too. You now have 2 terminals open: one running
`docker compose up`, one running the AI service. Verify the AI service is
up (from any other terminal):
```bash
curl http://localhost:8000/health
# {"status":"ok","model":"llama3.2","embed_model":"nomic-embed-text"}
```

### A.4 Open the app

Go to **http://localhost:3000** in your browser.

- Click **Sign up**, fill in an organization name, email, and password
  (8+ characters). This creates your workspace and logs you in as the
  `owner`.
- You'll land on the dashboard. Click **New meeting**, give it a title,
  and paste some text into the transcript box (or leave it blank and
  upload a file afterward from the meeting detail page).
- Open the meeting and click **Generate summary** — this calls
  Ollama through the AI service and should return a real summary in a few
  seconds (first request per session is slower while the model loads into
  memory).
- Try the **Ask a question** box on the same page.
- Scroll down to **Documents** and upload a pdf/txt/docx file. It shows an
  "Indexing…" badge that flips to "Indexed for Q&A" once the AI service has
  chunked and embedded it (a few seconds for small files). Once indexed,
  ask a question specific to that document's content — the answer box will
  show which excerpts were retrieved.
- As the `owner`, you'll also see an **Analytics** link in the top-right
  of the dashboard.

### A.5 Stopping everything

In the `docker compose up` terminal: press `Ctrl+C`, then run:
```bash
docker compose down
```
(Add `-v` — `docker compose down -v` — if you also want to wipe the
database and start fresh next time.)

In the AI service terminal: press `Ctrl+C`.

---

## Path B: Everything manual, no Docker

Use this if you don't have Docker installed. You'll run 4 things in 4
separate terminal windows: Postgres, the API, the AI service, and the web
app.

### B.1 Set up Postgres

If you don't already have Postgres 16 running locally, install it for your
OS (https://www.postgresql.org/download/), then:

**Install the pgvector extension too** — it's required for document Q&A
(embeddings are stored in a `vector` column). It's not part of stock
Postgres:
- macOS (Homebrew): `brew install pgvector`
- Debian/Ubuntu: `sudo apt install postgresql-16-pgvector` (package name
  varies by distro/version — see https://github.com/pgvector/pgvector#installation
  if that doesn't exist for yours)
- Windows: follow the "Windows" build instructions at the link above, or
  use Path A (Docker) instead, which ships pgvector preinstalled.

```bash
# Create a role and database matching the project's default connection string
psql postgres -c "CREATE USER meetinghub WITH PASSWORD 'meetinghub_dev_password' CREATEDB;"
psql postgres -c "CREATE DATABASE meetinghub OWNER meetinghub;"

# Apply the schema (creates the vector extension, all tables, and indexes)
psql "postgresql://meetinghub:meetinghub_dev_password@localhost:5432/meetinghub" \
  -f postgres/init.sql
```

(On some systems the first two commands need to run as the `postgres` OS
user, e.g. `sudo -u postgres psql ...` on Linux.)

Verify the tables were created:
```bash
psql "postgresql://meetinghub:meetinghub_dev_password@localhost:5432/meetinghub" -c "\dt"
```
You should see `organizations`, `users`, `meetings`, `documents`,
`document_chunks`, `meeting_participants`.

### B.2 Start the AI service — Terminal 1

```bash
cd ai-meeting-hub/apps/ai-service
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\Activate.ps1
pip install -r requirements.txt
export DATABASE_URL="postgresql://meetinghub:meetinghub_dev_password@localhost:5432/meetinghub"
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

(Windows PowerShell: set `$env:DATABASE_URL="postgresql://meetinghub:meetinghub_dev_password@localhost:5432/meetinghub"` first.)

Verify: `curl http://localhost:8000/health` — also confirm `ollama pull
nomic-embed-text` was run back in step 0, since that's what powers document
embeddings.

### B.3 Start the API — Terminal 2

```bash
cd ai-meeting-hub/apps/api
cp .env.example .env
```

Edit `.env` and set `JWT_SECRET` to a real random string (see `openssl rand
-base64 48` above). Then:

```bash
npm install
DATABASE_URL="postgresql://meetinghub:meetinghub_dev_password@localhost:5432/meetinghub" \
AI_SERVICE_URL="http://localhost:8000" \
npm run dev
```

(On Windows PowerShell, set env vars separately instead of inline:
```powershell
$env:DATABASE_URL="postgresql://meetinghub:meetinghub_dev_password@localhost:5432/meetinghub"
$env:AI_SERVICE_URL="http://localhost:8000"
npm run dev
```)

Verify: `curl http://localhost:4000/health`

### B.4 Start the web app — Terminal 3

```bash
cd ai-meeting-hub/apps/web
npm install
NEXT_PUBLIC_API_URL="http://localhost:4000" npm run dev
```

(Windows PowerShell: `$env:NEXT_PUBLIC_API_URL="http://localhost:4000"; npm run dev`)

### B.5 Open the app

Go to **http://localhost:3000** and follow the same steps as A.4 above
(sign up, create a meeting, generate a summary, ask a question).

### B.6 Stopping everything

Press `Ctrl+C` in each of the 3 terminals (AI service, API, web). Leave
Postgres running as a background service, or stop it via your OS's normal
method (`brew services stop postgresql`, `sudo systemctl stop postgresql`,
etc.) if you want it fully off.

---

## 3. Verifying it's actually working (optional but useful)

If something seems off, check each layer independently, from the bottom
up:

```bash
# 1. Is Ollama up and has both models?
curl http://localhost:11434/api/tags
# Look for both "llama3.2" and "nomic-embed-text" in the list

# 2. Is the AI service up, and can it reach Ollama + Postgres?
curl http://localhost:8000/health
# {"status":"ok","model":"llama3.2","embed_model":"nomic-embed-text"}
curl -X POST http://localhost:8000/summarize \
  -H "Content-Type: application/json" \
  -d '{"transcript":"Alice: We shipped the login page. Bob: next week we tackle billing."}'
# Should return {"summary": "..."} within ~10-30s. A 502 here means the
# AI service can't reach Ollama — check step 0/A.3/B.2. If the ai-service
# process itself won't start, check its DATABASE_URL / that Postgres is up.

# 3. Is the API up, and can it reach Postgres + the AI service?
curl http://localhost:4000/health

# 4. Is the web app up?
curl -I http://localhost:3000
# Should return HTTP/1.1 200 OK
```

If step 2 works but generating a summary in the browser doesn't, the
problem is almost certainly `NEXT_PUBLIC_API_URL` not matching where your
API is actually listening — double check step A.1/B.4.

---

## 4. Common issues

| Symptom | Likely cause | Fix |
|---|---|---|
| Browser shows "Couldn't reach the server" on login/signup | API isn't running, or wrong `NEXT_PUBLIC_API_URL` | `curl http://localhost:4000/health`; restart web app with the correct URL |
| "Generate summary" / "Ask" spins forever then errors (502) | Ollama isn't running, or the model isn't pulled | `ollama serve` in a terminal, `ollama pull llama3.2`, then retry |
| `docker compose up` fails to connect to `host.docker.internal:8000` | Only affects Linux hosts on older Docker | Docker Engine ≥ 20.10 is required; the compose file already adds the needed `extra_hosts` entry. Upgrade Docker if this fails |
| Postgres connection refused | Postgres isn't running, or wrong port/credentials | Path A: `docker compose logs postgres`. Path B: check your local Postgres service is running on port 5432 |
| `EADDRINUSE` on port 3000/4000/8000/5432 | Something else is already using that port | Stop the other process, or change the port for the conflicting service (`PORT` env var for the API, `-p` flag for Next.js) |
| File upload returns 400 | Unsupported file type or file over 25MB | Allowed: pdf, txt, md, docx, mp3, wav, m4a |
| Document badge stuck on "Indexing failed" | AI service can't reach Postgres, or `nomic-embed-text` isn't pulled | Hover the badge for the error; check the ai-service terminal; `ollama pull nomic-embed-text` |
| `CREATE EXTENSION vector` fails on startup | Using plain `postgres:16-alpine` instead of the pgvector image, or (Path B) pgvector isn't installed locally | Path A: pull `pgvector/pgvector:pg16` and recreate (`docker compose down -v && docker compose up --build`). Path B: install the pgvector extension for your OS (see B.1) |
| `npm install` fails on an old Node version | Node < 20 | Upgrade to Node 20+ (use [nvm](https://github.com/nvm-sh/nvm) if you need multiple versions) |

For anything else, see the **Troubleshooting** and **Security notes**
sections of the main `README.md`.
