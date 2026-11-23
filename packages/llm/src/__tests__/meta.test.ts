import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { MetaLlamaAdapter, resolveMetaBaseUrl, type MetaOpenAiClientLike } from '../adapters/meta.js';
import { DEFAULT_META_BASE_URL } from '../types.js';

const OutputSchema = z.object({
  city: z.string().min(1),
  lpa: z.number()
});

describe('MetaLlamaAdapter', () => {
  it('defaults to https://api.llama.com/compat/v1/ and respects META_BASE_URL overrides', () => {
    expect(DEFAULT_META_BASE_URL).toBe('https://api.llama.com/compat/v1/');
    expect(resolveMetaBaseUrl(undefined, {})).toBe('https://api.llama.com/compat/v1/');
    expect(resolveMetaBaseUrl(undefined, { META_BASE_URL: 'https://proxy.example.com/v1' })).toBe(
      'https://proxy.example.com/v1/'
    );
    expect(
      resolveMetaBaseUrl('https://custom.llama.endpoint/compat/v1', {
        META_BASE_URL: 'https://ignored.example.com/v1'
      })
    ).toBe('https://custom.llama.endpoint/compat/v1/');
  });

  it('tolerates preview /models payload variations', async () => {
    const mockClient: MetaOpenAiClientLike = {
      models: {
        list: vi.fn(async () => ({
          items: [
            { name: 'Llama-4-Preview-A', owner: 'meta' },
            { id: 'Llama-4-Preview-B', owned_by: 'meta' }
          ]
        }))
      },
      chat: { completions: { create: vi.fn() } }
    };

    const adapter = new MetaLlamaAdapter({ provider: 'meta', apiKey: 'llama-key' }, mockClient);
    const models = await adapter.listModels();

    expect(models.map((m) => m.id)).toEqual(['Llama-4-Preview-A', 'Llama-4-Preview-B']);
  });

  it('feature-detects and downgrades max_completion_tokens, temperature, and response_format cleanly', async () => {
    const createMock = vi
      .fn()
      // 1st attempt rejects max_completion_tokens
      .mockRejectedValueOnce(
        Object.assign(new Error('Unknown field: max_completion_tokens'), { status: 400 })
      )
      // 2nd attempt rejects json_schema response_format
      .mockRejectedValueOnce(
        Object.assign(new Error('Unsupported parameter: response_format json_schema'), { status: 422 })
      )
      // 3rd attempt rejects json_object response_format
      .mockRejectedValueOnce(
        Object.assign(new Error('Unsupported response_format json_object'), { status: 400 })
      )
      // 4th attempt succeeds using prompt-enforced JSON + max_tokens
      .mockResolvedValueOnce({
        model: 'Llama-Preview-X',
        choices: [
          {
            message: {
              content: [{ type: 'text', text: '{"city":"Bengaluru","lpa":18}' }]
            }
          }
        ],
        usage: { prompt_tokens: 55, completion_tokens: 18 }
      });

    const mockClient: MetaOpenAiClientLike = {
      models: {
        list: vi.fn(async () => ({ data: [{ id: 'Llama-Preview-X' }] }))
      },
      chat: { completions: { create: createMock } }
    };

    const adapter = new MetaLlamaAdapter({ provider: 'meta', apiKey: 'llama-key' }, mockClient);
    const res = await adapter.generateStructured({
      schema: OutputSchema,
      schemaName: 'salary_target',
      userPrompt: 'Bengaluru 18 LPA',
      maxTokens: 256,
      temperature: 0.2
    });

    expect(res.data).toEqual({ city: 'Bengaluru', lpa: 18 });
    expect(createMock).toHaveBeenCalledTimes(4);
    expect(createMock.mock.calls[3]?.[0]?.['max_tokens']).toBe(256);
    expect(createMock.mock.calls[3]?.[0]?.['max_completion_tokens']).toBeUndefined();
    expect(createMock.mock.calls[3]?.[0]?.['response_format']).toBeUndefined();

    const cachedCaps = adapter.getCapabilities('Llama-Preview-X');
    expect(cachedCaps).toMatchObject({
      structuredOutputMode: 'prompt_json',
      tokenLimitParam: 'max_tokens',
      supportsTemperature: true
    });
  });
});
