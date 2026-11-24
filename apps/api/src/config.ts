import { LlmProviderIdSchema, type LlmProviderId } from '@jobpilot/shared';

export interface ApiConfig {
  port: number;
  host: string;
  corsOrigin: string;
  logLevel: string;
  supabaseUrl: string;
  /** Modern Supabase publishable key (`sb_publishable_...`), with fallback to legacy `SUPABASE_ANON_KEY` */
  supabasePublishableKey: string;
  /** Modern Supabase secret key (`sb_secret_...`), with fallback to legacy `SUPABASE_SERVICE_ROLE_KEY` */
  supabaseSecretKey: string;
  /** @deprecated Alias of `supabasePublishableKey` kept for compatibility */
  supabaseAnonKey: string;
  /** @deprecated Alias of `supabaseSecretKey` kept for compatibility */
  supabaseServiceRoleKey: string;
  appEncryptionKey: string;
  llmProvider: LlmProviderId;
  llmModel?: string;
  openaiApiKey?: string;
  geminiApiKey?: string;
  metaApiKey?: string;
  metaBaseUrl: string;
  adzunaAppId?: string;
  adzunaAppKey?: string;
  joobleApiKey?: string;
  jsearchRapidApiKey?: string;
  jobSyncStaleHours: number;
  autoSyncIntervalHours: number;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): ApiConfig {
  const rawProvider = (env['LLM_PROVIDER'] ?? 'gemini').trim().toLowerCase();
  const parsedProvider = LlmProviderIdSchema.safeParse(rawProvider);
  const llmProvider: LlmProviderId = parsedProvider.success ? parsedProvider.data : 'gemini';

  const portStr = env['PORT'] ?? env['API_PORT'] ?? '4000';
  const port = Number.parseInt(portStr, 10);

  const supabasePublishableKey =
    env['SUPABASE_PUBLISHABLE_KEY']?.trim() ||
    env['SUPABASE_ANON_KEY']?.trim() ||
    '';

  const supabaseSecretKey =
    env['SUPABASE_SECRET_KEY']?.trim() ||
    env['SUPABASE_SERVICE_ROLE_KEY']?.trim() ||
    '';

  const rawAutoSync = Number.parseInt(env['AUTO_SYNC_INTERVAL_HOURS'] ?? '6', 10);
  const rawStale = Number.parseInt(env['JOB_SYNC_STALE_HOURS'] ?? '6', 10);

  return {
    port: Number.isFinite(port) && port > 0 ? port : 4000,
    host: env['API_HOST'] ?? '0.0.0.0',
    corsOrigin: env['CORS_ORIGIN'] ?? 'http://localhost:3000',
    logLevel: env['LOG_LEVEL'] ?? 'info',
    supabaseUrl: env['SUPABASE_URL']?.trim() ?? '',
    supabasePublishableKey,
    supabaseSecretKey,
    supabaseAnonKey: supabasePublishableKey,
    supabaseServiceRoleKey: supabaseSecretKey,
    appEncryptionKey: env['APP_ENCRYPTION_KEY']?.trim() ?? '',
    llmProvider,
    llmModel: env['LLM_MODEL']?.trim() || undefined,
    openaiApiKey: env['OPENAI_API_KEY']?.trim() || undefined,
    geminiApiKey: env['GEMINI_API_KEY']?.trim() || undefined,
    metaApiKey: env['META_API_KEY']?.trim() || undefined,
    metaBaseUrl: env['META_BASE_URL']?.trim() || 'https://api.llama.com/compat/v1/',
    adzunaAppId: env['ADZUNA_APP_ID']?.trim() || undefined,
    adzunaAppKey: env['ADZUNA_APP_KEY']?.trim() || undefined,
    joobleApiKey: env['JOOBLE_API_KEY']?.trim() || undefined,
    jsearchRapidApiKey: env['JSEARCH_RAPIDAPI_KEY']?.trim() || undefined,
    jobSyncStaleHours: Number.isFinite(rawStale) ? Math.max(1, rawStale) : 6,
    autoSyncIntervalHours: Number.isFinite(rawAutoSync) ? Math.max(0, rawAutoSync) : 6
  };
}
