'use client';

import type {
  ApplicationEventRecord,
  ApplicationRecord,
  ApplicationStatus,
  AtsScoreReport,
  AtsScoreRequest,
  CoverLetterRecord,
  CrawlRunSummary,
  CreateManualApplicationRequest,
  CreateProfileVariantRequest,
  DismissReason,
  GenerateCoverLetterRequest,
  GithubImportRequest,
  ImportPreviewCandidate,
  JobFeedItem,
  JobSighting,
  JobSourceStatus,
  JobSyncStatus,
  LlmProviderId,
  LlmSettingsItem,
  LlmUsageSummary,
  MasterProfile,
  ModelInfo,
  ParsedResumeOutput,
  ProfileStory,
  ProfileVariantRecord,
  RecommendationsResponse,
  RefreshMatchesRequest,
  ResumeVersionRecord,
  SavedAnswer,
  SyncJobsRequest,
  TailorResumeRequest,
  TestLlmKeyRequest,
  TestLlmKeyResult,
  UpdateApplicationRequest,
  UpdateCoverLetterRequest,
  UpdateProfileRequest,
  UpdateProfileVariantRequest,
  UpsertLlmSettingsRequest,
  UpsertSavedAnswerRequest,
  UpsertStoryRequest
} from '@jobpilot/shared';
import { getSupabaseClient } from './supabase';

export function getApiBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_API_URL?.trim() || 'http://localhost:4000').replace(/\/$/, '');
}

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function getAccessToken(): Promise<string> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new ApiError('Supabase environment variables are not configured.', 401);
  }
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new ApiError('Not authenticated. Please sign in first.', 401);
  }
  return token;
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let res: Response;
  try {
    res = await fetch(`${getApiBaseUrl()}${path}`, {
      ...init,
      headers
    });
  } catch {
    throw new ApiError(
      'Unable to reach the JobPilot API server. If hosted on Render Free, it may be waking up from sleep (~30s).',
      503
    );
  }

  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  if (!res.ok) {
    const errMsg =
      json && typeof json === 'object' && 'error' in json && typeof json.error === 'string'
        ? json.error
        : `Request failed with status ${res.status}`;
    throw new ApiError(errMsg, res.status);
  }

  return json as T;
}

export async function checkApiHealth(): Promise<{ ok: boolean; defaultProvider?: string }> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/health`, { cache: 'no-store' });
    if (!res.ok) return { ok: false };
    return (await res.json()) as { ok: boolean; defaultProvider?: string };
  } catch {
    return { ok: false };
  }
}

export const api = {
  getProfile: () => apiFetch<MasterProfile>('/api/profile'),
  updateProfile: (payload: UpdateProfileRequest) =>
    apiFetch<MasterProfile>('/api/profile', {
      method: 'PUT',
      body: JSON.stringify(payload)
    }),
  parseResumePdf: async (
    file: File,
    opts: { apply?: boolean; provider?: LlmProviderId; model?: string } = {}
  ) => {
    const form = new FormData();
    form.append('file', file);
    const params = new URLSearchParams();
    if (opts.apply) params.set('apply', 'true');
    if (opts.provider) params.set('provider', opts.provider);
    if (opts.model) params.set('model', opts.model);
    const qs = params.toString();
    return apiFetch<{
      storagePath: string;
      parsed: ParsedResumeOutput;
      extractedTextLength: number;
      totalPages: number;
      modelUsed: string;
      latencyMs: number;
      appliedProfile?: MasterProfile;
    }>(`/api/profile/parse-resume${qs ? `?${qs}` : ''}`, {
      method: 'POST',
      body: form
    });
  },

  listProfileVariants: () => apiFetch<ProfileVariantRecord[]>('/api/profiles/variants'),
  createProfileVariant: (payload: CreateProfileVariantRequest) =>
    apiFetch<ProfileVariantRecord>('/api/profiles/variants', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  updateProfileVariant: (id: string, payload: UpdateProfileVariantRequest) =>
    apiFetch<ProfileVariantRecord>(`/api/profiles/variants/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    }),
  deleteProfileVariant: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/profiles/variants/${id}`, { method: 'DELETE' }),

  importGithubProfile: (payload: Partial<GithubImportRequest> & { username: string }) =>
    apiFetch<ImportPreviewCandidate>('/api/profile/import/github', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  importLinkedinPdf: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return apiFetch<ImportPreviewCandidate>('/api/profile/import/linkedin-pdf', {
      method: 'POST',
      body: form
    });
  },

  listStories: () => apiFetch<ProfileStory[]>('/api/stories'),
  createStory: (payload: UpsertStoryRequest) =>
    apiFetch<ProfileStory>('/api/stories', { method: 'POST', body: JSON.stringify(payload) }),
  updateStory: (id: string, payload: UpsertStoryRequest) =>
    apiFetch<ProfileStory>(`/api/stories/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteStory: (id: string) => apiFetch<{ ok: boolean }>(`/api/stories/${id}`, { method: 'DELETE' }),

  listAnswers: () => apiFetch<SavedAnswer[]>('/api/answers'),
  createAnswer: (payload: UpsertSavedAnswerRequest) =>
    apiFetch<SavedAnswer>('/api/answers', { method: 'POST', body: JSON.stringify(payload) }),
  updateAnswer: (id: string, payload: UpsertSavedAnswerRequest) =>
    apiFetch<SavedAnswer>(`/api/answers/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteAnswer: (id: string) => apiFetch<{ ok: boolean }>(`/api/answers/${id}`, { method: 'DELETE' }),

  getLlmSettings: () =>
    apiFetch<{ defaultEnvProvider: LlmProviderId; items: LlmSettingsItem[] }>('/api/settings/llm'),
  upsertLlmSetting: (provider: LlmProviderId, payload: UpsertLlmSettingsRequest) =>
    apiFetch<LlmSettingsItem>(`/api/settings/llm/${provider}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    }),
  clearLlmKey: (provider: LlmProviderId) =>
    apiFetch<{ ok: boolean }>(`/api/settings/llm/${provider}/key`, { method: 'DELETE' }),
  listProviderModels: (payload: {
    provider: LlmProviderId;
    apiKey?: string;
    baseUrlOverride?: string;
  }) =>
    apiFetch<{ provider: LlmProviderId; models: ModelInfo[] }>('/api/settings/llm/models', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  testLlmKey: (payload: TestLlmKeyRequest) =>
    apiFetch<TestLlmKeyResult>('/api/settings/llm/test', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),

  getUsage: () => apiFetch<LlmUsageSummary>('/api/usage'),

  listJobs: (params: Record<string, string | number | boolean | undefined> = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') qs.set(k, String(v));
    }
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch<{ items: JobFeedItem[]; total: number }>(`/api/jobs${suffix}`);
  },
  getJobDetail: (jobId: string) =>
    apiFetch<{ item: JobFeedItem; sightings: JobSighting[] }>(`/api/jobs/${jobId}`),
  listJobSources: () =>
    apiFetch<{ sources: JobSourceStatus[]; recentRuns: CrawlRunSummary[] }>('/api/jobs/sources'),
  getRecommendations: () => apiFetch<RecommendationsResponse>('/api/jobs/recommendations'),
  getJobSyncStatus: () => apiFetch<JobSyncStatus>('/api/jobs/sync/status'),
  syncJobs: (payload: Partial<SyncJobsRequest> = {}) =>
    apiFetch<{
      alreadyRunning: boolean;
      skipped: boolean;
      reason?: string;
      insertedCount: number;
      updatedCount: number;
      rawJobsCount: number;
      dedupedCount: number;
      boardSuccess: number;
      boardFailures: number;
      aggregatorCount: number;
      syncStatus: JobSyncStatus;
    }>('/api/jobs/sync', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  refreshMatches: (payload: Partial<RefreshMatchesRequest> = {}) =>
    apiFetch<{
      profileVersion: number;
      usedLlm: boolean;
      stats: {
        totalEvaluated: number;
        hardFilterPassed: number;
        hardFilterFailed: number;
        reusedFromCache: number;
        llmScored: number;
        heuristicScored: number;
      };
      matchesCount: number;
    }>('/api/jobs/match/refresh', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  dismissJob: (jobId: string, dismissed: boolean = true, reason?: DismissReason) =>
    apiFetch<{ ok: boolean }>(`/api/jobs/${jobId}/dismiss`, {
      method: 'POST',
      body: JSON.stringify({ dismissed, ...(reason ? { reason } : {}) })
    }),
  saveJob: (jobId: string) =>
    apiFetch<{ id: string; status: string }>(`/api/jobs/${jobId}/save`, {
      method: 'POST',
      body: JSON.stringify({})
    }),

  tailorResume: (payload: TailorResumeRequest) =>
    apiFetch<ResumeVersionRecord>('/api/resumes/tailor', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  listResumeVersions: (jobId?: string) => {
    const suffix = jobId ? `?jobId=${encodeURIComponent(jobId)}` : '';
    return apiFetch<ResumeVersionRecord[]>(`/api/resumes/versions${suffix}`);
  },
  getResumeVersion: (versionId: string) =>
    apiFetch<ResumeVersionRecord>(`/api/resumes/versions/${versionId}`),
  verifyResumeVersion: (versionId: string) =>
    apiFetch<ResumeVersionRecord>(`/api/resumes/versions/${versionId}/verify`, {
      method: 'POST',
      body: JSON.stringify({})
    }),
  deleteResumeVersion: (versionId: string) =>
    apiFetch<{ ok: boolean }>(`/api/resumes/versions/${versionId}`, { method: 'DELETE' }),
  downloadResumePdf: (versionId: string, filename?: string) =>
    downloadAuthenticatedFile(
      `/api/resumes/versions/${versionId}/pdf`,
      filename ?? `jobpilot-resume-${versionId.slice(0, 8)}.pdf`
    ),
  fetchResumePdfBlobUrl: (versionId: string) =>
    fetchAuthenticatedBlobUrl(`/api/resumes/versions/${versionId}/pdf?disposition=inline`),
  downloadResumeTypst: (versionId: string, filename?: string) =>
    downloadAuthenticatedFile(
      `/api/resumes/versions/${versionId}/typst`,
      filename ?? `jobpilot-resume-${versionId.slice(0, 8)}.typ`
    ),
  scoreResumeAts: (payload: AtsScoreRequest) =>
    apiFetch<AtsScoreReport>('/api/resumes/ats-score', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),

  generateCoverLetter: (payload: GenerateCoverLetterRequest) =>
    apiFetch<CoverLetterRecord>('/api/cover-letters/generate', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  listCoverLetters: (jobId?: string) => {
    const suffix = jobId ? `?jobId=${encodeURIComponent(jobId)}` : '';
    return apiFetch<CoverLetterRecord[]>(`/api/cover-letters${suffix}`);
  },
  getCoverLetter: (id: string) => apiFetch<CoverLetterRecord>(`/api/cover-letters/${id}`),
  updateCoverLetter: (id: string, payload: UpdateCoverLetterRequest) =>
    apiFetch<CoverLetterRecord>(`/api/cover-letters/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    }),
  deleteCoverLetter: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/cover-letters/${id}`, { method: 'DELETE' }),
  downloadCoverLetterPdf: (id: string, filename?: string) =>
    downloadAuthenticatedFile(
      `/api/cover-letters/${id}/pdf`,
      filename ?? `jobpilot-cover-letter-${id.slice(0, 8)}.pdf`
    ),
  fetchCoverLetterPdfBlobUrl: (id: string) =>
    fetchAuthenticatedBlobUrl(`/api/cover-letters/${id}/pdf?disposition=inline`),
  downloadCoverLetterTypst: (id: string, filename?: string) =>
    downloadAuthenticatedFile(
      `/api/cover-letters/${id}/typst`,
      filename ?? `jobpilot-cover-letter-${id.slice(0, 8)}.typ`
    ),

  listApplications: (status?: ApplicationStatus) => {
    const suffix = status ? `?status=${encodeURIComponent(status)}` : '';
    return apiFetch<{ items: ApplicationRecord[] }>(`/api/applications${suffix}`);
  },
  getApplicationDetail: (id: string) =>
    apiFetch<{ application: ApplicationRecord; events: ApplicationEventRecord[] }>(
      `/api/applications/${id}`
    ),
  createManualApplication: (payload: CreateManualApplicationRequest) =>
    apiFetch<ApplicationRecord>('/api/applications', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  updateApplication: (id: string, payload: UpdateApplicationRequest) =>
    apiFetch<ApplicationRecord>(`/api/applications/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    }),
  deleteApplication: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/applications/${id}`, { method: 'DELETE' }),

  exportAccount: () => apiFetch<Record<string, unknown>>('/api/account/export'),
  deleteAccount: () => apiFetch<{ ok: boolean }>('/api/account', { method: 'DELETE' })
};

async function fetchAuthenticatedBlobResponse(path: string): Promise<{ blob: Blob; filename?: string }> {
  const token = await getAccessToken();
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    throw new ApiError(`Failed to fetch PDF (${res.status})`, res.status);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition');
  const match = disposition?.match(/filename="([^"]+)"/i);
  return { blob, filename: match?.[1] };
}

async function fetchAuthenticatedBlobUrl(path: string): Promise<string> {
  const { blob } = await fetchAuthenticatedBlobResponse(path);
  return URL.createObjectURL(blob);
}

async function downloadAuthenticatedFile(path: string, fallbackFilename: string): Promise<void> {
  const { blob, filename } = await fetchAuthenticatedBlobResponse(path);
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename ?? fallbackFilename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}
