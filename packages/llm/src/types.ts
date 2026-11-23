import type { z } from 'zod';
import type {
  LlmProviderId,
  LlmTaskType,
  ModelInfo,
  ProviderCapabilities,
  TestLlmKeyResult
} from '@jobpilot/shared';

export const DEFAULT_META_BASE_URL = 'https://api.llama.com/compat/v1/';

export interface LlmCallLogEntry {
  userId?: string | null;
  taskType: LlmTaskType;
  provider: LlmProviderId;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  estimatedCostUsd: number;
  retryCount: number;
  usedRepair: boolean;
  status: 'ok' | 'error';
  errorCode?: string | null;
}

export type LlmUsageLogger = (entry: LlmCallLogEntry) => void | Promise<void>;

export interface LlmProviderConfig {
  provider: LlmProviderId;
  apiKey: string;
  defaultModel?: string;
  baseUrl?: string;
  userId?: string | null;
  logger?: LlmUsageLogger;
}

export interface TextGenerationRequest {
  model?: string;
  systemPrompt?: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  taskType?: LlmTaskType;
}

export interface RawCompletionResponse {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  capabilities?: ProviderCapabilities;
}

export interface StructuredGenerationRequest<TSchema extends z.ZodTypeAny> {
  schema: TSchema;
  schemaName: string;
  systemPrompt?: string;
  userPrompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  maxRetries?: number;
  taskType?: LlmTaskType;
}

export interface StructuredGenerationResult<TData> {
  data: TData;
  provider: LlmProviderId;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  estimatedCostUsd: number;
  retryCount: number;
  usedRepair: boolean;
  capabilities?: ProviderCapabilities;
}

export interface LlmProvider {
  readonly providerId: LlmProviderId;
  listModels(): Promise<ModelInfo[]>;
  testKey(model?: string): Promise<TestLlmKeyResult>;
  generateText(request: TextGenerationRequest): Promise<RawCompletionResponse & { latencyMs: number; estimatedCostUsd: number }>;
  generateStructured<TSchema extends z.ZodTypeAny>(
    request: StructuredGenerationRequest<TSchema>
  ): Promise<StructuredGenerationResult<z.infer<TSchema>>>;
  getCapabilities(model?: string): ProviderCapabilities | null;
}

export class LlmProviderError extends Error {
  readonly provider: LlmProviderId;
  readonly statusCode?: number;
  readonly code: string;

  constructor(
    message: string,
    options: { provider: LlmProviderId; statusCode?: number; code?: string; cause?: unknown }
  ) {
    super(message, { cause: options.cause });
    this.name = 'LlmProviderError';
    this.provider = options.provider;
    this.statusCode = options.statusCode;
    this.code = options.code ?? 'PROVIDER_ERROR';
  }
}

export class LlmValidationError extends Error {
  readonly provider: LlmProviderId;
  readonly model: string;
  readonly zodErrors: string;
  readonly rawOutput: string;

  constructor(
    message: string,
    options: { provider: LlmProviderId; model: string; zodErrors: string; rawOutput: string }
  ) {
    super(message);
    this.name = 'LlmValidationError';
    this.provider = options.provider;
    this.model = options.model;
    this.zodErrors = options.zodErrors;
    this.rawOutput = options.rawOutput;
  }
}
