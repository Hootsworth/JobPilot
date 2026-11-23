import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL_NAME, EMBEDDING_MODEL_VERSION } from '@jobpilot/embeddings';
import type { JobForMatching } from '@jobpilot/ingestion';
import type { LlmProvider } from '@jobpilot/llm';
import type { LlmProviderId } from '@jobpilot/shared';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { AuthVerifier } from '../plugins/auth.js';
import { MemoryDataStore } from '../store/memory-store.js';

function makeSeedJob(id: string, overrides: Partial<JobForMatching> = {}): JobForMatching {
  return {
    id,
    ownerUserId: null,
    dedupeFingerprint: `fp-${id}`,
    sourceType: 'greenhouse',
    externalId: id,
    sourceUrl: `https://boards.greenhouse.io/razorpay/jobs/${id}`,
    applyUrl: `https://boards.greenhouse.io/razorpay/jobs/${id}#app`,
    companyName: 'Razorpay',
    companyDomain: null,
    companyLogoUrl: null,
    title: 'Software Engineer 1 (Backend)',
    normalizedTitle: 'software engineer 1 backend',
    locationRaw: 'Bengaluru, India',
    city: 'Bengaluru',
    countryCode: 'IN',
    workMode: 'hybrid',
    seniority: 'junior',
    experienceMinYears: 0,
    experienceMaxYears: 2,
    salaryMin: 1_400_000,
    salaryMax: 2_000_000,
    salaryCurrency: 'INR',
    salaryPeriod: 'year',
    salaryMinLpa: 14,
    salaryMaxLpa: 20,
    descriptionClean: 'Build TypeScript, Node.js, PostgreSQL, and Kafka microservices.',
    extractedSkills: ['TypeScript', 'Node.js', 'PostgreSQL', 'Kafka'],
    postedAt: new Date().toISOString(),
    isActive: true,
    lastSeenAt: new Date().toISOString(),
    embeddingModel: EMBEDDING_MODEL_NAME,
    embeddingModelVersion: EMBEDDING_MODEL_VERSION,
    embeddedAt: new Date().toISOString(),
    sightingsCount: 1,
    embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? 1 : 0)),
    ...overrides
  };
}

describe('Phase 2 API: Jobs feed, 3-stage matching, caching, save & dismiss', () => {
  it('filters jobs, caches LLM scores per profile version, invalidates on profile edit, and supports save/dismiss', async () => {
    const store = new MemoryDataStore();
    const userId = '11111111-1111-4111-8111-111111111111';
    const headers = { authorization: 'Bearer valid-jwt' };

    const j1 = makeSeedJob('20000000-0000-4000-8000-000000000001');
    const j2 = makeSeedJob('20000000-0000-4000-8000-000000000002', {
      companyName: 'LowPay India',
      title: 'Backend Trainee',
      salaryMinLpa: 4,
      salaryMaxLpa: 6
    });
    const j3 = makeSeedJob('20000000-0000-4000-8000-000000000003', {
      companyName: 'Linear',
      title: 'Product Engineer',
      locationRaw: 'Remote',
      city: null,
      countryCode: 'US',
      workMode: 'remote',
      extractedSkills: ['TypeScript', 'React', 'GraphQL']
    });
    store.seedJobsForTest([j1, j2, j3]);

    const generateStructured = vi.fn(async (req: { userPrompt: string }) => {
      const results = [];
      if (req.userPrompt.includes(j1.id)) {
        results.push({
          jobId: j1.id,
          score: 93,
          oneLineReason: 'Strong Bengaluru Node.js + Postgres fit.',
          matchedSkills: ['TypeScript', 'Node.js', 'PostgreSQL'],
          skillGaps: ['Kafka']
        });
      }
      if (req.userPrompt.includes(j3.id)) {
        results.push({
          jobId: j3.id,
          score: 81,
          oneLineReason: 'Remote TypeScript match.',
          matchedSkills: ['TypeScript'],
          skillGaps: ['GraphQL']
        });
      }
      return {
        data: { results },
        provider: 'gemini' as const,
        model: 'gemini-live',
        inputTokens: 100,
        outputTokens: 50,
        latencyMs: 90,
        estimatedCostUsd: 0.0001,
        retryCount: 0,
        usedRepair: false
      };
    });

    const app = await buildApp({
      config: loadConfig({
        APP_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
        LLM_PROVIDER: 'gemini',
        GEMINI_API_KEY: 'gm-server-key'
      }),
      store,
      authVerifier: {
        verifyToken: async (jwt) =>
          jwt === 'valid-jwt' ? { id: userId, email: 'dev@iit.ac.in', fullName: 'Dev' } : null
      },
      providerFactory: (cfg: { provider: LlmProviderId }) =>
        ({
          providerId: cfg.provider,
          generateStructured
        }) as unknown as LlmProvider,
      enableLogger: false
    });

    // Configure India profile (expected 12 LPA + Global Remote allowed)
    await app.inject({
      method: 'PUT',
      url: '/api/profile',
      headers,
      payload: {
        jsonResume: {
          basics: { name: 'Dev', label: 'Backend Engineer' },
          work: [],
          education: [],
          projects: [],
          skills: [{ name: 'Stack', level: '', keywords: ['TypeScript', 'Node.js', 'PostgreSQL'] }]
        },
        indiaProfile: {
          expectedCtcLpa: 12,
          preferredCities: ['Bengaluru', 'Remote (Global)'],
          willingToRelocate: false,
          isFresher: true
        }
      }
    });

    // 1st refresh runs LLM re-rank for passing jobs (j1 + j3); j2 fails LPA hard filter
    const refresh1 = await app.inject({ method: 'POST', url: '/api/jobs/match/refresh', headers });
    expect(refresh1.statusCode).toBe(200);
    expect(refresh1.json().stats).toMatchObject({
      hardFilterPassed: 2,
      hardFilterFailed: 1,
      llmScored: 2
    });
    expect(generateStructured).toHaveBeenCalledTimes(1);

    // 2nd refresh on SAME profileVersion reuses cache with ZERO new LLM calls
    const refresh2 = await app.inject({ method: 'POST', url: '/api/jobs/match/refresh', headers });
    expect(refresh2.statusCode).toBe(200);
    expect(refresh2.json().stats.reusedFromCache).toBe(2);
    expect(generateStructured).toHaveBeenCalledTimes(1);

    // Feed filtering returns passing jobs sorted by match score
    const feedRes = await app.inject({
      method: 'GET',
      url: '/api/jobs?onlyPassed=true&minSalaryLpa=12',
      headers
    });
    expect(feedRes.statusCode).toBe(200);
    const feedBody = feedRes.json();
    expect(feedBody.items).toHaveLength(2);
    expect(feedBody.items[0].job.id).toBe(j1.id);
    expect(feedBody.items[0].match.llmScore).toBe(93);
    expect(feedBody.items[0].match.skillGaps).toEqual(['Kafka']);

    // Save j1 & dismiss j3
    const saveRes = await app.inject({
      method: 'POST',
      url: `/api/jobs/${j1.id}/save`,
      headers
    });
    expect(saveRes.statusCode).toBe(200);
    expect(saveRes.json().status).toBe('saved');

    const dismissRes = await app.inject({
      method: 'POST',
      url: `/api/jobs/${j3.id}/dismiss`,
      headers,
      payload: { dismissed: true }
    });
    expect(dismissRes.statusCode).toBe(200);

    const afterFeed = await app.inject({
      method: 'GET',
      url: '/api/jobs?onlyPassed=true',
      headers
    });
    expect(afterFeed.json().items).toHaveLength(1);
    expect(afterFeed.json().items[0].applicationStatus).toBe('saved');

    // Editing profile bumps activeProfileVersion -> invalidates cache cleanly
    await app.inject({
      method: 'PUT',
      url: '/api/profile',
      headers,
      payload: { fullName: 'Dev Updated' }
    });

    const refresh3 = await app.inject({ method: 'POST', url: '/api/jobs/match/refresh', headers });
    expect(refresh3.statusCode).toBe(200);
    expect(refresh3.json().stats.reusedFromCache).toBe(0);
    expect(generateStructured).toHaveBeenCalledTimes(2);
  });
});
