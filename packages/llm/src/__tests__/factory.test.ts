import { describe, expect, it } from 'vitest';
import { GeminiAdapter } from '../adapters/gemini.js';
import { MetaLlamaAdapter } from '../adapters/meta.js';
import { OpenAIAdapter } from '../adapters/openai.js';
import { createLlmProviderFromEnv } from '../factory.js';
import { LlmProviderError } from '../types.js';

describe('createLlmProviderFromEnv', () => {
  it('switches across openai, gemini, and meta with zero code changes', () => {
    const openai = createLlmProviderFromEnv({
      LLM_PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-test'
    });
    expect(openai).toBeInstanceOf(OpenAIAdapter);
    expect(openai.providerId).toBe('openai');

    const gemini = createLlmProviderFromEnv({
      LLM_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'gm-test'
    });
    expect(gemini).toBeInstanceOf(GeminiAdapter);
    expect(gemini.providerId).toBe('gemini');

    const meta = createLlmProviderFromEnv({
      LLM_PROVIDER: 'meta',
      META_API_KEY: 'llama-test',
      META_BASE_URL: 'https://custom.llama.test/compat/v1'
    });
    expect(meta).toBeInstanceOf(MetaLlamaAdapter);
    expect((meta as MetaLlamaAdapter).baseUrl).toBe('https://custom.llama.test/compat/v1/');
  });

  it('throws clear errors on invalid provider or missing key', () => {
    expect(() =>
      createLlmProviderFromEnv({ LLM_PROVIDER: 'anthropic' })
    ).toThrow(LlmProviderError);

    expect(() =>
      createLlmProviderFromEnv({ LLM_PROVIDER: 'meta', META_API_KEY: '' })
    ).toThrow(LlmProviderError);
  });
});
