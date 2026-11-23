# Free-Tier Deployment Guide

JobPilot is architected to run 100% on free/open-source tools and free-tier cloud services:
- **Database, Vector Store, Auth & PDF Storage**: Supabase Free Tier (`Postgres 16` + `pgvector` + Row-Level Security + Storage)
- **Backend API & Typst PDF Renderer**: Render Free Web Service (`apps/api/Dockerfile`)
- **Frontend Web App**: Vercel Hobby / Free Tier (`apps/web`, Next.js 16)
- **Scheduled Crawlers, Local Embeddings & Provider Evals**: GitHub Actions Free Tier (`.github/workflows/crawl-and-score.yml` & `.github/workflows/ci-and-evals.yml`)
- **Browser Autofill Assistant**: Chrome MV3 Extension (`apps/extension`, WXT)

---

## 1. Supabase Setup (Postgres + pgvector + Auth + Storage)

1. Create a new project on [Supabase](https://supabase.com/) (Free tier).
2. Open the **SQL Editor** in the Supabase dashboard and execute the migrations in order:
   - `supabase/migrations/0001_initial_schema.sql` (enables `vector` and `pg_trgm`, creates `profiles`, `profile_stories`, `saved_answers`, `user_llm_settings`, `llm_usage_logs`, `job_sources`, `jobs` with `vector(384)`, `job_sightings`, `job_matches`, `resume_versions`, `applications`, and `application_events`).
   - `supabase/migrations/0002_rls_and_storage.sql` (enables Row-Level Security on every user table and provisions private `resumes-raw` and `resumes-rendered` Storage buckets).
   - `supabase/migrations/0003_matching_rpc.sql` (adds the `match_jobs_by_embedding` pgvector cosine similarity RPC).
   - `supabase/migrations/0004_resume_pdf_engine.sql` (adds `pdf_engine` metadata column to `resume_versions`).
3. Copy your project credentials from **Project Settings -> API**:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server-only; never expose in `NEXT_PUBLIC_*`)

---

## 2. Important: GitHub Actions Secrets vs Deployed Host Environment Variables

> **Critical Security & Operations Note**:
> GitHub Actions Secrets (`Settings -> Secrets and variables -> Actions` in `https://github.com/Hootsworth/JobPilot.git`) are **ONLY** injected into GitHub Actions runner containers during CI and scheduled cron jobs (`crawl-and-score.yml` and `ci-and-evals.yml`).
>
> **GitHub Actions Secrets are NOT automatically available to your deployed Render API or Vercel web app.** You must set the required environment variables directly in Render and Vercel (or let users supply their own provider keys via encrypted BYOK in `/settings`).

| Variable | GitHub Actions Secrets | Render API (`apps/api`) | Vercel Web (`apps/web`) |
| :--- | :---: | :---: | :---: |
| `SUPABASE_URL` | Yes | Yes | No (use `NEXT_PUBLIC_SUPABASE_URL`) |
| `SUPABASE_ANON_KEY` | No | Yes | No (use `NEXT_PUBLIC_SUPABASE_ANON_KEY`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Yes | **NEVER** |
| `APP_ENCRYPTION_KEY` | No | Yes (64 hex chars / 32 bytes) | **NEVER** |
| `LLM_PROVIDER` | Yes (`gemini`/`openai`/`meta`) | Yes | No |
| `LLM_MODEL` | Optional | Optional | No |
| `OPENAI_API_KEY` | Optional (for CI evals / cron) | Optional (or BYOK) | **NEVER** |
| `GEMINI_API_KEY` | Optional (for CI evals / cron) | Optional (or BYOK) | **NEVER** |
| `META_API_KEY` | Optional (for CI evals / cron) | Optional (or BYOK) | **NEVER** |
| `META_BASE_URL` | Optional (`https://api.llama.com/compat/v1/`) | Optional | No |
| `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` | Optional (India job crawl) | Optional | No |
| `JOOBLE_API_KEY` | Optional (India job crawl) | Optional | No |

---

## 3. Deploy Backend API on Render (Free Docker Service)

1. Push your repository to GitHub (`https://github.com/Hootsworth/JobPilot.git`).
2. In [Render](https://render.com/), click **New + -> Web Service** and connect the repository.
3. Configure the service:
   - **Environment**: `Docker`
   - **Dockerfile Path**: `apps/api/Dockerfile`
   - **Docker Build Context Directory**: `.` (monorepo root)
   - **Instance Type**: `Free`
4. Add Environment Variables in Render:
   - `PORT=4000`
   - `HOST=0.0.0.0`
   - `CORS_ORIGIN=https://your-vercel-domain.vercel.app` (or `*` if using the Chrome extension across ATS origins)
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   - `APP_ENCRYPTION_KEY` (generate with `openssl rand -hex 32`)
   - `LLM_PROVIDER=gemini` (or `openai` / `meta`)
5. Note on Render Free Tier spin-down: Render Free instances sleep after 15 minutes of inactivity. The JobPilot web header (`AppShell`) automatically pings `/health` on load and displays an `API: OFFLINE/WAKING` status badge while the container wakes up.

---

## 4. Deploy Frontend Web App on Vercel (Free Hobby Tier)

1. In [Vercel](https://vercel.com/), import the GitHub repository.
2. Configure the project:
   - **Framework Preset**: `Next.js`
   - **Root Directory**: `apps/web`
   - **Install Command**: `npm install` (runs from monorepo root automatically)
   - **Build Command**: `cd ../.. && npm run build -w @jobpilot/shared && npm run build -w @jobpilot/web`
3. Add Environment Variables in Vercel:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_API_URL=https://your-render-api.onrender.com`

---

## 5. Build & Load the Chrome MV3 Extension (`apps/extension`)

1. From the monorepo root, build the extension package:
   ```bash
   npm run build -w @jobpilot/extension
   ```
   This outputs the production Manifest V3 bundle to `apps/extension/.output/chrome-mv3/`.
2. Open Google Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select `apps/extension/.output/chrome-mv3`.
5. Click the **JobPilot** extension icon in the Chrome toolbar to open the Side Panel, paste your API Base URL and Supabase access token (or local dev token), and test form detection on Greenhouse, Lever, Ashby, Workday, or opt-in Indian job portals.
