import type {
  ApplicationEventRecord,
  ApplicationRecord,
  ApplicationStatus,
  CaptureExtensionJobRequest,
  CaptureExtensionJobResponse,
  CrawlRunSummary,
  CreateManualApplicationRequest,
  IndiaProfile,
  JdRequirements,
  JobFeedItem,
  JobFeedQuery,
  JobMatch,
  JobSighting,
  JobSourceStatus,
  JsonResume,
  LlmProviderId,
  LlmUsageLog,
  LlmUsageSummary,
  MasterProfile,
  ProfileStory,
  ProviderCapabilities,
  ResumeDiffSummary,
  ResumeTemplateId,
  ResumeVersionRecord,
  SavedAnswer,
  SearchPreferences,
  UpdateApplicationRequest,
  UpdateProfileRequest,
  UpsertSavedAnswerRequest,
  UpsertStoryRequest,
  VerifierReport
} from '@jobpilot/shared';
import type { JobForMatching } from '@jobpilot/ingestion';
import type { LlmCallLogEntry } from '@jobpilot/llm';

export interface AuthUser {
  id: string;
  email?: string;
  fullName?: string;
}

export interface StoredLlmSetting {
  userId: string;
  provider: LlmProviderId;
  isActive: boolean;
  selectedModel: string | null;
  baseUrlOverride: string | null;
  encryptedApiKey: string | null;
  keyIv: string | null;
  keyAuthTag: string | null;
  keyHint: string | null;
  detectedCapabilities: ProviderCapabilities | null;
  lastTestedAt: string | null;
  lastTestStatus: 'ok' | 'error' | 'untested' | null;
  updatedAt: string;
}

export interface LlmSettingPatch {
  isActive?: boolean;
  selectedModel?: string | null;
  baseUrlOverride?: string | null;
  encryptedApiKey?: string | null;
  keyIv?: string | null;
  keyAuthTag?: string | null;
  keyHint?: string | null;
  detectedCapabilities?: ProviderCapabilities | null;
  lastTestedAt?: string | null;
  lastTestStatus?: 'ok' | 'error' | 'untested' | null;
}

export interface ProfilePatch extends UpdateProfileRequest {
  jsonResume?: JsonResume;
  indiaProfile?: IndiaProfile;
  searchPreferences?: SearchPreferences;
  sourceResumeStoragePath?: string | null;
}

export interface AccountExportPayload {
  exportedAt: string;
  profile: MasterProfile;
  stories: ProfileStory[];
  savedAnswers: SavedAnswer[];
  llmSettings: Array<Omit<StoredLlmSetting, 'encryptedApiKey' | 'keyIv' | 'keyAuthTag'> & { hasKey: boolean }>;
  usageLogs: LlmUsageLog[];
  resumeVersions: ResumeVersionRecord[];
  applications: ApplicationRecord[];
}

export interface CreateResumeVersionInput {
  id: string;
  jobId: string | null;
  parentProfileVersion: number;
  label: string;
  jdRequirements: JdRequirements;
  tailoredJsonResume: JsonResume;
  diffSummary: ResumeDiffSummary;
  verifierReport: VerifierReport;
  verifierPassed: boolean;
  templateId: ResumeTemplateId;
  typstSource: string;
  pdfStoragePath: string;
  pdfEngine: 'typst' | 'builtin-ats-pdf';
  provider: LlmProviderId | null;
  model: string | null;
}

export interface DataStore {
  getOrCreateProfile(user: AuthUser): Promise<MasterProfile>;
  updateProfile(userId: string, patch: ProfilePatch, bumpVersion?: boolean): Promise<MasterProfile>;
  updateProfileEmbedding(
    userId: string,
    params: { hash: string; vector: number[]; model: string; version: string }
  ): Promise<void>;

  listStories(userId: string): Promise<ProfileStory[]>;
  createStory(userId: string, input: UpsertStoryRequest): Promise<ProfileStory>;
  updateStory(userId: string, storyId: string, input: UpsertStoryRequest): Promise<ProfileStory | null>;
  deleteStory(userId: string, storyId: string): Promise<boolean>;

  listSavedAnswers(userId: string): Promise<SavedAnswer[]>;
  createSavedAnswer(userId: string, input: UpsertSavedAnswerRequest): Promise<SavedAnswer>;
  updateSavedAnswer(
    userId: string,
    answerId: string,
    input: UpsertSavedAnswerRequest
  ): Promise<SavedAnswer | null>;
  deleteSavedAnswer(userId: string, answerId: string): Promise<boolean>;

  listLlmSettings(userId: string): Promise<StoredLlmSetting[]>;
  getLlmSetting(userId: string, provider: LlmProviderId): Promise<StoredLlmSetting | null>;
  upsertLlmSetting(
    userId: string,
    provider: LlmProviderId,
    patch: LlmSettingPatch
  ): Promise<StoredLlmSetting>;
  clearLlmKey(userId: string, provider: LlmProviderId): Promise<StoredLlmSetting | null>;

  logLlmUsage(entry: LlmCallLogEntry): Promise<void>;
  getUsageSummary(userId: string, limit?: number): Promise<LlmUsageSummary>;

  uploadRawResume(userId: string, filename: string, buffer: Buffer): Promise<string>;

  exportAccountData(user: AuthUser): Promise<AccountExportPayload>;
  deleteAccount(userId: string): Promise<void>;

  getProfileEmbedding(
    userId: string
  ): Promise<{ vector: number[]; model: string; version: string } | null>;
  listJobsFeed(
    userId: string,
    profileVersion: number,
    query: JobFeedQuery
  ): Promise<{ items: JobFeedItem[]; total: number }>;
  getJobDetail(
    userId: string,
    jobId: string,
    profileVersion: number
  ): Promise<{ item: JobFeedItem; sightings: JobSighting[] } | null>;
  listActiveJobsForMatching(userId: string, limit?: number): Promise<JobForMatching[]>;
  listMatchesForProfileVersion(userId: string, profileVersion: number): Promise<JobMatch[]>;
  upsertJobMatches(userId: string, matches: JobMatch[]): Promise<void>;
  setMatchDismissed(
    userId: string,
    jobId: string,
    profileVersion: number,
    dismissed: boolean
  ): Promise<boolean>;
  saveJobApplication(
    userId: string,
    jobId: string,
    sourceChannel?: string
  ): Promise<{ id: string; status: string }>;
  listJobSourcesAndRuns(): Promise<{
    sources: JobSourceStatus[];
    recentRuns: CrawlRunSummary[];
  }>;

  getJobForTailoring(
    userId: string,
    jobId: string
  ): Promise<{
    id: string;
    title: string;
    companyName: string;
    descriptionClean: string;
    parsedRequirements: unknown | null;
  } | null>;
  saveJobParsedRequirements(jobId: string, requirements: JdRequirements): Promise<void>;

  uploadRenderedResumePdf(userId: string, versionId: string, buffer: Buffer): Promise<string>;
  downloadRenderedResumePdf(userId: string, storagePath: string): Promise<Buffer | null>;

  listResumeVersions(userId: string, jobId?: string): Promise<ResumeVersionRecord[]>;
  getResumeVersion(userId: string, versionId: string): Promise<ResumeVersionRecord | null>;
  createResumeVersion(
    userId: string,
    input: CreateResumeVersionInput
  ): Promise<ResumeVersionRecord>;
  updateResumeVersionVerification(
    userId: string,
    versionId: string,
    report: VerifierReport
  ): Promise<ResumeVersionRecord | null>;
  deleteResumeVersion(userId: string, versionId: string): Promise<boolean>;

  captureExtensionJob(
    userId: string,
    input: CaptureExtensionJobRequest
  ): Promise<CaptureExtensionJobResponse>;

  listApplications(userId: string, status?: ApplicationStatus): Promise<ApplicationRecord[]>;
  getApplicationDetail(
    userId: string,
    applicationId: string
  ): Promise<{ application: ApplicationRecord; events: ApplicationEventRecord[] } | null>;
  createManualApplication(
    userId: string,
    input: CreateManualApplicationRequest
  ): Promise<ApplicationRecord>;
  updateApplication(
    userId: string,
    applicationId: string,
    patch: UpdateApplicationRequest
  ): Promise<ApplicationRecord | null>;
  deleteApplication(userId: string, applicationId: string): Promise<boolean>;
}
