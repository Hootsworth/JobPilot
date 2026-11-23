import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { createLlmProviderFromEnv, type LlmProvider } from '@jobpilot/llm';
import {
  EMBEDDING_MODEL_NAME,
  EMBEDDING_MODEL_VERSION
} from '@jobpilot/embeddings';
import {
  IndiaProfileSchema,
  JsonResumeSchema,
  JobRecordSchema,
  SearchPreferencesSchema,
  type MasterProfile
} from '@jobpilot/shared';
import { runThreeStageMatching, type JobForMatching } from '../matching/matcher.js';

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

function parseVector(raw: unknown): number[] | null {
  if (Array.isArray(raw)) return raw.map(Number);
  if (typeof raw === 'string' && raw.startsWith('[')) {
    try {
      return (JSON.parse(raw) as unknown[]).map(Number);
    } catch {
      return null;
    }
  }
  return null;
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

  let llmProvider: LlmProvider | null = null;
  try {
    llmProvider = createLlmProviderFromEnv(process.env, async (entry) => {
      await supabase.from('llm_usage_logs').insert({
        user_id: entry.userId ?? null,
        task_type: entry.taskType,
        provider: entry.provider,
        model: entry.model,
        input_tokens: entry.inputTokens,
        output_tokens: entry.outputTokens,
        latency_ms: entry.latencyMs,
        estimated_cost_usd: entry.estimatedCostUsd,
        retry_count: entry.retryCount,
        used_repair: entry.usedRepair,
        status: entry.status,
        error_code: entry.errorCode ?? null
      });
    });
  } catch {
    console.log('No server LLM key configured for batch score; running Stage 1+2 heuristic scoring.');
  }

  const { data: profiles } = await supabase
    .from('profiles')
    .select('*')
    .not('onboarding_completed_at', 'is', null)
    .limit(100);

  const { data: rawJobs } = await supabase
    .from('jobs')
    .select('*')
    .is('owner_user_id', null)
    .eq('is_active', true)
    .order('posted_at', { ascending: false, nullsFirst: false })
    .limit(200);

  const jobs: JobForMatching[] = ((rawJobs ?? []) as Array<Record<string, unknown>>).map((r) => ({
    ...JobRecordSchema.parse({
      id: r['id'],
      ownerUserId: r['owner_user_id'] ?? null,
      dedupeFingerprint: r['dedupe_fingerprint'],
      sourceType: r['source_type'],
      externalId: r['external_id'] ?? null,
      sourceUrl: r['source_url'],
      applyUrl: r['apply_url'] ?? null,
      companyName: r['company_name'],
      companyDomain: r['company_domain'] ?? null,
      companyLogoUrl: r['company_logo_url'] ?? null,
      title: r['title'],
      normalizedTitle: r['normalized_title'] ?? null,
      locationRaw: r['location_raw'] ?? null,
      city: r['city'] ?? null,
      countryCode: r['country_code'] ?? null,
      workMode: r['work_mode'] ?? 'unknown',
      seniority: r['seniority'] ?? 'unknown',
      experienceMinYears: r['experience_min_years'] != null ? Number(r['experience_min_years']) : null,
      experienceMaxYears: r['experience_max_years'] != null ? Number(r['experience_max_years']) : null,
      salaryMin: r['salary_min'] != null ? Number(r['salary_min']) : null,
      salaryMax: r['salary_max'] != null ? Number(r['salary_max']) : null,
      salaryCurrency: r['salary_currency'] ?? null,
      salaryPeriod: r['salary_period'] ?? null,
      salaryMinLpa: r['salary_min_lpa'] != null ? Number(r['salary_min_lpa']) : null,
      salaryMaxLpa: r['salary_max_lpa'] != null ? Number(r['salary_max_lpa']) : null,
      descriptionClean: r['description_clean'] ?? '',
      extractedSkills: Array.isArray(r['extracted_skills']) ? r['extracted_skills'] : [],
      postedAt: r['posted_at'] ?? null,
      isActive: Boolean(r['is_active']),
      lastSeenAt: String(r['last_seen_at']),
      embeddingModel: r['embedding_model'] ?? null,
      embeddingModelVersion: r['embedding_model_version'] ?? null,
      embeddedAt: r['embedded_at'] ?? null,
      sightingsCount: 1
    }),
    embedding: parseVector(r['embedding'])
  }));

  let totalMatched = 0;
  for (const row of (profiles ?? []) as Array<Record<string, unknown>>) {
    const profile: MasterProfile = {
      id: String(row['id']),
      fullName: (row['full_name'] as string | null) ?? null,
      email: (row['email'] as string | null) ?? null,
      phone: (row['phone'] as string | null) ?? null,
      activeProfileVersion: Number(row['active_profile_version'] ?? 1),
      jsonResume: JsonResumeSchema.parse(row['json_resume'] ?? {}),
      indiaProfile: IndiaProfileSchema.parse(row['india_profile'] ?? {}),
      searchPreferences: SearchPreferencesSchema.parse(row['search_preferences'] ?? {}),
      sourceResumeStoragePath: (row['source_resume_storage_path'] as string | null) ?? null,
      embeddingModel: (row['embedding_model'] as string | null) ?? null,
      embeddingModelVersion: (row['embedding_model_version'] as string | null) ?? null,
      embeddedAt: (row['embedded_at'] as string | null) ?? null,
      telemetryOptIn: Boolean(row['telemetry_opt_in']),
      onboardingCompletedAt: (row['onboarding_completed_at'] as string | null) ?? null,
      updatedAt: String(row['updated_at'] ?? new Date().toISOString())
    };

    const profileVec = parseVector(row['embedding']);
    const result = await runThreeStageMatching({
      profile,
      jobs,
      profileEmbedding:
        profileVec && profile.embeddingModel && profile.embeddingModelVersion
          ? {
              vector: profileVec,
              model: profile.embeddingModel || EMBEDDING_MODEL_NAME,
              version: profile.embeddingModelVersion || EMBEDDING_MODEL_VERSION
            }
          : null,
      llmProvider
    });

    if (result.matches.length > 0) {
      await supabase.from('job_matches').upsert(
        result.matches.map((m) => ({
          user_id: profile.id,
          job_id: m.jobId,
          profile_version: m.profileVersion,
          hard_filter_passed: m.hardFilterPassed,
          hard_filter_reasons: m.hardFilterReasons,
          vector_similarity: m.vectorSimilarity,
          llm_score: m.llmScore,
          match_reason: m.matchReason,
          matched_skills: m.matchedSkills,
          skill_gaps: m.skillGaps,
          provider: m.provider,
          model: m.model,
          dismissed: m.dismissed,
          computed_at: m.computedAt
        })),
        { onConflict: 'user_id,job_id,profile_version' }
      );
      totalMatched += result.matches.length;
    }
  }

  console.log('JobPilot batch scoring finished:', JSON.stringify({ totalMatched }));
}

main().catch((err) => {
  console.error('JobPilot batch scoring failed:', err);
  process.exit(1);
});
