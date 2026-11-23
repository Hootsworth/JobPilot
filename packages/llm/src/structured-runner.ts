import type { z } from 'zod';
import type { LlmProviderId, LlmTaskType, ProviderCapabilities } from '@jobpilot/shared';
import { estimateCostUsd } from './pricing.js';
import { extractJsonPayload, formatZodErrors, zodToStandardJsonSchema } from './schema-utils.js';
import {
  LlmValidationError,
  type LlmUsageLogger,
  type RawCompletionResponse,
  type StructuredGenerationRequest,
  type StructuredGenerationResult
} from './types.js';

export type RawStructuredCaller = (params: {
  model?: string;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
}) => Promise<RawCompletionResponse>;

async function safeLogUsage(
  logger: LlmUsageLogger | undefined,
  entry: Parameters<LlmUsageLogger>[0]
): Promise<void> {
  if (!logger) return;
  try {
    await logger(entry);
  } catch {
    // Telemetry logging must never break primary LLM execution
  }
}

export async function runStructuredWithRetryAndRepair<TSchema extends z.ZodTypeAny>(params: {
  provider: LlmProviderId;
  userId?: string | null;
  logger?: LlmUsageLogger;
  request: StructuredGenerationRequest<TSchema>;
  callModel: RawStructuredCaller;
  repairModel?: RawStructuredCaller;
}): Promise<StructuredGenerationResult<z.infer<TSchema>>> {
  const { provider, userId, logger, request, callModel } = params;
  const maxRetries = request.maxRetries ?? 2;
  const taskType: LlmTaskType = request.taskType ?? 'resume_parse';
  const baseSystemPrompt =
    request.systemPrompt ??
    'You are a precise JSON extraction engine. Return only valid JSON matching the requested schema.';

  const startTime = Date.now();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let lastRawText = '';
  let lastModel = request.model ?? 'unknown';
  let lastErrorSummary = 'Unknown validation error';
  let lastCapabilities: ProviderCapabilities | undefined;
  let retryCount = 0;

  let currentUserPrompt = request.userPrompt;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await callModel({
        model: request.model,
        systemPrompt: baseSystemPrompt,
        userPrompt: currentUserPrompt,
        temperature: request.temperature,
        maxTokens: request.maxTokens
      });

      lastModel = response.model;
      lastRawText = response.text;
      lastCapabilities = response.capabilities;
      totalInputTokens += response.inputTokens;
      totalOutputTokens += response.outputTokens;

      const candidateJson = extractJsonPayload(response.text);
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(candidateJson);
      } catch (jsonErr) {
        const msg = jsonErr instanceof Error ? jsonErr.message : 'Invalid JSON syntax';
        lastErrorSummary = `JSON parse error: ${msg}`;
        if (attempt < maxRetries) {
          retryCount++;
          currentUserPrompt = [
            request.userPrompt,
            '',
            '---',
            'Your previous response was NOT valid JSON. Fix the output strictly and return ONLY valid JSON.',
            `Parse error: ${msg}`,
            `Previous output:\n${response.text.slice(0, 4000)}`
          ].join('\n');
          continue;
        }
        break;
      }

      const validation = request.schema.safeParse(parsedJson);
      if (validation.success) {
        const latencyMs = Date.now() - startTime;
        const { estimatedCostUsd } = estimateCostUsd(lastModel, totalInputTokens, totalOutputTokens);
        await safeLogUsage(logger, {
          userId,
          taskType,
          provider,
          model: lastModel,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          latencyMs,
          estimatedCostUsd,
          retryCount,
          usedRepair: false,
          status: 'ok'
        });

        return {
          data: validation.data,
          provider,
          model: lastModel,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          latencyMs,
          estimatedCostUsd,
          retryCount,
          usedRepair: false,
          capabilities: lastCapabilities
        };
      }

      lastErrorSummary = formatZodErrors(validation.error);
      if (attempt < maxRetries) {
        retryCount++;
        currentUserPrompt = [
          request.userPrompt,
          '',
          '---',
          'Your previous JSON output failed schema validation. Fix ONLY the invalid fields and return complete valid JSON matching the schema.',
          `Validation errors:\n${lastErrorSummary}`,
          `Previous output:\n${candidateJson.slice(0, 4000)}`
        ].join('\n');
      }
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      const { estimatedCostUsd } = estimateCostUsd(lastModel, totalInputTokens, totalOutputTokens);
      await safeLogUsage(logger, {
        userId,
        taskType,
        provider,
        model: lastModel,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        latencyMs,
        estimatedCostUsd,
        retryCount,
        usedRepair: false,
        status: 'error',
        errorCode: err instanceof Error ? err.name : 'PROVIDER_ERROR'
      });
      throw err;
    }
  }

  // Fallback: dedicated repair pass
  const repairCaller = params.repairModel ?? callModel;
  const schemaSnapshot = JSON.stringify(zodToStandardJsonSchema(request.schema), null, 2);
  const repairSystemPrompt =
    'You are a strict JSON structure repair tool. Reformat the provided broken JSON into valid JSON conforming exactly to the target JSON Schema. Never invent facts, dates, metrics, or entities not present in the input.';
  const repairUserPrompt = [
    `Target JSON Schema (${request.schemaName}):`,
    schemaSnapshot,
    '',
    'Validation Errors:',
    lastErrorSummary,
    '',
    'Broken Output to Repair:',
    lastRawText.slice(0, 6000)
  ].join('\n');

  try {
    const repaired = await repairCaller({
      model: request.model,
      systemPrompt: repairSystemPrompt,
      userPrompt: repairUserPrompt,
      temperature: 0,
      maxTokens: request.maxTokens
    });
    lastModel = repaired.model;
    lastRawText = repaired.text;
    lastCapabilities = repaired.capabilities ?? lastCapabilities;
    totalInputTokens += repaired.inputTokens;
    totalOutputTokens += repaired.outputTokens;

    const candidateJson = extractJsonPayload(repaired.text);
    const parsedRepair = JSON.parse(candidateJson) as unknown;
    const validation = request.schema.safeParse(parsedRepair);

    if (validation.success) {
      const latencyMs = Date.now() - startTime;
      const { estimatedCostUsd } = estimateCostUsd(lastModel, totalInputTokens, totalOutputTokens);
      await safeLogUsage(logger, {
        userId,
        taskType,
        provider,
        model: lastModel,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        latencyMs,
        estimatedCostUsd,
        retryCount,
        usedRepair: true,
        status: 'ok'
      });

      return {
        data: validation.data,
        provider,
        model: lastModel,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        latencyMs,
        estimatedCostUsd,
        retryCount,
        usedRepair: true,
        capabilities: lastCapabilities
      };
    }

    lastErrorSummary = formatZodErrors(validation.error);
  } catch (repairErr) {
    if (repairErr instanceof SyntaxError) {
      lastErrorSummary = `Repair pass returned invalid JSON: ${repairErr.message}`;
    } else if (repairErr instanceof Error) {
      lastErrorSummary = `Repair pass failed: ${repairErr.message}`;
    }
  }

  const latencyMs = Date.now() - startTime;
  const { estimatedCostUsd } = estimateCostUsd(lastModel, totalInputTokens, totalOutputTokens);
  await safeLogUsage(logger, {
    userId,
    taskType,
    provider,
    model: lastModel,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    latencyMs,
    estimatedCostUsd,
    retryCount,
    usedRepair: true,
    status: 'error',
    errorCode: 'ZOD_VALIDATION_FAILED'
  });

  throw new LlmValidationError(
    `LLM structured output failed schema validation for ${request.schemaName} after ${retryCount} retries and repair pass`,
    {
      provider,
      model: lastModel,
      zodErrors: lastErrorSummary,
      rawOutput: lastRawText
    }
  );
}
