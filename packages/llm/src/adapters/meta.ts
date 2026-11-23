import OpenAI from 'openai';
import type { z } from 'zod';
import type {
  ModelInfo,
  ProviderCapabilities,
  StructuredOutputMode,
  TestLlmKeyResult,
  TokenLimitParam
} from '@jobpilot/shared';
import { estimateCostUsd } from '../pricing.js';
import { zodToOpenAiJsonSchema, zodToStandardJsonSchema } from '../schema-utils.js';
import { runStructuredWithRetryAndRepair } from '../structured-runner.js';
import {
  DEFAULT_META_BASE_URL,
  LlmProviderError,
  type LlmProvider,
  type LlmProviderConfig,
  type RawCompletionResponse,
  type StructuredGenerationRequest,
  type StructuredGenerationResult,
  type TextGenerationRequest
} from '../types.js';

export interface MetaOpenAiClientLike {
  models: {
    list(): Promise<unknown> | AsyncIterable<unknown>;
  };
  chat: {
    completions: {
      create(body: Record<string, unknown>): Promise<{
        model?: string;
        choices?: Array<{
          message?: {
            content?: string | Array<{ type?: string; text?: string }> | null;
          };
        }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      }>;
    };
  };
}

function getHttpStatus(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const status = (err as { status?: unknown }).status;
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function resolveMetaBaseUrl(override?: string | null, env: Record<string, string | undefined> = process.env): string {
  const candidate = override?.trim() || env['META_BASE_URL']?.trim() || DEFAULT_META_BASE_URL;
  return candidate.endsWith('/') ? candidate : `${candidate}/`;
}

function extractMessageText(
  content: string | Array<{ type?: string; text?: string }> | null | undefined
): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('');
  }
  return '';
}

function normalizeModelRecord(item: unknown): ModelInfo | null {
  if (!item || typeof item !== 'object') return null;
  const rec = item as Record<string, unknown>;
  const rawId = rec['id'] ?? rec['model'] ?? rec['name'];
  if (typeof rawId !== 'string' || !rawId.trim()) return null;
  const id = rawId.trim();
  const displayName =
    typeof rec['display_name'] === 'string' && rec['display_name'].trim()
      ? rec['display_name'].trim()
      : typeof rec['name'] === 'string' && rec['name'].trim()
        ? rec['name'].trim()
        : id;
  const ownedBy =
    typeof rec['owned_by'] === 'string'
      ? rec['owned_by']
      : typeof rec['owner'] === 'string'
        ? rec['owner']
        : 'meta';

  return {
    id,
    displayName,
    ownedBy
  };
}

export class MetaLlamaAdapter implements LlmProvider {
  readonly providerId = 'meta' as const;
  readonly baseUrl: string;
  private readonly client: MetaOpenAiClientLike;
  private readonly config: LlmProviderConfig;
  private readonly capabilitiesCache = new Map<string, ProviderCapabilities>();

  constructor(config: LlmProviderConfig, clientOverride?: MetaOpenAiClientLike) {
    this.config = config;
    this.baseUrl = resolveMetaBaseUrl(config.baseUrl);
    this.client =
      clientOverride ??
      (new OpenAI({
        apiKey: config.apiKey,
        baseURL: this.baseUrl
      }) as unknown as MetaOpenAiClientLike);
  }

  private cacheKey(model: string): string {
    return `${this.baseUrl}::${model}`;
  }

  getCapabilities(model?: string): ProviderCapabilities | null {
    const key = model ?? this.config.defaultModel;
    return key ? (this.capabilitiesCache.get(this.cacheKey(key)) ?? null) : null;
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const response = await this.client.models.list();
      const rawItems: unknown[] = [];

      if (Array.isArray(response)) {
        rawItems.push(...response);
      } else if (response && typeof response === 'object') {
        const obj = response as Record<string, unknown>;
        if (Array.isArray(obj['data'])) {
          rawItems.push(...obj['data']);
        } else if (Array.isArray(obj['items'])) {
          rawItems.push(...obj['items']);
        } else if (Symbol.asyncIterator in obj) {
          for await (const item of response as AsyncIterable<unknown>) {
            rawItems.push(item);
          }
        }
      }

      const models = rawItems
        .map(normalizeModelRecord)
        .filter((m): m is ModelInfo => m !== null);

      const deduped = new Map<string, ModelInfo>();
      for (const m of models) {
        if (!deduped.has(m.id)) deduped.set(m.id, m);
      }
      return Array.from(deduped.values()).sort((a, b) => a.id.localeCompare(b.id));
    } catch (err) {
      throw new LlmProviderError(`Meta Llama /models failed: ${getErrorMessage(err)}`, {
        provider: 'meta',
        statusCode: getHttpStatus(err),
        code: 'LIST_MODELS_FAILED',
        cause: err
      });
    }
  }

  private async resolveModel(requested?: string): Promise<string> {
    if (requested?.trim()) return requested.trim();
    if (this.config.defaultModel?.trim()) return this.config.defaultModel.trim();
    const models = await this.listModels();
    const first = models[0]?.id;
    if (!first) {
      throw new LlmProviderError(
        'No Meta Llama model specified and live GET /models returned empty.',
        { provider: 'meta', code: 'NO_MODEL_AVAILABLE' }
      );
    }
    return first;
  }

  private async callWithFeatureDetection(params: {
    model: string;
    systemPrompt?: string;
    userPrompt: string;
    temperature?: number;
    maxTokens?: number;
    structured?: {
      schemaName: string;
      jsonSchema: { name: string; strict: boolean; schema: Record<string, unknown> };
      standardSchemaText: string;
    };
  }): Promise<RawCompletionResponse> {
    const key = this.cacheKey(params.model);
    const cached = this.capabilitiesCache.get(key);

    let mode: StructuredOutputMode = params.structured
      ? (cached?.structuredOutputMode ?? 'json_schema')
      : 'prompt_json';
    let tokenParam: TokenLimitParam = cached?.tokenLimitParam ?? 'max_completion_tokens';
    let supportsTemp = cached?.supportsTemperature ?? true;

    for (let attempt = 0; attempt < 5; attempt++) {
      const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
      let systemText = params.systemPrompt ?? '';
      if (params.structured) {
        const schemaRule = `Return ONLY valid JSON matching this schema (${params.structured.schemaName}):\n${params.structured.standardSchemaText}`;
        systemText = systemText ? `${systemText}\n\n${schemaRule}` : schemaRule;
      }
      if (systemText) {
        messages.push({ role: 'system', content: systemText });
      }
      messages.push({ role: 'user', content: params.userPrompt });

      const body: Record<string, unknown> = {
        model: params.model,
        messages
      };

      if (params.structured) {
        if (mode === 'json_schema') {
          body['response_format'] = {
            type: 'json_schema',
            json_schema: params.structured.jsonSchema
          };
        } else if (mode === 'json_object') {
          body['response_format'] = { type: 'json_object' };
        }
      }

      if (supportsTemp && params.temperature !== undefined) {
        body['temperature'] = params.temperature;
      }
      if (params.maxTokens !== undefined) {
        body[tokenParam] = params.maxTokens;
      }

      try {
        const res = await this.client.chat.completions.create(body);
        const text = extractMessageText(res.choices?.[0]?.message?.content);
        const detected: ProviderCapabilities = {
          structuredOutputMode: mode,
          supportsTemperature: supportsTemp,
          tokenLimitParam: tokenParam,
          probedAt: new Date().toISOString()
        };
        this.capabilitiesCache.set(key, detected);

        return {
          text,
          model: res.model ?? params.model,
          inputTokens: res.usage?.prompt_tokens ?? 0,
          outputTokens: res.usage?.completion_tokens ?? 0,
          capabilities: detected
        };
      } catch (err) {
        const status = getHttpStatus(err);
        const msg = getErrorMessage(err).toLowerCase();
        const isParamError =
          status === 400 ||
          status === 422 ||
          msg.includes('unsupported') ||
          msg.includes('unrecognized') ||
          msg.includes('invalid') ||
          msg.includes('unknown field');

        if (isParamError && attempt < 4) {
          if (
            tokenParam === 'max_completion_tokens' &&
            (msg.includes('max_completion_tokens') || msg.includes('max_tokens'))
          ) {
            tokenParam = 'max_tokens';
            continue;
          }
          if (supportsTemp && msg.includes('temperature')) {
            supportsTemp = false;
            continue;
          }
          if (
            params.structured &&
            (msg.includes('response_format') ||
              msg.includes('json_schema') ||
              msg.includes('json_object'))
          ) {
            if (mode === 'json_schema') {
              mode = 'json_object';
              continue;
            }
            if (mode === 'json_object') {
              mode = 'prompt_json';
              continue;
            }
          }
        }

        throw new LlmProviderError(`Meta Llama API completion failed: ${getErrorMessage(err)}`, {
          provider: 'meta',
          statusCode: status,
          code: 'COMPLETION_FAILED',
          cause: err
        });
      }
    }

    throw new LlmProviderError('Meta Llama API exhausted preview compatibility retries', {
      provider: 'meta',
      code: 'COMPLETION_FAILED'
    });
  }

  async generateText(
    request: TextGenerationRequest
  ): Promise<RawCompletionResponse & { latencyMs: number; estimatedCostUsd: number }> {
    const start = Date.now();
    const model = await this.resolveModel(request.model);
    try {
      const res = await this.callWithFeatureDetection({
        model,
        systemPrompt: request.systemPrompt,
        userPrompt: request.userPrompt,
        temperature: request.temperature,
        maxTokens: request.maxTokens
      });
      const latencyMs = Date.now() - start;
      const { estimatedCostUsd } = estimateCostUsd(res.model, res.inputTokens, res.outputTokens);
      await this.config.logger?.({
        userId: this.config.userId,
        taskType: request.taskType ?? 'form_draft',
        provider: 'meta',
        model: res.model,
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
        latencyMs,
        estimatedCostUsd,
        retryCount: 0,
        usedRepair: false,
        status: 'ok'
      });
      return { ...res, latencyMs, estimatedCostUsd };
    } catch (err) {
      await this.config.logger?.({
        userId: this.config.userId,
        taskType: request.taskType ?? 'form_draft',
        provider: 'meta',
        model,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: Date.now() - start,
        estimatedCostUsd: 0,
        retryCount: 0,
        usedRepair: false,
        status: 'error',
        errorCode: err instanceof LlmProviderError ? err.code : 'PROVIDER_ERROR'
      });
      throw err;
    }
  }

  async generateStructured<TSchema extends z.ZodTypeAny>(
    request: StructuredGenerationRequest<TSchema>
  ): Promise<StructuredGenerationResult<z.infer<TSchema>>> {
    const model = await this.resolveModel(request.model);
    const jsonSchema = zodToOpenAiJsonSchema(request.schema, request.schemaName);
    const standardSchemaText = JSON.stringify(zodToStandardJsonSchema(request.schema));

    return runStructuredWithRetryAndRepair({
      provider: 'meta',
      userId: this.config.userId,
      logger: this.config.logger,
      request: { ...request, model },
      callModel: async ({ systemPrompt, userPrompt, temperature, maxTokens }) =>
        this.callWithFeatureDetection({
          model,
          systemPrompt,
          userPrompt,
          temperature,
          maxTokens,
          structured: {
            schemaName: request.schemaName,
            jsonSchema,
            standardSchemaText
          }
        })
    });
  }

  async testKey(model?: string): Promise<TestLlmKeyResult> {
    const start = Date.now();
    try {
      const models = await this.listModels();
      const targetModel = model?.trim() || this.config.defaultModel?.trim() || models[0]?.id;
      if (!targetModel) {
        return {
          ok: false,
          provider: 'meta',
          modelTested: null,
          latencyMs: Date.now() - start,
          modelsCount: models.length,
          detectedCapabilities: null,
          message: `Connected to ${this.baseUrl}, but /models returned 0 models.`
        };
      }

      const res = await this.callWithFeatureDetection({
        model: targetModel,
        userPrompt: 'Reply with OK.',
        maxTokens: 8,
        temperature: 0
      });
      const latencyMs = Date.now() - start;
      const { estimatedCostUsd } = estimateCostUsd(res.model, res.inputTokens, res.outputTokens);
      await this.config.logger?.({
        userId: this.config.userId,
        taskType: 'key_test',
        provider: 'meta',
        model: res.model,
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
        latencyMs,
        estimatedCostUsd,
        retryCount: 0,
        usedRepair: false,
        status: 'ok'
      });

      return {
        ok: true,
        provider: 'meta',
        modelTested: res.model,
        latencyMs,
        modelsCount: models.length,
        detectedCapabilities: res.capabilities ?? null,
        message: `Verified Meta Llama compat API at ${this.baseUrl} (${models.length} models listed).`
      };
    } catch (err) {
      return {
        ok: false,
        provider: 'meta',
        modelTested: model ?? this.config.defaultModel ?? null,
        latencyMs: Date.now() - start,
        modelsCount: 0,
        detectedCapabilities: null,
        message: getErrorMessage(err)
      };
    }
  }
}
