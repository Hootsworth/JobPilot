import { LlmProviderIdSchema, type LlmProviderId } from '@jobpilot/shared';

export interface ApiConfig {
  port: number;
  host: string;
  corsOrigin: string;
  webBaseUrl: string;
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
  billingMode: 'managed' | 'self_hosted';
  allowDemoBilling: boolean;
  managedFastProvider: LlmProviderId;
  managedFastModel?: string;
  managedPrecisionProvider: LlmProviderId;
  managedPrecisionModel?: string;
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  razorpayKeyId?: string;
  razorpayKeySecret?: string;
  razorpayWebhookSecret?: string;
  dodoApiKey?: string;
  dodoWebhookSecret?: string;
  adzunaAppId?: string;
  adzunaAppKey?: string;
  joobleApiKey?: string;
  jsearchRapidApiKey?: string;
  jobSyncStaleHours: number;
  autoSyncIntervalHours: number;
}

function parseProviderOrFallback(
  raw: string | undefined,
  fallback: LlmProviderId
): LlmProviderId {
  if (!raw) return fallback;
  const parsed = LlmProviderIdSchema.safeParse(raw.trim().toLowerCase());
  return parsed.success ? parsed.data : fallback;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): ApiConfig {
  const llmProvider = parseProviderOrFallback(env['LLM_PROVIDER'], 'gemini');

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

  const corsOrigin = env['CORS_ORIGIN'] ?? 'http://localhost:3000';
  const firstCorsOrigin = corsOrigin
    .split(',')
    .map((s) => s.trim())
    .find((s) => s && s !== '*');

  const rawBillingMode = (env['BILLING_MODE'] ?? 'managed').trim().toLowerCase();
  const billingMode: 'managed' | 'self_hosted' =
    rawBillingMode === 'self_hosted' ? 'self_hosted' : 'managed';

  const stripeSecretKey = env['STRIPE_SECRET_KEY']?.trim() || undefined;
  const razorpayKeySecret = env['RAZORPAY_KEY_SECRET']?.trim() || undefined;
  const dodoApiKey = env['DODO_API_KEY']?.trim() || undefined;

  const hasLivePaymentGateway = Boolean(stripeSecretKey || razorpayKeySecret || dodoApiKey);
  const rawDemoBilling = env['ALLOW_DEMO_BILLING']?.trim().toLowerCase();
  const allowDemoBilling =
    rawDemoBilling === 'true'
      ? true
      : rawDemoBilling === 'false'
        ? false
        : !hasLivePaymentGateway;

  const managedFastProvider = parseProviderOrFallback(env['MANAGED_FAST_PROVIDER'], 'gemini');
  const managedPrecisionProvider = parseProviderOrFallback(
    env['MANAGED_PRECISION_PROVIDER'],
    'gemini'
  );

  return {
    port: Number.isFinite(port) && port > 0 ? port : 4000,
    host: env['API_HOST'] ?? '0.0.0.0',
    corsOrigin,
    webBaseUrl: (env['WEB_BASE_URL']?.trim() || firstCorsOrigin || 'http://localhost:3000').replace(
      /\/+$/,
      ''
    ),
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
    billingMode,
    allowDemoBilling,
    managedFastProvider,
    managedFastModel:
      env['MANAGED_FAST_MODEL']?.trim() || env['LLM_MODEL']?.trim() || 'gemini-2.5-flash-lite',
    managedPrecisionProvider,
    managedPrecisionModel: env['MANAGED_PRECISION_MODEL']?.trim() || 'gemini-2.5-pro',
    stripeSecretKey,
    stripeWebhookSecret: env['STRIPE_WEBHOOK_SECRET']?.trim() || undefined,
    razorpayKeyId: env['RAZORPAY_KEY_ID']?.trim() || undefined,
    razorpayKeySecret,
    razorpayWebhookSecret: env['RAZORPAY_WEBHOOK_SECRET']?.trim() || undefined,
    dodoApiKey,
    dodoWebhookSecret: env['DODO_WEBHOOK_SECRET']?.trim() || undefined,
    adzunaAppId: env['ADZUNA_APP_ID']?.trim() || undefined,
    adzunaAppKey: env['ADZUNA_APP_KEY']?.trim() || undefined,
    joobleApiKey: env['JOOBLE_API_KEY']?.trim() || undefined,
    jsearchRapidApiKey: env['JSEARCH_RAPIDAPI_KEY']?.trim() || undefined,
    jobSyncStaleHours: Number.isFinite(rawStale) ? Math.max(1, rawStale) : 6,
    autoSyncIntervalHours: Number.isFinite(rawAutoSync) ? Math.max(0, rawAutoSync) : 6
  };
}
