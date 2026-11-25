import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { dedupeNormalizedJobs } from '@jobpilot/ingestion';
import { NormalizedJobInputSchema } from '@jobpilot/shared';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { MemoryDataStore } from '../store/memory-store.js';

describe('Jobs Velocity: Saved Searches & Company Watchlist Boards', () => {
  it('creates, lists with live counts, marks seen, and deletes saved job searches without bumping profile version', async () => {
    const store = new MemoryDataStore();
    const userId = '11111111-1111-4111-8111-111111111111';
    const headers = { authorization: 'Bearer valid-jwt' };

    const app = await buildApp({
      config: loadConfig({ APP_ENCRYPTION_KEY: randomBytes(32).toString('hex') }),
      store,
      authVerifier: {
        verifyToken: async (jwt) => (jwt === 'valid-jwt' ? { id: userId, fullName: 'Riya' } : null)
      },
      enableLogger: false
    });

    const initialProfileRes = await app.inject({ method: 'GET', url: '/api/profile', headers });
    const initialVersion = initialProfileRes.json().activeProfileVersion;

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/jobs/saved-searches',
      headers,
      payload: {
        name: 'Bengaluru Remote TS',
        q: 'TypeScript',
        workMode: 'remote',
        onlyPassed: true,
        sortBy: 'match_score'
      }
    });

    expect(createRes.statusCode).toBe(201);
    const created = createRes.json();
    expect(created.name).toBe('Bengaluru Remote TS');

    const profileAfterRes = await app.inject({ method: 'GET', url: '/api/profile', headers });
    expect(profileAfterRes.json().activeProfileVersion).toBe(initialVersion);

    // Seed an older and a newer matching job cleanly
    const futurePostedAt = new Date(Date.now() + 60_000).toISOString();
    const bundles = dedupeNormalizedJobs([
      NormalizedJobInputSchema.parse({
        sourceType: 'greenhouse',
        externalId: 'ts-remote-1',
        sourceUrl: 'https://boards.greenhouse.io/acme/jobs/1',
        applyUrl: 'https://boards.greenhouse.io/acme/jobs/1',
        companyName: 'Acme',
        title: 'Senior TypeScript Engineer',
        normalizedTitle: 'senior typescript engineer',
        locationRaw: 'Bengaluru (Remote)',
        city: 'Bengaluru',
        countryCode: 'IN',
        workMode: 'remote',
        seniority: 'senior',
        employmentType: 'full_time',
        careerCategory: 'software_engineering',
        boardKey: 'greenhouse:acme',
        descriptionRaw: 'TypeScript Node.js',
        descriptionClean: 'TypeScript Node.js backend systems',
        extractedSkills: ['TypeScript', 'Node.js'],
        postedAt: futurePostedAt
      })
    ]);
    await store.upsertPublicJobsBatch(bundles);

    const listRes = await app.inject({ method: 'GET', url: '/api/jobs/saved-searches', headers });
    expect(listRes.statusCode).toBe(200);
    const listBody = listRes.json();
    expect(listBody.items).toHaveLength(1);
    expect(listBody.items[0].matchCount).toBe(1);
    expect(listBody.items[0].newCount).toBe(1);

    const seenRes = await app.inject({
      method: 'POST',
      url: `/api/jobs/saved-searches/${created.id}/seen`,
      headers,
      payload: {}
    });
    expect(seenRes.statusCode).toBe(200);

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/jobs/saved-searches/${created.id}`,
      headers
    });
    expect(delRes.statusCode).toBe(200);

    const emptyRes = await app.inject({ method: 'GET', url: '/api/jobs/saved-searches', headers });
    expect(emptyRes.json().items).toHaveLength(0);
  });

  it('tracks valid ATS company boards on demand and rejects unsupported or failing board URLs', async () => {
    const store = new MemoryDataStore();
    const userId = '22222222-2222-4222-8222-222222222222';
    const headers = { authorization: 'Bearer valid-jwt' };

    const syncRunner = vi.fn(async (params) => {
      const board = params.boards?.[0];
      if (!board || board.slug === 'broken-board') {
        return {
          bundles: [],
          sourceUpdates: [
            {
              sourceType: board?.sourceType ?? 'greenhouse',
              slug: board?.slug ?? 'broken-board',
              displayName: board?.displayName ?? 'Broken',
              regionFocus: 'india',
              enabled: true,
              etag: null,
              lastModified: null,
              lastCrawledAt: new Date().toISOString(),
              lastStatus: 'error:404',
              consecutiveFailures: 1,
              jobsCount: 0,
              failed: true
            }
          ],
          reconcilableBoards: [],
          stats: {
            mode: 'full' as const,
            boardsSelected: 1,
            boardsTotal: 1,
            boardsSkippedCooldown: 0,
            boardSuccess: 0,
            boardFailures: 1,
            aggregatorCount: 0,
            rawJobsCount: 0,
            dedupedCount: 0
          }
        };
      }

      const bundles = dedupeNormalizedJobs([
        NormalizedJobInputSchema.parse({
          sourceType: 'greenhouse',
          externalId: 'gh-razorpay-101',
          sourceUrl: 'https://boards.greenhouse.io/razorpay/jobs/101',
          applyUrl: 'https://boards.greenhouse.io/razorpay/jobs/101',
          companyName: 'Razorpay',
          title: 'Backend Engineer',
          normalizedTitle: 'backend engineer',
          locationRaw: 'Bengaluru, India',
          city: 'Bengaluru',
          countryCode: 'IN',
          workMode: 'hybrid',
          seniority: 'junior',
          employmentType: 'full_time',
          careerCategory: 'software_engineering',
          boardKey: 'greenhouse:razorpay',
          descriptionRaw: 'Go PostgreSQL Kafka',
          descriptionClean: 'Go PostgreSQL Kafka payments infrastructure',
          extractedSkills: ['Go', 'PostgreSQL'],
          postedAt: new Date().toISOString()
        })
      ]);

      return {
        bundles,
        sourceUpdates: [
          {
            sourceType: board.sourceType,
            slug: board.slug,
            displayName: board.displayName,
            regionFocus: board.regionFocus,
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
        reconcilableBoards: [
          {
            boardKey: `${board.sourceType}:${board.slug}`,
            activeExternalIds: ['gh-razorpay-101']
          }
        ],
        stats: {
          mode: 'full' as const,
          boardsSelected: 1,
          boardsTotal: 1,
          boardsSkippedCooldown: 0,
          boardSuccess: 1,
          boardFailures: 0,
          aggregatorCount: 0,
          rawJobsCount: 1,
          dedupedCount: bundles.length
        }
      };
    });

    const app = await buildApp({
      config: loadConfig({ APP_ENCRYPTION_KEY: randomBytes(32).toString('hex') }),
      store,
      authVerifier: {
        verifyToken: async (jwt) => (jwt === 'valid-jwt' ? { id: userId, fullName: 'Aarav' } : null)
      },
      syncRunner,
      enableLogger: false
    });

    const invalidRes = await app.inject({
      method: 'POST',
      url: '/api/jobs/sources/boards',
      headers,
      payload: {
        boardUrl: 'https://example.com/careers',
        regionFocus: 'india'
      }
    });
    expect(invalidRes.statusCode).toBe(400);

    const brokenRes = await app.inject({
      method: 'POST',
      url: '/api/jobs/sources/boards',
      headers,
      payload: {
        boardUrl: 'https://boards.greenhouse.io/broken-board',
        regionFocus: 'india'
      }
    });
    expect(brokenRes.statusCode).toBe(400);

    const okRes = await app.inject({
      method: 'POST',
      url: '/api/jobs/sources/boards',
      headers,
      payload: {
        boardUrl: 'https://boards.greenhouse.io/razorpay',
        regionFocus: 'india'
      }
    });
    expect(okRes.statusCode).toBe(201);
    const body = okRes.json();
    expect(body.source).toMatchObject({
      sourceType: 'greenhouse',
      slug: 'razorpay',
      displayName: 'Razorpay',
      enabled: true
    });
    expect(body.syncedJobsCount).toBe(1);
    expect(body.insertedCount).toBe(1);

    const feedRes = await app.inject({ method: 'GET', url: '/api/jobs?q=Razorpay', headers });
    expect(feedRes.statusCode).toBe(200);
    expect(feedRes.json().items.length).toBeGreaterThanOrEqual(1);
  });
});
