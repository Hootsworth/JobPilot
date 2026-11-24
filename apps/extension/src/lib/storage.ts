import { getDefaultEnabledAdapterMap } from '@jobpilot/form-engine';
import type {
  AtsAdapterId,
  CoverLetterRecord,
  MasterProfile,
  ProfileVariantRecord,
  ResumeVersionRecord,
  SavedAnswer
} from '@jobpilot/shared';

export interface ExtensionAuthSession {
  accessToken: string;
  refreshToken: string;
  email: string;
  expiresAt?: number;
}

export type AdapterEnabledMap = Record<Exclude<AtsAdapterId, 'generic'>, boolean>;

export interface ExtensionSettingsState {
  apiBaseUrl: string;
  webBaseUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  enabledAdapters: AdapterEnabledMap;
}

export interface CachedUserData {
  profile: MasterProfile;
  savedAnswers: SavedAnswer[];
  resumeVersions: ResumeVersionRecord[];
  profileVariants: ProfileVariantRecord[];
  coverLetters: CoverLetterRecord[];
  syncedAt: string;
}

const STORAGE_KEYS = {
  session: 'jobpilot_ext_session',
  settings: 'jobpilot_ext_settings',
  cachedData: 'jobpilot_ext_cached_data'
} as const;

const extEnv = (
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}
);

export const DEFAULT_SETTINGS: ExtensionSettingsState = {
  apiBaseUrl: (extEnv['VITE_API_URL'] || 'https://jobpilot-moek.onrender.com').replace(/\/$/, ''),
  webBaseUrl: (extEnv['VITE_WEB_URL'] || 'https://jobpilot.singulr.tech').replace(/\/$/, ''),
  supabaseUrl: (extEnv['VITE_SUPABASE_URL'] || '').replace(/\/$/, ''),
  supabaseAnonKey:
    extEnv['VITE_SUPABASE_PUBLISHABLE_KEY'] || extEnv['VITE_SUPABASE_ANON_KEY'] || '',
  enabledAdapters: getDefaultEnabledAdapterMap()
};

export async function getExtensionSettings(): Promise<ExtensionSettingsState> {
  const res = await chrome.storage.local.get(STORAGE_KEYS.settings);
  const raw = res[STORAGE_KEYS.settings] as Partial<ExtensionSettingsState> | undefined;
  const defaults = getDefaultEnabledAdapterMap();
  return {
    apiBaseUrl: (raw?.apiBaseUrl || DEFAULT_SETTINGS.apiBaseUrl).replace(/\/$/, ''),
    webBaseUrl: (raw?.webBaseUrl || DEFAULT_SETTINGS.webBaseUrl).replace(/\/$/, ''),
    supabaseUrl: (raw?.supabaseUrl || DEFAULT_SETTINGS.supabaseUrl).replace(/\/$/, ''),
    supabaseAnonKey: raw?.supabaseAnonKey || DEFAULT_SETTINGS.supabaseAnonKey,
    enabledAdapters: {
      greenhouse: raw?.enabledAdapters?.greenhouse ?? defaults.greenhouse,
      lever: raw?.enabledAdapters?.lever ?? defaults.lever,
      ashby: raw?.enabledAdapters?.ashby ?? defaults.ashby,
      workday: raw?.enabledAdapters?.workday ?? defaults.workday,
      naukri: raw?.enabledAdapters?.naukri ?? defaults.naukri,
      foundit: raw?.enabledAdapters?.foundit ?? defaults.foundit,
      internshala: raw?.enabledAdapters?.internshala ?? defaults.internshala,
      instahyre: raw?.enabledAdapters?.instahyre ?? defaults.instahyre,
      wellfound: raw?.enabledAdapters?.wellfound ?? defaults.wellfound,
      linkedin: raw?.enabledAdapters?.linkedin ?? defaults.linkedin
    }
  };
}

export async function saveExtensionSettings(
  patch: Partial<ExtensionSettingsState>
): Promise<ExtensionSettingsState> {
  const current = await getExtensionSettings();
  const next: ExtensionSettingsState = {
    ...current,
    ...patch,
    apiBaseUrl: (patch.apiBaseUrl ?? current.apiBaseUrl).replace(/\/$/, ''),
    webBaseUrl: (patch.webBaseUrl ?? current.webBaseUrl).replace(/\/$/, ''),
    supabaseUrl: (patch.supabaseUrl ?? current.supabaseUrl).replace(/\/$/, ''),
    enabledAdapters: {
      ...current.enabledAdapters,
      ...(patch.enabledAdapters ?? {})
    }
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: next });
  return next;
}

export async function getExtensionSession(): Promise<ExtensionAuthSession | null> {
  const res = await chrome.storage.local.get(STORAGE_KEYS.session);
  const raw = res[STORAGE_KEYS.session] as ExtensionAuthSession | undefined;
  return raw?.accessToken ? raw : null;
}

export async function saveExtensionSession(
  session: ExtensionAuthSession | null
): Promise<void> {
  if (!session) {
    await chrome.storage.local.remove(STORAGE_KEYS.session);
    return;
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.session]: session });
}

export async function getCachedUserData(): Promise<CachedUserData | null> {
  const res = await chrome.storage.local.get(STORAGE_KEYS.cachedData);
  const raw = res[STORAGE_KEYS.cachedData] as Partial<CachedUserData> | undefined;
  if (!raw?.profile) return null;
  return {
    profile: raw.profile,
    savedAnswers: raw.savedAnswers ?? [],
    resumeVersions: raw.resumeVersions ?? [],
    profileVariants: raw.profileVariants ?? [],
    coverLetters: raw.coverLetters ?? [],
    syncedAt: raw.syncedAt ?? new Date().toISOString()
  };
}

export async function saveCachedUserData(data: CachedUserData | null): Promise<void> {
  if (!data) {
    await chrome.storage.local.remove(STORAGE_KEYS.cachedData);
    return;
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.cachedData]: data });
}
