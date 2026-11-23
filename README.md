# JobPilot

An open-source, privacy-first AI job search and application assistant tuned for **India + global** hiring markets — built on free-tier infrastructure, local embeddings, and a provider-agnostic LLM layer (OpenAI, Gemini, Meta Llama API).

## Design Language

JobPilot's UI follows the terminal-native, monospaced aesthetic documented in [`DESIGN.md`](./DESIGN.md) (`opencode.ai` system via `getdesign`): warm cream canvas (`#fdfcfc`), near-black ink (`#201d1d`), hairline rules (`rgba(15,0,0,0.12)`), `4px` interactive controls, `0px` containers, ASCII bracket glyphs (`[+]`, `[-]`, `[x]`), and full light/dark theme parity.

## Workspace Structure

```text
apps/
  api/        Fastify TypeScript API (Render Free / Docker)
  web/        Next.js App Router + Tailwind (Vercel Free)
  extension/  Chrome MV3 assistant (WXT Side Panel + Greenhouse/Lever/Ashby)
packages/
  shared/     Shared Zod schemas (JSON Resume, India fields, Jobs, Resume Tailor, Extension)
  embeddings/ Local BAAI/bge-small-en-v1.5 (384d ONNX int8) embedder
  llm/        OpenAI, Gemini, and Meta Llama compat adapters + Zod retry/repair
  ingestion/  Official ATS + India feed crawlers, deduper, and 3-stage matcher
  tailoring/  Grounded resume tailor, dual verifier (deterministic + LLM), Typst & ATS PDF renderer
  form-engine/ Pure DOM traverser, controlled-input/combobox/file engine & ATS adapters
  evals/      Matching (NDCG@10), resume faithfulness & HTML form-fill CI eval gates
data/
  seed-boards.json  Curated India + global Greenhouse/Lever/Ashby/Workable slugs
supabase/
  migrations/ Postgres + pgvector schema, HNSW/GIN indexes, matching RPC, RLS
docs/
  architecture.md
  deployment.md
  secrets-and-env.md
  privacy-and-tos.md
```

Repository: [`https://github.com/Hootsworth/JobPilot.git`](https://github.com/Hootsworth/JobPilot.git)

## Quickstart (Local Development)

1. **Install dependencies** (requires Node 20+ / npm 10+):
   ```bash
   npm install
   ```

2. **Configure Supabase**:
   - Create a free Supabase project.
   - Run migrations [`0001_initial_schema.sql`](./supabase/migrations/0001_initial_schema.sql), [`0002_rls_and_storage.sql`](./supabase/migrations/0002_rls_and_storage.sql), [`0003_matching_rpc.sql`](./supabase/migrations/0003_matching_rpc.sql), and [`0004_resume_pdf_engine.sql`](./supabase/migrations/0004_resume_pdf_engine.sql) in order in the Supabase SQL Editor (or via `supabase db push`).

3. **Configure environment variables**:
   - Copy `.env.example` to `.env` in the repo root (and `apps/web/.env.local` for Next.js public env vars).
   - Generate a 32-byte encryption key for BYOK storage:
     ```bash
     openssl rand -hex 32
     ```
   - See [`docs/secrets-and-env.md`](./docs/secrets-and-env.md) for how GitHub Secrets, host env vars, and BYOK interact.

4. **Run locally**:
   ```bash
   npm run build:packages
   npm run dev
   ```
   - Web app: `http://localhost:3000`
   - API server: `http://localhost:4000` (health check: `GET /health`)

5. **Run local crawl + batch embed (optional for local DB)**:
   ```bash
   npm run crawl --workspace=@jobpilot/ingestion
   npm run embed --workspace=@jobpilot/ingestion
   npm run score --workspace=@jobpilot/ingestion
   ```

6. **Run verification**:
   ```bash
   npm run typecheck
   npm run test
   npm run build
   ```

7. **Load the Chrome MV3 extension unpacked (Phases 4–5)**:
   - After `npm run build`, open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select `apps/extension/.output/chrome-mv3`.
   - Open JobPilot Web (`/settings`), click **Copy Extension Session JSON**, then click the JobPilot toolbar icon to open the Side Panel and connect.
   - Non-API portals (**Naukri, Foundit, Internshala, Instahyre, Wellfound, LinkedIn**) are **off by default** and never scraped server-side; enable any individual adapter in the Side Panel **Adapters** tab to grant host access for that portal only.

## Delivery Phases

- [x] **Phase 1**: Architecture, monorepo scaffold, DB schema + RLS, LLM layer (OpenAI/Gemini/Meta + BYOK + tests), PDF resume parser, Master Profile + India fields + Story Bank + Saved Answers + Settings + Usage dashboard
- [x] **Phase 2**: Job ingestion (Greenhouse, Lever, Ashby, Workable, Adzuna, Jooble, Remotive, Arbeitnow, RemoteOK, optional JSearch) + cross-source dedupe + local `bge-small` embeddings + 3-stage matching + matching eval harness + `/jobs` feed UI
- [x] **Phase 3**: Grounded resume tailoring + dual verifier (deterministic + LLM) + Typst / ATS-safe PDF export + diff view + faithfulness eval gate
- [x] **Phase 4**: Chrome MV3 extension (WXT Side Panel) + `@jobpilot/form-engine` for Greenhouse, Lever, and Ashby + HTML snapshot form-fill eval harness
- [x] **Phase 5**: Isolated opt-in Indian/non-API adapters (Naukri, Foundit, Internshala, Instahyre, Wellfound, LinkedIn) + Workday + grounded LLM fallback filler + expanded HTML & multi-provider eval suite
- [x] **Phase 6**: Application Tracker (`/tracker` + `/api/applications/*`) with exact tailored resume version linking & follow-up reminders, onboarding readiness polish, WCAG 2.1 AA skip-nav & global `?` keyboard shortcut dialog, free-tier deployment guide ([`docs/deployment.md`](./docs/deployment.md)), and Chrome Web Store submission documentation ([`apps/extension/CHROMEWEBSTORE.md`](./apps/extension/CHROMEWEBSTORE.md))
