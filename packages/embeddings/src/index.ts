import { createHash } from 'node:crypto';
import type { IndiaProfile, JsonResume, ProfileStory } from '@jobpilot/shared';

export const EMBEDDING_MODEL_NAME = 'BAAI/bge-small-en-v1.5';
export const EMBEDDING_ONNX_ID = 'Xenova/bge-small-en-v1.5';
export const EMBEDDING_MODEL_VERSION = 'onnx-q8-v1';
export const EMBEDDING_DIMENSIONS = 384;
export const BGE_QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

export interface EmbeddingVectorResult {
  vector: number[];
  model: string;
  version: string;
  dimensions: number;
}

export type FeatureExtractorFn = (
  inputs: string[],
  options: { pooling: 'mean'; normalize: boolean }
) => Promise<{ tolist(): unknown }>;

export interface LocalBgeEmbedderOptions {
  modelId?: string;
  modelName?: string;
  modelVersion?: string;
  extractor?: FeatureExtractorFn;
  batchSize?: number;
}

export class LocalBgeEmbedder {
  readonly modelName: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly dimensions = EMBEDDING_DIMENSIONS;
  private readonly defaultBatchSize: number;
  private extractorPromise: Promise<FeatureExtractorFn> | null = null;
  private injectedExtractor?: FeatureExtractorFn;

  constructor(options: LocalBgeEmbedderOptions = {}) {
    this.modelName = options.modelName ?? EMBEDDING_MODEL_NAME;
    this.modelId = options.modelId ?? EMBEDDING_ONNX_ID;
    this.modelVersion = options.modelVersion ?? EMBEDDING_MODEL_VERSION;
    this.defaultBatchSize = options.batchSize ?? 16;
    this.injectedExtractor = options.extractor;
  }

  private async getExtractor(): Promise<FeatureExtractorFn> {
    if (this.injectedExtractor) return this.injectedExtractor;
    if (!this.extractorPromise) {
      this.extractorPromise = (async () => {
        const transformers = await import('@huggingface/transformers');
        const pipe = await transformers.pipeline('feature-extraction', this.modelId, {
          dtype: 'q8'
        });
        return pipe as unknown as FeatureExtractorFn;
      })();
    }
    return this.extractorPromise;
  }

  async embedDocuments(
    texts: string[],
    batchSize: number = this.defaultBatchSize
  ): Promise<EmbeddingVectorResult[]> {
    if (texts.length === 0) return [];
    const extractor = await this.getExtractor();
    const results: EmbeddingVectorResult[] = [];
    const step = Math.max(1, batchSize);

    for (let i = 0; i < texts.length; i += step) {
      const slice = texts.slice(i, i + step).map((t) => t.trim() || ' ');
      const tensor = await extractor(slice, { pooling: 'mean', normalize: true });
      const rows = tensor.tolist();
      if (!Array.isArray(rows)) {
        throw new Error('Unexpected feature-extraction output shape from bge-small');
      }
      for (const row of rows) {
        if (!Array.isArray(row)) {
          throw new Error('Expected 2D vector array from batch feature-extraction');
        }
        const vector = row.map((v) => Number(v));
        if (vector.length !== this.dimensions) {
          throw new Error(
            `Expected ${this.dimensions} dimensions from ${this.modelName}, got ${vector.length}`
          );
        }
        results.push({
          vector,
          model: this.modelName,
          version: this.modelVersion,
          dimensions: this.dimensions
        });
      }
    }

    return results;
  }

  async embedQuery(query: string): Promise<EmbeddingVectorResult> {
    const prefixed = `${BGE_QUERY_PREFIX}${query.trim()}`;
    const [result] = await this.embedDocuments([prefixed], 1);
    if (!result) {
      throw new Error('Failed to generate query embedding');
    }
    return result;
  }
}

export function buildProfileEmbeddingText(
  jsonResume: JsonResume,
  indiaProfile?: IndiaProfile,
  stories: ProfileStory[] = []
): string {
  const parts: string[] = [];
  if (jsonResume.basics.label) parts.push(`Headline: ${jsonResume.basics.label}`);
  if (jsonResume.basics.summary) parts.push(`Summary: ${jsonResume.basics.summary}`);

  if (jsonResume.skills.length > 0) {
    const skillText = jsonResume.skills
      .map((group) => `${group.name}: ${group.keywords.join(', ')}`)
      .join(' | ');
    parts.push(`Skills: ${skillText}`);
  }

  if (jsonResume.work.length > 0) {
    const workText = jsonResume.work
      .map(
        (w) =>
          `${w.position} at ${w.name} (${w.startDate} - ${w.endDate || 'Present'}): ${w.summary} ${w.highlights.join('; ')}`
      )
      .join('\n');
    parts.push(`Experience:\n${workText}`);
  }

  if (jsonResume.projects.length > 0) {
    const projText = jsonResume.projects
      .map(
        (p) =>
          `${p.name}: ${p.description} [${(p.keywords ?? []).join(', ')}] ${p.highlights.join('; ')}`
      )
      .join('\n');
    parts.push(`Projects:\n${projText}`);
  }

  if (jsonResume.education.length > 0) {
    const eduText = jsonResume.education
      .map((e) => `${e.studyType} ${e.area} at ${e.institution}`)
      .join('; ');
    parts.push(`Education: ${eduText}`);
  }

  if (indiaProfile) {
    if (indiaProfile.preferredCities.length > 0) {
      parts.push(`Preferred Locations: ${indiaProfile.preferredCities.join(', ')}`);
    }
    if (indiaProfile.degree || indiaProfile.branch) {
      parts.push(`Academic Background: ${indiaProfile.degree} ${indiaProfile.branch}`.trim());
    }
  }

  if (stories.length > 0) {
    const storyText = stories
      .map((s) => `${s.title} (${s.skillsUsed.join(', ')}): ${s.action} ${s.result}`)
      .join('\n');
    parts.push(`Key Stories:\n${storyText}`);
  }

  return parts.join('\n\n').trim();
}

export function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    const va = a[i] ?? 0;
    const vb = b[i] ?? 0;
    dot += va * vb;
    magA += va * va;
    magB += vb * vb;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}
