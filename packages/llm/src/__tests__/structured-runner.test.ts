import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { runStructuredWithRetryAndRepair } from '../structured-runner.js';
import { LlmValidationError, type LlmCallLogEntry } from '../types.js';

const ItemSchema = z.object({
  title: z.string().min(3),
  count: z.number().int().min(1)
});

describe('runStructuredWithRetryAndRepair', () => {
  it('retries with Zod error feedback and succeeds without repair', async () => {
    const logs: LlmCallLogEntry[] = [];
    const callModel = vi
      .fn()
      // Attempt 0: missing count, invalid title
      .mockResolvedValueOnce({
        text: '```json\n{"title":"a"}\n```',
        model: 'test-model',
        inputTokens: 20,
        outputTokens: 10
      })
      // Attempt 1: fixed after Zod error feedback
      .mockResolvedValueOnce({
        text: '{"title":"Engineer","count":3}',
        model: 'test-model',
        inputTokens: 35,
        outputTokens: 12
      });

    const result = await runStructuredWithRetryAndRepair({
      provider: 'gemini',
      userId: 'user-1',
      logger: (entry) => {
        logs.push(entry);
      },
      request: {
        schema: ItemSchema,
        schemaName: 'item_schema',
        userPrompt: 'Extract item',
        maxRetries: 2,
        taskType: 'resume_parse'
      },
      callModel
    });

    expect(result.data).toEqual({ title: 'Engineer', count: 3 });
    expect(result.retryCount).toBe(1);
    expect(result.usedRepair).toBe(false);
    expect(callModel).toHaveBeenCalledTimes(2);
    expect(callModel.mock.calls[1]?.[0]?.userPrompt).toContain('Validation errors:');
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      provider: 'gemini',
      model: 'test-model',
      inputTokens: 55,
      outputTokens: 22,
      retryCount: 1,
      usedRepair: false,
      status: 'ok'
    });
  });

  it('falls back to a dedicated repair prompt when retries are exhausted', async () => {
    const logs: LlmCallLogEntry[] = [];
    const callModel = vi.fn().mockResolvedValue({
      text: 'Not valid json at all',
      model: 'test-model',
      inputTokens: 10,
      outputTokens: 5
    });

    const repairModel = vi.fn().mockResolvedValue({
      text: '{"title":"Backend Intern","count":1}',
      model: 'test-model',
      inputTokens: 30,
      outputTokens: 12
    });

    const result = await runStructuredWithRetryAndRepair({
      provider: 'meta',
      logger: (entry) => {
        logs.push(entry);
      },
      request: {
        schema: ItemSchema,
        schemaName: 'item_schema',
        userPrompt: 'Extract item',
        maxRetries: 1,
        taskType: 'jd_extract'
      },
      callModel,
      repairModel
    });

    expect(result.data).toEqual({ title: 'Backend Intern', count: 1 });
    expect(result.usedRepair).toBe(true);
    expect(result.retryCount).toBe(1);
    expect(callModel).toHaveBeenCalledTimes(2);
    expect(repairModel).toHaveBeenCalledTimes(1);
    expect(logs[0]?.usedRepair).toBe(true);
    expect(logs[0]?.status).toBe('ok');
  });

  it('throws LlmValidationError and logs error if repair also fails', async () => {
    const logs: LlmCallLogEntry[] = [];
    const callModel = vi.fn().mockResolvedValue({
      text: '{"title":"x","count":-1}',
      model: 'test-model',
      inputTokens: 10,
      outputTokens: 5
    });

    await expect(
      runStructuredWithRetryAndRepair({
        provider: 'openai',
        logger: (entry) => {
          logs.push(entry);
        },
        request: {
          schema: ItemSchema,
          schemaName: 'item_schema',
          userPrompt: 'Extract item',
          maxRetries: 1
        },
        callModel
      })
    ).rejects.toBeInstanceOf(LlmValidationError);

    expect(logs).toHaveLength(1);
    expect(logs[0]?.status).toBe('error');
    expect(logs[0]?.errorCode).toBe('ZOD_VALIDATION_FAILED');
  });
});
