import OpenAI from 'openai';
import type { z } from 'zod';
import type { ModelInfo, ProviderCapabilities, TestLlmKeyResult } from '@jobpilot/shared';
import { estimateCostUsd } from '../pricing.js';
import { zodToOpenAiJsonSchema, zodToStandardJsonSchema } from '../schema-utils.js';
import { runStructuredWithRetryAndRepair } from '../structured-runner.js';
import {
  LlmProviderError,
  type LlmProvider,
  type LlmProviderConfig,
  type RawCompletionResponse,
  type StructuredGenerationRequest,
  type StructuredGenerationResult,
  type TextGenerationRequest
} from '../types.js';

export interface OpenAiClientLike {
  models: {
    list(): AsyncIterable<{ id: string; owned_by?: string }> | Promise<{ data: Array<{ id: string; owned_by?: string }> }>;
  };
  chat: {
    completions: {
      create(body: Record<string, unknown>): Promise<{
        model?: string;
        choices: Array<{ message?: { content?: string | null } }>;
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

function isUnsupportedModelForChat(id: string): boolean {
  const lower = id.toLowerCase();
  return (
    lower.includes('embedding') ||
    lower.includes('whisper') ||
    lower.includes('tts') ||
    lower.includes('dall-e') ||
    lower.includes('moderation') ||
    lower.includes('transcribe') ||
    lower.includes('realtime')
  );
}

export class OpenAIAdapter implements LlmProvider {
  readonly providerId = 'openai' as const;
  private readonly client: OpenAiClientLike;
  private readonly config: LlmProviderConfig;
  private readonly capabilitiesCache = new Map<string, ProviderCapabilities>();

  constructor(config: LlmProviderConfig, clientOverride?: OpenAiClientLike) {
    this.config = config;
    this.client =
      clientOverride ??
      (new OpenAI({
        apiKey: config.apiKey,
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {})
      }) as unknown as OpenAiClientLike);
  }

  getCapabilities(model?: string): ProviderCapabilities | null {
    const key = model ?? this.config.defaultModel;
    return key ? (this.capabilitiesCache.get(key) ?? null) : null;
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const response = await this.client.models.list();
      const rawItems: Array<{ id: string; owned_by?: string }> = [];

      if (Symbol.asyncIterator in Object(response)) {
        for await (const item of response as AsyncIterable<{ id: string; owned_by?: string }>) {
          if (item?.id) rawItems.push(item);
        }
      } else if ('data' in response && Array.isArray(response.data)) {
        rawItems.push(...response.data.filter((item) => Boolean(item?.id)));
      }

      const filtered = rawItems.filter((m) => !isUnsupportedModelForChat(m.id));
      const finalItems = filtered.length > 0 ? filtered : rawItems;

      return finalItems
        .map((m) => ({
          id: m.id,
          displayName: m.id,
          ownedBy: m.owned_by,
          supportsStructuredHint: true
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
    } catch (err) {
      throw new LlmProviderError(`OpenAI listModels failed: ${getErrorMessage(err)}`, {
        provider: 'openai',
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
        'No OpenAI model specified and live listModels() returned empty.',
        { provider: 'openai', code: 'NO_MODEL_AVAILABLE' }
      );
    }
    return first;
  }

  private async runChatCompletion(params: {
    model: string;
    systemPrompt?: string;
    userPrompt: string;
    temperature?: number;
    maxTokens?: number;
    responseFormat?: Record<string, unknown>;
  }): Promise<RawCompletionResponse> {
    const caps = this.capabilitiesCache.get(params.model) ?? {
      structuredOutputMode: 'json_schema' as const,
      supportsTemperature: true,
      tokenLimitParam: 'max_completion_tokens' as const,
      probedAt: new Date().toISOString()
    };

    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (params.systemPrompt) messages.push({ role: 'system', content: params.systemPrompt });
    messages.push({ role: 'user', content: params.userPrompt });

    let activeFormat = params.responseFormat;
    let useTemperature = caps.supportsTemperature && params.temperature !== undefined;
    let tokenParam = caps.tokenLimitParam;

    for (let attempt = 0; attempt < 3; attempt++) {
      const body: Record<string, unknown> = {
        model: params.model,
        messages
      };
      if (activeFormat) body['response_format'] = activeFormat;
      if (useTemperature && params.temperature !== undefined) body['temperature'] = params.temperature;
      if (params.maxTokens !== undefined) body[tokenParam] = params.maxTokens;

      try {
        const res = await this.client.chat.completions.create(body);
        const text = res.choices[0]?.message?.content ?? '';
        const mode =
          activeFormat?.['type'] === 'json_schema'
            ? 'json_schema'
            : activeFormat?.['type'] === 'json_object'
              ? 'json_object'
              : 'prompt_json';
        const updatedCaps: ProviderCapabilities = {
          structuredOutputMode: mode,
          supportsTemperature: useTemperature || caps.supportsTemperature,
          tokenLimitParam: tokenParam,
          probedAt: new Date().toISOString()
        };
        this.capabilitiesCache.set(params.model, updatedCaps);

        return {
          text,
          model: res.model ?? params.model,
          inputTokens: res.usage?.prompt_tokens ?? 0,
          outputTokens: res.usage?.completion_tokens ?? 0,
          capabilities: updatedCaps
        };
      } catch (err) {
        const status = getHttpStatus(err);
        const msg = getErrorMessage(err).toLowerCase();
        if (status === 400 && attempt < 2) {
          if (msg.includes('max_completion_tokens') && tokenParam === 'max_completion_tokens') {
            tokenParam = 'max_tokens';
            continue;
          }
          if (msg.includes('temperature') && useTemperature) {
            useTemperature = false;
            caps.supportsTemperature = false;
            continue;
          }
          if (
            activeFormat?.['type'] === 'json_schema' &&
            (msg.includes('json_schema') || msg.includes('response_format'))
          ) {
            activeFormat = { type: 'json_object' };
            continue;
          }
        }
        throw new LlmProviderError(`OpenAI completion failed: ${getErrorMessage(err)}`, {
          provider: 'openai',
          statusCode: status,
          code: 'COMPLETION_FAILED',
          cause: err
        });
      }
    }

    throw new LlmProviderError('OpenAI completion exhausted capability fallbacks', {
      provider: 'openai',
      code: 'COMPLETION_FAILED'
    });
  }

  async generateText(
    request: TextGenerationRequest
  ): Promise<RawCompletionResponse & { latencyMs: number; estimatedCostUsd: number }> {
    const start = Date.now();
    const model = await this.resolveModel(request.model);
    try {
      const res = await this.runChatCompletion({
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
        provider: 'openai',
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
        provider: 'openai',
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
    const jsonSchemaDef = zodToOpenAiJsonSchema(request.schema, request.schemaName);
    const standardSchemaText = JSON.stringify(zodToStandardJsonSchema(request.schema));

    return runStructuredWithRetryAndRepair({
      provider: 'openai',
      userId: this.config.userId,
      logger: this.config.logger,
      request: { ...request, model },
      callModel: async ({ systemPrompt, userPrompt, temperature, maxTokens }) => {
        const cached = this.capabilitiesCache.get(model);
        const responseFormat =
          cached?.structuredOutputMode === 'json_object'
            ? { type: 'json_object' }
            : { type: 'json_schema', json_schema: jsonSchemaDef };

        const augmentedSystem = `${systemPrompt}\n\nRespond strictly with JSON conforming to this schema:\n${standardSchemaText}`;

        return this.runChatCompletion({
          model,
          systemPrompt: augmentedSystem,
          userPrompt,
          temperature,
          maxTokens,
          responseFormat
        });
      }
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
          provider: 'openai',
          modelTested: null,
          latencyMs: Date.now() - start,
          modelsCount: models.length,
          detectedCapabilities: null,
          message: 'API key listed 0 usable chat models.'
        };
      }
      const res = await this.runChatCompletion({
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
        provider: 'openai',
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
        provider: 'openai',
        modelTested: res.model,
        latencyMs,
        modelsCount: models.length,
        detectedCapabilities: res.capabilities ?? null,
        message: `Verified OpenAI access (${models.length} models listed).`
      };
    } catch (err) {
      return {
        ok: false,
        provider: 'openai',
        modelTested: model ?? this.config.defaultModel ?? null,
        latencyMs: Date.now() - start,
        modelsCount: 0,
        detectedCapabilities: null,
        message: getErrorMessage(err)
      };
    }
  }
}
