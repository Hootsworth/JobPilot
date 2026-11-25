import { getDefaultEnabledAdapterMap } from '@jobpilot/form-engine';
import { isExtensionContextValid } from './runtime-safe';
import type {
  AtsAdapterId,
  BillingSnapshot,
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
  showInlineApplyButton: boolean;
  hiddenCtaDomains: string[];
}

export interface TailorHandoffPayload {
  applyUrl: string;
  jobId?: string;
  jobTitle?: string;
  companyName?: string;
  resumeVersionId?: string;
  coverLetterId?: string;
  profileVariantId?: string;
  createdAt: number;
}

export interface CachedUserData {
  profile: MasterProfile;
  savedAnswers: SavedAnswer[];
  resumeVersions: ResumeVersionRecord[];
  profileVariants: ProfileVariantRecord[];
  coverLetters: CoverLetterRecord[];
  billing?: BillingSnapshot;
  syncedAt: string;
}

const STORAGE_KEYS = {
  session: 'jobpilot_ext_session',
  settings: 'jobpilot_ext_settings',
  cachedData: 'jobpilot_ext_cached_data',
  tailorHandoff: 'jobpilot_tailor_handoff'
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
  enabledAdapters: getDefaultEnabledAdapterMap(),
  showInlineApplyButton: false,
  hiddenCtaDomains: []
};

function normalizeHiddenDomains(domains: string[] | undefined): string[] {
  if (!Array.isArray(domains)) return [];
  return Array.from(
    new Set(
      domains
        .map((d) => d.trim().toLowerCase())
        .filter((d) => d.length > 0 && d.length <= 200)
    )
  );
}

export async function getExtensionSettings(): Promise<ExtensionSettingsState> {
  const defaults = getDefaultEnabledAdapterMap();
  if (!isExtensionContextValid()) {
    return {
      ...DEFAULT_SETTINGS,
      enabledAdapters: { ...defaults },
      hiddenCtaDomains: []
    };
  }
  try {
    const res = await chrome.storage.local.get(STORAGE_KEYS.settings);
    const raw = res[STORAGE_KEYS.settings] as Partial<ExtensionSettingsState> | undefined;
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
      },
      showInlineApplyButton: Boolean(raw?.showInlineApplyButton ?? false),
      hiddenCtaDomains: normalizeHiddenDomains(raw?.hiddenCtaDomains)
    };
  } catch {
    return {
      ...DEFAULT_SETTINGS,
      enabledAdapters: { ...defaults },
      hiddenCtaDomains: []
    };
  }
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
    },
    showInlineApplyButton: patch.showInlineApplyButton ?? current.showInlineApplyButton,
    hiddenCtaDomains: normalizeHiddenDomains(patch.hiddenCtaDomains ?? current.hiddenCtaDomains)
  };
  if (isExtensionContextValid()) {
    try {
      await chrome.storage.local.set({ [STORAGE_KEYS.settings]: next });
    } catch {
      // Extension context invalidated during save
    }
  }
  return next;
}

export async function getExtensionSession(): Promise<ExtensionAuthSession | null> {
  if (!isExtensionContextValid()) return null;
  try {
    const res = await chrome.storage.local.get(STORAGE_KEYS.session);
    const raw = res[STORAGE_KEYS.session] as ExtensionAuthSession | undefined;
    return raw?.accessToken ? raw : null;
  } catch {
    return null;
  }
}

export async function saveExtensionSession(
  session: ExtensionAuthSession | null
): Promise<void> {
  if (!isExtensionContextValid()) return;
  try {
    if (!session) {
      await chrome.storage.local.remove(STORAGE_KEYS.session);
      return;
    }
    await chrome.storage.local.set({ [STORAGE_KEYS.session]: session });
  } catch {
    // Extension context invalidated
  }
}

export async function getCachedUserData(): Promise<CachedUserData | null> {
  if (!isExtensionContextValid()) return null;
  try {
    const res = await chrome.storage.local.get(STORAGE_KEYS.cachedData);
    const raw = res[STORAGE_KEYS.cachedData] as Partial<CachedUserData> | undefined;
    if (!raw?.profile) return null;
    return {
      profile: raw.profile,
      savedAnswers: raw.savedAnswers ?? [],
      resumeVersions: raw.resumeVersions ?? [],
      profileVariants: raw.profileVariants ?? [],
      coverLetters: raw.coverLetters ?? [],
      billing: raw.billing,
      syncedAt: raw.syncedAt ?? new Date().toISOString()
    };
  } catch {
    return null;
  }
}

export async function saveCachedUserData(data: CachedUserData | null): Promise<void> {
  if (!isExtensionContextValid()) return;
  try {
    if (!data) {
      await chrome.storage.local.remove(STORAGE_KEYS.cachedData);
      return;
    }
    await chrome.storage.local.set({ [STORAGE_KEYS.cachedData]: data });
  } catch {
    // Extension context invalidated
  }
}

export async function saveTailorHandoff(payload: TailorHandoffPayload | null): Promise<void> {
  if (!isExtensionContextValid()) return;
  try {
    if (!payload) {
      await chrome.storage.session.remove(STORAGE_KEYS.tailorHandoff).catch(() => {});
      return;
    }
    await chrome.storage.session.set({ [STORAGE_KEYS.tailorHandoff]: payload }).catch(() => {});
  } catch {
    // Ignore invalidated context
  }
}

export async function getTailorHandoff(): Promise<TailorHandoffPayload | null> {
  if (!isExtensionContextValid()) return null;
  try {
    const res = await chrome.storage.session.get(STORAGE_KEYS.tailorHandoff).catch(() => ({}));
    const raw = (res as Record<string, unknown>)[STORAGE_KEYS.tailorHandoff] as
      | TailorHandoffPayload
      | undefined;
    if (!raw?.applyUrl || !raw.createdAt) return null;
    if (Date.now() - raw.createdAt > 15 * 60_000) {
      await saveTailorHandoff(null);
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}
