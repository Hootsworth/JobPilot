# Privacy & Terms-of-Service Policy

## Privacy by Default

- **Row-Level Security (RLS)**: All user tables (`profiles`, `profile_stories`, `saved_answers`, `user_llm_settings`, `job_matches`, `resume_versions`, `applications`, `application_events`, `llm_usage_logs`) enforce `auth.uid()` isolation in Postgres.
- **Private Storage**: Uploaded raw PDFs (`resumes-raw`) and generated PDFs (`resumes-rendered`) live in private Supabase Storage buckets scoped by `<user_id>/*`.
- **Telemetry**: `profiles.telemetry_opt_in` defaults to `false`. JobPilot tracks LLM token/latency/cost logs per user strictly for the user's own Usage dashboard and does not send third-party analytics without opt-in.
- **Data Portability & Right to Delete**:
  - `GET /api/account/export` exports the user's full profile, stories, saved answers, LLM metadata (excluding secrets), applications, and usage logs.
  - `DELETE /api/account` removes stored files from Supabase Storage and deletes the user record, cascading across all user tables.

## Job Source Compliance

- **Server-side ingestion** (Phase 2) is strictly restricted to official/public ATS JSON endpoints (Greenhouse, Lever, Ashby, Workable) and documented public/API job feeds (Adzuna, Jooble, Remotive, Arbeitnow, RemoteOK, optional JSearch).
- **Non-API sites** (Naukri, Foundit, Internshala, Instahyre, Wellfound, LinkedIn) are **never** scraped server-side. In Phase 5, they are supported solely inside the user's own active browser session via opt-in, isolated Chrome extension adapters with explicit ToS risk warnings and mandatory review before submit.

## Chrome Extension Permissions & Safety (Phases 4–5)

- **Minimal Manifest V3 Permissions**: `storage`, `tabs`, `sidePanel`, `contextMenus`, `scripting` — zero `<all_urls>` permission in default `host_permissions`.
- **Scoped Default Hosts**: Only official Greenhouse (`boards/job-boards`, US & EU), Lever (`jobs/jobs.eu`), Ashby (`jobs.ashbyhq.com`), and configured API endpoints (`http://localhost:4000/*`, `https://*.onrender.com/*`).
- **Opt-In Non-API Portals (`optional_host_permissions`)**: Workday (`*.myworkdayjobs.com`) and non-API session portals (**Naukri, Foundit, Internshala, Instahyre, Wellfound, LinkedIn**) are isolated in their own adapter modules (`packages/form-engine/src/adapters/`). All 6 non-API portals are **disabled by default**, display explicit ToS risk disclaimers (`MODERATE` / `HIGH`), request host permission via `chrome.permissions.request()` only when toggled on by the user, inject on demand via `chrome.scripting.executeScript()`, and immediately revoke host permission via `chrome.permissions.remove()` when toggled off.
- **Local-Only Session Storage**: Auth tokens and synced profile/resume snapshots live in `chrome.storage.local`; background service workers hold no persistent in-memory secrets.
- **No Auto-Submit Guarantee**: `@jobpilot/form-engine` explicitly excludes submit buttons, never overwrites pre-filled user inputs, caps LLM fallback confidence at `<= 0.85` for human verification, supports one-click Undo, and always pauses in the Side Panel for user review before final submission.
