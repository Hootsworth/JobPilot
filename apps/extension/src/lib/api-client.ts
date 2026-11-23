import type {
  CaptureExtensionJobRequest,
  CaptureExtensionJobResponse,
  DraftAnswersRequest,
  DraftAnswersResponse,
  FallbackFillRequest,
  FallbackFillResponse,
  MasterProfile,
  ResumeVersionRecord,
  SavedAnswer
} from '@jobpilot/shared';
import {
  getExtensionSession,
  getExtensionSettings,
  saveCachedUserData,
  saveExtensionSession,
  type CachedUserData,
  type ExtensionAuthSession
} from './storage';

export class ExtensionApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ExtensionApiError';
    this.status = status;
  }
}

async function tryRefreshSession(current: ExtensionAuthSession): Promise<ExtensionAuthSession | null> {
  const settings = await getExtensionSettings();
  if (!settings.supabaseUrl || !settings.supabaseAnonKey || !current.refreshToken) {
    return null;
  }

  const res = await fetch(`${settings.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: settings.supabaseAnonKey
    },
    body: JSON.stringify({ refresh_token: current.refreshToken })
  });

  if (!res.ok) return null;
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    user?: { email?: string };
  };
  if (!json.access_token) return null;

  const refreshed: ExtensionAuthSession = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? current.refreshToken,
    email: json.user?.email ?? current.email,
    expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : undefined
  };
  await saveExtensionSession(refreshed);
  return refreshed;
}

async function authorizedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const settings = await getExtensionSettings();
  let session = await getExtensionSession();
  if (!session) {
    throw new ExtensionApiError('Not connected. Sign in or paste Session JSON in Connect.', 401);
  }

  const doCall = (token: string) => {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    if (init.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    return fetch(`${settings.apiBaseUrl}${path}`, { ...init, headers });
  };

  let res = await doCall(session.accessToken);
  if (res.status === 401) {
    const refreshed = await tryRefreshSession(session);
    if (refreshed) {
      session = refreshed;
      res = await doCall(session.accessToken);
    }
  }
  return res;
}

async function fetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await authorizedFetch(path, init);
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (!res.ok) {
    const msg =
      parsed && typeof parsed === 'object' && 'error' in parsed
        ? String((parsed as { error: unknown }).error)
        : `API request failed (${res.status})`;
    throw new ExtensionApiError(msg, res.status);
  }
  return parsed as T;
}

export async function signInWithSupabasePassword(params: {
  supabaseUrl: string;
  supabaseAnonKey: string;
  email: string;
  password: string;
}): Promise<ExtensionAuthSession> {
  const base = params.supabaseUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: params.supabaseAnonKey
    },
    body: JSON.stringify({
      email: params.email.trim(),
      password: params.password
    })
  });

  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error_description?: string;
    msg?: string;
    user?: { email?: string };
  };

  if (!res.ok || !data.access_token) {
    throw new ExtensionApiError(
      data.error_description || data.msg || `Supabase sign-in failed (${res.status})`,
      res.status
    );
  }

  const session: ExtensionAuthSession = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? '',
    email: data.user?.email ?? params.email.trim(),
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined
  };
  await saveExtensionSession(session);
  return session;
}

export async function syncExtensionUserData(): Promise<CachedUserData> {
  const [profile, savedAnswers, resumeVersions] = await Promise.all([
    fetchJson<MasterProfile>('/api/profile'),
    fetchJson<SavedAnswer[]>('/api/answers'),
    fetchJson<ResumeVersionRecord[]>('/api/resumes/versions')
  ]);

  const cached: CachedUserData = {
    profile,
    savedAnswers,
    resumeVersions,
    syncedAt: new Date().toISOString()
  };
  await saveCachedUserData(cached);
  return cached;
}

export async function draftExtensionAnswers(
  payload: DraftAnswersRequest
): Promise<DraftAnswersResponse> {
  return fetchJson<DraftAnswersResponse>('/api/extension/draft-answers', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function fallbackFillExtensionFields(
  payload: FallbackFillRequest
): Promise<FallbackFillResponse> {
  return fetchJson<FallbackFillResponse>('/api/extension/fallback-fill', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function captureExtensionJob(
  payload: CaptureExtensionJobRequest
): Promise<CaptureExtensionJobResponse> {
  return fetchJson<CaptureExtensionJobResponse>('/api/extension/capture-job', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export async function fetchResumePdfBytes(
  versionId: string
): Promise<{ base64: string; filename: string }> {
  const res = await authorizedFetch(`/api/resumes/versions/${encodeURIComponent(versionId)}/pdf`);
  if (!res.ok) {
    throw new ExtensionApiError(`Failed to fetch tailored PDF (${res.status})`, res.status);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  const disposition = res.headers.get('content-disposition');
  const match = disposition?.match(/filename="([^"]+)"/i);
  const filename = match?.[1] ?? `jobpilot-resume-${versionId.slice(0, 8)}.pdf`;
  return {
    base64: uint8ToBase64(buf),
    filename
  };
}
