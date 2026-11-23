import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { SeedBoardSchema, type NormalizedJobInput } from '@jobpilot/shared';
import {
  fetchAdzunaIndia,
  fetchArbeitnowFeed,
  fetchAshbyBoard,
  fetchGreenhouseBoard,
  fetchJoobleIndia,
  fetchJSearchOptional,
  fetchLeverBoard,
  fetchRemoteOkFeed,
  fetchRemotiveFeed,
  fetchWorkableBoard
} from '../connectors/index.js';
import { PoliteHttpClient } from '../http/polite-fetch.js';
import { dedupeNormalizedJobs } from '../normalize/dedupe.js';

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

function loadSeedBoards() {
  const candidates = [
    resolve(process.cwd(), 'data/seed-boards.json'),
    resolve(process.cwd(), '../../data/seed-boards.json')
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('Could not locate data/seed-boards.json');
  const raw = JSON.parse(readFileSync(found, 'utf8')) as unknown[];
  return raw.map((item) => SeedBoardSchema.parse(item)).filter((b) => b.enabled);
}

async function main() {
  loadEnvIfPresent();
  const supabaseUrl = process.env['SUPABASE_URL']?.trim();
  const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY']?.trim();
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const http = new PoliteHttpClient();
  const boards = loadSeedBoards();

  const { data: runRow } = await supabase
    .from('crawl_runs')
    .insert({ job_name: 'crawl', status: 'running' })
    .select('id')
    .single();

  const { data: existingSources } = await supabase.from('job_sources').select('*');
  const sourceCache = new Map<string, { etag: string | null; last_modified: string | null; consecutive_failures: number }>();
  for (const s of existingSources ?? []) {
    const r = s as Record<string, unknown>;
    sourceCache.set(`${r['source_type']}:${r['slug']}`, {
      etag: (r['etag'] as string | null) ?? null,
      last_modified: (r['last_modified'] as string | null) ?? null,
      consecutive_failures: Number(r['consecutive_failures'] ?? 0)
    });
  }

  const rawJobs: NormalizedJobInput[] = [];
  let boardSuccess = 0;
  let boardFailures = 0;

  for (const board of boards) {
    const key = `${board.sourceType}:${board.slug}`;
    const prev = sourceCache.get(key);
    try {
      const cond = { etag: prev?.etag, lastModified: prev?.last_modified };
      const res =
        board.sourceType === 'greenhouse'
          ? await fetchGreenhouseBoard({ slug: board.slug, companyName: board.displayName, http, conditional: cond })
          : board.sourceType === 'lever'
            ? await fetchLeverBoard({ slug: board.slug, companyName: board.displayName, http, conditional: cond })
            : board.sourceType === 'ashby'
              ? await fetchAshbyBoard({ slug: board.slug, companyName: board.displayName, http, conditional: cond })
              : await fetchWorkableBoard({ slug: board.slug, companyName: board.displayName, http, conditional: cond });

      rawJobs.push(...res.jobs);
      boardSuccess++;
      await supabase.from('job_sources').upsert(
        {
          source_type: board.sourceType,
          slug: board.slug,
          display_name: board.displayName,
          region_focus: board.regionFocus,
          enabled: board.enabled,
          etag: res.etag,
          last_modified: res.lastModified,
          last_crawled_at: new Date().toISOString(),
          last_status: res.notModified ? '304_not_modified' : `ok:${res.jobs.length}`,
          consecutive_failures: 0
        },
        { onConflict: 'source_type,slug' }
      );
    } catch (err) {
      boardFailures++;
      const msg = err instanceof Error ? err.message : String(err);
      await supabase.from('job_sources').upsert(
        {
          source_type: board.sourceType,
          slug: board.slug,
          display_name: board.displayName,
          region_focus: board.regionFocus,
          enabled: board.enabled,
          last_crawled_at: new Date().toISOString(),
          last_status: `error:${msg.slice(0, 120)}`,
          consecutive_failures: (prev?.consecutive_failures ?? 0) + 1
        },
        { onConflict: 'source_type,slug' }
      );
    }
  }

  const feeds = await Promise.allSettled([
    fetchRemotiveFeed({ http }),
    fetchArbeitnowFeed({ http }),
    fetchRemoteOkFeed({ http }),
    fetchAdzunaIndia({
      appId: process.env['ADZUNA_APP_ID'],
      appKey: process.env['ADZUNA_APP_KEY'],
      http
    }),
    fetchJoobleIndia({ apiKey: process.env['JOOBLE_API_KEY'], http }),
    fetchJSearchOptional({
      rapidApiKey: process.env['JSEARCH_RAPIDAPI_KEY'],
      maxPagesPerRun: Number.parseInt(process.env['JSEARCH_MAX_PAGES_PER_RUN'] ?? '1', 10),
      http
    })
  ]);

  for (const res of feeds) {
    if (res.status === 'fulfilled') {
      rawJobs.push(...res.value.jobs);
    }
  }

  const deduped = dedupeNormalizedJobs(rawJobs);
  let insertedCount = 0;
  let updatedCount = 0;

  for (const bundle of deduped) {
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
      p_raw_payload: j.rawPayload ?? null
    });

    if (!error && Array.isArray(data) && data[0]) {
      const row = data[0] as { job_id: string; is_new: boolean };
      if (row.is_new) insertedCount++;
      else updatedCount++;

      // Record any additional sightings from the cross-source bundle
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

  const stats = {
    boardsTotal: boards.length,
    boardSuccess,
    boardFailures,
    rawJobsCount: rawJobs.length,
    dedupedCount: deduped.length,
    insertedCount,
    updatedCount
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
