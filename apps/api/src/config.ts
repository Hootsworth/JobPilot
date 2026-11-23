import { LlmProviderIdSchema, type LlmProviderId } from '@jobpilot/shared';

export interface ApiConfig {
  port: number;
  host: string;
  corsOrigin: string;
  logLevel: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
  appEncryptionKey: string;
  llmProvider: LlmProviderId;
  llmModel?: string;
  openaiApiKey?: string;
  geminiApiKey?: string;
  metaApiKey?: string;
  metaBaseUrl: string;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): ApiConfig {
  const rawProvider = (env['LLM_PROVIDER'] ?? 'gemini').trim().toLowerCase();
  const parsedProvider = LlmProviderIdSchema.safeParse(rawProvider);
  const llmProvider: LlmProviderId = parsedProvider.success ? parsedProvider.data : 'gemini';

  const portStr = env['PORT'] ?? env['API_PORT'] ?? '4000';
  const port = Number.parseInt(portStr, 10);

  return {
    port: Number.isFinite(port) && port > 0 ? port : 4000,
    host: env['API_HOST'] ?? '0.0.0.0',
    corsOrigin: env['CORS_ORIGIN'] ?? 'http://localhost:3000',
    logLevel: env['LOG_LEVEL'] ?? 'info',
    supabaseUrl: env['SUPABASE_URL']?.trim() ?? '',
    supabaseAnonKey: env['SUPABASE_ANON_KEY']?.trim() ?? '',
    supabaseServiceRoleKey: env['SUPABASE_SERVICE_ROLE_KEY']?.trim() ?? '',
    appEncryptionKey: env['APP_ENCRYPTION_KEY']?.trim() ?? '',
    llmProvider,
    llmModel: env['LLM_MODEL']?.trim() || undefined,
    openaiApiKey: env['OPENAI_API_KEY']?.trim() || undefined,
    geminiApiKey: env['GEMINI_API_KEY']?.trim() || undefined,
    metaApiKey: env['META_API_KEY']?.trim() || undefined,
    metaBaseUrl: env['META_BASE_URL']?.trim() || 'https://api.llama.com/compat/v1/'
  };
}
