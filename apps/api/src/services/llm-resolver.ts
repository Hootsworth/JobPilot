import {
  createLlmProvider,
  resolveMetaBaseUrl,
  type LlmProvider,
  type LlmUsageLogger
} from '@jobpilot/llm';
import type { LlmProviderId } from '@jobpilot/shared';
import type { ApiConfig } from '../config.js';
import type { DataStore } from '../store/types.js';
import { decryptSecret } from './crypto.js';

export type LlmProviderFactory = typeof createLlmProvider;

export interface ResolvedLlmContext {
  provider: LlmProvider;
  providerId: LlmProviderId;
  usingEnvFallback: boolean;
}

export function getEnvApiKeyForProvider(
  config: ApiConfig,
  provider: LlmProviderId
): string | undefined {
  switch (provider) {
    case 'openai':
      return config.openaiApiKey;
    case 'gemini':
      return config.geminiApiKey;
    case 'meta':
      return config.metaApiKey;
  }
}

export async function resolveUserLlmProvider(params: {
  userId: string;
  config: ApiConfig;
  store: DataStore;
  providerOverride?: LlmProviderId;
  apiKeyOverride?: string;
  modelOverride?: string;
  baseUrlOverride?: string;
  providerFactory?: LlmProviderFactory;
}): Promise<ResolvedLlmContext> {
  const { userId, config, store } = params;
  const settings = await store.listLlmSettings(userId);
  const activeSetting = settings.find((s) => s.isActive);
  const providerId: LlmProviderId =
    params.providerOverride ?? activeSetting?.provider ?? config.llmProvider;

  const providerSetting = settings.find((s) => s.provider === providerId);

  let apiKey = params.apiKeyOverride?.trim();
  let usingEnvFallback = false;

  if (!apiKey && providerSetting?.encryptedApiKey && providerSetting.keyIv && providerSetting.keyAuthTag) {
    if (!config.appEncryptionKey) {
      throw new Error('APP_ENCRYPTION_KEY is not configured on the server to decrypt BYOK keys.');
    }
    apiKey = decryptSecret(
      {
        ciphertext: providerSetting.encryptedApiKey,
        iv: providerSetting.keyIv,
        authTag: providerSetting.keyAuthTag
      },
      config.appEncryptionKey
    );
  }

  if (!apiKey) {
    const envKey = getEnvApiKeyForProvider(config, providerId);
    if (envKey) {
      apiKey = envKey;
      usingEnvFallback = true;
    }
  }

  if (!apiKey) {
    throw new Error(
      `No API key configured for provider "${providerId}". Add a BYOK key in Settings or set it in server env vars.`
    );
  }

  const defaultModel =
    params.modelOverride?.trim() ||
    providerSetting?.selectedModel?.trim() ||
    (providerId === config.llmProvider ? config.llmModel : undefined);

  const baseUrl =
    providerId === 'meta'
      ? resolveMetaBaseUrl(
          params.baseUrlOverride ?? providerSetting?.baseUrlOverride ?? undefined,
          { META_BASE_URL: config.metaBaseUrl }
        )
      : params.baseUrlOverride?.trim() || providerSetting?.baseUrlOverride?.trim() || undefined;

  const logger: LlmUsageLogger = async (entry) => {
    await store.logLlmUsage({ ...entry, userId });
  };

  const factory = params.providerFactory ?? createLlmProvider;
  const provider = factory({
    provider: providerId,
    apiKey,
    defaultModel,
    baseUrl,
    userId,
    logger
  });

  return {
    provider,
    providerId,
    usingEnvFallback
  };
}
