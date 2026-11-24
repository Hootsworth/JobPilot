import {
  getCreditCost,
  getPlanEntitlements,
  PLAN_CATALOG,
  type AiActionType,
  type AiQualityMode,
  type BillingSnapshot,
  type LlmProviderId,
  type PlanEntitlements,
  type PlanId
} from '@jobpilot/shared';
import { createLlmProvider, resolveMetaBaseUrl, type LlmProvider, type LlmUsageLogger } from '@jobpilot/llm';
import type { ApiConfig } from '../config.js';
import type { DataStore } from '../store/types.js';
import {
  resolveUserLlmProvider,
  type LlmProviderFactory
} from './llm-resolver.js';

export type EntitlementErrorCode =
  | 'INSUFFICIENT_CREDITS'
  | 'PLAN_UPGRADE_REQUIRED'
  | 'PLAN_LIMIT_REACHED';

export class EntitlementError extends Error {
  readonly statusCode: 402 | 403;
  readonly code: EntitlementErrorCode;
  readonly requiredPlan?: PlanId;
  readonly creditsRequired?: number;
  readonly creditsRemaining?: number;
  readonly upgradeUrl = '/billing';

  constructor(params: {
    statusCode: 402 | 403;
    code: EntitlementErrorCode;
    message: string;
    requiredPlan?: PlanId;
    creditsRequired?: number;
    creditsRemaining?: number;
  }) {
    super(params.message);
    this.name = 'EntitlementError';
    this.statusCode = params.statusCode;
    this.code = params.code;
    this.requiredPlan = params.requiredPlan;
    this.creditsRequired = params.creditsRequired;
    this.creditsRemaining = params.creditsRemaining;
  }

  toJSON() {
    return {
      error: this.message,
      code: this.code,
      ...(this.requiredPlan ? { requiredPlan: this.requiredPlan } : {}),
      ...(this.creditsRequired !== undefined ? { creditsRequired: this.creditsRequired } : {}),
      ...(this.creditsRemaining !== undefined ? { creditsRemaining: this.creditsRemaining } : {}),
      upgradeUrl: this.upgradeUrl
    };
  }
}

const DEFAULT_MANAGED_GEMINI_MODELS: Record<AiQualityMode, string> = {
  fast: 'gemini-3.5-flash-lite',
  precision: 'gemini-3.8-flash'
};

export function hasManagedServerKeys(config: ApiConfig): boolean {
  return Boolean(config.geminiApiKey);
}

export function resolveManagedRoute(
  config: ApiConfig,
  aiMode: AiQualityMode
): { providerId: LlmProviderId; apiKey: string; model: string } | null {
  if (!config.geminiApiKey) {
    return null;
  }
  const configuredModel =
    aiMode === 'precision' ? config.managedPrecisionModel : config.managedFastModel;
  return {
    providerId: 'gemini',
    apiKey: config.geminiApiKey,
    model: configuredModel || DEFAULT_MANAGED_GEMINI_MODELS[aiMode]
  };
}

export async function buildBillingSnapshot(
  userId: string,
  config: ApiConfig,
  store: DataStore
): Promise<BillingSnapshot> {
  const [subscription, settings, recentLedger] = await Promise.all([
    store.getOrCreateSubscription(userId),
    store.listLlmSettings(userId),
    store.listCreditLedger(userId, 25)
  ]);

  const entitlements = getPlanEntitlements(subscription.planId);
  const plan = PLAN_CATALOG[subscription.planId];
  const hasSavedByokKey = settings.some(
    (s) => Boolean(s.encryptedApiKey && s.keyIv && s.keyAuthTag)
  );
  const managedKeysAvailable = hasManagedServerKeys(config);
  const executionMode: 'managed' | 'byok' =
    config.billingMode === 'self_hosted' ||
    (subscription.useByokOverride && hasSavedByokKey) ||
    (!managedKeysAvailable && hasSavedByokKey)
      ? 'byok'
      : 'managed';

  return {
    subscription,
    entitlements,
    plan,
    totalCreditsRemaining:
      subscription.monthlyCreditsRemaining + subscription.topupCreditsRemaining,
    billingMode: config.billingMode,
    executionMode,
    demoBillingEnabled: config.allowDemoBilling,
    hasManagedServerKeys: managedKeysAvailable,
    hasSavedByokKey,
    recentLedger
  };
}

export interface AcquiredLlmContext {
  provider: LlmProvider;
  providerId: LlmProviderId;
  model?: string;
  aiMode: AiQualityMode;
  executionMode: 'managed' | 'byok';
  creditsCharged: number;
  entitlements: PlanEntitlements;
  refund: (reason: string) => Promise<void>;
}

export async function acquireLlmForAction(params: {
  userId: string;
  action: AiActionType;
  requestedAiMode?: AiQualityMode;
  providerOverride?: LlmProviderId;
  modelOverride?: string;
  apiKeyOverride?: string;
  config: ApiConfig;
  store: DataStore;
  providerFactory?: LlmProviderFactory;
}): Promise<AcquiredLlmContext> {
  const { userId, action, config, store } = params;
  const [subscription, settings] = await Promise.all([
    store.getOrCreateSubscription(userId),
    store.listLlmSettings(userId)
  ]);

  const entitlements = getPlanEntitlements(subscription.planId);
  const hasSavedByokKey = settings.some(
    (s) => Boolean(s.encryptedApiKey && s.keyIv && s.keyAuthTag)
  );
  const managedKeysAvailable = hasManagedServerKeys(config);
  const hasSelfHostedEnvFallback = Boolean(
    !managedKeysAvailable && (config.openaiApiKey || config.metaApiKey)
  );

  const shouldUseByok =
    Boolean(params.apiKeyOverride?.trim()) ||
    (subscription.useByokOverride && hasSavedByokKey) ||
    config.billingMode === 'self_hosted' ||
    (!managedKeysAvailable && hasSavedByokKey) ||
    hasSelfHostedEnvFallback;

  if (shouldUseByok) {
    const resolved = await resolveUserLlmProvider({
      userId,
      config,
      store,
      providerOverride: params.providerOverride,
      modelOverride: params.modelOverride,
      apiKeyOverride: params.apiKeyOverride,
      providerFactory: params.providerFactory
    });

    return {
      provider: resolved.provider,
      providerId: resolved.providerId,
      model: params.modelOverride,
      aiMode: params.requestedAiMode ?? subscription.aiModePreference,
      executionMode: 'byok',
      creditsCharged: 0,
      entitlements,
      refund: async () => {}
    };
  }

  // Managed mode
  const aiMode: AiQualityMode = params.requestedAiMode ?? subscription.aiModePreference;
  if (!entitlements.allowedAiModes.includes(aiMode)) {
    throw new EntitlementError({
      statusCode: 403,
      code: 'PLAN_UPGRADE_REQUIRED',
      requiredPlan: 'plus',
      message:
        'Precision frontier models require the Plus plan. Switch to Fast mode or upgrade to Plus.'
    });
  }

  const creditsRequired = getCreditCost(action, aiMode);
  const debit = await store.debitCredits(userId, {
    amount: creditsRequired,
    reason: action,
    aiMode,
    metadata: { action, aiMode }
  });

  if (!debit.ok) {
    const remaining =
      debit.subscription.monthlyCreditsRemaining + debit.subscription.topupCreditsRemaining;
    throw new EntitlementError({
      statusCode: 402,
      code: 'INSUFFICIENT_CREDITS',
      requiredPlan: subscription.planId === 'free' ? 'pro' : undefined,
      creditsRequired,
      creditsRemaining: remaining,
      message: `Not enough credits for ${action.replace('_', ' ')} (${creditsRequired} required, ${remaining} remaining). Upgrade your plan or add a Top-Up pack.`
    });
  }

  let refunded = false;
  const refund = async (reason: string) => {
    if (refunded || creditsRequired <= 0) return;
    refunded = true;
    await store.refundCredits(userId, {
      debitedMonthly: debit.debitedMonthly,
      debitedTopup: debit.debitedTopup,
      reason: `refund:${action}:${reason}`,
      aiMode,
      metadata: { action, refundReason: reason }
    });
  };

  const route = resolveManagedRoute(config, aiMode);
  if (!route) {
    await refund('no_server_key');
    throw new Error(
      'Managed Gemini AI key is not configured on the server. Set GEMINI_API_KEY or enable Developer BYOK in Settings.'
    );
  }

  const logger: LlmUsageLogger = async (entry) => {
    await store.logLlmUsage({ ...entry, userId });
  };
  const factory = params.providerFactory ?? createLlmProvider;
  const provider = factory({
    provider: route.providerId,
    apiKey: route.apiKey,
    defaultModel: route.model,
    baseUrl:
      route.providerId === 'meta'
        ? resolveMetaBaseUrl(undefined, { META_BASE_URL: config.metaBaseUrl })
        : undefined,
    userId,
    logger
  });

  return {
    provider,
    providerId: route.providerId,
    model: route.model,
    aiMode,
    executionMode: 'managed',
    creditsCharged: creditsRequired,
    entitlements,
    refund
  };
}
