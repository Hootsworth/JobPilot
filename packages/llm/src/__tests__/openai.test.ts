import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { OpenAIAdapter, type OpenAiClientLike } from '../adapters/openai.js';

const PersonSchema = z.object({
  name: z.string().min(1),
  years: z.number().int().min(0)
});

describe('OpenAIAdapter', () => {
  it('lists live chat models without hardcoding IDs', async () => {
    const mockClient: OpenAiClientLike = {
      models: {
        list: vi.fn(async () => ({
          data: [
            { id: 'text-embedding-3-small', owned_by: 'openai' },
            { id: 'gpt-test-chat-1', owned_by: 'openai' },
            { id: 'whisper-1', owned_by: 'openai' },
            { id: 'gpt-test-chat-2', owned_by: 'openai' }
          ]
        }))
      },
      chat: { completions: { create: vi.fn() } }
    };

    const adapter = new OpenAIAdapter({ provider: 'openai', apiKey: 'sk-test' }, mockClient);
    const models = await adapter.listModels();

    expect(models.map((m) => m.id)).toEqual(['gpt-test-chat-1', 'gpt-test-chat-2']);
  });

  it('sends strict json_schema and downgrades to json_object when rejected', async () => {
    const createMock = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('Invalid parameter: json_schema unsupported'), { status: 400 }))
      .mockResolvedValueOnce({
        model: 'gpt-live-1',
        choices: [{ message: { content: '{"name":"Aarav","years":2}' } }],
        usage: { prompt_tokens: 40, completion_tokens: 15 }
      });

    const mockClient: OpenAiClientLike = {
      models: {
        list: vi.fn(async () => ({ data: [{ id: 'gpt-live-1' }] }))
      },
      chat: { completions: { create: createMock } }
    };

    const adapter = new OpenAIAdapter({ provider: 'openai', apiKey: 'sk-test' }, mockClient);
    const result = await adapter.generateStructured({
      schema: PersonSchema,
      schemaName: 'person_profile',
      userPrompt: 'Extract Aarav, 2 years'
    });

    expect(result.data).toEqual({ name: 'Aarav', years: 2 });
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(createMock.mock.calls[0]?.[0]?.['response_format']).toMatchObject({ type: 'json_schema' });
    expect(createMock.mock.calls[1]?.[0]?.['response_format']).toEqual({ type: 'json_object' });
    expect(adapter.getCapabilities('gpt-live-1')?.structuredOutputMode).toBe('json_object');
  });

  it('testKey verifies live models and executes a minimal call', async () => {
    const mockClient: OpenAiClientLike = {
      models: {
        list: vi.fn(async () => ({ data: [{ id: 'live-model-alpha' }] }))
      },
      chat: {
        completions: {
          create: vi.fn(async () => ({
            model: 'live-model-alpha',
            choices: [{ message: { content: 'OK' } }],
            usage: { prompt_tokens: 5, completion_tokens: 1 }
          }))
        }
      }
    };

    const adapter = new OpenAIAdapter({ provider: 'openai', apiKey: 'sk-test' }, mockClient);
    const testResult = await adapter.testKey();

    expect(testResult.ok).toBe(true);
    expect(testResult.modelTested).toBe('live-model-alpha');
    expect(testResult.modelsCount).toBe(1);
  });
});
