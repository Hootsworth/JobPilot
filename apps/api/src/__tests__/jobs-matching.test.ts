import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL_NAME, EMBEDDING_MODEL_VERSION } from '@jobpilot/embeddings';
import { dedupeNormalizedJobs, type JobForMatching } from '@jobpilot/ingestion';
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

  it('syncs public discovery feeds on demand, auto-populates tiered home recommendations, and learns from company dismissals', async () => {
    const store = new MemoryDataStore();
    const userId = '22222222-2222-4222-8222-222222222222';
    const headers = { authorization: 'Bearer valid-jwt' };

    const syncedBundles = dedupeNormalizedJobs([
      {
        sourceType: 'greenhouse',
        externalId: 'sync-1',
        sourceUrl: 'https://boards.greenhouse.io/razorpay/jobs/1',
        applyUrl: 'https://boards.greenhouse.io/razorpay/jobs/1#app',
        companyName: 'Razorpay',
        companyDomain: null,
        companyLogoUrl: null,
        title: 'Backend Engineer (SDE-1)',
        normalizedTitle: 'backend engineer sde 1',
        locationRaw: 'Bengaluru, India',
        city: 'Bengaluru',
        countryCode: 'IN',
        workMode: 'hybrid',
        seniority: 'junior',
        experienceMinYears: 0,
        experienceMaxYears: 2,
        salaryMin: 1_500_000,
        salaryMax: 2_000_000,
        salaryCurrency: 'INR',
        salaryPeriod: 'year',
        salaryMinLpa: 15,
        salaryMaxLpa: 20,
        descriptionRaw: 'TypeScript, Node.js, PostgreSQL',
        descriptionClean: 'Build TypeScript, Node.js, PostgreSQL backend services.',
        extractedSkills: ['TypeScript', 'Node.js', 'PostgreSQL'],
        postedAt: new Date().toISOString()
      },
      {
        sourceType: 'himalayas',
        externalId: 'sync-2',
        sourceUrl: 'https://himalayas.app/jobs/2',
        applyUrl: 'https://himalayas.app/jobs/2',
        companyName: 'RemoteCloud',
        companyDomain: null,
        companyLogoUrl: null,
        title: 'Software Engineer',
        normalizedTitle: 'software engineer',
        locationRaw: 'Remote (Worldwide)',
        city: null,
        countryCode: 'US',
        workMode: 'remote',
        seniority: 'junior',
        experienceMinYears: 0,
        experienceMaxYears: 2,
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: null,
        salaryPeriod: null,
        salaryMinLpa: null,
        salaryMaxLpa: null,
        descriptionRaw: 'TypeScript remote product APIs',
        descriptionClean: 'TypeScript and Node.js remote product engineering.',
        extractedSkills: ['TypeScript', 'Node.js'],
        postedAt: new Date().toISOString()
      },
      {
        sourceType: 'lever',
        externalId: 'sync-3',
        sourceUrl: 'https://jobs.lever.co/dismisscorp/3',
        applyUrl: 'https://jobs.lever.co/dismisscorp/3/apply',
        companyName: 'DismissCorp',
        companyDomain: null,
        companyLogoUrl: null,
        title: 'Software Engineer I',
        normalizedTitle: 'software engineer i',
        locationRaw: 'Bengaluru, India',
        city: 'Bengaluru',
        countryCode: 'IN',
        workMode: 'hybrid',
        seniority: 'junior',
        experienceMinYears: 0,
        experienceMaxYears: 2,
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: null,
        salaryPeriod: null,
        salaryMinLpa: null,
        salaryMaxLpa: null,
        descriptionRaw: 'TypeScript backend',
        descriptionClean: 'Build TypeScript backend APIs.',
        extractedSkills: ['TypeScript'],
        postedAt: new Date().toISOString()
      },
      {
        sourceType: 'lever',
        externalId: 'sync-4',
        sourceUrl: 'https://jobs.lever.co/dismisscorp/4',
        applyUrl: 'https://jobs.lever.co/dismisscorp/4/apply',
        companyName: 'DismissCorp',
        companyDomain: null,
        companyLogoUrl: null,
        title: 'Platform Backend Engineer',
        normalizedTitle: 'platform backend engineer',
        locationRaw: 'Bengaluru, India',
        city: 'Bengaluru',
        countryCode: 'IN',
        workMode: 'hybrid',
        seniority: 'junior',
        experienceMinYears: 0,
        experienceMaxYears: 2,
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: null,
        salaryPeriod: null,
        salaryMinLpa: null,
        salaryMaxLpa: null,
        descriptionRaw: 'TypeScript and PostgreSQL platform',
        descriptionClean: 'Build TypeScript and PostgreSQL services.',
        extractedSkills: ['TypeScript', 'PostgreSQL'],
        postedAt: new Date().toISOString()
      },
      {
        sourceType: 'greenhouse',
        externalId: 'sync-5',
        sourceUrl: 'https://boards.greenhouse.io/bigco/jobs/5',
        applyUrl: 'https://boards.greenhouse.io/bigco/jobs/5',
        companyName: 'BigCo',
        companyDomain: null,
        companyLogoUrl: null,
        title: 'Senior Backend Engineer',
        normalizedTitle: 'senior backend engineer',
        locationRaw: 'Bengaluru, India',
        city: 'Bengaluru',
        countryCode: 'IN',
        workMode: 'hybrid',
        seniority: 'senior',
        experienceMinYears: 5,
        experienceMaxYears: 8,
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: null,
        salaryPeriod: null,
        salaryMinLpa: null,
        salaryMaxLpa: null,
        descriptionRaw: 'TypeScript and Node.js systems',
        descriptionClean: 'Lead TypeScript and Node.js services.',
        extractedSkills: ['TypeScript', 'Node.js'],
        postedAt: new Date().toISOString()
      }
    ]);

    const app = await buildApp({
      config: loadConfig({ APP_ENCRYPTION_KEY: randomBytes(32).toString('hex') }),
      store,
      authVerifier: {
        verifyToken: async (jwt) =>
          jwt === 'valid-jwt' ? { id: userId, email: 'dev@iit.ac.in', fullName: 'Dev' } : null
      },
      syncRunner: async () => ({
        bundles: syncedBundles,
        sourceUpdates: [
          {
            sourceType: 'greenhouse',
            slug: 'razorpay',
            displayName: 'Razorpay',
            regionFocus: 'india',
            enabled: true,
            etag: null,
            lastModified: null,
            lastCrawledAt: new Date().toISOString(),
            lastStatus: 'ok:1',
            consecutiveFailures: 0,
            jobsCount: 1,
            failed: false
          }
        ],
        stats: {
          mode: 'quick',
          boardsSelected: 1,
          boardsTotal: 1,
          boardSuccess: 1,
          boardFailures: 0,
          aggregatorCount: 1,
          rawJobsCount: syncedBundles.length,
          dedupedCount: syncedBundles.length
        }
      }),
      enableLogger: false
    });

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

    const statusBefore = await app.inject({ method: 'GET', url: '/api/jobs/sync/status', headers });
    expect(statusBefore.statusCode).toBe(200);
    expect(statusBefore.json()).toMatchObject({ isStale: true, totalActiveJobs: 0 });

    const syncRes = await app.inject({
      method: 'POST',
      url: '/api/jobs/sync',
      headers,
      payload: { mode: 'quick' }
    });
    expect(syncRes.statusCode).toBe(200);
    expect(syncRes.json()).toMatchObject({
      skipped: false,
      insertedCount: 5,
      syncStatus: { isStale: false, totalActiveJobs: 5 }
    });

    // Bump profile version cleanly so /recommendations exercises inline auto-matching
    await app.inject({
      method: 'PUT',
      url: '/api/profile',
      headers,
      payload: { fullName: 'Dev Ready' }
    });

    const rec1 = await app.inject({ method: 'GET', url: '/api/jobs/recommendations', headers });
    expect(rec1.statusCode).toBe(200);
    const rec1Body = rec1.json();
    expect(rec1Body.autoMatchedCount).toBe(5);
    expect(rec1Body.counts.forYou).toBe(4);
    expect(rec1Body.counts.fresh).toBe(4);
    expect(rec1Body.counts.india).toBe(3);
    expect(rec1Body.counts.remote).toBe(1);
    expect(rec1Body.counts.nearMatches).toBe(1);
    expect(rec1Body.buckets.nearMatches[0].match.llmScore).toBeGreaterThan(0);

    // Cached second call skips recomputation
    const rec2 = await app.inject({ method: 'GET', url: '/api/jobs/recommendations', headers });
    expect(rec2.json().autoMatchedCount).toBe(0);

    // Dismiss one DismissCorp job with reason='company' -> down-ranks sibling DismissCorp job
    const dismissTarget = rec2
      .json()
      .buckets.forYou.find((i: { job: { title: string } }) => i.job.title === 'Software Engineer I');
    const siblingBefore = rec2
      .json()
      .buckets.forYou.find(
        (i: { job: { title: string } }) => i.job.title === 'Platform Backend Engineer'
      );

    const dismissRes = await app.inject({
      method: 'POST',
      url: `/api/jobs/${dismissTarget.job.id}/dismiss`,
      headers,
      payload: { dismissed: true, reason: 'company' }
    });
    expect(dismissRes.statusCode).toBe(200);

    await app.inject({
      method: 'POST',
      url: '/api/jobs/match/refresh',
      headers,
      payload: { forceRecompute: true, topKLlm: 0, topKVector: 100 }
    });

    const rec3 = await app.inject({ method: 'GET', url: '/api/jobs/recommendations', headers });
    expect(rec3.json().counts.forYou).toBe(3);
    const siblingAfter = rec3
      .json()
      .buckets.forYou.find(
        (i: { job: { title: string } }) => i.job.title === 'Platform Backend Engineer'
      );
    expect(siblingAfter.match.llmScore).toBeLessThan(siblingBefore.match.llmScore);
  });
});
