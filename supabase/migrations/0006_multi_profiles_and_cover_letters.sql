-- Multi-profile variants (#8) and grounded cover letters (#1)

create table if not exists public.profile_variants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  slug text not null,
  target_role text not null default '',
  is_default boolean not null default false,
  json_resume jsonb not null default '{}'::jsonb,
  india_profile jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug)
);

create unique index if not exists idx_profile_variants_default_per_user
  on public.profile_variants (user_id)
  where is_default = true;

create index if not exists idx_profile_variants_user_id
  on public.profile_variants (user_id, updated_at desc);

create table if not exists public.cover_letters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  profile_variant_id uuid references public.profile_variants(id) on delete set null,
  parent_profile_version integer not null default 1,
  version_number integer not null default 1,
  label text not null,
  company_name text not null,
  role_title text not null,
  tone text not null default 'concise-technical',
  jd_requirements jsonb not null default '{}'::jsonb,
  content jsonb not null default '{}'::jsonb,
  plain_text text not null default '',
  verifier_report jsonb not null default '{}'::jsonb,
  verifier_passed boolean not null default false,
  typst_source text,
  pdf_storage_path text,
  pdf_engine text not null default 'builtin-ats-pdf',
  provider text,
  model text,
  created_at timestamptz not null default now()
);

create index if not exists idx_cover_letters_user_created
  on public.cover_letters (user_id, created_at desc);

create index if not exists idx_cover_letters_job_id
  on public.cover_letters (job_id);

alter table public.resume_versions
  add column if not exists profile_variant_id uuid references public.profile_variants(id) on delete set null;

create index if not exists idx_resume_versions_variant_id
  on public.resume_versions (profile_variant_id);

alter table public.applications
  add column if not exists cover_letter_id uuid references public.cover_letters(id) on delete set null;

create index if not exists idx_applications_cover_letter_id
  on public.applications (cover_letter_id);

alter table public.profile_variants enable row level security;
alter table public.cover_letters enable row level security;

drop policy if exists "profile_variants_owner_all" on public.profile_variants;
create policy "profile_variants_owner_all"
  on public.profile_variants
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "cover_letters_owner_all" on public.cover_letters;
create policy "cover_letters_owner_all"
  on public.cover_letters
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant all on table public.profile_variants to service_role;
grant select, insert, update, delete on table public.profile_variants to authenticated;

grant all on table public.cover_letters to service_role;
grant select, insert, update, delete on table public.cover_letters to authenticated;
