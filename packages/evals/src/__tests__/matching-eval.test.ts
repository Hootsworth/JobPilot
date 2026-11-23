import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  evaluateHardFilters,
  runThreeStageMatching,
  type JobForMatching
} from '@jobpilot/ingestion';
import {
  createEmptyIndiaProfile,
  createEmptyJsonResume,
  JobRecordSchema,
  type MasterProfile
} from '@jobpilot/shared';
import { computeHardFilterMetrics, computeNdcgAtK } from '../metrics.js';

interface GoldenDataset {
  profiles: Array<{
    profileId: string;
    fullName: string;
    activeProfileVersion: number;
    jsonResume: Record<string, unknown>;
    indiaProfile: Record<string, unknown>;
    searchPreferences: Record<string, unknown>;
  }>;
  cases: Array<{
    profileId: string;
    expectedHardFilterPass: boolean;
    relevanceTier: number;
    job: Record<string, unknown>;
  }>;
}

function hydrateProfile(raw: GoldenDataset['profiles'][number]): MasterProfile {
  const baseResume = createEmptyJsonResume();
  const baseIndia = createEmptyIndiaProfile();
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    fullName: raw.fullName,
    email: 'eval@jobpilot.dev',
    phone: null,
    activeProfileVersion: raw.activeProfileVersion,
    jsonResume: { ...baseResume, ...(raw.jsonResume as object) } as MasterProfile['jsonResume'],
    indiaProfile: { ...baseIndia, ...(raw.indiaProfile as object) } as MasterProfile['indiaProfile'],
    searchPreferences: raw.searchPreferences as MasterProfile['searchPreferences'],
    sourceResumeStoragePath: null,
    embeddingModel: null,
    embeddingModelVersion: null,
    embeddedAt: null,
    telemetryOptIn: false,
    onboardingCompletedAt: null,
    updatedAt: new Date().toISOString()
  };
}

function hydrateJob(raw: Record<string, unknown>): JobForMatching {
  const parsed = JobRecordSchema.parse({
    dedupeFingerprint: `eval-${raw['id']}`,
    sourceType: 'greenhouse',
    sourceUrl: `https://boards.greenhouse.io/eval/jobs/${raw['id']}`,
    lastSeenAt: new Date().toISOString(),
    ...raw
  });
  return { ...parsed, embedding: null };
}

describe('@jobpilot/evals matching regression harness', () => {
  it('achieves 100% hard-filter accuracy and NDCG@10 >= 0.85 across hand-labeled India + global set', async () => {
    const raw = JSON.parse(
      readFileSync(resolve(__dirname, '../../fixtures/matching/golden-india-global.json'), 'utf8')
    ) as GoldenDataset;

    const filterPredictions: Array<{ expectedPass: boolean; actualPass: boolean }> = [];

    for (const pRaw of raw.profiles) {
      const profile = hydrateProfile(pRaw);
      const profileCases = raw.cases.filter((c) => c.profileId === pRaw.profileId);
      const jobs = profileCases.map((c) => hydrateJob(c.job));
      const relevanceMap = new Map<string, number>();

      for (let i = 0; i < profileCases.length; i++) {
        const c = profileCases[i]!;
        const job = jobs[i]!;
        const hf = evaluateHardFilters(profile, job);
        filterPredictions.push({
          expectedPass: c.expectedHardFilterPass,
          actualPass: hf.passed
        });
        relevanceMap.set(job.id, c.relevanceTier);
      }

      const result = await runThreeStageMatching({
        profile,
        jobs,
        topKVector: 20,
        topKLlm: 20
      });

      const orderedIds = result.matches
        .sort((a, b) => {
          if (a.hardFilterPassed !== b.hardFilterPassed) return a.hardFilterPassed ? -1 : 1;
          return (b.llmScore ?? 0) - (a.llmScore ?? 0);
        })
        .map((m) => m.jobId);

      const ndcg10 = computeNdcgAtK(orderedIds, relevanceMap, 10);
      expect(ndcg10).toBeGreaterThanOrEqual(0.85);
    }

    const hfMetrics = computeHardFilterMetrics(filterPredictions);
    expect(hfMetrics.accuracy).toBe(1);
    expect(hfMetrics.falsePositives).toBe(0);
    expect(hfMetrics.falseNegatives).toBe(0);
  });
});
