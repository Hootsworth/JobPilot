-- JobPilot Row-Level Security (RLS) & Private Storage Buckets

-- Enable RLS on all 13 tables
alter table public.profiles enable row level security;
alter table public.profile_stories enable row level security;
alter table public.saved_answers enable row level security;
alter table public.user_llm_settings enable row level security;
alter table public.job_sources enable row level security;
alter table public.jobs enable row level security;
alter table public.job_sightings enable row level security;
alter table public.job_matches enable row level security;
alter table public.resume_versions enable row level security;
alter table public.applications enable row level security;
alter table public.application_events enable row level security;
alter table public.llm_usage_logs enable row level security;
alter table public.crawl_runs enable row level security;

-- 1. profiles: strictly owner-only
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists profiles_delete_own on public.profiles;
create policy profiles_delete_own on public.profiles
  for delete using (auth.uid() = id);

-- 2. profile_stories
drop policy if exists profile_stories_own on public.profile_stories;
create policy profile_stories_own on public.profile_stories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 3. saved_answers
drop policy if exists saved_answers_own on public.saved_answers;
create policy saved_answers_own on public.saved_answers
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 4. user_llm_settings
drop policy if exists user_llm_settings_own on public.user_llm_settings;
create policy user_llm_settings_own on public.user_llm_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 5. job_sources: readable by authenticated users; service role writes
drop policy if exists job_sources_read_auth on public.job_sources;
create policy job_sources_read_auth on public.job_sources
  for select using (auth.role() = 'authenticated');

-- 6. jobs: public catalog (owner_user_id is null) readable by authenticated users;
--    extension-captured jobs (owner_user_id = auth.uid()) strictly private to owner
drop policy if exists jobs_read_public_or_own on public.jobs;
create policy jobs_read_public_or_own on public.jobs
  for select using (
    (owner_user_id is null and auth.role() = 'authenticated')
    or owner_user_id = auth.uid()
  );

drop policy if exists jobs_insert_own on public.jobs;
create policy jobs_insert_own on public.jobs
  for insert with check (owner_user_id = auth.uid());

drop policy if exists jobs_update_own on public.jobs;
create policy jobs_update_own on public.jobs
  for update using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

drop policy if exists jobs_delete_own on public.jobs;
create policy jobs_delete_own on public.jobs
  for delete using (owner_user_id = auth.uid());

-- 7. job_sightings: inherits visibility of parent job
drop policy if exists job_sightings_read_parent on public.job_sightings;
create policy job_sightings_read_parent on public.job_sightings
  for select using (
    exists (
      select 1 from public.jobs j
      where j.id = job_sightings.job_id
        and ((j.owner_user_id is null and auth.role() = 'authenticated') or j.owner_user_id = auth.uid())
    )
  );

-- 8. job_matches
drop policy if exists job_matches_own on public.job_matches;
create policy job_matches_own on public.job_matches
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 9. resume_versions
drop policy if exists resume_versions_own on public.resume_versions;
create policy resume_versions_own on public.resume_versions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 10. applications
drop policy if exists applications_own on public.applications;
create policy applications_own on public.applications
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 11. application_events
drop policy if exists application_events_own on public.application_events;
create policy application_events_own on public.application_events
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 12. llm_usage_logs
drop policy if exists llm_usage_logs_select_own on public.llm_usage_logs;
create policy llm_usage_logs_select_own on public.llm_usage_logs
  for select using (auth.uid() = user_id);

drop policy if exists llm_usage_logs_insert_own on public.llm_usage_logs;
create policy llm_usage_logs_insert_own on public.llm_usage_logs
  for insert with check (auth.uid() = user_id);

-- 13. crawl_runs: readable by authenticated users; service role writes
drop policy if exists crawl_runs_read_auth on public.crawl_runs;
create policy crawl_runs_read_auth on public.crawl_runs
  for select using (auth.role() = 'authenticated');

-- Private Storage buckets for raw uploaded resumes & tailored rendered PDFs
insert into storage.buckets (id, name, public)
values ('resumes-raw', 'resumes-raw', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('resumes-rendered', 'resumes-rendered', false)
on conflict (id) do nothing;

drop policy if exists resumes_storage_select_own on storage.objects;
create policy resumes_storage_select_own on storage.objects
  for select using (
    bucket_id in ('resumes-raw', 'resumes-rendered')
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists resumes_storage_insert_own on storage.objects;
create policy resumes_storage_insert_own on storage.objects
  for insert with check (
    bucket_id in ('resumes-raw', 'resumes-rendered')
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists resumes_storage_update_own on storage.objects;
create policy resumes_storage_update_own on storage.objects
  for update using (
    bucket_id in ('resumes-raw', 'resumes-rendered')
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id in ('resumes-raw', 'resumes-rendered')
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists resumes_storage_delete_own on storage.objects;
create policy resumes_storage_delete_own on storage.objects
  for delete using (
    bucket_id in ('resumes-raw', 'resumes-rendered')
    and auth.uid()::text = (storage.foldername(name))[1]
  );
