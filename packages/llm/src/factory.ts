import { LlmProviderIdSchema, type LlmProviderId } from '@jobpilot/shared';
import { GeminiAdapter } from './adapters/gemini.js';
import { MetaLlamaAdapter, resolveMetaBaseUrl } from './adapters/meta.js';
import { OpenAIAdapter } from './adapters/openai.js';
import {
  LlmProviderError,
  type LlmProvider,
  type LlmProviderConfig,
  type LlmUsageLogger
} from './types.js';

export function createLlmProvider(config: LlmProviderConfig): LlmProvider {
  if (!config.apiKey.trim()) {
    throw new LlmProviderError(`Missing API key for provider "${config.provider}".`, {
      provider: config.provider,
      code: 'MISSING_API_KEY'
    });
  }

  switch (config.provider) {
    case 'openai':
      return new OpenAIAdapter(config);
    case 'gemini':
      return new GeminiAdapter(config);
    case 'meta':
      return new MetaLlamaAdapter(config);
  }
}

export function createLlmProviderFromEnv(
  env: Record<string, string | undefined> = process.env,
  logger?: LlmUsageLogger
): LlmProvider {
  const rawProvider = (env['LLM_PROVIDER'] ?? 'gemini').trim().toLowerCase();
  const parsed = LlmProviderIdSchema.safeParse(rawProvider);
  if (!parsed.success) {
    throw new LlmProviderError(
      `Unsupported LLM_PROVIDER "${rawProvider}". Expected one of: openai, gemini, meta.`,
      { provider: 'gemini', code: 'INVALID_PROVIDER' }
    );
  }

  const provider: LlmProviderId = parsed.data;
  const defaultModel = env['LLM_MODEL']?.trim() || undefined;

  if (provider === 'openai') {
    return createLlmProvider({
      provider,
      apiKey: env['OPENAI_API_KEY'] ?? '',
      defaultModel,
      logger
    });
  }

  if (provider === 'gemini') {
    return createLlmProvider({
      provider,
      apiKey: env['GEMINI_API_KEY'] ?? '',
      defaultModel,
      logger
    });
  }

  return createLlmProvider({
    provider: 'meta',
    apiKey: env['META_API_KEY'] ?? '',
    defaultModel,
    baseUrl: resolveMetaBaseUrl(undefined, env),
    logger
  });
}
