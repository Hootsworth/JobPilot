-- JobPilot Initial Schema Migration
-- Enables pgcrypto, pgvector, and pg_trgm; creates core tables, triggers, and indexes.

create extension if not exists pgcrypto;
create extension if not exists vector;
create extension if not exists pg_trgm;

-- Shared updated_at trigger helper
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

-- 1. profiles (1:1 with auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  phone text,
  active_profile_version integer not null default 1 check (active_profile_version >= 1),
  json_resume jsonb not null default '{}'::jsonb,
  india_profile jsonb not null default '{}'::jsonb,
  search_preferences jsonb not null default '{}'::jsonb,
  source_resume_storage_path text,
  profile_text_hash text,
  embedding vector(384),
  embedding_model text,
  embedding_model_version text,
  embedded_at timestamptz,
  telemetry_opt_in boolean not null default false,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Automatically provision a profile row on user signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2. profile_stories (STAR story bank + quantified metrics)
create table if not exists public.profile_stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  category text not null default 'project',
  situation text not null default '',
  task text not null default '',
  action text not null default '',
  result text not null default '',
  metrics jsonb not null default '[]'::jsonb,
  skills_used text[] not null default '{}',
  linked_experience_id text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists profile_stories_user_idx
  on public.profile_stories (user_id, created_at desc);

drop trigger if exists profile_stories_set_updated_at on public.profile_stories;
create trigger profile_stories_set_updated_at
  before update on public.profile_stories
  for each row execute function public.set_updated_at();

-- 3. saved_answers (Reusable application Q&A)
create table if not exists public.saved_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  question_key text not null,
  question_pattern text not null,
  answer text not null,
  tags text[] not null default '{}',
  embedding vector(384),
  embedding_model text,
  embedding_model_version text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists saved_answers_user_idx
  on public.saved_answers (user_id, updated_at desc);

drop trigger if exists saved_answers_set_updated_at on public.saved_answers;
create trigger saved_answers_set_updated_at
  before update on public.saved_answers
  for each row execute function public.set_updated_at();

-- 4. user_llm_settings (Per-provider configuration & encrypted BYOK keys)
create table if not exists public.user_llm_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('openai', 'gemini', 'meta')),
  is_active boolean not null default false,
  selected_model text,
  base_url_override text,
  encrypted_api_key text,
  key_iv text,
  key_auth_tag text,
  key_hint text,
  detected_capabilities jsonb,
  last_tested_at timestamptz,
  last_test_status text check (last_test_status is null or last_test_status in ('ok', 'error', 'untested')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, provider)
);

create index if not exists user_llm_settings_user_active_idx
  on public.user_llm_settings (user_id, is_active);

drop trigger if exists user_llm_settings_set_updated_at on public.user_llm_settings;
create trigger user_llm_settings_set_updated_at
  before update on public.user_llm_settings
  for each row execute function public.set_updated_at();

-- 5. job_sources (Crawled board/API registry + HTTP conditional cache)
create table if not exists public.job_sources (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  slug text not null,
  display_name text not null,
  region_focus text not null default 'global',
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  etag text,
  last_modified text,
  last_crawled_at timestamptz,
  last_status text,
  consecutive_failures integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (source_type, slug)
);

drop trigger if exists job_sources_set_updated_at on public.job_sources;
create trigger job_sources_set_updated_at
  before update on public.job_sources
  for each row execute function public.set_updated_at();

-- 6. jobs (Normalized, deduplicated jobs; public catalog or owner-scoped extension capture)
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references public.profiles(id) on delete cascade,
  dedupe_fingerprint text not null,
  source_type text not null,
  external_id text,
  source_url text not null,
  apply_url text,
  company_name text not null,
  company_domain text,
  company_logo_url text,
  title text not null,
  normalized_title text,
  location_raw text,
  city text,
  country_code text,
  work_mode text check (work_mode is null or work_mode in ('remote', 'hybrid', 'onsite', 'unknown')),
  seniority text check (seniority is null or seniority in ('intern', 'fresher', 'junior', 'mid', 'senior', 'staff', 'lead', 'manager', 'unknown')),
  experience_min_years numeric(4, 1),
  experience_max_years numeric(4, 1),
  salary_min numeric(14, 2),
  salary_max numeric(14, 2),
  salary_currency text,
  salary_period text,
  salary_min_lpa numeric(8, 2),
  salary_max_lpa numeric(8, 2),
  description_raw text,
  description_clean text not null default '',
  extracted_skills text[] not null default '{}',
  parsed_requirements jsonb,
  posted_at timestamptz,
  expires_at timestamptz,
  is_active boolean not null default true,
  last_seen_at timestamptz not null default timezone('utc', now()),
  embedding vector(384),
  embedding_model text,
  embedding_model_version text,
  embedded_at timestamptz,
  raw_payload jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists jobs_owner_dedupe_uidx
  on public.jobs (coalesce(owner_user_id, '00000000-0000-0000-0000-000000000000'::uuid), dedupe_fingerprint);

create index if not exists jobs_embedding_hnsw_idx
  on public.jobs using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create index if not exists jobs_title_trgm_idx
  on public.jobs using gin (title gin_trgm_ops);

create index if not exists jobs_company_trgm_idx
  on public.jobs using gin (company_name gin_trgm_ops);

create index if not exists jobs_filter_idx
  on public.jobs (is_active, country_code, work_mode, seniority);

create index if not exists jobs_lpa_idx
  on public.jobs (salary_min_lpa, salary_max_lpa);

drop trigger if exists jobs_set_updated_at on public.jobs;
create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

-- 7. job_sightings (Cross-source dedupe trail)
create table if not exists public.job_sightings (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  source_type text not null,
  external_id text not null,
  source_url text not null,
  seen_at timestamptz not null default timezone('utc', now()),
  unique (job_id, source_type, external_id)
);

-- 8. job_matches (Cached 3-stage matching output per user/job/profile_version)
create table if not exists public.job_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  profile_version integer not null,
  hard_filter_passed boolean not null default true,
  hard_filter_reasons jsonb not null default '[]'::jsonb,
  vector_similarity real,
  llm_score smallint check (llm_score is null or (llm_score >= 0 and llm_score <= 100)),
  match_reason text,
  matched_skills text[] not null default '{}',
  skill_gaps text[] not null default '{}',
  provider text,
  model text,
  dismissed boolean not null default false,
  computed_at timestamptz not null default timezone('utc', now()),
  unique (user_id, job_id, profile_version)
);

create index if not exists job_matches_user_rank_idx
  on public.job_matches (user_id, profile_version, llm_score desc);

-- 9. resume_versions (Immutable tailored resume history + verifier audit)
create table if not exists public.resume_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  parent_profile_version integer not null,
  version_number integer not null,
  label text not null,
  jd_requirements jsonb not null default '{}'::jsonb,
  tailored_json_resume jsonb not null,
  diff_summary jsonb not null default '{}'::jsonb,
  verifier_report jsonb not null default '{}'::jsonb,
  verifier_passed boolean not null default false,
  template_id text not null default 'ats-classic',
  typst_source text,
  pdf_storage_path text,
  provider text,
  model text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists resume_versions_user_idx
  on public.resume_versions (user_id, created_at desc);

-- 10. applications (Application tracker)
create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  resume_version_id uuid references public.resume_versions(id) on delete set null,
  status text not null default 'saved' check (status in ('saved', 'applied', 'interview', 'offer', 'rejected', 'withdrawn')),
  applied_at timestamptz,
  next_follow_up_at timestamptz,
  follow_up_note text,
  salary_offered text,
  notes text,
  source_channel text not null default 'web',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, job_id)
);

create index if not exists applications_user_status_idx
  on public.applications (user_id, status, next_follow_up_at);

drop trigger if exists applications_set_updated_at on public.applications;
create trigger applications_set_updated_at
  before update on public.applications
  for each row execute function public.set_updated_at();

-- 11. application_events (Audit timeline per application)
create table if not exists public.application_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists application_events_app_idx
  on public.application_events (application_id, created_at desc);

-- 12. llm_usage_logs (Token, latency, retry/repair, and cost telemetry)
create table if not exists public.llm_usage_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  task_type text not null,
  provider text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  latency_ms integer not null default 0,
  estimated_cost_usd numeric(12, 6) not null default 0,
  retry_count integer not null default 0,
  used_repair boolean not null default false,
  status text not null check (status in ('ok', 'error')),
  error_code text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists llm_usage_logs_user_created_idx
  on public.llm_usage_logs (user_id, created_at desc);

-- 13. crawl_runs (GitHub Actions crawler run log)
create table if not exists public.crawl_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  stats jsonb not null default '{}'::jsonb,
  status text not null default 'running'
);
