import { getDefaultEnabledAdapterMap } from '@jobpilot/form-engine';
import type {
  AtsAdapterId,
  MasterProfile,
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
  supabaseUrl: string;
  supabaseAnonKey: string;
  enabledAdapters: AdapterEnabledMap;
}

export interface CachedUserData {
  profile: MasterProfile;
  savedAnswers: SavedAnswer[];
  resumeVersions: ResumeVersionRecord[];
  syncedAt: string;
}

const STORAGE_KEYS = {
  session: 'jobpilot_ext_session',
  settings: 'jobpilot_ext_settings',
  cachedData: 'jobpilot_ext_cached_data'
} as const;

export const DEFAULT_SETTINGS: ExtensionSettingsState = {
  apiBaseUrl: 'http://localhost:4000',
  supabaseUrl: '',
  supabaseAnonKey: '',
  enabledAdapters: getDefaultEnabledAdapterMap()
};

export async function getExtensionSettings(): Promise<ExtensionSettingsState> {
  const res = await chrome.storage.local.get(STORAGE_KEYS.settings);
  const raw = res[STORAGE_KEYS.settings] as Partial<ExtensionSettingsState> | undefined;
  const defaults = getDefaultEnabledAdapterMap();
  return {
    apiBaseUrl: (raw?.apiBaseUrl || DEFAULT_SETTINGS.apiBaseUrl).replace(/\/$/, ''),
    supabaseUrl: (raw?.supabaseUrl || '').replace(/\/$/, ''),
    supabaseAnonKey: raw?.supabaseAnonKey || '',
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
  return (res[STORAGE_KEYS.cachedData] as CachedUserData | undefined) ?? null;
}

export async function saveCachedUserData(data: CachedUserData | null): Promise<void> {
  if (!data) {
    await chrome.storage.local.remove(STORAGE_KEYS.cachedData);
    return;
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.cachedData]: data });
}
