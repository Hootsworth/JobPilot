import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { GeminiAdapter, type GeminiClientLike } from '../adapters/gemini.js';

const CandidateSchema = z.object({
  college: z.string().min(1),
  cgpa: z.number().nullable()
});

describe('GeminiAdapter', () => {
  it('lists live models and filters to generateContent-capable models', async () => {
    const mockClient: GeminiClientLike = {
      models: {
        list: vi.fn(async () => ({
          async *[Symbol.asyncIterator]() {
            yield {
              name: 'models/text-embedding-004',
              displayName: 'Embedding',
              supportedActions: ['embedContent']
            };
            yield {
              name: 'models/gemini-live-flash',
              displayName: 'Gemini Live Flash',
              supportedActions: ['generateContent']
            };
          }
        })),
        generateContent: vi.fn()
      }
    };

    const adapter = new GeminiAdapter({ provider: 'gemini', apiKey: 'gm-test' }, mockClient);
    const models = await adapter.listModels();

    expect(models).toEqual([
      {
        id: 'gemini-live-flash',
        displayName: 'Gemini Live Flash',
        ownedBy: 'google',
        description: undefined,
        supportsStructuredHint: true
      }
    ]);
  });

  it('uses responseMimeType and responseSchema for structured outputs', async () => {
    const generateContent = vi.fn(async () => ({
      text: '{"college":"IIT Bombay","cgpa":9.1}',
      usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 12 }
    }));

    const mockClient: GeminiClientLike = {
      models: {
        list: vi.fn(async () => ({
          async *[Symbol.asyncIterator]() {
            yield { name: 'models/gemini-live-pro', supportedActions: ['generateContent'] };
          }
        })),
        generateContent
      }
    };

    const adapter = new GeminiAdapter({ provider: 'gemini', apiKey: 'gm-test' }, mockClient);
    const res = await adapter.generateStructured({
      schema: CandidateSchema,
      schemaName: 'candidate',
      userPrompt: 'IIT Bombay, CGPA 9.1'
    });

    expect(res.data).toEqual({ college: 'IIT Bombay', cgpa: 9.1 });
    const callArg = generateContent.mock.calls[0]?.[0];
    expect(callArg?.model).toBe('gemini-live-pro');
    expect(callArg?.config?.['responseMimeType']).toBe('application/json');
    expect(callArg?.config?.['responseSchema']).toMatchObject({
      type: 'OBJECT',
      properties: {
        college: { type: 'STRING' },
        cgpa: { type: 'NUMBER', nullable: true }
      }
    });
  });

  it('testKey checks live list and generateContent', async () => {
    const mockClient: GeminiClientLike = {
      models: {
        list: vi.fn(async () => ({
          async *[Symbol.asyncIterator]() {
            yield { name: 'models/gemini-live-flash', supportedActions: ['generateContent'] };
          }
        })),
        generateContent: vi.fn(async () => ({
          text: 'OK',
          usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 1 }
        }))
      }
    };

    const adapter = new GeminiAdapter({ provider: 'gemini', apiKey: 'gm-test' }, mockClient);
    const res = await adapter.testKey();

    expect(res.ok).toBe(true);
    expect(res.modelTested).toBe('gemini-live-flash');
    expect(res.modelsCount).toBe(1);
  });
});
