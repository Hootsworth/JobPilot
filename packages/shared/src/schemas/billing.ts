import { z } from 'zod';

export const PlanIdSchema = z.enum(['free', 'pro', 'sprint_90', 'plus']);
export type PlanId = z.infer<typeof PlanIdSchema>;

export const SubscriptionStatusSchema = z.enum(['active', 'canceled', 'expired', 'past_due']);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusSchema>;

export const BillingCurrencySchema = z.enum(['INR', 'USD']);
export type BillingCurrency = z.infer<typeof BillingCurrencySchema>;

export const AiQualityModeSchema = z.enum(['fast', 'precision']);
export type AiQualityMode = z.infer<typeof AiQualityModeSchema>;

export const CreditPackIdSchema = z.enum(['pack_150', 'pack_500']);
export type CreditPackId = z.infer<typeof CreditPackIdSchema>;

export const AiActionTypeSchema = z.enum([
  'resume_parse',
  'resume_tailor',
  'resume_verify',
  'cover_letter',
  'form_draft',
  'fallback_fill',
  'job_match_rerank'
]);
export type AiActionType = z.infer<typeof AiActionTypeSchema>;

export const PaymentProviderSchema = z.enum(['stripe', 'razorpay', 'dodo', 'manual']);
export type PaymentProvider = z.infer<typeof PaymentProviderSchema>;

export const PlanEntitlementsSchema = z.object({
  maxProfileVariants: z.number().int().min(1),
  allowedAiModes: z.array(AiQualityModeSchema),
  dualLlmVerifier: z.boolean(),
  nonApiAdaptersUnlocked: z.boolean(),
  priorityJobSync: z.boolean()
});
export type PlanEntitlements = z.infer<typeof PlanEntitlementsSchema>;

export const PlanDefinitionSchema = z.object({
  id: PlanIdSchema,
  name: z.string(),
  tagline: z.string(),
  billingInterval: z.enum(['free', 'monthly', 'one_time_90d']),
  priceInr: z.number().int().min(0),
  priceUsd: z.number().int().min(0),
  monthlyCredits: z.number().int().min(0),
  durationDays: z.number().int().min(1),
  highlightBadge: z.string().optional(),
  entitlements: PlanEntitlementsSchema,
  features: z.array(z.string())
});
export type PlanDefinition = z.infer<typeof PlanDefinitionSchema>;

export const CreditPackDefinitionSchema = z.object({
  id: CreditPackIdSchema,
  name: z.string(),
  credits: z.number().int().min(1),
  priceInr: z.number().int().min(1),
  priceUsd: z.number().int().min(1),
  tagline: z.string()
});
export type CreditPackDefinition = z.infer<typeof CreditPackDefinitionSchema>;

export const UserSubscriptionSchema = z.object({
  userId: z.string().uuid(),
  planId: PlanIdSchema,
  status: SubscriptionStatusSchema,
  billingCurrency: BillingCurrencySchema,
  aiModePreference: AiQualityModeSchema,
  useByokOverride: z.boolean(),
  monthlyCreditsRemaining: z.number().int().min(0),
  monthlyCreditsAllowance: z.number().int().min(0),
  topupCreditsRemaining: z.number().int().min(0),
  currentPeriodStart: z.string(),
  currentPeriodEnd: z.string(),
  paymentProvider: PaymentProviderSchema.nullable(),
  externalCustomerId: z.string().nullable(),
  externalSubscriptionId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type UserSubscription = z.infer<typeof UserSubscriptionSchema>;

export const CreditLedgerEntrySchema = z.object({
  id: z.string(),
  userId: z.string().uuid(),
  delta: z.number().int(),
  bucket: z.enum(['monthly', 'topup']),
  reason: z.string(),
  aiMode: z.enum(['fast', 'precision', 'byok']).nullable(),
  balanceAfter: z.number().int().min(0),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string()
});
export type CreditLedgerEntry = z.infer<typeof CreditLedgerEntrySchema>;

export const BillingSnapshotSchema = z.object({
  subscription: UserSubscriptionSchema,
  entitlements: PlanEntitlementsSchema,
  plan: PlanDefinitionSchema,
  totalCreditsRemaining: z.number().int().min(0),
  billingMode: z.enum(['managed', 'self_hosted']),
  executionMode: z.enum(['managed', 'byok']),
  demoBillingEnabled: z.boolean(),
  hasManagedServerKeys: z.boolean(),
  hasSavedByokKey: z.boolean(),
  recentLedger: z.array(CreditLedgerEntrySchema)
});
export type BillingSnapshot = z.infer<typeof BillingSnapshotSchema>;

export const UpdateBillingPreferencesRequestSchema = z.object({
  billingCurrency: BillingCurrencySchema.optional(),
  aiModePreference: AiQualityModeSchema.optional(),
  useByokOverride: z.boolean().optional()
});
export type UpdateBillingPreferencesRequest = z.infer<typeof UpdateBillingPreferencesRequestSchema>;

export const CreateCheckoutRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('plan'),
    planId: PlanIdSchema,
    currency: BillingCurrencySchema.default('INR')
  }),
  z.object({
    kind: z.literal('topup'),
    packId: CreditPackIdSchema,
    currency: BillingCurrencySchema.default('INR')
  })
]);
export type CreateCheckoutRequest = z.infer<typeof CreateCheckoutRequestSchema>;

export const CheckoutResponseSchema = z.object({
  mode: z.enum(['instant_demo', 'redirect']),
  checkoutUrl: z.string().nullable().default(null),
  message: z.string(),
  snapshot: BillingSnapshotSchema
});
export type CheckoutResponse = z.infer<typeof CheckoutResponseSchema>;

export const PLAN_CATALOG: Record<PlanId, PlanDefinition> = {
  free: {
    id: 'free',
    name: 'Free',
    tagline: 'Starter managed AI with zero API key setup',
    billingInterval: 'free',
    priceInr: 0,
    priceUsd: 0,
    monthlyCredits: 25,
    durationDays: 30,
    entitlements: {
      maxProfileVariants: 1,
      allowedAiModes: ['fast'],
      dualLlmVerifier: false,
      nonApiAdaptersUnlocked: false,
      priorityJobSync: false
    },
    features: [
      '25 managed Fast AI credits / month (~5 tailored resumes)',
      '1 Master Profile + PDF resume parse + GitHub import',
      'Unlimited local job matching, Application Tracker & PDF export',
      'Official ATS autofill (Greenhouse, Lever, Ashby, Workday)',
      'Deterministic grounded claim verification'
    ]
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    tagline: 'For active job seekers applying daily across India & global boards',
    billingInterval: 'monthly',
    priceInr: 499,
    priceUsd: 15,
    monthlyCredits: 300,
    durationDays: 30,
    highlightBadge: 'Most Popular',
    entitlements: {
      maxProfileVariants: 3,
      allowedAiModes: ['fast'],
      dualLlmVerifier: true,
      nonApiAdaptersUnlocked: true,
      priorityJobSync: false
    },
    features: [
      '300 managed Fast AI credits / month (~100 tailored resumes)',
      'Up to 3 Profile Variants (e.g. Frontend, Backend, Founding)',
      'Full Dual Verifier (Deterministic + independent LLM audit)',
      'All opt-in India & global portals (Naukri, Internshala, Instahyre, Foundit, Wellfound, LinkedIn)',
      'Unlimited STAR Story Bank + AI answer drafting in Chrome'
    ]
  },
  sprint_90: {
    id: 'sprint_90',
    name: '90-Day Sprint Pass',
    tagline: 'Full Pro access for 90 days — one-time, never auto-renews',
    billingInterval: 'one_time_90d',
    priceInr: 1199,
    priceUsd: 35,
    monthlyCredits: 900,
    durationDays: 90,
    highlightBadge: 'No Auto-Renew',
    entitlements: {
      maxProfileVariants: 3,
      allowedAiModes: ['fast'],
      dualLlmVerifier: true,
      nonApiAdaptersUnlocked: true,
      priorityJobSync: false
    },
    features: [
      '900 upfront Fast AI credits valid for 90 days',
      'One-time payment — automatically reverts to Free after 90 days',
      'Includes all Pro features: 3 Profile Variants & Dual LLM Verifier',
      'All 6 India & non-API extension adapters unlocked',
      'Any purchased top-up credits carry over after pass expiry'
    ]
  },
  plus: {
    id: 'plus',
    name: 'Plus',
    tagline: 'Frontier Precision models, unlimited variants, and priority sync',
    billingInterval: 'monthly',
    priceInr: 1199,
    priceUsd: 32,
    monthlyCredits: 1200,
    durationDays: 30,
    highlightBadge: 'Frontier AI',
    entitlements: {
      maxProfileVariants: 999,
      allowedAiModes: ['fast', 'precision'],
      dualLlmVerifier: true,
      nonApiAdaptersUnlocked: true,
      priorityJobSync: true
    },
    features: [
      '1,200 managed AI credits / month across Fast & Precision modes',
      'Frontier Precision routing (Gemini 2.5 Pro) for complex tailoring & cover letters',
      'Unlimited Profile Variants for every target role',
      'Priority job catalog sync (1-hour cooldown vs 6-hour standard)',
      'Full Dual LLM Verifier + all 10 extension ATS/portal adapters'
    ]
  }
};

export const CREDIT_PACKS: Record<CreditPackId, CreditPackDefinition> = {
  pack_150: {
    id: 'pack_150',
    name: '150 Top-Up Credits',
    credits: 150,
    priceInr: 199,
    priceUsd: 5,
    tagline: 'Never expires · used only after monthly credits run out'
  },
  pack_500: {
    id: 'pack_500',
    name: '500 Top-Up Credits',
    credits: 500,
    priceInr: 549,
    priceUsd: 14,
    tagline: 'Never expires · best value for heavy application sprints'
  }
};

export const CREDIT_COSTS: Record<AiActionType, Record<AiQualityMode, number>> = {
  resume_parse: { fast: 1, precision: 3 },
  resume_tailor: { fast: 3, precision: 10 },
  resume_verify: { fast: 1, precision: 3 },
  cover_letter: { fast: 2, precision: 6 },
  form_draft: { fast: 1, precision: 3 },
  fallback_fill: { fast: 1, precision: 3 },
  job_match_rerank: { fast: 2, precision: 5 }
};

export function getPlanEntitlements(planId: PlanId): PlanEntitlements {
  return PLAN_CATALOG[planId].entitlements;
}

export function getCreditCost(action: AiActionType, mode: AiQualityMode): number {
  return CREDIT_COSTS[action][mode];
}
