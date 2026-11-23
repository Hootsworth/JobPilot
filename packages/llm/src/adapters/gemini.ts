import { GoogleGenAI } from '@google/genai';
import type { z } from 'zod';
import type { ModelInfo, ProviderCapabilities, TestLlmKeyResult } from '@jobpilot/shared';
import { estimateCostUsd } from '../pricing.js';
import { zodToGeminiResponseSchema, zodToStandardJsonSchema } from '../schema-utils.js';
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

export interface GeminiRawModel {
  name?: string;
  displayName?: string;
  description?: string;
  supportedActions?: string[];
  supportedGenerationMethods?: string[];
}

export interface GeminiClientLike {
  models: {
    list(params?: { config?: { pageSize?: number } }): Promise<AsyncIterable<GeminiRawModel>>;
    generateContent(params: {
      model: string;
      contents: string;
      config?: Record<string, unknown>;
    }): Promise<{
      text?: string;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    }>;
  };
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function getHttpStatus(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const status = (err as { status?: unknown }).status;
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}

function stripModelsPrefix(name: string): string {
  return name.replace(/^models\//, '').trim();
}

export class GeminiAdapter implements LlmProvider {
  readonly providerId = 'gemini' as const;
  private readonly client: GeminiClientLike;
  private readonly config: LlmProviderConfig;
  private readonly capabilitiesCache = new Map<string, ProviderCapabilities>();

  constructor(config: LlmProviderConfig, clientOverride?: GeminiClientLike) {
    this.config = config;
    this.client =
      clientOverride ??
      (new GoogleGenAI({ apiKey: config.apiKey }) as unknown as GeminiClientLike);
  }

  getCapabilities(model?: string): ProviderCapabilities | null {
    const key = model ?? this.config.defaultModel;
    return key ? (this.capabilitiesCache.get(stripModelsPrefix(key)) ?? null) : null;
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const pager = await this.client.models.list({ config: { pageSize: 100 } });
      const models: ModelInfo[] = [];

      for await (const raw of pager) {
        if (!raw.name) continue;
        const id = stripModelsPrefix(raw.name);
        const actions = raw.supportedActions ?? raw.supportedGenerationMethods;
        if (actions && actions.length > 0) {
          const supportsGenerate = actions.some((a) =>
            a.toLowerCase().includes('generatecontent')
          );
          if (!supportsGenerate) continue;
        } else if (id.toLowerCase().includes('embedding')) {
          continue;
        }

        models.push({
          id,
          displayName: raw.displayName?.trim() || id,
          ownedBy: 'google',
          description: raw.description,
          supportsStructuredHint: true
        });
      }

      return models.sort((a, b) => a.id.localeCompare(b.id));
    } catch (err) {
      throw new LlmProviderError(`Gemini listModels failed: ${getErrorMessage(err)}`, {
        provider: 'gemini',
        statusCode: getHttpStatus(err),
        code: 'LIST_MODELS_FAILED',
        cause: err
      });
    }
  }

  private async resolveModel(requested?: string): Promise<string> {
    if (requested?.trim()) return stripModelsPrefix(requested);
    if (this.config.defaultModel?.trim()) return stripModelsPrefix(this.config.defaultModel);
    const models = await this.listModels();
    const first = models[0]?.id;
    if (!first) {
      throw new LlmProviderError(
        'No Gemini model specified and live models.list() returned empty.',
        { provider: 'gemini', code: 'NO_MODEL_AVAILABLE' }
      );
    }
    return first;
  }

  private async callGemini(params: {
    model: string;
    systemPrompt?: string;
    userPrompt: string;
    temperature?: number;
    maxTokens?: number;
    responseSchema?: Record<string, unknown>;
    jsonMode?: boolean;
  }): Promise<RawCompletionResponse> {
    const genConfig: Record<string, unknown> = {};
    if (params.systemPrompt) genConfig['systemInstruction'] = params.systemPrompt;
    if (params.temperature !== undefined) genConfig['temperature'] = params.temperature;
    if (params.maxTokens !== undefined) genConfig['maxOutputTokens'] = params.maxTokens;
    if (params.jsonMode || params.responseSchema) {
      genConfig['responseMimeType'] = 'application/json';
    }
    if (params.responseSchema) {
      genConfig['responseSchema'] = params.responseSchema;
    }

    try {
      const response = await this.client.models.generateContent({
        model: params.model,
        contents: params.userPrompt,
        config: genConfig
      });
      const caps: ProviderCapabilities = {
        structuredOutputMode: params.responseSchema
          ? 'json_schema'
          : params.jsonMode
            ? 'json_object'
            : 'prompt_json',
        supportsTemperature: true,
        tokenLimitParam: 'max_tokens',
        probedAt: new Date().toISOString()
      };
      this.capabilitiesCache.set(params.model, caps);

      return {
        text: response.text ?? '',
        model: params.model,
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
        capabilities: caps
      };
    } catch (err) {
      const msg = getErrorMessage(err);
      // Fallback if responseSchema hits a Gemini schema restriction while jsonMode works
      if (params.responseSchema && msg.toLowerCase().includes('schema')) {
        const fallbackConfig = { ...genConfig };
        delete fallbackConfig['responseSchema'];
        try {
          const fallbackRes = await this.client.models.generateContent({
            model: params.model,
            contents: params.userPrompt,
            config: fallbackConfig
          });
          const caps: ProviderCapabilities = {
            structuredOutputMode: 'json_object',
            supportsTemperature: true,
            tokenLimitParam: 'max_tokens',
            probedAt: new Date().toISOString()
          };
          this.capabilitiesCache.set(params.model, caps);
          return {
            text: fallbackRes.text ?? '',
            model: params.model,
            inputTokens: fallbackRes.usageMetadata?.promptTokenCount ?? 0,
            outputTokens: fallbackRes.usageMetadata?.candidatesTokenCount ?? 0,
            capabilities: caps
          };
        } catch (fallbackErr) {
          throw new LlmProviderError(`Gemini generateContent failed: ${getErrorMessage(fallbackErr)}`, {
            provider: 'gemini',
            statusCode: getHttpStatus(fallbackErr),
            code: 'COMPLETION_FAILED',
            cause: fallbackErr
          });
        }
      }
      throw new LlmProviderError(`Gemini generateContent failed: ${msg}`, {
        provider: 'gemini',
        statusCode: getHttpStatus(err),
        code: 'COMPLETION_FAILED',
        cause: err
      });
    }
  }

  async generateText(
    request: TextGenerationRequest
  ): Promise<RawCompletionResponse & { latencyMs: number; estimatedCostUsd: number }> {
    const start = Date.now();
    const model = await this.resolveModel(request.model);
    try {
      const res = await this.callGemini({
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
        provider: 'gemini',
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
        provider: 'gemini',
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
    const responseSchema = zodToGeminiResponseSchema(request.schema);
    const standardSchemaText = JSON.stringify(zodToStandardJsonSchema(request.schema));

    return runStructuredWithRetryAndRepair({
      provider: 'gemini',
      userId: this.config.userId,
      logger: this.config.logger,
      request: { ...request, model },
      callModel: async ({ systemPrompt, userPrompt, temperature, maxTokens }) => {
        return this.callGemini({
          model,
          systemPrompt: `${systemPrompt}\n\nTarget JSON Schema:\n${standardSchemaText}`,
          userPrompt,
          temperature,
          maxTokens,
          jsonMode: true,
          responseSchema
        });
      }
    });
  }

  async testKey(model?: string): Promise<TestLlmKeyResult> {
    const start = Date.now();
    try {
      const models = await this.listModels();
      const targetModel = model?.trim()
        ? stripModelsPrefix(model)
        : this.config.defaultModel?.trim()
          ? stripModelsPrefix(this.config.defaultModel)
          : models[0]?.id;

      if (!targetModel) {
        return {
          ok: false,
          provider: 'gemini',
          modelTested: null,
          latencyMs: Date.now() - start,
          modelsCount: models.length,
          detectedCapabilities: null,
          message: 'API key listed 0 usable Gemini models.'
        };
      }

      const res = await this.callGemini({
        model: targetModel,
        userPrompt: 'Reply with OK.',
        maxTokens: 16,
        temperature: 0
      });
      const latencyMs = Date.now() - start;
      const { estimatedCostUsd } = estimateCostUsd(res.model, res.inputTokens, res.outputTokens);
      await this.config.logger?.({
        userId: this.config.userId,
        taskType: 'key_test',
        provider: 'gemini',
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
        provider: 'gemini',
        modelTested: res.model,
        latencyMs,
        modelsCount: models.length,
        detectedCapabilities: res.capabilities ?? null,
        message: `Verified Gemini access (${models.length} models listed).`
      };
    } catch (err) {
      return {
        ok: false,
        provider: 'gemini',
        modelTested: model ?? this.config.defaultModel ?? null,
        latencyMs: Date.now() - start,
        modelsCount: 0,
        detectedCapabilities: null,
        message: getErrorMessage(err)
      };
    }
  }
}
