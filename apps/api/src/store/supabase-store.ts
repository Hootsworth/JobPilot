import { createHash, randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  ApplicationStatusSchema,
  CoverLetterContentSchema,
  CoverLetterToneSchema,
  CrawlRunSummarySchema,
  IndiaProfileSchema,
  JdRequirementsSchema,
  JobMatchSchema,
  JobRecordSchema,
  JobSightingSchema,
  JobSourceStatusSchema,
  JsonResumeSchema,
  LlmProviderIdSchema,
  ProviderCapabilitiesSchema,
  ResumeDiffSummarySchema,
  ResumeTemplateIdSchema,
  ResumeVersionRecordSchema,
  SearchPreferencesSchema,
  StoryCategorySchema,
  StoryMetricSchema,
  VerifierReportSchema,
  type ApplicationEventRecord,
  type ApplicationRecord,
  type ApplicationStatus,
  type CaptureExtensionJobRequest,
  type CaptureExtensionJobResponse,
  type CoverLetterRecord,
  type CrawlRunSummary,
  type CreateManualApplicationRequest,
  type CreateProfileVariantRequest,
  type DismissReason,
  type JdRequirements,
  type JobFeedItem,
  type JobFeedQuery,
  type JobMatch,
  type JobRecord,
  type JobSighting,
  type JobSourceStatus,
  type LlmProviderId,
  type LlmUsageLog,
  type LlmUsageSummary,
  type MasterProfile,
  type ProfileStory,
  type ProfileVariantRecord,
  type ResumeVersionRecord,
  type SavedAnswer,
  type UpdateApplicationRequest,
  type UpdateProfileVariantRequest,
  type UpsertSavedAnswerRequest,
  type UpsertStoryRequest,
  type VerifierReport
} from '@jobpilot/shared';
import type {
  DedupedJobBundle,
  JobForMatching,
  SourceCacheEntry
} from '@jobpilot/ingestion';
import type { LlmCallLogEntry } from '@jobpilot/llm';
import {
  buildUsageSummary,
  matchesFeedBucket,
  mergeDismissReason,
  slugifyVariantName
} from './memory-store.js';
import type {
  AccountExportPayload,
  AuthUser,
  CreateCoverLetterInput,
  CreateResumeVersionInput,
  DataStore,
  LlmSettingPatch,
  ProfilePatch,
  StoredLlmSetting,
  UpdateCoverLetterPatch,
  UpsertJobSourceStatusInput
} from './types.js';

function mapProfileRow(row: Record<string, unknown>): MasterProfile {
  return {
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
}

function mapStoryRow(row: Record<string, unknown>): ProfileStory {
  const rawMetrics = Array.isArray(row['metrics']) ? row['metrics'] : [];
  const metrics = rawMetrics
    .map((m) => StoryMetricSchema.safeParse(m))
    .filter((r) => r.success)
    .map((r) => r.data);

  const cat = StoryCategorySchema.safeParse(row['category']);
  return {
    id: String(row['id']),
    userId: String(row['user_id']),
    title: String(row['title'] ?? ''),
    category: cat.success ? cat.data : 'project',
    situation: String(row['situation'] ?? ''),
    task: String(row['task'] ?? ''),
    action: String(row['action'] ?? ''),
    result: String(row['result'] ?? ''),
    metrics,
    skillsUsed: Array.isArray(row['skills_used']) ? (row['skills_used'] as string[]) : [],
    linkedExperienceId: (row['linked_experience_id'] as string | null) ?? null,
    createdAt: String(row['created_at']),
    updatedAt: String(row['updated_at'])
  };
}

function mapSavedAnswerRow(row: Record<string, unknown>): SavedAnswer {
  return {
    id: String(row['id']),
    userId: String(row['user_id']),
    questionKey: String(row['question_key'] ?? ''),
    questionPattern: String(row['question_pattern'] ?? ''),
    answer: String(row['answer'] ?? ''),
    tags: Array.isArray(row['tags']) ? (row['tags'] as string[]) : [],
    createdAt: String(row['created_at']),
    updatedAt: String(row['updated_at'])
  };
}

function mapLlmSettingRow(row: Record<string, unknown>): StoredLlmSetting {
  const caps = row['detected_capabilities']
    ? ProviderCapabilitiesSchema.safeParse(row['detected_capabilities'])
    : null;
  const rawStatus = row['last_test_status'];
  const status =
    rawStatus === 'ok' || rawStatus === 'error' || rawStatus === 'untested'
      ? rawStatus
      : null;

  return {
    userId: String(row['user_id']),
    provider: LlmProviderIdSchema.parse(row['provider']),
    isActive: Boolean(row['is_active']),
    selectedModel: (row['selected_model'] as string | null) ?? null,
    baseUrlOverride: (row['base_url_override'] as string | null) ?? null,
    encryptedApiKey: (row['encrypted_api_key'] as string | null) ?? null,
    keyIv: (row['key_iv'] as string | null) ?? null,
    keyAuthTag: (row['key_auth_tag'] as string | null) ?? null,
    keyHint: (row['key_hint'] as string | null) ?? null,
    detectedCapabilities: caps?.success ? caps.data : null,
    lastTestedAt: (row['last_tested_at'] as string | null) ?? null,
    lastTestStatus: status,
    updatedAt: String(row['updated_at'] ?? new Date().toISOString())
  };
}

function parsePgVector(raw: unknown): number[] | null {
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

function mapJobRow(row: Record<string, unknown>, sightingsCount: number = 1): JobRecord {
  return JobRecordSchema.parse({
    id: row['id'],
    ownerUserId: row['owner_user_id'] ?? null,
    dedupeFingerprint: row['dedupe_fingerprint'],
    sourceType: row['source_type'],
    externalId: row['external_id'] ?? null,
    sourceUrl: row['source_url'],
    applyUrl: row['apply_url'] ?? null,
    companyName: row['company_name'],
    companyDomain: row['company_domain'] ?? null,
    companyLogoUrl: row['company_logo_url'] ?? null,
    title: row['title'],
    normalizedTitle: row['normalized_title'] ?? null,
    locationRaw: row['location_raw'] ?? null,
    city: row['city'] ?? null,
    countryCode: row['country_code'] ?? null,
    workMode: row['work_mode'] ?? 'unknown',
    seniority: row['seniority'] ?? 'unknown',
    experienceMinYears: row['experience_min_years'] != null ? Number(row['experience_min_years']) : null,
    experienceMaxYears: row['experience_max_years'] != null ? Number(row['experience_max_years']) : null,
    salaryMin: row['salary_min'] != null ? Number(row['salary_min']) : null,
    salaryMax: row['salary_max'] != null ? Number(row['salary_max']) : null,
    salaryCurrency: row['salary_currency'] ?? null,
    salaryPeriod: row['salary_period'] ?? null,
    salaryMinLpa: row['salary_min_lpa'] != null ? Number(row['salary_min_lpa']) : null,
    salaryMaxLpa: row['salary_max_lpa'] != null ? Number(row['salary_max_lpa']) : null,
    descriptionClean: row['description_clean'] ?? '',
    extractedSkills: Array.isArray(row['extracted_skills']) ? row['extracted_skills'] : [],
    postedAt: row['posted_at'] ?? null,
    isActive: Boolean(row['is_active']),
    lastSeenAt: String(row['last_seen_at'] ?? row['updated_at'] ?? new Date().toISOString()),
    embeddingModel: row['embedding_model'] ?? null,
    embeddingModelVersion: row['embedding_model_version'] ?? null,
    embeddedAt: row['embedded_at'] ?? null,
    sightingsCount
  });
}

function mapJobMatchRow(row: Record<string, unknown>): JobMatch {
  return JobMatchSchema.parse({
    id: row['id'],
    jobId: row['job_id'],
    profileVersion: Number(row['profile_version']),
    hardFilterPassed: Boolean(row['hard_filter_passed']),
    hardFilterReasons: Array.isArray(row['hard_filter_reasons']) ? row['hard_filter_reasons'] : [],
    vectorSimilarity: row['vector_similarity'] != null ? Number(row['vector_similarity']) : null,
    llmScore: row['llm_score'] != null ? Number(row['llm_score']) : null,
    matchReason: (row['match_reason'] as string | null) ?? null,
    matchedSkills: Array.isArray(row['matched_skills']) ? row['matched_skills'] : [],
    skillGaps: Array.isArray(row['skill_gaps']) ? row['skill_gaps'] : [],
    provider: (row['provider'] as string | null) ?? null,
    model: (row['model'] as string | null) ?? null,
    dismissed: Boolean(row['dismissed']),
    computedAt: String(row['computed_at'])
  });
}

function mapResumeVersionRow(row: Record<string, unknown>): ResumeVersionRecord {
  const rawPdfEngine = row['pdf_engine'];
  return ResumeVersionRecordSchema.parse({
    id: row['id'],
    userId: row['user_id'],
    jobId: row['job_id'] ?? null,
    profileVariantId: (row['profile_variant_id'] as string | null) ?? null,
    parentProfileVersion: Number(row['parent_profile_version'] ?? 1),
    versionNumber: Number(row['version_number'] ?? 1),
    label: String(row['label'] ?? ''),
    jdRequirements: JdRequirementsSchema.parse(row['jd_requirements'] ?? {}),
    tailoredJsonResume: JsonResumeSchema.parse(row['tailored_json_resume'] ?? {}),
    diffSummary: ResumeDiffSummarySchema.parse(row['diff_summary'] ?? {}),
    verifierReport: VerifierReportSchema.parse(row['verifier_report'] ?? {}),
    verifierPassed: Boolean(row['verifier_passed']),
    templateId: ResumeTemplateIdSchema.catch('ats-classic').parse(row['template_id']),
    typstSource: (row['typst_source'] as string | null) ?? null,
    pdfStoragePath: (row['pdf_storage_path'] as string | null) ?? null,
    pdfEngine: rawPdfEngine === 'typst' ? 'typst' : 'builtin-ats-pdf',
    provider: (row['provider'] as string | null) ?? null,
    model: (row['model'] as string | null) ?? null,
    createdAt: String(row['created_at'])
  });
}

function mapProfileVariantRow(row: Record<string, unknown>): ProfileVariantRecord {
  return {
    id: String(row['id']),
    userId: String(row['user_id']),
    name: String(row['name'] ?? 'Default'),
    slug: String(row['slug'] ?? 'default'),
    targetRole: String(row['target_role'] ?? ''),
    isDefault: Boolean(row['is_default']),
    jsonResume: JsonResumeSchema.parse(row['json_resume'] ?? {}),
    indiaProfile: IndiaProfileSchema.parse(row['india_profile'] ?? {}),
    version: Number(row['version'] ?? 1),
    createdAt: String(row['created_at'] ?? new Date().toISOString()),
    updatedAt: String(row['updated_at'] ?? new Date().toISOString())
  };
}

function mapCoverLetterRow(row: Record<string, unknown>): CoverLetterRecord {
  const rawPdfEngine = row['pdf_engine'];
  return {
    id: String(row['id']),
    userId: String(row['user_id']),
    jobId: (row['job_id'] as string | null) ?? null,
    profileVariantId: (row['profile_variant_id'] as string | null) ?? null,
    parentProfileVersion: Number(row['parent_profile_version'] ?? 1),
    versionNumber: Number(row['version_number'] ?? 1),
    label: String(row['label'] ?? ''),
    companyName: String(row['company_name'] ?? ''),
    roleTitle: String(row['role_title'] ?? ''),
    tone: CoverLetterToneSchema.catch('concise-technical').parse(row['tone']),
    jdRequirements: JdRequirementsSchema.parse(row['jd_requirements'] ?? {}),
    content: CoverLetterContentSchema.parse(row['content'] ?? {}),
    plainText: String(row['plain_text'] ?? ''),
    verifierReport: VerifierReportSchema.parse(row['verifier_report'] ?? {}),
    verifierPassed: Boolean(row['verifier_passed']),
    typstSource: (row['typst_source'] as string | null) ?? null,
    pdfStoragePath: (row['pdf_storage_path'] as string | null) ?? null,
    pdfEngine: rawPdfEngine === 'typst' ? 'typst' : 'builtin-ats-pdf',
    provider: row['provider'] ? LlmProviderIdSchema.catch('gemini').parse(row['provider']) : null,
    model: (row['model'] as string | null) ?? null,
    createdAt: String(row['created_at'] ?? new Date().toISOString())
  };
}

export class SupabaseDataStore implements DataStore {
  private readonly client: SupabaseClient;

  constructor(supabaseUrl: string, serviceRoleKey: string) {
    this.client = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
  }

  async getOrCreateProfile(user: AuthUser): Promise<MasterProfile> {
    const { data, error } = await this.client
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    if (error) throw new Error(`Failed to fetch profile: ${error.message}`);
    if (data) return mapProfileRow(data as Record<string, unknown>);

    const { data: inserted, error: insertError } = await this.client
      .from('profiles')
      .upsert(
        {
          id: user.id,
          email: user.email ?? null,
          full_name: user.fullName ?? null
        },
        { onConflict: 'id' }
      )
      .select('*')
      .single();

    if (insertError) throw new Error(`Failed to create profile: ${insertError.message}`);
    return mapProfileRow(inserted as Record<string, unknown>);
  }

  async updateProfile(
    userId: string,
    patch: ProfilePatch,
    bumpVersion: boolean = true
  ): Promise<MasterProfile> {
    const current = await this.getOrCreateProfile({ id: userId });
    const updatePayload: Record<string, unknown> = {
      active_profile_version: bumpVersion
        ? current.activeProfileVersion + 1
        : current.activeProfileVersion
    };

    if (patch.fullName !== undefined) updatePayload['full_name'] = patch.fullName;
    if (patch.email !== undefined) updatePayload['email'] = patch.email || null;
    if (patch.phone !== undefined) updatePayload['phone'] = patch.phone || null;
    if (patch.jsonResume !== undefined) {
      updatePayload['json_resume'] = JsonResumeSchema.parse(patch.jsonResume);
    }
    if (patch.indiaProfile !== undefined) {
      updatePayload['india_profile'] = IndiaProfileSchema.parse(patch.indiaProfile);
    }
    if (patch.searchPreferences !== undefined) {
      updatePayload['search_preferences'] = SearchPreferencesSchema.parse(patch.searchPreferences);
    }
    if (patch.sourceResumeStoragePath !== undefined) {
      updatePayload['source_resume_storage_path'] = patch.sourceResumeStoragePath;
    }
    if (patch.telemetryOptIn !== undefined) {
      updatePayload['telemetry_opt_in'] = patch.telemetryOptIn;
    }
    if (patch.markOnboardingComplete && !current.onboardingCompletedAt) {
      updatePayload['onboarding_completed_at'] = new Date().toISOString();
    }

    const { data, error } = await this.client
      .from('profiles')
      .update(updatePayload)
      .eq('id', userId)
      .select('*')
      .single();

    if (error) throw new Error(`Failed to update profile: ${error.message}`);
    const updatedProfile = mapProfileRow(data as Record<string, unknown>);
    if (patch.jsonResume !== undefined || patch.indiaProfile !== undefined) {
      await this.client
        .from('profile_variants')
        .update({
          json_resume: updatedProfile.jsonResume,
          india_profile: updatedProfile.indiaProfile,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId)
        .eq('is_default', true);
    }
    return updatedProfile;
  }

  async updateProfileEmbedding(
    userId: string,
    params: { hash: string; vector: number[]; model: string; version: string }
  ): Promise<void> {
    const { error } = await this.client
      .from('profiles')
      .update({
        profile_text_hash: params.hash,
        embedding: `[${params.vector.join(',')}]`,
        embedding_model: params.model,
        embedding_model_version: params.version,
        embedded_at: new Date().toISOString()
      })
      .eq('id', userId);
    if (error) throw new Error(`Failed to update profile embedding: ${error.message}`);
  }

  async listStories(userId: string): Promise<ProfileStory[]> {
    const { data, error } = await this.client
      .from('profile_stories')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to list stories: ${error.message}`);
    return (data ?? []).map((r) => mapStoryRow(r as Record<string, unknown>));
  }

  async createStory(userId: string, input: UpsertStoryRequest): Promise<ProfileStory> {
    const { data, error } = await this.client
      .from('profile_stories')
      .insert({
        user_id: userId,
        title: input.title,
        category: input.category,
        situation: input.situation,
        task: input.task,
        action: input.action,
        result: input.result,
        metrics: input.metrics,
        skills_used: input.skillsUsed,
        linked_experience_id: input.linkedExperienceId ?? null
      })
      .select('*')
      .single();

    if (error) throw new Error(`Failed to create story: ${error.message}`);
    return mapStoryRow(data as Record<string, unknown>);
  }

  async updateStory(
    userId: string,
    storyId: string,
    input: UpsertStoryRequest
  ): Promise<ProfileStory | null> {
    const { data, error } = await this.client
      .from('profile_stories')
      .update({
        title: input.title,
        category: input.category,
        situation: input.situation,
        task: input.task,
        action: input.action,
        result: input.result,
        metrics: input.metrics,
        skills_used: input.skillsUsed,
        linked_experience_id: input.linkedExperienceId ?? null
      })
      .eq('id', storyId)
      .eq('user_id', userId)
      .select('*')
      .maybeSingle();

    if (error) throw new Error(`Failed to update story: ${error.message}`);
    return data ? mapStoryRow(data as Record<string, unknown>) : null;
  }

  async deleteStory(userId: string, storyId: string): Promise<boolean> {
    const { data, error } = await this.client
      .from('profile_stories')
      .delete()
      .eq('id', storyId)
      .eq('user_id', userId)
      .select('id');

    if (error) throw new Error(`Failed to delete story: ${error.message}`);
    return (data?.length ?? 0) > 0;
  }

  async listSavedAnswers(userId: string): Promise<SavedAnswer[]> {
    const { data, error } = await this.client
      .from('saved_answers')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

    if (error) throw new Error(`Failed to list saved answers: ${error.message}`);
    return (data ?? []).map((r) => mapSavedAnswerRow(r as Record<string, unknown>));
  }

  async createSavedAnswer(userId: string, input: UpsertSavedAnswerRequest): Promise<SavedAnswer> {
    const { data, error } = await this.client
      .from('saved_answers')
      .insert({
        user_id: userId,
        question_key: input.questionKey,
        question_pattern: input.questionPattern,
        answer: input.answer,
        tags: input.tags
      })
      .select('*')
      .single();

    if (error) throw new Error(`Failed to create saved answer: ${error.message}`);
    return mapSavedAnswerRow(data as Record<string, unknown>);
  }

  async updateSavedAnswer(
    userId: string,
    answerId: string,
    input: UpsertSavedAnswerRequest
  ): Promise<SavedAnswer | null> {
    const { data, error } = await this.client
      .from('saved_answers')
      .update({
        question_key: input.questionKey,
        question_pattern: input.questionPattern,
        answer: input.answer,
        tags: input.tags
      })
      .eq('id', answerId)
      .eq('user_id', userId)
      .select('*')
      .maybeSingle();

    if (error) throw new Error(`Failed to update saved answer: ${error.message}`);
    return data ? mapSavedAnswerRow(data as Record<string, unknown>) : null;
  }

  async deleteSavedAnswer(userId: string, answerId: string): Promise<boolean> {
    const { data, error } = await this.client
      .from('saved_answers')
      .delete()
      .eq('id', answerId)
      .eq('user_id', userId)
      .select('id');

    if (error) throw new Error(`Failed to delete saved answer: ${error.message}`);
    return (data?.length ?? 0) > 0;
  }

  async listLlmSettings(userId: string): Promise<StoredLlmSetting[]> {
    const { data, error } = await this.client
      .from('user_llm_settings')
      .select('*')
      .eq('user_id', userId);

    if (error) throw new Error(`Failed to list LLM settings: ${error.message}`);
    return (data ?? []).map((r) => mapLlmSettingRow(r as Record<string, unknown>));
  }

  async getLlmSetting(userId: string, provider: LlmProviderId): Promise<StoredLlmSetting | null> {
    const { data, error } = await this.client
      .from('user_llm_settings')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', provider)
      .maybeSingle();

    if (error) throw new Error(`Failed to fetch LLM setting: ${error.message}`);
    return data ? mapLlmSettingRow(data as Record<string, unknown>) : null;
  }

  async upsertLlmSetting(
    userId: string,
    provider: LlmProviderId,
    patch: LlmSettingPatch
  ): Promise<StoredLlmSetting> {
    if (patch.isActive) {
      await this.client
        .from('user_llm_settings')
        .update({ is_active: false })
        .eq('user_id', userId)
        .neq('provider', provider);
    }

    const rowPatch: Record<string, unknown> = {
      user_id: userId,
      provider
    };
    if (patch.isActive !== undefined) rowPatch['is_active'] = patch.isActive;
    if (patch.selectedModel !== undefined) rowPatch['selected_model'] = patch.selectedModel;
    if (patch.baseUrlOverride !== undefined) rowPatch['base_url_override'] = patch.baseUrlOverride;
    if (patch.encryptedApiKey !== undefined) rowPatch['encrypted_api_key'] = patch.encryptedApiKey;
    if (patch.keyIv !== undefined) rowPatch['key_iv'] = patch.keyIv;
    if (patch.keyAuthTag !== undefined) rowPatch['key_auth_tag'] = patch.keyAuthTag;
    if (patch.keyHint !== undefined) rowPatch['key_hint'] = patch.keyHint;
    if (patch.detectedCapabilities !== undefined) {
      rowPatch['detected_capabilities'] = patch.detectedCapabilities;
    }
    if (patch.lastTestedAt !== undefined) rowPatch['last_tested_at'] = patch.lastTestedAt;
    if (patch.lastTestStatus !== undefined) rowPatch['last_test_status'] = patch.lastTestStatus;

    const { data, error } = await this.client
      .from('user_llm_settings')
      .upsert(rowPatch, { onConflict: 'user_id,provider' })
      .select('*')
      .single();

    if (error) throw new Error(`Failed to upsert LLM setting: ${error.message}`);
    return mapLlmSettingRow(data as Record<string, unknown>);
  }

  async clearLlmKey(userId: string, provider: LlmProviderId): Promise<StoredLlmSetting | null> {
    const existing = await this.getLlmSetting(userId, provider);
    if (!existing) return null;
    return this.upsertLlmSetting(userId, provider, {
      encryptedApiKey: null,
      keyIv: null,
      keyAuthTag: null,
      keyHint: null,
      lastTestedAt: null,
      lastTestStatus: 'untested'
    });
  }

  async logLlmUsage(entry: LlmCallLogEntry): Promise<void> {
    const { error } = await this.client.from('llm_usage_logs').insert({
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
    if (error) {
      throw new Error(`Failed to log LLM usage: ${error.message}`);
    }
  }

  async getUsageSummary(userId: string, limit: number = 100): Promise<LlmUsageSummary> {
    const { data, error } = await this.client
      .from('llm_usage_logs')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`Failed to fetch usage summary: ${error.message}`);
    const logs: LlmUsageLog[] = (data ?? []).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: String(r['id']),
        taskType: String(r['task_type']),
        provider: LlmProviderIdSchema.parse(r['provider']),
        model: String(r['model']),
        inputTokens: Number(r['input_tokens'] ?? 0),
        outputTokens: Number(r['output_tokens'] ?? 0),
        latencyMs: Number(r['latency_ms'] ?? 0),
        estimatedCostUsd: Number(r['estimated_cost_usd'] ?? 0),
        retryCount: Number(r['retry_count'] ?? 0),
        usedRepair: Boolean(r['used_repair']),
        status: r['status'] === 'error' ? 'error' : 'ok',
        errorCode: (r['error_code'] as string | null) ?? null,
        createdAt: String(r['created_at'])
      };
    });
    return buildUsageSummary(logs);
  }

  async uploadRawResume(userId: string, filename: string, buffer: Buffer): Promise<string> {
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${userId}/${Date.now()}-${safeName}`;
    const { error } = await this.client.storage
      .from('resumes-raw')
      .upload(storagePath, buffer, {
        contentType: 'application/pdf',
        upsert: false
      });

    if (error) throw new Error(`Failed to upload raw resume PDF: ${error.message}`);
    return storagePath;
  }

  async exportAccountData(user: AuthUser): Promise<AccountExportPayload> {
    const [
      profile,
      profileVariants,
      stories,
      savedAnswers,
      settings,
      usageSummary,
      resumeVersions,
      coverLetters,
      applications
    ] = await Promise.all([
      this.getOrCreateProfile(user),
      this.listProfileVariants(user.id),
      this.listStories(user.id),
      this.listSavedAnswers(user.id),
      this.listLlmSettings(user.id),
      this.getUsageSummary(user.id, 500),
      this.listResumeVersions(user.id),
      this.listCoverLetters(user.id),
      this.listApplications(user.id)
    ]);

    return {
      exportedAt: new Date().toISOString(),
      profile,
      profileVariants,
      stories,
      savedAnswers,
      llmSettings: settings.map(
        ({ encryptedApiKey, keyIv, keyAuthTag, ...safe }) => ({
          ...safe,
          hasKey: Boolean(encryptedApiKey && keyIv && keyAuthTag)
        })
      ),
      usageLogs: usageSummary.recentLogs,
      resumeVersions,
      coverLetters,
      applications
    };
  }

  async deleteAccount(userId: string): Promise<void> {
    for (const bucket of ['resumes-raw', 'resumes-rendered']) {
      const { data: objects } = await this.client.storage.from(bucket).list(userId, { limit: 1000 });
      if (objects && objects.length > 0) {
        const paths = objects.map((o) => `${userId}/${o.name}`);
        await this.client.storage.from(bucket).remove(paths);
      }
    }

    const { error } = await this.client.auth.admin.deleteUser(userId);
    if (error) throw new Error(`Failed to delete auth user: ${error.message}`);
  }

  async getProfileEmbedding(
    userId: string
  ): Promise<{ vector: number[]; model: string; version: string } | null> {
    const { data, error } = await this.client
      .from('profiles')
      .select('embedding, embedding_model, embedding_model_version')
      .eq('id', userId)
      .maybeSingle();

    if (error || !data) return null;
    const row = data as Record<string, unknown>;
    const vector = parsePgVector(row['embedding']);
    if (!vector || !row['embedding_model'] || !row['embedding_model_version']) return null;
    return {
      vector,
      model: String(row['embedding_model']),
      version: String(row['embedding_model_version'])
    };
  }

  private buildFilteredJobsQuery(userId: string, query: JobFeedQuery) {
    let q = this.client
      .from('jobs')
      .select('*')
      .eq('is_active', true)
      .or(`owner_user_id.is.null,owner_user_id.eq.${userId}`);

    if (query.country) q = q.eq('country_code', query.country.toUpperCase());
    if (query.city) q = q.ilike('city', `%${query.city}%`);
    if (query.workMode) q = q.eq('work_mode', query.workMode);
    if (query.seniority) q = q.eq('seniority', query.seniority);
    if (query.source) q = q.eq('source_type', query.source);
    if (query.minSalaryLpa != null) {
      q = q.or(`salary_max_lpa.is.null,salary_max_lpa.gte.${query.minSalaryLpa}`);
    }
    if (query.maxExperienceYears != null) {
      q = q.or(`experience_min_years.is.null,experience_min_years.lte.${query.maxExperienceYears}`);
    }
    if (query.q?.trim()) {
      const safe = query.q.trim().replace(/[,()]/g, ' ');
      q = q.or(`title.ilike.%${safe}%,company_name.ilike.%${safe}%,location_raw.ilike.%${safe}%`);
    }
    return q;
  }

  async listJobsFeed(
    userId: string,
    profileVersion: number,
    query: JobFeedQuery
  ): Promise<{ items: JobFeedItem[]; total: number }> {
    const useMatchWindow = !query.q?.trim() && query.sortBy === 'match_score';
    let jobRows: Array<Record<string, unknown>> = [];

    if (useMatchWindow) {
      const [topMatchRes, newestRes] = await Promise.all([
        this.client
          .from('job_matches')
          .select('job_id')
          .eq('user_id', userId)
          .eq('profile_version', profileVersion)
          .eq('dismissed', false)
          .order('hard_filter_passed', { ascending: false })
          .order('llm_score', { ascending: false, nullsFirst: false })
          .limit(250),
        this.buildFilteredJobsQuery(userId, query)
          .order('posted_at', { ascending: false, nullsFirst: false })
          .limit(250)
      ]);

      if (newestRes.error) {
        throw new Error(`Failed to list jobs feed: ${newestRes.error.message}`);
      }

      const newestRows = (newestRes.data ?? []) as Array<Record<string, unknown>>;
      const seenIds = new Set(newestRows.map((r) => String(r['id'])));
      const missingMatchedIds = ((topMatchRes.data ?? []) as Array<Record<string, unknown>>)
        .map((r) => String(r['job_id']))
        .filter((id) => !seenIds.has(id));

      jobRows = [...newestRows];
      if (missingMatchedIds.length > 0) {
        const extraRes = await this.buildFilteredJobsQuery(userId, query).in(
          'id',
          missingMatchedIds.slice(0, 200)
        );
        if (!extraRes.error && extraRes.data) {
          for (const row of extraRes.data as Array<Record<string, unknown>>) {
            const id = String(row['id']);
            if (!seenIds.has(id)) {
              seenIds.add(id);
              jobRows.push(row);
            }
          }
        }
      }
    } else {
      const { data: jobsData, error: jobsErr } = await this.buildFilteredJobsQuery(userId, query)
        .order('posted_at', { ascending: false, nullsFirst: false })
        .limit(300);

      if (jobsErr) throw new Error(`Failed to list jobs feed: ${jobsErr.message}`);
      jobRows = (jobsData ?? []) as Array<Record<string, unknown>>;
    }

    const jobIds = jobRows.map((r) => String(r['id']));
    if (jobIds.length === 0) return { items: [], total: 0 };

    const [{ data: matchData }, { data: appData }] = await Promise.all([
      this.client
        .from('job_matches')
        .select('*')
        .eq('user_id', userId)
        .eq('profile_version', profileVersion)
        .in('job_id', jobIds),
      this.client
        .from('applications')
        .select('job_id, status')
        .eq('user_id', userId)
        .in('job_id', jobIds)
    ]);

    const matchMap = new Map<string, JobMatch>();
    for (const row of (matchData ?? []) as Array<Record<string, unknown>>) {
      const mapped = mapJobMatchRow(row);
      matchMap.set(mapped.jobId, mapped);
    }

    const appMap = new Map<string, string>();
    for (const row of (appData ?? []) as Array<Record<string, unknown>>) {
      appMap.set(String(row['job_id']), String(row['status']));
    }

    const combined: JobFeedItem[] = [];
    for (const r of jobRows) {
      const job = mapJobRow(r);
      const match = matchMap.get(job.id) ?? null;
      if (!query.includeDismissed && match?.dismissed) continue;
      if (query.onlyPassed && query.bucket !== 'near_matches' && match && !match.hardFilterPassed) {
        continue;
      }
      const candidateItem: JobFeedItem = {
        job,
        match,
        applicationStatus: appMap.get(job.id) ?? null
      };
      if (!matchesFeedBucket(candidateItem, query.bucket, query.freshHours)) continue;
      combined.push(candidateItem);
    }

    combined.sort((a, b) => {
      if (query.sortBy === 'salary_lpa') {
        return (b.job.salaryMaxLpa ?? -1) - (a.job.salaryMaxLpa ?? -1);
      }
      if (query.sortBy === 'recent') {
        return (b.job.postedAt ?? b.job.lastSeenAt).localeCompare(a.job.postedAt ?? a.job.lastSeenAt);
      }
      const aPass = a.match?.hardFilterPassed ?? true;
      const bPass = b.match?.hardFilterPassed ?? true;
      if (aPass !== bPass) return aPass ? -1 : 1;
      const scoreDiff = (b.match?.llmScore ?? -1) - (a.match?.llmScore ?? -1);
      if (scoreDiff !== 0) return scoreDiff;
      return (b.job.postedAt ?? b.job.lastSeenAt).localeCompare(a.job.postedAt ?? a.job.lastSeenAt);
    });

    const total = combined.length;
    return {
      items: combined.slice(query.offset, query.offset + query.limit),
      total
    };
  }

  async getJobDetail(
    userId: string,
    jobId: string,
    profileVersion: number
  ): Promise<{ item: JobFeedItem; sightings: JobSighting[] } | null> {
    const { data: row, error } = await this.client
      .from('jobs')
      .select('*')
      .eq('id', jobId)
      .or(`owner_user_id.is.null,owner_user_id.eq.${userId}`)
      .maybeSingle();

    if (error || !row) return null;

    const [{ data: sightingsData }, { data: matchRow }, { data: appRow }] = await Promise.all([
      this.client.from('job_sightings').select('*').eq('job_id', jobId),
      this.client
        .from('job_matches')
        .select('*')
        .eq('user_id', userId)
        .eq('job_id', jobId)
        .eq('profile_version', profileVersion)
        .maybeSingle(),
      this.client
        .from('applications')
        .select('status')
        .eq('user_id', userId)
        .eq('job_id', jobId)
        .maybeSingle()
    ]);

    const sightings = ((sightingsData ?? []) as Array<Record<string, unknown>>).map((s) =>
      JobSightingSchema.parse({
        sourceType: s['source_type'],
        externalId: s['external_id'],
        sourceUrl: s['source_url'],
        seenAt: s['seen_at']
      })
    );

    return {
      item: {
        job: mapJobRow(row as Record<string, unknown>, Math.max(1, sightings.length)),
        match: matchRow ? mapJobMatchRow(matchRow as Record<string, unknown>) : null,
        applicationStatus: (appRow as Record<string, unknown> | null)?.['status'] as string | null ?? null
      },
      sightings
    };
  }

  async listActiveJobsForMatching(userId: string, limit: number = 600): Promise<JobForMatching[]> {
    const { data, error } = await this.client
      .from('jobs')
      .select('*')
      .eq('is_active', true)
      .or(`owner_user_id.is.null,owner_user_id.eq.${userId}`)
      .order('posted_at', { ascending: false, nullsFirst: false })
      .limit(limit);

    if (error) throw new Error(`Failed to load jobs for matching: ${error.message}`);
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      ...mapJobRow(r),
      embedding: parsePgVector(r['embedding'])
    }));
  }

  async listMatchesForProfileVersion(userId: string, profileVersion: number): Promise<JobMatch[]> {
    const { data, error } = await this.client
      .from('job_matches')
      .select('*')
      .eq('user_id', userId)
      .eq('profile_version', profileVersion);

    if (error) throw new Error(`Failed to fetch cached job matches: ${error.message}`);
    return ((data ?? []) as Array<Record<string, unknown>>).map(mapJobMatchRow);
  }

  async upsertJobMatches(userId: string, matches: JobMatch[]): Promise<void> {
    if (matches.length === 0) return;
    const rows = matches.map((m) => ({
      user_id: userId,
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
    }));

    const { error } = await this.client
      .from('job_matches')
      .upsert(rows, { onConflict: 'user_id,job_id,profile_version' });

    if (error) throw new Error(`Failed to upsert job matches: ${error.message}`);
  }

  async setMatchDismissed(
    userId: string,
    jobId: string,
    profileVersion: number,
    dismissed: boolean,
    reason?: DismissReason
  ): Promise<boolean> {
    if (reason) {
      const { data: existing } = await this.client
        .from('job_matches')
        .select('hard_filter_reasons')
        .eq('user_id', userId)
        .eq('job_id', jobId)
        .eq('profile_version', profileVersion)
        .maybeSingle();

      const existingReasons = Array.isArray((existing as Record<string, unknown> | null)?.['hard_filter_reasons'])
        ? ((existing as Record<string, unknown>)['hard_filter_reasons'] as string[])
        : [];
      const nextReasons = mergeDismissReason(existingReasons, reason);

      const { error } = await this.client.from('job_matches').upsert(
        {
          user_id: userId,
          job_id: jobId,
          profile_version: profileVersion,
          dismissed,
          hard_filter_reasons: nextReasons,
          computed_at: new Date().toISOString()
        },
        { onConflict: 'user_id,job_id,profile_version' }
      );
      return !error;
    }

    const { error } = await this.client.from('job_matches').upsert(
      {
        user_id: userId,
        job_id: jobId,
        profile_version: profileVersion,
        dismissed,
        computed_at: new Date().toISOString()
      },
      { onConflict: 'user_id,job_id,profile_version' }
    );
    return !error;
  }

  async saveJobApplication(
    userId: string,
    jobId: string,
    sourceChannel: string = 'web'
  ): Promise<{ id: string; status: string }> {
    const { data: existing } = await this.client
      .from('applications')
      .select('id, status')
      .eq('user_id', userId)
      .eq('job_id', jobId)
      .maybeSingle();

    if (existing) {
      return {
        id: String((existing as Record<string, unknown>)['id']),
        status: String((existing as Record<string, unknown>)['status'])
      };
    }

    const { data: created, error } = await this.client
      .from('applications')
      .insert({
        user_id: userId,
        job_id: jobId,
        status: 'saved',
        source_channel: sourceChannel
      })
      .select('id, status')
      .single();

    if (error || !created) {
      throw new Error(`Failed to save job application: ${error?.message ?? 'unknown error'}`);
    }

    const appId = String((created as Record<string, unknown>)['id']);
    await this.client.from('application_events').insert({
      application_id: appId,
      user_id: userId,
      event_type: 'status_change',
      payload: { status: 'saved', sourceChannel }
    });

    return {
      id: appId,
      status: String((created as Record<string, unknown>)['status'])
    };
  }

  async listJobSourcesAndRuns(): Promise<{
    sources: JobSourceStatus[];
    recentRuns: CrawlRunSummary[];
  }> {
    const [{ data: sourcesData }, { data: runsData }] = await Promise.all([
      this.client
        .from('job_sources')
        .select('*')
        .order('last_crawled_at', { ascending: false, nullsFirst: false })
        .limit(150),
      this.client
        .from('crawl_runs')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(10)
    ]);

    const sources = ((sourcesData ?? []) as Array<Record<string, unknown>>).map((s) =>
      JobSourceStatusSchema.parse({
        id: s['id'],
        sourceType: s['source_type'],
        slug: s['slug'],
        displayName: s['display_name'],
        regionFocus: s['region_focus'],
        enabled: Boolean(s['enabled']),
        lastCrawledAt: s['last_crawled_at'] ?? null,
        lastStatus: s['last_status'] ?? null,
        consecutiveFailures: Number(s['consecutive_failures'] ?? 0)
      })
    );

    const recentRuns = ((runsData ?? []) as Array<Record<string, unknown>>).map((r) =>
      CrawlRunSummarySchema.parse({
        id: r['id'],
        jobName: r['job_name'],
        startedAt: r['started_at'],
        finishedAt: r['finished_at'] ?? null,
        status: r['status'],
        stats: (r['stats'] as Record<string, unknown>) ?? {}
      })
    );

    return { sources, recentRuns };
  }

  async listJobSourceCache(): Promise<Map<string, SourceCacheEntry>> {
    const { data } = await this.client
      .from('job_sources')
      .select('source_type, slug, etag, last_modified, last_crawled_at, consecutive_failures')
      .limit(200);
    const cache = new Map<string, SourceCacheEntry>();
    for (const s of (data ?? []) as Array<Record<string, unknown>>) {
      cache.set(`${s['source_type']}:${s['slug']}`, {
        etag: (s['etag'] as string | null) ?? null,
        lastModified: (s['last_modified'] as string | null) ?? null,
        lastCrawledAt: (s['last_crawled_at'] as string | null) ?? null,
        consecutiveFailures: Number(s['consecutive_failures'] ?? 0)
      });
    }
    return cache;
  }

  async upsertPublicJobsBatch(
    bundles: DedupedJobBundle[]
  ): Promise<{ insertedCount: number; updatedCount: number }> {
    let insertedCount = 0;
    let updatedCount = 0;
    const CHUNK_SIZE = 10;

    for (let i = 0; i < bundles.length; i += CHUNK_SIZE) {
      const chunk = bundles.slice(i, i + CHUNK_SIZE);
      await Promise.all(
        chunk.map(async (bundle) => {
          const j = bundle.canonical;
          const { data, error } = await this.client.rpc('upsert_public_job', {
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

            if (bundle.sightings.length > 1) {
              await this.client.from('job_sightings').upsert(
                bundle.sightings.slice(1).map((s) => ({
                  job_id: row.job_id,
                  source_type: s.sourceType,
                  external_id: s.externalId,
                  source_url: s.sourceUrl,
                  seen_at: s.seenAt
                })),
                { onConflict: 'job_id,source_type,external_id' }
              );
            }
          }
        })
      );
    }

    return { insertedCount, updatedCount };
  }

  async upsertJobSourceStatus(input: UpsertJobSourceStatusInput): Promise<void> {
    await this.client.from('job_sources').upsert(
      {
        source_type: input.sourceType,
        slug: input.slug,
        display_name: input.displayName,
        region_focus: input.regionFocus,
        enabled: input.enabled,
        etag: input.etag,
        last_modified: input.lastModified,
        last_crawled_at: input.lastCrawledAt,
        last_status: input.lastStatus,
        consecutive_failures: input.consecutiveFailures
      },
      { onConflict: 'source_type,slug' }
    );
  }

  async startCrawlRun(jobName: string): Promise<string> {
    const { data, error } = await this.client
      .from('crawl_runs')
      .insert({ job_name: jobName, status: 'running' })
      .select('id')
      .single();
    if (error || !data) {
      throw new Error(`Failed to start crawl run: ${error?.message ?? 'unknown error'}`);
    }
    return String((data as Record<string, unknown>)['id']);
  }

  async finishCrawlRun(
    runId: string,
    status: 'ok' | 'error',
    stats: Record<string, unknown>
  ): Promise<void> {
    await this.client
      .from('crawl_runs')
      .update({
        finished_at: new Date().toISOString(),
        status,
        stats
      })
      .eq('id', runId);
  }

  async countActiveJobs(userId: string): Promise<{ total: number; bySource: Record<string, number> }> {
    const { data, error } = await this.client
      .from('jobs')
      .select('source_type')
      .eq('is_active', true)
      .or(`owner_user_id.is.null,owner_user_id.eq.${userId}`)
      .limit(5000);

    if (error) {
      return { total: 0, bySource: {} };
    }
    const bySource: Record<string, number> = {};
    let total = 0;
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      const src = String(r['source_type'] ?? 'manual');
      total++;
      bySource[src] = (bySource[src] ?? 0) + 1;
    }
    return { total, bySource };
  }

  async getJobForTailoring(
    userId: string,
    jobId: string
  ): Promise<{
    id: string;
    title: string;
    companyName: string;
    descriptionClean: string;
    parsedRequirements: unknown | null;
  } | null> {
    const { data, error } = await this.client
      .from('jobs')
      .select('id, title, company_name, description_clean, parsed_requirements')
      .eq('id', jobId)
      .or(`owner_user_id.is.null,owner_user_id.eq.${userId}`)
      .maybeSingle();

    if (error || !data) return null;
    const row = data as Record<string, unknown>;
    return {
      id: String(row['id']),
      title: String(row['title']),
      companyName: String(row['company_name']),
      descriptionClean: String(row['description_clean'] ?? ''),
      parsedRequirements: row['parsed_requirements'] ?? null
    };
  }

  async saveJobParsedRequirements(jobId: string, requirements: JdRequirements): Promise<void> {
    await this.client
      .from('jobs')
      .update({ parsed_requirements: requirements })
      .eq('id', jobId);
  }

  async uploadRenderedResumePdf(
    userId: string,
    versionId: string,
    buffer: Buffer
  ): Promise<string> {
    const storagePath = `${userId}/${versionId}.pdf`;
    const { error } = await this.client.storage
      .from('resumes-rendered')
      .upload(storagePath, buffer, {
        contentType: 'application/pdf',
        upsert: true
      });
    if (error) throw new Error(`Failed to upload rendered PDF: ${error.message}`);
    return storagePath;
  }

  async downloadRenderedResumePdf(
    userId: string,
    storagePath: string
  ): Promise<Buffer | null> {
    if (!storagePath.startsWith(`${userId}/`)) return null;
    const { data, error } = await this.client.storage
      .from('resumes-rendered')
      .download(storagePath);
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  }

  async listResumeVersions(userId: string, jobId?: string): Promise<ResumeVersionRecord[]> {
    let q = this.client
      .from('resume_versions')
      .select('*')
      .eq('user_id', userId)
      .order('version_number', { ascending: false });

    if (jobId) q = q.eq('job_id', jobId);
    const { data, error } = await q.limit(100);
    if (error) throw new Error(`Failed to list resume versions: ${error.message}`);
    return ((data ?? []) as Array<Record<string, unknown>>).map(mapResumeVersionRow);
  }

  async getResumeVersion(
    userId: string,
    versionId: string
  ): Promise<ResumeVersionRecord | null> {
    const { data, error } = await this.client
      .from('resume_versions')
      .select('*')
      .eq('user_id', userId)
      .eq('id', versionId)
      .maybeSingle();

    if (error || !data) return null;
    return mapResumeVersionRow(data as Record<string, unknown>);
  }

  async listProfileVariants(userId: string): Promise<ProfileVariantRecord[]> {
    const profile = await this.getOrCreateProfile({ id: userId });
    const { data, error } = await this.client
      .from('profile_variants')
      .select('*')
      .eq('user_id', userId)
      .order('is_default', { ascending: false })
      .order('updated_at', { ascending: false });

    if (error) throw new Error(`Failed to list profile variants: ${error.message}`);
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    if (rows.length > 0) return rows.map(mapProfileVariantRow);

    const { data: inserted, error: insertErr } = await this.client
      .from('profile_variants')
      .insert({
        user_id: userId,
        name: 'Default',
        slug: 'default',
        target_role: profile.jsonResume.basics.label ?? '',
        is_default: true,
        json_resume: profile.jsonResume,
        india_profile: profile.indiaProfile,
        version: profile.activeProfileVersion
      })
      .select('*')
      .single();

    if (insertErr || !inserted) {
      throw new Error(`Failed to seed default profile variant: ${insertErr?.message ?? 'unknown error'}`);
    }
    return [mapProfileVariantRow(inserted as Record<string, unknown>)];
  }

  async getProfileVariant(userId: string, variantId: string): Promise<ProfileVariantRecord | null> {
    const { data, error } = await this.client
      .from('profile_variants')
      .select('*')
      .eq('user_id', userId)
      .eq('id', variantId)
      .maybeSingle();

    if (error || !data) return null;
    return mapProfileVariantRow(data as Record<string, unknown>);
  }

  async createProfileVariant(
    userId: string,
    input: CreateProfileVariantRequest
  ): Promise<ProfileVariantRecord> {
    const existing = await this.listProfileVariants(userId);
    const existingSlugs = new Set(existing.map((v) => v.slug));
    const source = input.cloneFromVariantId
      ? existing.find((v) => v.id === input.cloneFromVariantId)
      : existing.find((v) => v.isDefault);
    const shouldBeDefault = Boolean(input.isDefault);

    if (shouldBeDefault) {
      await this.client
        .from('profile_variants')
        .update({ is_default: false })
        .eq('user_id', userId)
        .eq('is_default', true);
    }

    const nextJson = JsonResumeSchema.parse(input.jsonResume ?? source?.jsonResume ?? {});
    const nextIndia = IndiaProfileSchema.parse(input.indiaProfile ?? source?.indiaProfile ?? {});

    const { data, error } = await this.client
      .from('profile_variants')
      .insert({
        user_id: userId,
        name: input.name,
        slug: slugifyVariantName(input.name, existingSlugs),
        target_role: input.targetRole ?? source?.targetRole ?? '',
        is_default: shouldBeDefault,
        json_resume: nextJson,
        india_profile: nextIndia,
        version: 1
      })
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(`Failed to create profile variant: ${error?.message ?? 'unknown error'}`);
    }

    if (shouldBeDefault) {
      await this.updateProfile(userId, { jsonResume: nextJson, indiaProfile: nextIndia }, true);
    }

    return mapProfileVariantRow(data as Record<string, unknown>);
  }

  async updateProfileVariant(
    userId: string,
    variantId: string,
    patch: UpdateProfileVariantRequest
  ): Promise<ProfileVariantRecord | null> {
    const existing = await this.listProfileVariants(userId);
    const target = existing.find((v) => v.id === variantId);
    if (!target) return null;

    if (patch.isDefault === true) {
      await this.client
        .from('profile_variants')
        .update({ is_default: false })
        .eq('user_id', userId)
        .eq('is_default', true);
    }

    const existingSlugs = new Set(existing.filter((v) => v.id !== variantId).map((v) => v.slug));
    const rowPatch: Record<string, unknown> = {
      version: target.version + 1,
      updated_at: new Date().toISOString()
    };
    if (patch.name !== undefined) {
      rowPatch['name'] = patch.name;
      rowPatch['slug'] = slugifyVariantName(patch.name, existingSlugs);
    }
    if (patch.targetRole !== undefined) rowPatch['target_role'] = patch.targetRole;
    if (patch.isDefault === true) rowPatch['is_default'] = true;
    if (patch.jsonResume !== undefined) {
      rowPatch['json_resume'] = JsonResumeSchema.parse(patch.jsonResume);
    }
    if (patch.indiaProfile !== undefined) {
      rowPatch['india_profile'] = IndiaProfileSchema.parse(patch.indiaProfile);
    }

    const { data, error } = await this.client
      .from('profile_variants')
      .update(rowPatch)
      .eq('user_id', userId)
      .eq('id', variantId)
      .select('*')
      .maybeSingle();

    if (error || !data) return null;
    const mapped = mapProfileVariantRow(data as Record<string, unknown>);

    if (mapped.isDefault) {
      await this.updateProfile(
        userId,
        { jsonResume: mapped.jsonResume, indiaProfile: mapped.indiaProfile },
        true
      );
    }
    return mapped;
  }

  async deleteProfileVariant(userId: string, variantId: string): Promise<boolean> {
    const existing = await this.listProfileVariants(userId);
    if (existing.length <= 1) return false;
    const target = existing.find((v) => v.id === variantId);
    if (!target) return false;

    const { error } = await this.client
      .from('profile_variants')
      .delete()
      .eq('user_id', userId)
      .eq('id', variantId);

    if (error) throw new Error(`Failed to delete profile variant: ${error.message}`);

    if (target.isDefault) {
      const nextDefault = existing.find((v) => v.id !== variantId);
      if (nextDefault) {
        await this.updateProfileVariant(userId, nextDefault.id, { isDefault: true });
      }
    }
    return true;
  }

  async createResumeVersion(
    userId: string,
    input: CreateResumeVersionInput
  ): Promise<ResumeVersionRecord> {
    const { data: latest } = await this.client
      .from('resume_versions')
      .select('version_number')
      .eq('user_id', userId)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextVersion = Number((latest as Record<string, unknown> | null)?.['version_number'] ?? 0) + 1;

    const { data, error } = await this.client
      .from('resume_versions')
      .insert({
        id: input.id,
        user_id: userId,
        job_id: input.jobId,
        profile_variant_id: input.profileVariantId ?? null,
        parent_profile_version: input.parentProfileVersion,
        version_number: nextVersion,
        label: input.label,
        jd_requirements: input.jdRequirements,
        tailored_json_resume: input.tailoredJsonResume,
        diff_summary: input.diffSummary,
        verifier_report: input.verifierReport,
        verifier_passed: input.verifierPassed,
        template_id: input.templateId,
        typst_source: input.typstSource,
        pdf_storage_path: input.pdfStoragePath,
        pdf_engine: input.pdfEngine,
        provider: input.provider,
        model: input.model
      })
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(`Failed to persist resume version: ${error?.message ?? 'unknown error'}`);
    }
    return mapResumeVersionRow(data as Record<string, unknown>);
  }

  async updateResumeVersionVerification(
    userId: string,
    versionId: string,
    report: VerifierReport
  ): Promise<ResumeVersionRecord | null> {
    const { data, error } = await this.client
      .from('resume_versions')
      .update({
        verifier_report: report,
        verifier_passed: report.passed
      })
      .eq('user_id', userId)
      .eq('id', versionId)
      .select('*')
      .maybeSingle();

    if (error || !data) return null;
    return mapResumeVersionRow(data as Record<string, unknown>);
  }

  async deleteResumeVersion(userId: string, versionId: string): Promise<boolean> {
    const existing = await this.getResumeVersion(userId, versionId);
    if (!existing) return false;
    if (existing.pdfStoragePath) {
      await this.client.storage.from('resumes-rendered').remove([existing.pdfStoragePath]);
    }
    const { error } = await this.client
      .from('resume_versions')
      .delete()
      .eq('user_id', userId)
      .eq('id', versionId);

    return !error;
  }

  async uploadRenderedCoverLetterPdf(
    userId: string,
    coverLetterId: string,
    buffer: Buffer
  ): Promise<string> {
    const path = `${userId}/cover-letters/${coverLetterId}.pdf`;
    const { error } = await this.client.storage
      .from('resumes-rendered')
      .upload(path, buffer, { contentType: 'application/pdf', upsert: true });

    if (error) throw new Error(`Failed to upload cover letter PDF: ${error.message}`);
    return path;
  }

  async listCoverLetters(userId: string, jobId?: string): Promise<CoverLetterRecord[]> {
    let q = this.client
      .from('cover_letters')
      .select('*')
      .eq('user_id', userId)
      .order('version_number', { ascending: false });

    if (jobId) q = q.eq('job_id', jobId);
    const { data, error } = await q.limit(100);
    if (error) throw new Error(`Failed to list cover letters: ${error.message}`);
    return ((data ?? []) as Array<Record<string, unknown>>).map(mapCoverLetterRow);
  }

  async getCoverLetter(userId: string, coverLetterId: string): Promise<CoverLetterRecord | null> {
    const { data, error } = await this.client
      .from('cover_letters')
      .select('*')
      .eq('user_id', userId)
      .eq('id', coverLetterId)
      .maybeSingle();

    if (error || !data) return null;
    return mapCoverLetterRow(data as Record<string, unknown>);
  }

  async createCoverLetter(
    userId: string,
    input: CreateCoverLetterInput
  ): Promise<CoverLetterRecord> {
    const { data: latest } = await this.client
      .from('cover_letters')
      .select('version_number')
      .eq('user_id', userId)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextVersion = Number((latest as Record<string, unknown> | null)?.['version_number'] ?? 0) + 1;

    const { data, error } = await this.client
      .from('cover_letters')
      .insert({
        id: input.id,
        user_id: userId,
        job_id: input.jobId,
        profile_variant_id: input.profileVariantId ?? null,
        parent_profile_version: input.parentProfileVersion,
        version_number: nextVersion,
        label: input.label,
        company_name: input.companyName,
        role_title: input.roleTitle,
        tone: input.tone,
        jd_requirements: input.jdRequirements,
        content: input.content,
        plain_text: input.plainText,
        verifier_report: input.verifierReport,
        verifier_passed: input.verifierPassed,
        typst_source: input.typstSource,
        pdf_storage_path: input.pdfStoragePath,
        pdf_engine: input.pdfEngine,
        provider: input.provider,
        model: input.model
      })
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(`Failed to persist cover letter: ${error?.message ?? 'unknown error'}`);
    }
    return mapCoverLetterRow(data as Record<string, unknown>);
  }

  async updateCoverLetter(
    userId: string,
    coverLetterId: string,
    patch: UpdateCoverLetterPatch
  ): Promise<CoverLetterRecord | null> {
    const rowPatch: Record<string, unknown> = {};
    if (patch.label !== undefined) rowPatch['label'] = patch.label;
    if (patch.content !== undefined) rowPatch['content'] = patch.content;
    if (patch.plainText !== undefined) rowPatch['plain_text'] = patch.plainText;
    if (patch.typstSource !== undefined) rowPatch['typst_source'] = patch.typstSource;
    if (patch.pdfStoragePath !== undefined) rowPatch['pdf_storage_path'] = patch.pdfStoragePath;
    if (patch.pdfEngine !== undefined) rowPatch['pdf_engine'] = patch.pdfEngine;

    const { data, error } = await this.client
      .from('cover_letters')
      .update(rowPatch)
      .eq('user_id', userId)
      .eq('id', coverLetterId)
      .select('*')
      .maybeSingle();

    if (error || !data) return null;
    return mapCoverLetterRow(data as Record<string, unknown>);
  }

  async deleteCoverLetter(userId: string, coverLetterId: string): Promise<boolean> {
    const existing = await this.getCoverLetter(userId, coverLetterId);
    if (!existing) return false;
    if (existing.pdfStoragePath) {
      await this.client.storage.from('resumes-rendered').remove([existing.pdfStoragePath]);
    }
    const { data, error } = await this.client
      .from('cover_letters')
      .delete()
      .eq('user_id', userId)
      .eq('id', coverLetterId)
      .select('id');

    if (error) throw new Error(`Failed to delete cover letter: ${error.message}`);
    return Array.isArray(data) && data.length > 0;
  }

  async captureExtensionJob(
    userId: string,
    input: CaptureExtensionJobRequest
  ): Promise<CaptureExtensionJobResponse> {
    const normalizedUrl = input.sourceUrl.trim().replace(/\/+$/, '').toLowerCase();
    const dedupeFingerprint = createHash('sha256')
      .update(`${input.sourceType}:${normalizedUrl}`)
      .digest('hex');

    const { data: existingJob, error: findErr } = await this.client
      .from('jobs')
      .select('id')
      .eq('owner_user_id', userId)
      .eq('dedupe_fingerprint', dedupeFingerprint)
      .maybeSingle();

    if (findErr) {
      throw new Error(`Failed checking existing captured job: ${findErr.message}`);
    }

    let jobId: string;
    const now = new Date().toISOString();

    if (existingJob) {
      jobId = String((existingJob as Record<string, unknown>)['id']);
      await this.client
        .from('jobs')
        .update({
          title: input.title,
          company_name: input.companyName,
          location_raw: input.locationRaw ?? null,
          ...(input.descriptionClean ? { description_clean: input.descriptionClean } : {}),
          last_seen_at: now
        })
        .eq('id', jobId)
        .eq('owner_user_id', userId);
    } else {
      const { data: insertedJob, error: insertJobErr } = await this.client
        .from('jobs')
        .insert({
          owner_user_id: userId,
          dedupe_fingerprint: dedupeFingerprint,
          source_type: input.sourceType,
          source_url: input.sourceUrl,
          apply_url: input.applyUrl ?? input.sourceUrl,
          company_name: input.companyName,
          title: input.title,
          normalized_title: input.title.toLowerCase(),
          location_raw: input.locationRaw ?? null,
          description_clean: input.descriptionClean ?? '',
          is_active: true,
          posted_at: now,
          last_seen_at: now
        })
        .select('id')
        .single();

      if (insertJobErr || !insertedJob) {
        throw new Error(`Failed to capture job: ${insertJobErr?.message ?? 'unknown error'}`);
      }
      jobId = String((insertedJob as Record<string, unknown>)['id']);
    }

    const { data: existingApp } = await this.client
      .from('applications')
      .select('id, status, resume_version_id')
      .eq('user_id', userId)
      .eq('job_id', jobId)
      .maybeSingle();

    const derivedNotes =
      input.notes ?? (input.salaryText ? `Compensation: ${input.salaryText}` : null);

    if (existingApp) {
      const appRow = existingApp as Record<string, unknown>;
      const appId = String(appRow['id']);
      const nextResumeId =
        input.resumeVersionId ?? (appRow['resume_version_id'] as string | null) ?? null;

      if (input.resumeVersionId || derivedNotes) {
        await this.client
          .from('applications')
          .update({
            ...(input.resumeVersionId ? { resume_version_id: input.resumeVersionId } : {}),
            ...(derivedNotes ? { notes: derivedNotes } : {})
          })
          .eq('id', appId)
          .eq('user_id', userId);
      }

      return {
        jobId,
        applicationId: appId,
        status: String(appRow['status']),
        resumeVersionId: nextResumeId
      };
    }

    const { data: createdApp, error: createAppErr } = await this.client
      .from('applications')
      .insert({
        user_id: userId,
        job_id: jobId,
        resume_version_id: input.resumeVersionId ?? null,
        status: 'saved',
        source_channel: 'extension',
        notes: derivedNotes
      })
      .select('id, status, resume_version_id')
      .single();

    if (createAppErr || !createdApp) {
      throw new Error(`Failed to create saved application: ${createAppErr?.message ?? 'unknown error'}`);
    }

    const createdRow = createdApp as Record<string, unknown>;
    const applicationId = String(createdRow['id']);
    await this.client.from('application_events').insert({
      application_id: applicationId,
      user_id: userId,
      event_type: 'captured_from_extension',
      payload: {
        sourceType: input.sourceType,
        sourceUrl: input.sourceUrl,
        resumeVersionId: input.resumeVersionId ?? null
      }
    });

    return {
      jobId,
      applicationId,
      status: String(createdRow['status']),
      resumeVersionId: (createdRow['resume_version_id'] as string | null) ?? null
    };
  }

  private async hydrateSupabaseApplications(
    userId: string,
    rows: Array<Record<string, unknown>>
  ): Promise<ApplicationRecord[]> {
    if (rows.length === 0) return [];
    const jobIds = Array.from(new Set(rows.map((r) => String(r['job_id'])).filter(Boolean)));
    const resumeIds = Array.from(
      new Set(
        rows
          .map((r) => (r['resume_version_id'] ? String(r['resume_version_id']) : null))
          .filter((x): x is string => Boolean(x))
      )
    );

    const coverIds = Array.from(
      new Set(
        rows
          .map((r) => (r['cover_letter_id'] ? String(r['cover_letter_id']) : null))
          .filter((x): x is string => Boolean(x))
      )
    );

    const [jobsRes, resumesRes, coversRes] = await Promise.all([
      jobIds.length > 0
        ? this.client
            .from('jobs')
            .select(
              'id, title, company_name, location_raw, source_type, source_url, apply_url, salary_min_lpa, salary_max_lpa'
            )
            .in('id', jobIds)
        : Promise.resolve({ data: [], error: null }),
      resumeIds.length > 0
        ? this.client
            .from('resume_versions')
            .select('id, version_number, label, verifier_passed, template_id')
            .eq('user_id', userId)
            .in('id', resumeIds)
        : Promise.resolve({ data: [], error: null }),
      coverIds.length > 0
        ? this.client
            .from('cover_letters')
            .select('id, version_number, label, company_name, role_title, tone, verifier_passed')
            .eq('user_id', userId)
            .in('id', coverIds)
        : Promise.resolve({ data: [], error: null })
    ]);

    const jobMap = new Map<string, Record<string, unknown>>();
    for (const j of (jobsRes.data ?? []) as Array<Record<string, unknown>>) {
      jobMap.set(String(j['id']), j);
    }
    const resumeMap = new Map<string, Record<string, unknown>>();
    for (const rv of (resumesRes.data ?? []) as Array<Record<string, unknown>>) {
      resumeMap.set(String(rv['id']), rv);
    }
    const coverMap = new Map<string, Record<string, unknown>>();
    for (const cl of (coversRes.data ?? []) as Array<Record<string, unknown>>) {
      coverMap.set(String(cl['id']), cl);
    }

    return rows.map((row) => {
      const jobId = String(row['job_id']);
      const resumeId = row['resume_version_id'] ? String(row['resume_version_id']) : null;
      const coverLetterId = row['cover_letter_id'] ? String(row['cover_letter_id']) : null;
      const jobRow = jobMap.get(jobId);
      const resumeRow = resumeId ? resumeMap.get(resumeId) : undefined;
      const coverRow = coverLetterId ? coverMap.get(coverLetterId) : undefined;
      return {
        id: String(row['id']),
        userId: String(row['user_id']),
        jobId,
        resumeVersionId: resumeId,
        coverLetterId,
        status: ApplicationStatusSchema.catch('saved').parse(row['status']),
        appliedAt: (row['applied_at'] as string | null) ?? null,
        nextFollowUpAt: (row['next_follow_up_at'] as string | null) ?? null,
        followUpNote: String(row['follow_up_note'] ?? ''),
        salaryOffered: String(row['salary_offered'] ?? ''),
        notes: String(row['notes'] ?? ''),
        sourceChannel: String(row['source_channel'] ?? 'web'),
        createdAt: String(row['created_at']),
        updatedAt: String(row['updated_at']),
        job: {
          id: jobId,
          title: String(jobRow?.['title'] ?? 'Tracked Application'),
          companyName: String(jobRow?.['company_name'] ?? 'Company'),
          locationRaw: (jobRow?.['location_raw'] as string | null) ?? null,
          sourceType: String(jobRow?.['source_type'] ?? 'custom'),
          sourceUrl: String(jobRow?.['source_url'] ?? 'https://jobpilot.local/manual'),
          applyUrl: (jobRow?.['apply_url'] as string | null) ?? null,
          salaryMinLpa:
            jobRow?.['salary_min_lpa'] != null ? Number(jobRow['salary_min_lpa']) : null,
          salaryMaxLpa:
            jobRow?.['salary_max_lpa'] != null ? Number(jobRow['salary_max_lpa']) : null
        },
        resumeVersion: resumeRow
          ? {
              id: String(resumeRow['id']),
              versionNumber: Number(resumeRow['version_number'] ?? 1),
              label: String(resumeRow['label'] ?? 'Tailored Resume'),
              verifierPassed: Boolean(resumeRow['verifier_passed']),
              templateId: String(resumeRow['template_id'] ?? 'ats-classic')
            }
          : null,
        coverLetter: coverRow
          ? {
              id: String(coverRow['id']),
              versionNumber: Number(coverRow['version_number'] ?? 1),
              label: String(coverRow['label'] ?? 'Cover Letter'),
              companyName: String(coverRow['company_name'] ?? ''),
              roleTitle: String(coverRow['role_title'] ?? ''),
              tone: String(coverRow['tone'] ?? 'concise-technical'),
              verifierPassed: Boolean(coverRow['verifier_passed'])
            }
          : null
      };
    });
  }

  async listApplications(
    userId: string,
    status?: ApplicationStatus
  ): Promise<ApplicationRecord[]> {
    let query = this.client
      .from('applications')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });
    if (status) {
      query = query.eq('status', status);
    }
    const { data, error } = await query;
    if (error) throw new Error(`Failed to list applications: ${error.message}`);
    return this.hydrateSupabaseApplications(
      userId,
      (data ?? []) as Array<Record<string, unknown>>
    );
  }

  async getApplicationDetail(
    userId: string,
    applicationId: string
  ): Promise<{ application: ApplicationRecord; events: ApplicationEventRecord[] } | null> {
    const { data: appRow, error } = await this.client
      .from('applications')
      .select('*')
      .eq('id', applicationId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw new Error(`Failed to fetch application: ${error.message}`);
    if (!appRow) return null;

    const [hydrated] = await this.hydrateSupabaseApplications(userId, [
      appRow as Record<string, unknown>
    ]);
    if (!hydrated) return null;

    const { data: eventRows, error: eventErr } = await this.client
      .from('application_events')
      .select('*')
      .eq('application_id', applicationId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (eventErr) throw new Error(`Failed to fetch application events: ${eventErr.message}`);

    const events: ApplicationEventRecord[] = (eventRows ?? []).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: String(r['id']),
        applicationId: String(r['application_id']),
        userId: String(r['user_id']),
        eventType: String(r['event_type']),
        payload:
          r['payload'] && typeof r['payload'] === 'object'
            ? (r['payload'] as Record<string, unknown>)
            : {},
        createdAt: String(r['created_at'])
      };
    });

    return { application: hydrated, events };
  }

  async createManualApplication(
    userId: string,
    input: CreateManualApplicationRequest
  ): Promise<ApplicationRecord> {
    const now = new Date().toISOString();
    const sourceUrl =
      input.sourceUrl ??
      `https://jobpilot.local/manual/${encodeURIComponent(input.companyName.toLowerCase())}/${randomUUID()}`;
    const dedupeFingerprint = createHash('sha256')
      .update(`manual:${userId}:${sourceUrl}`)
      .digest('hex');

      const { data: insertedJob, error: jobErr } = await this.client
      .from('jobs')
      .insert({
        owner_user_id: userId,
        dedupe_fingerprint: dedupeFingerprint,
        source_type: 'manual',
        source_url: sourceUrl,
        apply_url: sourceUrl,
        company_name: input.companyName,
        title: input.title,
        normalized_title: input.title.toLowerCase(),
        location_raw: input.locationRaw ?? null,
        description_clean: input.notes ?? '',
        is_active: true,
        posted_at: now,
        last_seen_at: now
      })
      .select('id')
      .single();

    if (jobErr || !insertedJob) {
      throw new Error(`Failed to insert manual job: ${jobErr?.message ?? 'unknown error'}`);
    }
    const jobId = String((insertedJob as Record<string, unknown>)['id']);
    const status: ApplicationStatus = input.status ?? 'applied';

    const { data: appRow, error: appErr } = await this.client
      .from('applications')
      .insert({
        user_id: userId,
        job_id: jobId,
        resume_version_id: input.resumeVersionId ?? null,
        cover_letter_id: input.coverLetterId ?? null,
        status,
        applied_at: status === 'saved' ? null : now,
        next_follow_up_at: input.nextFollowUpAt ?? null,
        follow_up_note: input.followUpNote ?? null,
        salary_offered: input.salaryOffered ?? null,
        notes: input.notes ?? null,
        source_channel: 'manual'
      })
      .select('*')
      .single();

    if (appErr || !appRow) {
      throw new Error(`Failed to insert manual application: ${appErr?.message ?? 'unknown error'}`);
    }

    const r = appRow as Record<string, unknown>;
    await this.client.from('application_events').insert({
      application_id: String(r['id']),
      user_id: userId,
      event_type: 'application_created',
      payload: {
        status,
        resumeVersionId: input.resumeVersionId ?? null,
        nextFollowUpAt: input.nextFollowUpAt ?? null
      }
    });

    const [hydrated] = await this.hydrateSupabaseApplications(userId, [r]);
    return hydrated!;
  }

  async updateApplication(
    userId: string,
    applicationId: string,
    patch: UpdateApplicationRequest
  ): Promise<ApplicationRecord | null> {
    const { data: existingRow, error: findErr } = await this.client
      .from('applications')
      .select('*')
      .eq('id', applicationId)
      .eq('user_id', userId)
      .maybeSingle();

    if (findErr) throw new Error(`Failed to fetch application: ${findErr.message}`);
    if (!existingRow) return null;

    const prev = existingRow as Record<string, unknown>;
    const rowPatch: Record<string, unknown> = {};
    const now = new Date().toISOString();

    if (patch.status !== undefined) {
      rowPatch['status'] = patch.status;
      if (patch.status !== 'saved' && !prev['applied_at'] && patch.appliedAt === undefined) {
        rowPatch['applied_at'] = now;
      }
    }
    if (patch.appliedAt !== undefined) rowPatch['applied_at'] = patch.appliedAt;
    if (patch.resumeVersionId !== undefined) rowPatch['resume_version_id'] = patch.resumeVersionId;
    if (patch.coverLetterId !== undefined) rowPatch['cover_letter_id'] = patch.coverLetterId;
    if (patch.nextFollowUpAt !== undefined) rowPatch['next_follow_up_at'] = patch.nextFollowUpAt;
    if (patch.followUpNote !== undefined) rowPatch['follow_up_note'] = patch.followUpNote;
    if (patch.salaryOffered !== undefined) rowPatch['salary_offered'] = patch.salaryOffered;
    if (patch.notes !== undefined) rowPatch['notes'] = patch.notes;

    const { data: updatedRow, error: updateErr } = await this.client
      .from('applications')
      .update(rowPatch)
      .eq('id', applicationId)
      .eq('user_id', userId)
      .select('*')
      .single();

    if (updateErr || !updatedRow) {
      throw new Error(`Failed to update application: ${updateErr?.message ?? 'unknown error'}`);
    }

    if (patch.status !== undefined && patch.status !== prev['status']) {
      await this.client.from('application_events').insert({
        application_id: applicationId,
        user_id: userId,
        event_type: 'status_changed',
        payload: { from: prev['status'], to: patch.status }
      });
    }
    if (patch.resumeVersionId !== undefined && patch.resumeVersionId !== prev['resume_version_id']) {
      await this.client.from('application_events').insert({
        application_id: applicationId,
        user_id: userId,
        event_type: 'resume_version_linked',
        payload: { from: prev['resume_version_id'], to: patch.resumeVersionId }
      });
    }
    if (patch.coverLetterId !== undefined && patch.coverLetterId !== prev['cover_letter_id']) {
      await this.client.from('application_events').insert({
        application_id: applicationId,
        user_id: userId,
        event_type: 'cover_letter_linked',
        payload: { from: prev['cover_letter_id'], to: patch.coverLetterId }
      });
    }
    if (patch.nextFollowUpAt !== undefined && patch.nextFollowUpAt !== prev['next_follow_up_at']) {
      await this.client.from('application_events').insert({
        application_id: applicationId,
        user_id: userId,
        event_type: 'follow_up_scheduled',
        payload: { nextFollowUpAt: patch.nextFollowUpAt, followUpNote: patch.followUpNote ?? '' }
      });
    }

    const [hydrated] = await this.hydrateSupabaseApplications(userId, [
      updatedRow as Record<string, unknown>
    ]);
    return hydrated ?? null;
  }

  async deleteApplication(userId: string, applicationId: string): Promise<boolean> {
    const { data, error } = await this.client
      .from('applications')
      .delete()
      .eq('id', applicationId)
      .eq('user_id', userId)
      .select('id');

    if (error) throw new Error(`Failed to delete application: ${error.message}`);
    return Array.isArray(data) && data.length > 0;
  }
}
