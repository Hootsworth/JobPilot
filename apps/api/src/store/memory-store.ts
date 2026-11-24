import { createHash, randomUUID } from 'node:crypto';
import {
  createEmptyIndiaProfile,
  createEmptyJsonResume,
  IndiaProfileSchema,
  JsonResumeSchema,
  LlmProviderIdSchema,
  SearchPreferencesSchema,
  type ApplicationEventRecord,
  type ApplicationRecord,
  type ApplicationStatus,
  type CaptureExtensionJobRequest,
  type CaptureExtensionJobResponse,
  type CoverLetterRecord,
  type CrawlRunSummary,
  type CreateManualApplicationRequest,
  type CreateProfileVariantRequest,
  type JdRequirements,
  type JobFeedItem,
  type JobFeedQuery,
  type JobMatch,
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
import type { JobForMatching } from '@jobpilot/ingestion';
import type { LlmCallLogEntry } from '@jobpilot/llm';
import type {
  AccountExportPayload,
  AuthUser,
  CreateCoverLetterInput,
  CreateResumeVersionInput,
  DataStore,
  LlmSettingPatch,
  ProfilePatch,
  StoredLlmSetting,
  UpdateCoverLetterPatch
} from './types.js';

export function slugifyVariantName(name: string, existingSlugs: Set<string>): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'variant';
  if (!existingSlugs.has(base)) return base;
  let n = 2;
  while (existingSlugs.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export function buildUsageSummary(logs: LlmUsageLog[]): LlmUsageSummary {
  const totalCalls = logs.length;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;
  let totalLatency = 0;

  const byProvMap = new Map<
    LlmProviderId,
    { calls: number; tokens: number; costUsd: number; latencySum: number }
  >();

  for (const log of logs) {
    totalInputTokens += log.inputTokens;
    totalOutputTokens += log.outputTokens;
    totalCostUsd += log.estimatedCostUsd;
    totalLatency += log.latencyMs;

    const prev = byProvMap.get(log.provider) ?? {
      calls: 0,
      tokens: 0,
      costUsd: 0,
      latencySum: 0
    };
    prev.calls += 1;
    prev.tokens += log.inputTokens + log.outputTokens;
    prev.costUsd += log.estimatedCostUsd;
    prev.latencySum += log.latencyMs;
    byProvMap.set(log.provider, prev);
  }

  return {
    totalCalls,
    totalInputTokens,
    totalOutputTokens,
    totalCostUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
    avgLatencyMs: totalCalls > 0 ? Math.round(totalLatency / totalCalls) : 0,
    byProvider: Array.from(byProvMap.entries()).map(([provider, stat]) => ({
      provider,
      calls: stat.calls,
      tokens: stat.tokens,
      costUsd: Math.round(stat.costUsd * 1_000_000) / 1_000_000,
      avgLatencyMs: Math.round(stat.latencySum / stat.calls)
    })),
    recentLogs: logs.slice(0, 50)
  };
}

export class MemoryDataStore implements DataStore {
  private profiles = new Map<string, MasterProfile>();
  private stories = new Map<string, ProfileStory[]>();
  private answers = new Map<string, SavedAnswer[]>();
  private llmSettings = new Map<string, StoredLlmSetting[]>();
  private usageLogs = new Map<string, LlmUsageLog[]>();
  private rawFiles = new Map<string, Buffer>();
  private profileEmbeddings = new Map<
    string,
    { vector: number[]; model: string; version: string }
  >();
  private jobs: JobForMatching[] = [];
  private sightingsByJobId = new Map<string, JobSighting[]>();
  private jobMatchesByUser = new Map<string, JobMatch[]>();
  private applicationsByUser = new Map<
    string,
    Map<
      string,
      {
        id: string;
        userId: string;
        jobId: string;
        status: ApplicationStatus;
        resumeVersionId: string | null;
        coverLetterId: string | null;
        appliedAt: string | null;
        nextFollowUpAt: string | null;
        followUpNote: string;
        salaryOffered: string;
        notes: string;
        sourceChannel: string;
        createdAt: string;
        updatedAt: string;
      }
    >
  >();
  private applicationEvents = new Map<string, ApplicationEventRecord[]>();
  private sources: JobSourceStatus[] = [];
  private crawlRuns: CrawlRunSummary[] = [];
  private jobParsedReqs = new Map<string, JdRequirements>();
  private renderedPdfs = new Map<string, Buffer>();
  private resumeVersionsByUser = new Map<string, ResumeVersionRecord[]>();
  private profileVariantsByUser = new Map<string, ProfileVariantRecord[]>();
  private coverLettersByUser = new Map<string, CoverLetterRecord[]>();

  seedJobsForTest(items: JobForMatching[], sources: JobSourceStatus[] = []) {
    this.jobs = structuredClone(items);
    this.sources = structuredClone(sources);
  }

  async getOrCreateProfile(user: AuthUser): Promise<MasterProfile> {
    const existing = this.profiles.get(user.id);
    if (existing) return structuredClone(existing);

    const now = new Date().toISOString();
    const profile: MasterProfile = {
      id: user.id,
      fullName: user.fullName ?? null,
      email: user.email ?? null,
      phone: null,
      activeProfileVersion: 1,
      jsonResume: createEmptyJsonResume(),
      indiaProfile: createEmptyIndiaProfile(),
      searchPreferences: SearchPreferencesSchema.parse({}),
      sourceResumeStoragePath: null,
      embeddingModel: null,
      embeddingModelVersion: null,
      embeddedAt: null,
      telemetryOptIn: false,
      onboardingCompletedAt: null,
      updatedAt: now
    };
    this.profiles.set(user.id, profile);
    return structuredClone(profile);
  }

  async updateProfile(
    userId: string,
    patch: ProfilePatch,
    bumpVersion: boolean = true
  ): Promise<MasterProfile> {
    const current = await this.getOrCreateProfile({ id: userId });
    const now = new Date().toISOString();
    const next: MasterProfile = {
      ...current,
      fullName: patch.fullName !== undefined ? patch.fullName : current.fullName,
      email: patch.email !== undefined ? (patch.email || null) : current.email,
      phone: patch.phone !== undefined ? (patch.phone || null) : current.phone,
      jsonResume: patch.jsonResume
        ? JsonResumeSchema.parse(patch.jsonResume)
        : current.jsonResume,
      indiaProfile: patch.indiaProfile
        ? IndiaProfileSchema.parse(patch.indiaProfile)
        : current.indiaProfile,
      searchPreferences: patch.searchPreferences
        ? SearchPreferencesSchema.parse(patch.searchPreferences)
        : current.searchPreferences,
      sourceResumeStoragePath:
        patch.sourceResumeStoragePath !== undefined
          ? patch.sourceResumeStoragePath
          : current.sourceResumeStoragePath,
      telemetryOptIn:
        patch.telemetryOptIn !== undefined ? patch.telemetryOptIn : current.telemetryOptIn,
      onboardingCompletedAt: patch.markOnboardingComplete
        ? current.onboardingCompletedAt ?? now
        : current.onboardingCompletedAt,
      activeProfileVersion: bumpVersion
        ? current.activeProfileVersion + 1
        : current.activeProfileVersion,
      updatedAt: now
    };
    this.profiles.set(userId, next);
    if (patch.jsonResume || patch.indiaProfile) {
      const variants = this.profileVariantsByUser.get(userId);
      const def = variants?.find((v) => v.isDefault);
      if (def) {
        def.jsonResume = structuredClone(next.jsonResume);
        def.indiaProfile = structuredClone(next.indiaProfile);
        def.version += 1;
        def.updatedAt = now;
      }
    }
    return structuredClone(next);
  }

  async updateProfileEmbedding(
    userId: string,
    params: { hash: string; vector: number[]; model: string; version: string }
  ): Promise<void> {
    const current = this.profiles.get(userId);
    if (!current) return;
    current.embeddingModel = params.model;
    current.embeddingModelVersion = params.version;
    current.embeddedAt = new Date().toISOString();
    this.profiles.set(userId, current);
    this.profileEmbeddings.set(userId, {
      vector: [...params.vector],
      model: params.model,
      version: params.version
    });
  }

  async listStories(userId: string): Promise<ProfileStory[]> {
    return structuredClone(this.stories.get(userId) ?? []);
  }

  async createStory(userId: string, input: UpsertStoryRequest): Promise<ProfileStory> {
    const now = new Date().toISOString();
    const story: ProfileStory = {
      id: randomUUID(),
      userId,
      title: input.title,
      category: input.category,
      situation: input.situation,
      task: input.task,
      action: input.action,
      result: input.result,
      metrics: input.metrics,
      skillsUsed: input.skillsUsed,
      linkedExperienceId: input.linkedExperienceId ?? null,
      createdAt: now,
      updatedAt: now
    };
    const list = this.stories.get(userId) ?? [];
    list.unshift(story);
    this.stories.set(userId, list);
    return structuredClone(story);
  }

  async updateStory(
    userId: string,
    storyId: string,
    input: UpsertStoryRequest
  ): Promise<ProfileStory | null> {
    const list = this.stories.get(userId) ?? [];
    const idx = list.findIndex((s) => s.id === storyId);
    if (idx === -1) return null;
    const existing = list[idx]!;
    const updated: ProfileStory = {
      ...existing,
      title: input.title,
      category: input.category,
      situation: input.situation,
      task: input.task,
      action: input.action,
      result: input.result,
      metrics: input.metrics,
      skillsUsed: input.skillsUsed,
      linkedExperienceId: input.linkedExperienceId ?? null,
      updatedAt: new Date().toISOString()
    };
    list[idx] = updated;
    return structuredClone(updated);
  }

  async deleteStory(userId: string, storyId: string): Promise<boolean> {
    const list = this.stories.get(userId) ?? [];
    const next = list.filter((s) => s.id !== storyId);
    if (next.length === list.length) return false;
    this.stories.set(userId, next);
    return true;
  }

  async listSavedAnswers(userId: string): Promise<SavedAnswer[]> {
    return structuredClone(this.answers.get(userId) ?? []);
  }

  async createSavedAnswer(userId: string, input: UpsertSavedAnswerRequest): Promise<SavedAnswer> {
    const now = new Date().toISOString();
    const item: SavedAnswer = {
      id: randomUUID(),
      userId,
      questionKey: input.questionKey,
      questionPattern: input.questionPattern,
      answer: input.answer,
      tags: input.tags,
      createdAt: now,
      updatedAt: now
    };
    const list = this.answers.get(userId) ?? [];
    list.unshift(item);
    this.answers.set(userId, list);
    return structuredClone(item);
  }

  async updateSavedAnswer(
    userId: string,
    answerId: string,
    input: UpsertSavedAnswerRequest
  ): Promise<SavedAnswer | null> {
    const list = this.answers.get(userId) ?? [];
    const idx = list.findIndex((a) => a.id === answerId);
    if (idx === -1) return null;
    const existing = list[idx]!;
    const updated: SavedAnswer = {
      ...existing,
      questionKey: input.questionKey,
      questionPattern: input.questionPattern,
      answer: input.answer,
      tags: input.tags,
      updatedAt: new Date().toISOString()
    };
    list[idx] = updated;
    return structuredClone(updated);
  }

  async deleteSavedAnswer(userId: string, answerId: string): Promise<boolean> {
    const list = this.answers.get(userId) ?? [];
    const next = list.filter((a) => a.id !== answerId);
    if (next.length === list.length) return false;
    this.answers.set(userId, next);
    return true;
  }

  async listLlmSettings(userId: string): Promise<StoredLlmSetting[]> {
    return structuredClone(this.llmSettings.get(userId) ?? []);
  }

  async getLlmSetting(userId: string, provider: LlmProviderId): Promise<StoredLlmSetting | null> {
    const list = this.llmSettings.get(userId) ?? [];
    const match = list.find((item) => item.provider === provider);
    return match ? structuredClone(match) : null;
  }

  async upsertLlmSetting(
    userId: string,
    provider: LlmProviderId,
    patch: LlmSettingPatch
  ): Promise<StoredLlmSetting> {
    const list = this.llmSettings.get(userId) ?? [];
    if (patch.isActive) {
      for (const row of list) {
        if (row.provider !== provider) row.isActive = false;
      }
    }

    const now = new Date().toISOString();
    const existingIdx = list.findIndex((item) => item.provider === provider);
    const base: StoredLlmSetting =
      existingIdx >= 0
        ? list[existingIdx]!
        : {
            userId,
            provider,
            isActive: false,
            selectedModel: null,
            baseUrlOverride: null,
            encryptedApiKey: null,
            keyIv: null,
            keyAuthTag: null,
            keyHint: null,
            detectedCapabilities: null,
            lastTestedAt: null,
            lastTestStatus: 'untested',
            updatedAt: now
          };

    const next: StoredLlmSetting = {
      ...base,
      ...patch,
      updatedAt: now
    };
    if (existingIdx >= 0) list[existingIdx] = next;
    else list.push(next);

    this.llmSettings.set(userId, list);
    return structuredClone(next);
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
    if (!entry.userId) return;
    const list = this.usageLogs.get(entry.userId) ?? [];
    const parsedProvider = LlmProviderIdSchema.safeParse(entry.provider);
    if (!parsedProvider.success) return;

    list.unshift({
      id: randomUUID(),
      taskType: entry.taskType,
      provider: parsedProvider.data,
      model: entry.model,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      latencyMs: entry.latencyMs,
      estimatedCostUsd: entry.estimatedCostUsd,
      retryCount: entry.retryCount,
      usedRepair: entry.usedRepair,
      status: entry.status,
      errorCode: entry.errorCode ?? null,
      createdAt: new Date().toISOString()
    });
    this.usageLogs.set(entry.userId, list);
  }

  async getUsageSummary(userId: string, limit: number = 100): Promise<LlmUsageSummary> {
    const logs = (this.usageLogs.get(userId) ?? []).slice(0, limit);
    return buildUsageSummary(logs);
  }

  async uploadRawResume(userId: string, filename: string, buffer: Buffer): Promise<string> {
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${userId}/${Date.now()}-${safeName}`;
    this.rawFiles.set(storagePath, Buffer.from(buffer));
    return storagePath;
  }

  async exportAccountData(user: AuthUser): Promise<AccountExportPayload> {
    const profile = await this.getOrCreateProfile(user);
    const profileVariants = await this.listProfileVariants(user.id);
    const stories = await this.listStories(user.id);
    const savedAnswers = await this.listSavedAnswers(user.id);
    const settings = await this.listLlmSettings(user.id);
    const usageLogs = this.usageLogs.get(user.id) ?? [];

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
      usageLogs: structuredClone(usageLogs),
      resumeVersions: await this.listResumeVersions(user.id),
      coverLetters: await this.listCoverLetters(user.id),
      applications: await this.listApplications(user.id)
    };
  }

  async deleteAccount(userId: string): Promise<void> {
    this.profiles.delete(userId);
    this.profileVariantsByUser.delete(userId);
    this.stories.delete(userId);
    this.answers.delete(userId);
    this.llmSettings.delete(userId);
    this.usageLogs.delete(userId);
    this.profileEmbeddings.delete(userId);
    this.jobMatchesByUser.delete(userId);
    const userApps = this.applicationsByUser.get(userId);
    if (userApps) {
      for (const app of userApps.values()) {
        this.applicationEvents.delete(app.id);
      }
    }
    this.applicationsByUser.delete(userId);
    this.resumeVersionsByUser.delete(userId);
    this.coverLettersByUser.delete(userId);
    for (const key of this.rawFiles.keys()) {
      if (key.startsWith(`${userId}/`)) {
        this.rawFiles.delete(key);
      }
    }
    for (const key of this.renderedPdfs.keys()) {
      if (key.startsWith(`${userId}/`)) {
        this.renderedPdfs.delete(key);
      }
    }
  }

  async getProfileEmbedding(
    userId: string
  ): Promise<{ vector: number[]; model: string; version: string } | null> {
    return this.profileEmbeddings.get(userId) ?? null;
  }

  async listJobsFeed(
    userId: string,
    profileVersion: number,
    query: JobFeedQuery
  ): Promise<{ items: JobFeedItem[]; total: number }> {
    const matches = (this.jobMatchesByUser.get(userId) ?? []).filter(
      (m) => m.profileVersion === profileVersion
    );
    const matchByJob = new Map(matches.map((m) => [m.jobId, m]));
    const appsByJob = this.applicationsByUser.get(userId) ?? new Map();
    const needle = query.q?.trim().toLowerCase();

    const filtered = this.jobs
      .filter((job) => {
        if (!job.isActive) return false;
        if (job.ownerUserId && job.ownerUserId !== userId) return false;
        if (query.country && job.countryCode?.toUpperCase() !== query.country.toUpperCase()) {
          return false;
        }
        if (query.city && !job.city?.toLowerCase().includes(query.city.toLowerCase())) {
          return false;
        }
        if (query.workMode && job.workMode !== query.workMode) return false;
        if (query.seniority && job.seniority !== query.seniority) return false;
        if (query.source && job.sourceType !== query.source) return false;
        if (
          query.minSalaryLpa != null &&
          job.salaryMaxLpa != null &&
          job.salaryMaxLpa < query.minSalaryLpa
        ) {
          return false;
        }
        if (
          query.maxExperienceYears != null &&
          job.experienceMinYears != null &&
          job.experienceMinYears > query.maxExperienceYears
        ) {
          return false;
        }
        if (needle) {
          const hay = `${job.title} ${job.companyName} ${job.locationRaw ?? ''} ${job.extractedSkills.join(' ')}`.toLowerCase();
          if (!hay.includes(needle)) return false;
        }
        const match = matchByJob.get(job.id);
        if (!query.includeDismissed && match?.dismissed) return false;
        if (query.onlyPassed && match && !match.hardFilterPassed) return false;
        return true;
      })
      .map<JobFeedItem>((job) => {
        const { embedding: _emb, ...cleanJob } = job;
        return {
          job: cleanJob,
          match: matchByJob.get(job.id) ?? null,
          applicationStatus: appsByJob.get(job.id)?.status ?? null
        };
      });

    filtered.sort((a, b) => {
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

    const total = filtered.length;
    const paged = filtered.slice(query.offset, query.offset + query.limit);
    return { items: structuredClone(paged), total };
  }

  async getJobDetail(
    userId: string,
    jobId: string,
    profileVersion: number
  ): Promise<{ item: JobFeedItem; sightings: JobSighting[] } | null> {
    const job = this.jobs.find(
      (j) => j.id === jobId && (!j.ownerUserId || j.ownerUserId === userId)
    );
    if (!job) return null;
    const match =
      (this.jobMatchesByUser.get(userId) ?? []).find(
        (m) => m.jobId === jobId && m.profileVersion === profileVersion
      ) ?? null;
    const app = this.applicationsByUser.get(userId)?.get(jobId);
    const { embedding: _emb, ...cleanJob } = job;
    return {
      item: structuredClone({
        job: cleanJob,
        match,
        applicationStatus: app?.status ?? null
      }),
      sightings: structuredClone(
        this.sightingsByJobId.get(jobId) ?? [
          {
            sourceType: cleanJob.sourceType,
            externalId: cleanJob.externalId ?? cleanJob.id,
            sourceUrl: cleanJob.sourceUrl,
            seenAt: cleanJob.lastSeenAt
          }
        ]
      )
    };
  }

  async listActiveJobsForMatching(userId: string, limit: number = 200): Promise<JobForMatching[]> {
    return structuredClone(
      this.jobs
        .filter((j) => j.isActive && (!j.ownerUserId || j.ownerUserId === userId))
        .slice(0, limit)
    );
  }

  async listMatchesForProfileVersion(userId: string, profileVersion: number): Promise<JobMatch[]> {
    return structuredClone(
      (this.jobMatchesByUser.get(userId) ?? []).filter(
        (m) => m.profileVersion === profileVersion
      )
    );
  }

  async upsertJobMatches(userId: string, matches: JobMatch[]): Promise<void> {
    const existing = this.jobMatchesByUser.get(userId) ?? [];
    const byKey = new Map<string, JobMatch>(
      existing.map((m) => [`${m.jobId}:${m.profileVersion}`, m])
    );
    for (const m of matches) {
      byKey.set(`${m.jobId}:${m.profileVersion}`, structuredClone(m));
    }
    this.jobMatchesByUser.set(userId, Array.from(byKey.values()));
  }

  async setMatchDismissed(
    userId: string,
    jobId: string,
    profileVersion: number,
    dismissed: boolean
  ): Promise<boolean> {
    const list = this.jobMatchesByUser.get(userId) ?? [];
    const idx = list.findIndex((m) => m.jobId === jobId && m.profileVersion === profileVersion);
    if (idx >= 0) {
      list[idx] = { ...list[idx]!, dismissed };
      return true;
    }
    const existsJob = this.jobs.some((j) => j.id === jobId);
    if (!existsJob) return false;
    list.push({
      jobId,
      profileVersion,
      hardFilterPassed: true,
      hardFilterReasons: [],
      vectorSimilarity: null,
      llmScore: null,
      matchReason: null,
      matchedSkills: [],
      skillGaps: [],
      provider: null,
      model: null,
      dismissed,
      computedAt: new Date().toISOString()
    });
    this.jobMatchesByUser.set(userId, list);
    return true;
  }

  private recordAppEvent(
    userId: string,
    applicationId: string,
    eventType: string,
    payload: Record<string, unknown> = {}
  ): void {
    const events = this.applicationEvents.get(applicationId) ?? [];
    events.unshift({
      id: randomUUID(),
      applicationId,
      userId,
      eventType,
      payload,
      createdAt: new Date().toISOString()
    });
    this.applicationEvents.set(applicationId, events);
  }

  private hydrateApplicationRecord(
    userId: string,
    raw: {
      id: string;
      userId: string;
      jobId: string;
      status: ApplicationStatus;
      resumeVersionId: string | null;
      coverLetterId: string | null;
      appliedAt: string | null;
      nextFollowUpAt: string | null;
      followUpNote: string;
      salaryOffered: string;
      notes: string;
      sourceChannel: string;
      createdAt: string;
      updatedAt: string;
    }
  ): ApplicationRecord {
    const job = this.jobs.find((j) => j.id === raw.jobId);
    const resumeList = this.resumeVersionsByUser.get(userId) ?? [];
    const resume = raw.resumeVersionId
      ? resumeList.find((r) => r.id === raw.resumeVersionId) ?? null
      : null;
    const coverList = this.coverLettersByUser.get(userId) ?? [];
    const cover = raw.coverLetterId
      ? coverList.find((c) => c.id === raw.coverLetterId) ?? null
      : null;

    return {
      id: raw.id,
      userId: raw.userId,
      jobId: raw.jobId,
      resumeVersionId: raw.resumeVersionId,
      coverLetterId: raw.coverLetterId,
      status: raw.status,
      appliedAt: raw.appliedAt,
      nextFollowUpAt: raw.nextFollowUpAt,
      followUpNote: raw.followUpNote,
      salaryOffered: raw.salaryOffered,
      notes: raw.notes,
      sourceChannel: raw.sourceChannel,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      job: {
        id: job?.id ?? raw.jobId,
        title: job?.title ?? 'Tracked Application',
        companyName: job?.companyName ?? 'Company',
        locationRaw: job?.locationRaw ?? null,
        sourceType: job?.sourceType ?? 'manual',
        sourceUrl: job?.sourceUrl ?? 'https://jobpilot.local/manual',
        applyUrl: job?.applyUrl ?? null,
        salaryMinLpa: job?.salaryMinLpa ?? null,
        salaryMaxLpa: job?.salaryMaxLpa ?? null
      },
      resumeVersion: resume
        ? {
            id: resume.id,
            versionNumber: resume.versionNumber,
            label: resume.label,
            verifierPassed: resume.verifierPassed,
            templateId: resume.templateId
          }
        : null,
      coverLetter: cover
        ? {
            id: cover.id,
            versionNumber: cover.versionNumber,
            label: cover.label,
            companyName: cover.companyName,
            roleTitle: cover.roleTitle,
            tone: cover.tone,
            verifierPassed: cover.verifierPassed
          }
        : null
    };
  }

  async saveJobApplication(
    userId: string,
    jobId: string,
    sourceChannel: string = 'web'
  ): Promise<{ id: string; status: string }> {
    let userApps = this.applicationsByUser.get(userId);
    if (!userApps) {
      userApps = new Map();
      this.applicationsByUser.set(userId, userApps);
    }
    const existing = userApps.get(jobId);
    if (existing) return { id: existing.id, status: existing.status };
    const now = new Date().toISOString();
    const created = {
      id: randomUUID(),
      userId,
      jobId,
      status: 'saved' as const,
      resumeVersionId: null,
      coverLetterId: null,
      appliedAt: null,
      nextFollowUpAt: null,
      followUpNote: '',
      salaryOffered: '',
      notes: '',
      sourceChannel,
      createdAt: now,
      updatedAt: now
    };
    userApps.set(jobId, created);
    this.recordAppEvent(userId, created.id, 'saved_to_tracker', {
      status: 'saved',
      sourceChannel
    });
    return { id: created.id, status: created.status };
  }

  async listJobSourcesAndRuns(): Promise<{
    sources: JobSourceStatus[];
    recentRuns: CrawlRunSummary[];
  }> {
    return {
      sources: structuredClone(this.sources),
      recentRuns: structuredClone(this.crawlRuns)
    };
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
    const job = this.jobs.find(
      (j) => j.id === jobId && (!j.ownerUserId || j.ownerUserId === userId)
    );
    if (!job) return null;
    return {
      id: job.id,
      title: job.title,
      companyName: job.companyName,
      descriptionClean: job.descriptionClean,
      parsedRequirements: this.jobParsedReqs.get(jobId) ?? null
    };
  }

  async saveJobParsedRequirements(jobId: string, requirements: JdRequirements): Promise<void> {
    this.jobParsedReqs.set(jobId, structuredClone(requirements));
  }

  async uploadRenderedResumePdf(
    userId: string,
    versionId: string,
    buffer: Buffer
  ): Promise<string> {
    const storagePath = `${userId}/${versionId}.pdf`;
    this.renderedPdfs.set(storagePath, Buffer.from(buffer));
    return storagePath;
  }

  async downloadRenderedResumePdf(
    userId: string,
    storagePath: string
  ): Promise<Buffer | null> {
    if (!storagePath.startsWith(`${userId}/`)) return null;
    const buf = this.renderedPdfs.get(storagePath);
    return buf ? Buffer.from(buf) : null;
  }

  async listResumeVersions(userId: string, jobId?: string): Promise<ResumeVersionRecord[]> {
    const list = this.resumeVersionsByUser.get(userId) ?? [];
    const filtered = jobId ? list.filter((v) => v.jobId === jobId) : list;
    return structuredClone(filtered);
  }

  async getResumeVersion(
    userId: string,
    versionId: string
  ): Promise<ResumeVersionRecord | null> {
    const list = this.resumeVersionsByUser.get(userId) ?? [];
    const found = list.find((v) => v.id === versionId);
    return found ? structuredClone(found) : null;
  }

  private ensureDefaultVariant(userId: string): ProfileVariantRecord[] {
    let list = this.profileVariantsByUser.get(userId);
    if (!list || list.length === 0) {
      const base = this.profiles.get(userId);
      const now = new Date().toISOString();
      const def: ProfileVariantRecord = {
        id: randomUUID(),
        userId,
        name: 'Default',
        slug: 'default',
        targetRole: base?.jsonResume.basics.label ?? '',
        isDefault: true,
        jsonResume: structuredClone(base?.jsonResume ?? createEmptyJsonResume()),
        indiaProfile: structuredClone(base?.indiaProfile ?? createEmptyIndiaProfile()),
        version: base?.activeProfileVersion ?? 1,
        createdAt: now,
        updatedAt: now
      };
      list = [def];
      this.profileVariantsByUser.set(userId, list);
    }
    return list;
  }

  async listProfileVariants(userId: string): Promise<ProfileVariantRecord[]> {
    await this.getOrCreateProfile({ id: userId });
    const list = this.ensureDefaultVariant(userId);
    return structuredClone(
      [...list].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || b.updatedAt.localeCompare(a.updatedAt))
    );
  }

  async getProfileVariant(userId: string, variantId: string): Promise<ProfileVariantRecord | null> {
    await this.getOrCreateProfile({ id: userId });
    const list = this.ensureDefaultVariant(userId);
    const found = list.find((v) => v.id === variantId);
    return found ? structuredClone(found) : null;
  }

  async createProfileVariant(
    userId: string,
    input: CreateProfileVariantRequest
  ): Promise<ProfileVariantRecord> {
    const profile = await this.getOrCreateProfile({ id: userId });
    const list = this.ensureDefaultVariant(userId);
    const now = new Date().toISOString();
    const existingSlugs = new Set(list.map((v) => v.slug));
    const sourceVariant = input.cloneFromVariantId
      ? list.find((v) => v.id === input.cloneFromVariantId)
      : list.find((v) => v.isDefault);

    const shouldBeDefault = Boolean(input.isDefault);
    if (shouldBeDefault) {
      for (const item of list) item.isDefault = false;
    }

    const created: ProfileVariantRecord = {
      id: randomUUID(),
      userId,
      name: input.name,
      slug: slugifyVariantName(input.name, existingSlugs),
      targetRole: input.targetRole ?? sourceVariant?.targetRole ?? '',
      isDefault: shouldBeDefault,
      jsonResume: structuredClone(
        input.jsonResume ?? sourceVariant?.jsonResume ?? profile.jsonResume
      ),
      indiaProfile: structuredClone(
        input.indiaProfile ?? sourceVariant?.indiaProfile ?? profile.indiaProfile
      ),
      version: 1,
      createdAt: now,
      updatedAt: now
    };
    list.push(created);

    if (shouldBeDefault) {
      await this.updateProfile(
        userId,
        {
          jsonResume: created.jsonResume,
          indiaProfile: created.indiaProfile
        },
        true
      );
    }

    return structuredClone(created);
  }

  async updateProfileVariant(
    userId: string,
    variantId: string,
    patch: UpdateProfileVariantRequest
  ): Promise<ProfileVariantRecord | null> {
    await this.getOrCreateProfile({ id: userId });
    const list = this.ensureDefaultVariant(userId);
    const target = list.find((v) => v.id === variantId);
    if (!target) return null;

    const now = new Date().toISOString();
    const existingSlugs = new Set(list.filter((v) => v.id !== variantId).map((v) => v.slug));
    if (patch.name !== undefined) {
      target.name = patch.name;
      target.slug = slugifyVariantName(patch.name, existingSlugs);
    }
    if (patch.targetRole !== undefined) target.targetRole = patch.targetRole;
    if (patch.jsonResume !== undefined) {
      target.jsonResume = JsonResumeSchema.parse(patch.jsonResume);
    }
    if (patch.indiaProfile !== undefined) {
      target.indiaProfile = IndiaProfileSchema.parse(patch.indiaProfile);
    }
    if (patch.isDefault === true) {
      for (const item of list) item.isDefault = item.id === target.id;
    }
    target.version += 1;
    target.updatedAt = now;

    if (target.isDefault) {
      const profile = this.profiles.get(userId);
      if (profile) {
        profile.jsonResume = structuredClone(target.jsonResume);
        profile.indiaProfile = structuredClone(target.indiaProfile);
        profile.activeProfileVersion += 1;
        profile.updatedAt = now;
      }
    }

    return structuredClone(target);
  }

  async deleteProfileVariant(userId: string, variantId: string): Promise<boolean> {
    await this.getOrCreateProfile({ id: userId });
    const list = this.ensureDefaultVariant(userId);
    if (list.length <= 1) return false;
    const idx = list.findIndex((v) => v.id === variantId);
    if (idx === -1) return false;

    const [removed] = list.splice(idx, 1);
    if (removed?.isDefault && list.length > 0) {
      list[0]!.isDefault = true;
      const profile = this.profiles.get(userId);
      if (profile) {
        profile.jsonResume = structuredClone(list[0]!.jsonResume);
        profile.indiaProfile = structuredClone(list[0]!.indiaProfile);
        profile.activeProfileVersion += 1;
        profile.updatedAt = new Date().toISOString();
      }
    }
    return true;
  }

  async createResumeVersion(
    userId: string,
    input: CreateResumeVersionInput
  ): Promise<ResumeVersionRecord> {
    const list = this.resumeVersionsByUser.get(userId) ?? [];
    const maxVersion = list.reduce((acc, v) => Math.max(acc, v.versionNumber), 0);
    const record: ResumeVersionRecord = {
      id: input.id,
      userId,
      jobId: input.jobId,
      profileVariantId: input.profileVariantId ?? null,
      parentProfileVersion: input.parentProfileVersion,
      versionNumber: maxVersion + 1,
      label: input.label,
      jdRequirements: structuredClone(input.jdRequirements),
      tailoredJsonResume: structuredClone(input.tailoredJsonResume),
      diffSummary: structuredClone(input.diffSummary),
      verifierReport: structuredClone(input.verifierReport),
      verifierPassed: input.verifierPassed,
      templateId: input.templateId,
      typstSource: input.typstSource,
      pdfStoragePath: input.pdfStoragePath,
      pdfEngine: input.pdfEngine,
      provider: input.provider,
      model: input.model,
      createdAt: new Date().toISOString()
    };
    list.unshift(record);
    this.resumeVersionsByUser.set(userId, list);
    return structuredClone(record);
  }

  async updateResumeVersionVerification(
    userId: string,
    versionId: string,
    report: VerifierReport
  ): Promise<ResumeVersionRecord | null> {
    const list = this.resumeVersionsByUser.get(userId) ?? [];
    const idx = list.findIndex((v) => v.id === versionId);
    if (idx === -1) return null;
    const updated: ResumeVersionRecord = {
      ...list[idx]!,
      verifierReport: structuredClone(report),
      verifierPassed: report.passed
    };
    list[idx] = updated;
    return structuredClone(updated);
  }

  async deleteResumeVersion(userId: string, versionId: string): Promise<boolean> {
    const list = this.resumeVersionsByUser.get(userId) ?? [];
    const target = list.find((v) => v.id === versionId);
    if (!target) return false;
    if (target.pdfStoragePath) this.renderedPdfs.delete(target.pdfStoragePath);
    this.resumeVersionsByUser.set(
      userId,
      list.filter((v) => v.id !== versionId)
    );
    return true;
  }

  async uploadRenderedCoverLetterPdf(
    userId: string,
    coverLetterId: string,
    buffer: Buffer
  ): Promise<string> {
    const storagePath = `${userId}/cover-letters/${coverLetterId}.pdf`;
    this.renderedPdfs.set(storagePath, Buffer.from(buffer));
    return storagePath;
  }

  async listCoverLetters(userId: string, jobId?: string): Promise<CoverLetterRecord[]> {
    const list = this.coverLettersByUser.get(userId) ?? [];
    const filtered = jobId ? list.filter((c) => c.jobId === jobId) : list;
    return structuredClone(filtered);
  }

  async getCoverLetter(userId: string, coverLetterId: string): Promise<CoverLetterRecord | null> {
    const list = this.coverLettersByUser.get(userId) ?? [];
    const found = list.find((c) => c.id === coverLetterId);
    return found ? structuredClone(found) : null;
  }

  async createCoverLetter(
    userId: string,
    input: CreateCoverLetterInput
  ): Promise<CoverLetterRecord> {
    const list = this.coverLettersByUser.get(userId) ?? [];
    const maxVersion = list.reduce((acc, c) => Math.max(acc, c.versionNumber), 0);
    const record: CoverLetterRecord = {
      id: input.id,
      userId,
      jobId: input.jobId,
      profileVariantId: input.profileVariantId ?? null,
      parentProfileVersion: input.parentProfileVersion,
      versionNumber: maxVersion + 1,
      label: input.label,
      companyName: input.companyName,
      roleTitle: input.roleTitle,
      tone: input.tone,
      jdRequirements: structuredClone(input.jdRequirements),
      content: structuredClone(input.content),
      plainText: input.plainText,
      verifierReport: structuredClone(input.verifierReport),
      verifierPassed: input.verifierPassed,
      typstSource: input.typstSource,
      pdfStoragePath: input.pdfStoragePath,
      pdfEngine: input.pdfEngine,
      provider: input.provider,
      model: input.model,
      createdAt: new Date().toISOString()
    };
    list.unshift(record);
    this.coverLettersByUser.set(userId, list);
    return structuredClone(record);
  }

  async updateCoverLetter(
    userId: string,
    coverLetterId: string,
    patch: UpdateCoverLetterPatch
  ): Promise<CoverLetterRecord | null> {
    const list = this.coverLettersByUser.get(userId) ?? [];
    const idx = list.findIndex((c) => c.id === coverLetterId);
    if (idx === -1) return null;
    const prev = list[idx]!;
    const updated: CoverLetterRecord = {
      ...prev,
      label: patch.label ?? prev.label,
      content: patch.content ? structuredClone(patch.content) : prev.content,
      plainText: patch.plainText ?? prev.plainText,
      typstSource: patch.typstSource ?? prev.typstSource,
      pdfStoragePath: patch.pdfStoragePath ?? prev.pdfStoragePath,
      pdfEngine: patch.pdfEngine ?? prev.pdfEngine
    };
    list[idx] = updated;
    return structuredClone(updated);
  }

  async deleteCoverLetter(userId: string, coverLetterId: string): Promise<boolean> {
    const list = this.coverLettersByUser.get(userId) ?? [];
    const target = list.find((c) => c.id === coverLetterId);
    if (!target) return false;
    if (target.pdfStoragePath) this.renderedPdfs.delete(target.pdfStoragePath);
    this.coverLettersByUser.set(
      userId,
      list.filter((c) => c.id !== coverLetterId)
    );
    return true;
  }

  async captureExtensionJob(
    userId: string,
    input: CaptureExtensionJobRequest
  ): Promise<CaptureExtensionJobResponse> {
    const normalizedUrl = input.sourceUrl.trim().replace(/\/+$/, '').toLowerCase();
    const dedupeFingerprint = createHash('sha256')
      .update(`${input.sourceType}:${normalizedUrl}`)
      .digest('hex');

    let job = this.jobs.find(
      (j) => j.ownerUserId === userId && j.dedupeFingerprint === dedupeFingerprint
    );

    const now = new Date().toISOString();
    if (!job) {
      job = {
        id: randomUUID(),
        ownerUserId: userId,
        dedupeFingerprint,
        sourceType: input.sourceType,
        externalId: null,
        sourceUrl: input.sourceUrl,
        applyUrl: input.applyUrl ?? input.sourceUrl,
        companyName: input.companyName,
        companyDomain: null,
        companyLogoUrl: null,
        title: input.title,
        normalizedTitle: input.title.toLowerCase(),
        locationRaw: input.locationRaw ?? null,
        city: null,
        countryCode: null,
        workMode: 'unknown',
        seniority: 'unknown',
        experienceMinYears: null,
        experienceMaxYears: null,
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: null,
        salaryPeriod: null,
        salaryMinLpa: null,
        salaryMaxLpa: null,
        descriptionClean: input.descriptionClean ?? '',
        extractedSkills: [],
        postedAt: now,
        isActive: true,
        lastSeenAt: now,
        embeddingModel: null,
        embeddingModelVersion: null,
        embeddedAt: null,
        sightingsCount: 1,
        embedding: null
      };
      this.jobs.unshift(job);
    } else {
      job.title = input.title;
      job.companyName = input.companyName;
      job.locationRaw = input.locationRaw ?? job.locationRaw;
      if (input.descriptionClean) job.descriptionClean = input.descriptionClean;
      job.lastSeenAt = now;
    }

    let userApps = this.applicationsByUser.get(userId);
    if (!userApps) {
      userApps = new Map();
      this.applicationsByUser.set(userId, userApps);
    }

    const derivedNotes =
      input.notes ?? (input.salaryText ? `Compensation: ${input.salaryText}` : '');

    const existingApp = userApps.get(job.id);
    if (existingApp) {
      if (input.resumeVersionId) existingApp.resumeVersionId = input.resumeVersionId;
      if (derivedNotes) existingApp.notes = derivedNotes;
      existingApp.updatedAt = now;
      return {
        jobId: job.id,
        applicationId: existingApp.id,
        status: existingApp.status,
        resumeVersionId: existingApp.resumeVersionId
      };
    }

    const appRecord = {
      id: randomUUID(),
      userId,
      jobId: job.id,
      status: 'saved' as const,
      resumeVersionId: input.resumeVersionId ?? null,
      coverLetterId: null,
      appliedAt: null,
      nextFollowUpAt: null,
      followUpNote: '',
      salaryOffered: input.salaryText ?? '',
      notes: derivedNotes,
      sourceChannel: 'extension',
      createdAt: now,
      updatedAt: now
    };
    userApps.set(job.id, appRecord);
    this.recordAppEvent(userId, appRecord.id, 'captured_from_extension', {
      sourceType: input.sourceType,
      sourceUrl: input.sourceUrl,
      resumeVersionId: appRecord.resumeVersionId
    });
    return {
      jobId: job.id,
      applicationId: appRecord.id,
      status: appRecord.status,
      resumeVersionId: appRecord.resumeVersionId
    };
  }

  async listApplications(
    userId: string,
    status?: ApplicationStatus
  ): Promise<ApplicationRecord[]> {
    const userApps = this.applicationsByUser.get(userId);
    if (!userApps) return [];
    const records = Array.from(userApps.values())
      .filter((app) => !status || app.status === status)
      .map((app) => this.hydrateApplicationRecord(userId, app))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return structuredClone(records);
  }

  async getApplicationDetail(
    userId: string,
    applicationId: string
  ): Promise<{ application: ApplicationRecord; events: ApplicationEventRecord[] } | null> {
    const userApps = this.applicationsByUser.get(userId);
    if (!userApps) return null;
    const found = Array.from(userApps.values()).find((app) => app.id === applicationId);
    if (!found) return null;
    const events = this.applicationEvents.get(found.id) ?? [];
    return {
      application: structuredClone(this.hydrateApplicationRecord(userId, found)),
      events: structuredClone(events)
    };
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

    const job: JobForMatching = {
      id: randomUUID(),
      ownerUserId: userId,
      dedupeFingerprint,
      sourceType: 'manual',
      externalId: null,
      sourceUrl,
      applyUrl: sourceUrl,
      companyName: input.companyName,
      companyDomain: null,
      companyLogoUrl: null,
      title: input.title,
      normalizedTitle: input.title.toLowerCase(),
      locationRaw: input.locationRaw ?? null,
      city: null,
      countryCode: null,
      workMode: 'unknown',
      seniority: 'unknown',
      experienceMinYears: null,
      experienceMaxYears: null,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
      salaryMinLpa: null,
      salaryMaxLpa: null,
      descriptionClean: input.notes ?? '',
      extractedSkills: [],
      postedAt: now,
      isActive: true,
      lastSeenAt: now,
      embeddingModel: null,
      embeddingModelVersion: null,
      embeddedAt: null,
      sightingsCount: 1,
      embedding: null
    };
    this.jobs.unshift(job);

    let userApps = this.applicationsByUser.get(userId);
    if (!userApps) {
      userApps = new Map();
      this.applicationsByUser.set(userId, userApps);
    }

    const status: ApplicationStatus = input.status ?? 'applied';
    const raw = {
      id: randomUUID(),
      userId,
      jobId: job.id,
      status,
      resumeVersionId: input.resumeVersionId ?? null,
      coverLetterId: input.coverLetterId ?? null,
      appliedAt: status === 'saved' ? null : now,
      nextFollowUpAt: input.nextFollowUpAt ?? null,
      followUpNote: input.followUpNote ?? '',
      salaryOffered: input.salaryOffered ?? '',
      notes: input.notes ?? '',
      sourceChannel: 'manual',
      createdAt: now,
      updatedAt: now
    };
    userApps.set(job.id, raw);
    this.recordAppEvent(userId, raw.id, 'application_created', {
      status: raw.status,
      resumeVersionId: raw.resumeVersionId,
      nextFollowUpAt: raw.nextFollowUpAt
    });
    return structuredClone(this.hydrateApplicationRecord(userId, raw));
  }

  async updateApplication(
    userId: string,
    applicationId: string,
    patch: UpdateApplicationRequest
  ): Promise<ApplicationRecord | null> {
    const userApps = this.applicationsByUser.get(userId);
    if (!userApps) return null;
    const found = Array.from(userApps.values()).find((app) => app.id === applicationId);
    if (!found) return null;

    const now = new Date().toISOString();
    const prevStatus = found.status;
    const prevResumeId = found.resumeVersionId;
    const prevCoverLetterId = found.coverLetterId;
    const prevFollowUp = found.nextFollowUpAt;

    if (patch.status !== undefined) {
      found.status = patch.status;
      if (patch.status !== 'saved' && !found.appliedAt && patch.appliedAt === undefined) {
        found.appliedAt = now;
      }
    }
    if (patch.appliedAt !== undefined) found.appliedAt = patch.appliedAt;
    if (patch.resumeVersionId !== undefined) found.resumeVersionId = patch.resumeVersionId;
    if (patch.coverLetterId !== undefined) found.coverLetterId = patch.coverLetterId;
    if (patch.nextFollowUpAt !== undefined) found.nextFollowUpAt = patch.nextFollowUpAt;
    if (patch.followUpNote !== undefined) found.followUpNote = patch.followUpNote;
    if (patch.salaryOffered !== undefined) found.salaryOffered = patch.salaryOffered;
    if (patch.notes !== undefined) found.notes = patch.notes;
    found.updatedAt = now;

    if (patch.status !== undefined && patch.status !== prevStatus) {
      this.recordAppEvent(userId, found.id, 'status_changed', {
        from: prevStatus,
        to: patch.status
      });
    }
    if (patch.resumeVersionId !== undefined && patch.resumeVersionId !== prevResumeId) {
      this.recordAppEvent(userId, found.id, 'resume_version_linked', {
        from: prevResumeId,
        to: patch.resumeVersionId
      });
    }
    if (patch.coverLetterId !== undefined && patch.coverLetterId !== prevCoverLetterId) {
      this.recordAppEvent(userId, found.id, 'cover_letter_linked', {
        from: prevCoverLetterId,
        to: patch.coverLetterId
      });
    }
    if (patch.nextFollowUpAt !== undefined && patch.nextFollowUpAt !== prevFollowUp) {
      this.recordAppEvent(userId, found.id, 'follow_up_scheduled', {
        nextFollowUpAt: patch.nextFollowUpAt,
        followUpNote: found.followUpNote
      });
    }

    return structuredClone(this.hydrateApplicationRecord(userId, found));
  }

  async deleteApplication(userId: string, applicationId: string): Promise<boolean> {
    const userApps = this.applicationsByUser.get(userId);
    if (!userApps) return false;
    for (const [jobId, app] of userApps.entries()) {
      if (app.id === applicationId) {
        userApps.delete(jobId);
        this.applicationEvents.delete(applicationId);
        return true;
      }
    }
    return false;
  }
}
