-- Job lifecycle, expanded normalization fields, and board/TTL expiration RPCs

alter table public.jobs
  add column if not exists employment_type text not null default 'unknown',
  add column if not exists fresher_eligible boolean,
  add column if not exists stipend_monthly_inr numeric(12, 2),
  add column if not exists career_category text not null default 'other',
  add column if not exists board_key text;

create index if not exists jobs_board_key_active_idx
  on public.jobs (board_key, is_active)
  where board_key is not null;

create index if not exists jobs_category_active_idx
  on public.jobs (is_active, career_category, employment_type);

drop function if exists public.upsert_public_job(
  text, text, text, text, text, text, text, text, text, text, text, text, text,
  text, text, numeric, numeric, numeric, numeric, text, text, numeric, numeric,
  text, text, text[], timestamptz, jsonb
);

create or replace function public.upsert_public_job(
  p_dedupe_fingerprint text,
  p_source_type text,
  p_external_id text,
  p_source_url text,
  p_apply_url text,
  p_company_name text,
  p_company_domain text,
  p_company_logo_url text,
  p_title text,
  p_normalized_title text,
  p_location_raw text,
  p_city text,
  p_country_code text,
  p_work_mode text,
  p_seniority text,
  p_experience_min_years numeric,
  p_experience_max_years numeric,
  p_salary_min numeric,
  p_salary_max numeric,
  p_salary_currency text,
  p_salary_period text,
  p_salary_min_lpa numeric,
  p_salary_max_lpa numeric,
  p_description_raw text,
  p_description_clean text,
  p_extracted_skills text[],
  p_posted_at timestamptz,
  p_raw_payload jsonb,
  p_employment_type text default 'unknown',
  p_fresher_eligible boolean default null,
  p_stipend_monthly_inr numeric default null,
  p_career_category text default 'other',
  p_board_key text default null
)
returns table (job_id uuid, is_new boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
  v_existing_source text;
  v_is_new boolean := false;
  v_incoming_is_ats boolean := p_source_type in ('greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters', 'workday');
  v_existing_is_ats boolean := false;
begin
  select id, source_type
    into v_job_id, v_existing_source
  from public.jobs
  where owner_user_id is null
    and dedupe_fingerprint = p_dedupe_fingerprint
  limit 1;

  if v_job_id is null and p_source_type is not null and p_external_id is not null then
    select id, source_type
      into v_job_id, v_existing_source
    from public.jobs
    where owner_user_id is null
      and source_type = p_source_type
      and external_id = p_external_id
    limit 1;
  end if;

  if v_job_id is null then
    insert into public.jobs (
      owner_user_id,
      dedupe_fingerprint,
      source_type,
      external_id,
      source_url,
      apply_url,
      company_name,
      company_domain,
      company_logo_url,
      title,
      normalized_title,
      location_raw,
      city,
      country_code,
      work_mode,
      seniority,
      employment_type,
      fresher_eligible,
      stipend_monthly_inr,
      career_category,
      board_key,
      experience_min_years,
      experience_max_years,
      salary_min,
      salary_max,
      salary_currency,
      salary_period,
      salary_min_lpa,
      salary_max_lpa,
      description_raw,
      description_clean,
      extracted_skills,
      posted_at,
      is_active,
      expires_at,
      last_seen_at,
      raw_payload
    ) values (
      null,
      p_dedupe_fingerprint,
      p_source_type,
      p_external_id,
      p_source_url,
      p_apply_url,
      p_company_name,
      p_company_domain,
      p_company_logo_url,
      p_title,
      p_normalized_title,
      p_location_raw,
      p_city,
      p_country_code,
      coalesce(p_work_mode, 'unknown'),
      coalesce(p_seniority, 'unknown'),
      coalesce(p_employment_type, 'unknown'),
      p_fresher_eligible,
      p_stipend_monthly_inr,
      coalesce(p_career_category, 'other'),
      p_board_key,
      p_experience_min_years,
      p_experience_max_years,
      p_salary_min,
      p_salary_max,
      p_salary_currency,
      p_salary_period,
      p_salary_min_lpa,
      p_salary_max_lpa,
      p_description_raw,
      coalesce(p_description_clean, ''),
      coalesce(p_extracted_skills, '{}'),
      p_posted_at,
      true,
      null,
      timezone('utc', now()),
      p_raw_payload
    )
    returning id into v_job_id;
    v_is_new := true;
  else
    v_existing_is_ats := v_existing_source in ('greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters', 'workday');

    update public.jobs
    set
      is_active = true,
      expires_at = null,
      last_seen_at = timezone('utc', now()),
      source_type = case when v_incoming_is_ats and not v_existing_is_ats then p_source_type else source_type end,
      external_id = case when v_incoming_is_ats and not v_existing_is_ats then p_external_id else external_id end,
      source_url = case when v_incoming_is_ats and not v_existing_is_ats then p_source_url else source_url end,
      apply_url = coalesce(
        case when v_incoming_is_ats and not v_existing_is_ats then p_apply_url else apply_url end,
        p_apply_url
      ),
      city = coalesce(city, p_city),
      country_code = coalesce(country_code, p_country_code),
      work_mode = case when work_mode = 'unknown' and p_work_mode <> 'unknown' then p_work_mode else work_mode end,
      seniority = case when seniority = 'unknown' and p_seniority <> 'unknown' then p_seniority else seniority end,
      employment_type = case when employment_type = 'unknown' and coalesce(p_employment_type, 'unknown') <> 'unknown' then p_employment_type else employment_type end,
      fresher_eligible = coalesce(fresher_eligible, p_fresher_eligible),
      stipend_monthly_inr = coalesce(stipend_monthly_inr, p_stipend_monthly_inr),
      career_category = case when career_category = 'other' and coalesce(p_career_category, 'other') <> 'other' then p_career_category else career_category end,
      board_key = coalesce(board_key, p_board_key),
      experience_min_years = coalesce(experience_min_years, p_experience_min_years),
      experience_max_years = coalesce(experience_max_years, p_experience_max_years),
      salary_min = coalesce(salary_min, p_salary_min),
      salary_max = coalesce(salary_max, p_salary_max),
      salary_currency = coalesce(salary_currency, p_salary_currency),
      salary_period = coalesce(salary_period, p_salary_period),
      salary_min_lpa = coalesce(salary_min_lpa, p_salary_min_lpa),
      salary_max_lpa = coalesce(salary_max_lpa, p_salary_max_lpa),
      description_clean = case
        when length(coalesce(p_description_clean, '')) > length(coalesce(description_clean, ''))
        then p_description_clean
        else description_clean
      end,
      extracted_skills = array(
        select distinct s
        from unnest(coalesce(extracted_skills, '{}') || coalesce(p_extracted_skills, '{}')) as s
        order by s
      ),
      posted_at = coalesce(posted_at, p_posted_at)
    where id = v_job_id;
  end if;

  insert into public.job_sightings (job_id, source_type, external_id, source_url, seen_at)
  values (
    v_job_id,
    p_source_type,
    coalesce(p_external_id, p_source_url),
    p_source_url,
    timezone('utc', now())
  )
  on conflict (job_id, source_type, external_id)
  do update set
    source_url = excluded.source_url,
    seen_at = excluded.seen_at;

  return query select v_job_id, v_is_new;
end;
$$;

revoke all on function public.upsert_public_job(
  text, text, text, text, text, text, text, text, text, text, text, text, text,
  text, text, numeric, numeric, numeric, numeric, text, text, numeric, numeric,
  text, text, text[], timestamptz, jsonb, text, boolean, numeric, text, text
) from public;
grant execute on function public.upsert_public_job(
  text, text, text, text, text, text, text, text, text, text, text, text, text,
  text, text, numeric, numeric, numeric, numeric, text, text, numeric, numeric,
  text, text, text[], timestamptz, jsonb, text, boolean, numeric, text, text
) to service_role;

create or replace function public.reconcile_board_expired_jobs(
  p_board_key text,
  p_active_external_ids text[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expired integer := 0;
begin
  if p_board_key is null or length(trim(p_board_key)) = 0 then
    return 0;
  end if;
  if p_active_external_ids is null or cardinality(p_active_external_ids) = 0 then
    return 0;
  end if;

  update public.jobs
  set
    is_active = false,
    expires_at = coalesce(expires_at, timezone('utc', now()))
  where owner_user_id is null
    and is_active = true
    and board_key = p_board_key
    and external_id is not null
    and not (external_id = any(p_active_external_ids));

  get diagnostics v_expired = row_count;
  return v_expired;
end;
$$;

revoke all on function public.reconcile_board_expired_jobs(text, text[]) from public;
grant execute on function public.reconcile_board_expired_jobs(text, text[]) to service_role;

create or replace function public.expire_stale_public_jobs(
  p_stale_days integer default 14
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expired integer := 0;
begin
  update public.jobs
  set
    is_active = false,
    expires_at = coalesce(expires_at, timezone('utc', now()))
  where owner_user_id is null
    and is_active = true
    and (
      last_seen_at < timezone('utc', now()) - make_interval(days => greatest(1, p_stale_days))
      or (expires_at is not null and expires_at < timezone('utc', now()))
    );

  get diagnostics v_expired = row_count;
  return v_expired;
end;
$$;

revoke all on function public.expire_stale_public_jobs(integer) from public;
grant execute on function public.expire_stale_public_jobs(integer) to service_role;
