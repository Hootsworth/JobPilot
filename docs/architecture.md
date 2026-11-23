# Architecture

## Overview

JobPilot is organized as an npm workspaces + Turborepo monorepo using TypeScript end-to-end so Zod schemas and domain types are shared across the API, web client, background ingestion jobs, and Chrome extension.

## Stack Decisions

- **Backend (`apps/api`)**: Node.js + Fastify + TypeScript.
  - Shares exact Zod schemas from `@jobpilot/shared` across API, web, and extension.
  - Lightweight runtime footprint tailored to Render's 512 MB free-tier container.
  - Pino structured logging with explicit redaction of `authorization`, cookies, and API key fields.
- **Database & Auth (`supabase/migrations`)**: Supabase Postgres + `pgvector` + `pg_trgm` + Auth + private Storage (`resumes-raw`, `resumes-rendered`).
  - Row-Level Security (RLS) isolates user profiles, stories, saved answers, encrypted BYOK keys, matches, resume versions, applications, usage logs, and private extension-saved jobs.
- **Embeddings (`packages/embeddings`)**: Fixed local `BAAI/bge-small-en-v1.5` (384-dim ONNX int8 via `@huggingface/transformers`), decoupled from the active chat LLM provider. Every vector row persists `embedding_model` and `embedding_model_version` alongside the vector.
- **LLM Layer (`packages/llm`)**:
  - **OpenAIAdapter**: official `openai` SDK using strict `json_schema` (with fallback to `json_object` when a model rejects strict schemas).
  - **GeminiAdapter**: official `@google/genai` SDK using `responseMimeType: 'application/json'` and sanitized `responseSchema`.
  - **MetaLlamaAdapter**: official `openai` SDK pointed at `META_BASE_URL` (default `https://api.llama.com/compat/v1/`, never native `/v1`). Dynamically probes and caches per-model capabilities (`json_schema` -> `json_object` -> prompt-enforced JSON, `max_completion_tokens` vs `max_tokens`).
  - **No hardcoded model IDs**: every adapter exposes live `listModels()` so users select models dynamically in Settings.
  - **Structured validation & healing**: `runStructuredWithRetryAndRepair()` runs `zod.safeParse`, feeds exact Zod errors back for up to 2 retries, and executes a final repair prompt before throwing `LlmValidationError`.
- **Web Frontend (`apps/web`)**: Next.js App Router + Tailwind CSS implementing the `opencode.ai` design tokens in [`DESIGN.md`](../DESIGN.md).
