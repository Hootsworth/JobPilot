import { z } from 'zod';

export const LlmProviderIdSchema = z.enum(['openai', 'gemini', 'meta']);
export type LlmProviderId = z.infer<typeof LlmProviderIdSchema>;

export const StructuredOutputModeSchema = z.enum(['json_schema', 'json_object', 'prompt_json']);
export type StructuredOutputMode = z.infer<typeof StructuredOutputModeSchema>;

export const TokenLimitParamSchema = z.enum(['max_completion_tokens', 'max_tokens']);
export type TokenLimitParam = z.infer<typeof TokenLimitParamSchema>;

export const ProviderCapabilitiesSchema = z.object({
  structuredOutputMode: StructuredOutputModeSchema,
  supportsTemperature: z.boolean().default(true),
  tokenLimitParam: TokenLimitParamSchema.default('max_completion_tokens'),
  probedAt: z.string().optional()
});
export type ProviderCapabilities = z.infer<typeof ProviderCapabilitiesSchema>;

export const ModelInfoSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  ownedBy: z.string().optional(),
  description: z.string().optional(),
  supportsStructuredHint: z.boolean().optional()
});
export type ModelInfo = z.infer<typeof ModelInfoSchema>;

export const LlmSettingsItemSchema = z.object({
  provider: LlmProviderIdSchema,
  isActive: z.boolean(),
  selectedModel: z.string().nullable(),
  baseUrlOverride: z.string().nullable(),
  hasKey: z.boolean(),
  keyHint: z.string().nullable(),
  usingEnvFallback: z.boolean(),
  detectedCapabilities: ProviderCapabilitiesSchema.nullable(),
  lastTestedAt: z.string().nullable(),
  lastTestStatus: z.enum(['ok', 'error', 'untested']).nullable()
});
export type LlmSettingsItem = z.infer<typeof LlmSettingsItemSchema>;

export const UpsertLlmSettingsSchema = z.object({
  isActive: z.boolean().optional(),
  selectedModel: z.string().trim().min(1).nullable().optional(),
  baseUrlOverride: z.string().trim().url().or(z.literal('')).nullable().optional(),
  apiKey: z.string().trim().min(1).optional()
});
export type UpsertLlmSettingsRequest = z.infer<typeof UpsertLlmSettingsSchema>;

export const TestLlmKeyRequestSchema = z.object({
  provider: LlmProviderIdSchema,
  apiKey: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
  baseUrlOverride: z.string().trim().url().or(z.literal('')).optional()
});
export type TestLlmKeyRequest = z.infer<typeof TestLlmKeyRequestSchema>;

export const TestLlmKeyResultSchema = z.object({
  ok: z.boolean(),
  provider: LlmProviderIdSchema,
  modelTested: z.string().nullable(),
  latencyMs: z.number().int().min(0),
  modelsCount: z.number().int().min(0),
  detectedCapabilities: ProviderCapabilitiesSchema.nullable(),
  message: z.string()
});
export type TestLlmKeyResult = z.infer<typeof TestLlmKeyResultSchema>;

export const LlmTaskTypeSchema = z.enum([
  'resume_parse',
  'resume_tailor',
  'resume_verify',
  'job_match_rerank',
  'jd_extract',
  'form_draft',
  'key_test',
  'json_repair'
]);
export type LlmTaskType = z.infer<typeof LlmTaskTypeSchema>;

export const LlmUsageLogSchema = z.object({
  id: z.string(),
  taskType: z.string(),
  provider: LlmProviderIdSchema,
  model: z.string(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  latencyMs: z.number().int(),
  estimatedCostUsd: z.number(),
  retryCount: z.number().int(),
  usedRepair: z.boolean(),
  status: z.enum(['ok', 'error']),
  errorCode: z.string().nullable(),
  createdAt: z.string()
});
export type LlmUsageLog = z.infer<typeof LlmUsageLogSchema>;

export const LlmUsageSummarySchema = z.object({
  totalCalls: z.number().int(),
  totalInputTokens: z.number().int(),
  totalOutputTokens: z.number().int(),
  totalCostUsd: z.number(),
  avgLatencyMs: z.number(),
  byProvider: z.array(
    z.object({
      provider: LlmProviderIdSchema,
      calls: z.number().int(),
      tokens: z.number().int(),
      costUsd: z.number(),
      avgLatencyMs: z.number()
    })
  ),
  recentLogs: z.array(LlmUsageLogSchema)
});
export type LlmUsageSummary = z.infer<typeof LlmUsageSummarySchema>;
