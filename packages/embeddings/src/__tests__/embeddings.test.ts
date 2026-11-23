import { describe, expect, it, vi } from 'vitest';
import { createEmptyIndiaProfile, createEmptyJsonResume } from '@jobpilot/shared';
import {
  BGE_QUERY_PREFIX,
  buildProfileEmbeddingText,
  cosineSimilarity,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL_NAME,
  EMBEDDING_MODEL_VERSION,
  LocalBgeEmbedder,
  sha256Text
} from '../index.js';

function unitVec(seed: number): number[] {
  const vec = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, idx) =>
    idx === seed ? 1 : 0
  );
  return vec;
}

describe('@jobpilot/embeddings', () => {
  it('attaches fixed bge-small model metadata and batches document calls', async () => {
    const mockExtractor = vi.fn(async (inputs: string[]) => ({
      tolist: () => inputs.map((_, i) => unitVec(i))
    }));

    const embedder = new LocalBgeEmbedder({
      extractor: mockExtractor,
      batchSize: 2
    });

    const out = await embedder.embedDocuments(['doc 1', 'doc 2', 'doc 3']);

    expect(mockExtractor).toHaveBeenCalledTimes(2);
    expect(mockExtractor.mock.calls[0]?.[0]).toEqual(['doc 1', 'doc 2']);
    expect(mockExtractor.mock.calls[1]?.[0]).toEqual(['doc 3']);
    expect(out).toHaveLength(3);
    expect(out[0]?.model).toBe(EMBEDDING_MODEL_NAME);
    expect(out[0]?.version).toBe(EMBEDDING_MODEL_VERSION);
    expect(out[0]?.dimensions).toBe(EMBEDDING_DIMENSIONS);
  });

  it('prepends the BGE query retrieval prefix on embedQuery()', async () => {
    const mockExtractor = vi.fn(async (inputs: string[]) => ({
      tolist: () => inputs.map(() => unitVec(0))
    }));

    const embedder = new LocalBgeEmbedder({ extractor: mockExtractor });
    await embedder.embedQuery('backend intern bengaluru');

    expect(mockExtractor).toHaveBeenCalledWith(
      [`${BGE_QUERY_PREFIX}backend intern bengaluru`],
      { pooling: 'mean', normalize: true }
    );
  });

  it('serializes master profile text deterministically for embedding hash checks', () => {
    const resume = createEmptyJsonResume();
    resume.basics.label = 'Backend Engineer';
    resume.skills = [{ name: 'Languages', level: '', keywords: ['TypeScript', 'Python'] }];
    const india = createEmptyIndiaProfile();
    india.preferredCities = ['Bengaluru'];

    const text = buildProfileEmbeddingText(resume, india);
    expect(text).toContain('Backend Engineer');
    expect(text).toContain('TypeScript, Python');
    expect(text).toContain('Bengaluru');
    expect(sha256Text(text)).toBe(sha256Text(text));
  });

  it('computes cosine similarity accurately', () => {
    expect(cosineSimilarity(unitVec(0), unitVec(0))).toBeCloseTo(1);
    expect(cosineSimilarity(unitVec(0), unitVec(1))).toBeCloseTo(0);
  });
});
