import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { loadCompanyRegistry } from '../discovery/seed-boards.js';
import { runDiscoverySync, type SourceCacheEntry } from '../discovery/sync-runner.js';
import { PoliteHttpClient } from '../http/polite-fetch.js';

function loadEnvIfPresent() {
  if (typeof process.loadEnvFile !== 'function') return;
  for (const p of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
    if (existsSync(p)) {
      try {
        process.loadEnvFile(p);
      } catch {
        // ignore
      }
    }
  }
}

async function main() {
  loadEnvIfPresent();
  const supabaseUrl = process.env['SUPABASE_URL']?.trim();
  const secretKey = (
    process.env['SUPABASE_SECRET_KEY'] ?? process.env['SUPABASE_SERVICE_ROLE_KEY']
  )?.trim();
  if (!supabaseUrl || !secretKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY (sb_secret_...)');
  }

  const supabase = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const http = new PoliteHttpClient({ timeoutMs: 10000 });
  const boards = loadCompanyRegistry();

  const { data: runRow } = await supabase
    .from('crawl_runs')
    .insert({ job_name: 'crawl', status: 'running' })
    .select('id')
    .single();

  const { data: existingSources } = await supabase.from('job_sources').select('*');
  const sourceCache = new Map<string, SourceCacheEntry>();
  for (const s of existingSources ?? []) {
    const r = s as Record<string, unknown>;
    sourceCache.set(`${r['source_type']}:${r['slug']}`, {
      etag: (r['etag'] as string | null) ?? null,
      lastModified: (r['last_modified'] as string | null) ?? null,
      lastCrawledAt: (r['last_crawled_at'] as string | null) ?? null,
      consecutiveFailures: Number(r['consecutive_failures'] ?? 0)
    });
  }

  const syncResult = await runDiscoverySync({
    mode: 'full',
    boards,
    existingSourceCache: sourceCache,
    respectRefreshTiers: process.env['CRAWL_FORCE_ALL'] !== 'true',
    envKeys: {
      adzunaAppId: process.env['ADZUNA_APP_ID'],
      adzunaAppKey: process.env['ADZUNA_APP_KEY'],
      joobleApiKey: process.env['JOOBLE_API_KEY'],
      jsearchRapidApiKey: process.env['JSEARCH_RAPIDAPI_KEY'],
      jsearchMaxPagesPerRun: Number.parseInt(process.env['JSEARCH_MAX_PAGES_PER_RUN'] ?? '1', 10)
    },
    http,
    concurrency: 6
  });

  for (const src of syncResult.sourceUpdates) {
    await supabase.from('job_sources').upsert(
      {
        source_type: src.sourceType,
        slug: src.slug,
        display_name: src.displayName,
        region_focus: src.regionFocus,
        enabled: src.enabled,
        etag: src.etag,
        last_modified: src.lastModified,
        last_crawled_at: src.lastCrawledAt,
        last_status: src.lastStatus,
        consecutive_failures: src.consecutiveFailures
      },
      { onConflict: 'source_type,slug' }
    );
  }

  let insertedCount = 0;
  let updatedCount = 0;

  for (const bundle of syncResult.bundles) {
    const j = bundle.canonical;
    const { data, error } = await supabase.rpc('upsert_public_job', {
      p_dedupe_fingerprint: bundle.fingerprint,
      p_source_type: j.sourceType,
      p_external_id: j.externalId,
      p_source_url: j.sourceUrl,
      p_apply_url: j.applyUrl,
      p_company_name: j.companyName,
      p_company_domain: j.companyDomain,
      p_company_logo_url: j.companyLogoUrl,
      p_title: j.title,
      p_normalized_title: j.normalizedTitle,
      p_location_raw: j.locationRaw,
      p_city: j.city,
      p_country_code: j.countryCode,
      p_work_mode: j.workMode,
      p_seniority: j.seniority,
      p_experience_min_years: j.experienceMinYears,
      p_experience_max_years: j.experienceMaxYears,
      p_salary_min: j.salaryMin,
      p_salary_max: j.salaryMax,
      p_salary_currency: j.salaryCurrency,
      p_salary_period: j.salaryPeriod,
      p_salary_min_lpa: j.salaryMinLpa,
      p_salary_max_lpa: j.salaryMaxLpa,
      p_description_raw: j.descriptionRaw,
      p_description_clean: j.descriptionClean,
      p_extracted_skills: j.extractedSkills,
      p_posted_at: j.postedAt,
      p_raw_payload: j.rawPayload ?? null,
      p_employment_type: j.employmentType ?? 'unknown',
      p_fresher_eligible: j.fresherEligible ?? null,
      p_stipend_monthly_inr: j.stipendMonthlyInr ?? null,
      p_career_category: j.careerCategory ?? 'other',
      p_board_key: j.boardKey ?? null
    });

    if (!error && Array.isArray(data) && data[0]) {
      const row = data[0] as { job_id: string; is_new: boolean };
      if (row.is_new) insertedCount++;
      else updatedCount++;

      for (const sighting of bundle.sightings.slice(1)) {
        await supabase.from('job_sightings').upsert(
          {
            job_id: row.job_id,
            source_type: sighting.sourceType,
            external_id: sighting.externalId,
            source_url: sighting.sourceUrl,
            seen_at: sighting.seenAt
          },
          { onConflict: 'job_id,source_type,external_id' }
        );
      }
    }
  }

  let expiredCount = 0;
  for (const boardSnap of syncResult.reconcilableBoards) {
    if (boardSnap.activeExternalIds.length === 0) continue;
    const { data: reconciled, error: reconcileErr } = await supabase.rpc(
      'reconcile_board_expired_jobs',
      {
        p_board_key: boardSnap.boardKey,
        p_active_external_ids: boardSnap.activeExternalIds
      }
    );
    if (!reconcileErr && reconciled != null) {
      expiredCount += Number(reconciled) || 0;
    }
  }
  const { data: staleExpired, error: staleErr } = await supabase.rpc(
    'expire_stale_public_jobs',
    { p_stale_days: 14 }
  );
  if (!staleErr && staleExpired != null) {
    expiredCount += Number(staleExpired) || 0;
  }

  const stats = {
    ...syncResult.stats,
    insertedCount,
    updatedCount,
    expiredCount
  };

  if (runRow?.id) {
    await supabase
      .from('crawl_runs')
      .update({ finished_at: new Date().toISOString(), status: 'ok', stats })
      .eq('id', runRow.id);
  }

  console.log('JobPilot crawl finished:', JSON.stringify(stats, null, 2));
}

main().catch((err) => {
  console.error('JobPilot crawl failed:', err);
  process.exit(1);
});
