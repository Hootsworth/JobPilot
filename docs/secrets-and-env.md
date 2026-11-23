# Secrets, Environment Variables & BYOK

## Important Distinction: GitHub Secrets vs. Host Runtime Env Vars

**GitHub Actions Secrets are NOT available to your deployed web app or API server.**

1. **GitHub Actions Secrets** (configured in GitHub Repo -> *Settings -> Secrets and variables -> Actions*):
   - Used ONLY inside GitHub Actions workflows (e.g., `crawl-and-embed.yml`, `llm-provider-eval.yml`).
   - Required for crawl/embed/score: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
   - Optional official job aggregator secrets: `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `JOOBLE_API_KEY`, `JSEARCH_RAPIDAPI_KEY`.
   - Optional LLM secrets for batch scoring or multi-provider evals: `OPENAI_API_KEY`, `GEMINI_API_KEY`, `META_API_KEY`.
   - Never visible to Vercel (Next.js) or Render (Fastify API).

2. **Deployed App Env Vars** (configured in **Render** for `apps/api` and **Vercel** for `apps/web`):
   - `apps/api` requires `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_ENCRYPTION_KEY`, and optionally server fallback LLM keys (`LLM_PROVIDER`, `LLM_MODEL`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `META_API_KEY`, `META_BASE_URL`).
   - If you use **BYOK mode** only, the API server does NOT need default `OPENAI_API_KEY` / `GEMINI_API_KEY` / `META_API_KEY` env vars — each user supplies and tests their own key in Settings.
   - `apps/web` only receives `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `NEXT_PUBLIC_API_URL`. Never put private keys or `APP_ENCRYPTION_KEY` in `NEXT_PUBLIC_*` variables.

## Meta Llama API Configuration

- `META_BASE_URL` defaults to `https://api.llama.com/compat/v1/` (the OpenAI-compatible wire).
- JobPilot intentionally does **not** use Meta's native `/v1` endpoint because its request/response schemas differ from the OpenAI chat completions spec.
- Users and hosts can override `META_BASE_URL` via environment variable or per-user Settings (useful for pointing at compatible gateways or updated Meta endpoints without code changes).

## BYOK Encryption Details

- User keys pasted in Settings are encrypted server-side in `apps/api` with **AES-256-GCM** using the 32-byte `APP_ENCRYPTION_KEY`.
- Each encrypted record stores its unique 12-byte random IV (`key_iv`), 16-byte authentication tag (`key_auth_tag`), ciphertext (`encrypted_api_key`), and last-4 character mask (`key_hint`).
- Plaintext keys are never written to database columns, returned in API responses, or emitted to Pino logs (auth headers and key fields are explicitly redacted).
