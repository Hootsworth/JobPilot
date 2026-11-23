import { describe, expect, it, vi } from 'vitest';
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL_NAME,
  EMBEDDING_MODEL_VERSION
} from '@jobpilot/embeddings';
import type { LlmProvider } from '@jobpilot/llm';
import {
  createEmptyIndiaProfile,
  createEmptyJsonResume,
  type JobMatch,
  type MasterProfile
} from '@jobpilot/shared';
import { evaluateHardFilters, runThreeStageMatching, type JobForMatching } from '../index.js';

function makeProfile(overrides: Partial<MasterProfile> = {}): MasterProfile {
  const jsonResume = createEmptyJsonResume();
  jsonResume.basics.label = 'Backend Engineer';
  jsonResume.skills = [{ name: 'Stack', level: '', keywords: ['TypeScript', 'Node.js', 'PostgreSQL', 'Redis'] }];
  jsonResume.work = [
    {
      id: 'w1',
      name: 'Startup',
      position: 'Software Engineer Intern',
      url: '',
      location: 'Bengaluru',
      employmentType: 'Internship',
      startDate: '2025-05',
      endDate: '2025-07',
      summary: '',
      highlights: ['Built Fastify APIs']
    }
  ];

  const indiaProfile = createEmptyIndiaProfile();
  indiaProfile.expectedCtcLpa = 12;
  indiaProfile.preferredCities = ['Bengaluru', 'Pune'];
  indiaProfile.willingToRelocate = false;
  indiaProfile.isFresher = true;

  return {
    id: '11111111-1111-4111-8111-111111111111',
    fullName: 'Aarav',
    email: 'aarav@example.com',
    phone: null,
    activeProfileVersion: 3,
    jsonResume,
    indiaProfile,
    searchPreferences: {
      targetRoles: ['Backend Engineer'],
      workModes: ['remote', 'hybrid', 'onsite'],
      seniorityLevels: ['intern', 'fresher', 'junior'],
      countries: ['IN'],
      minSalaryLpa: 10,
      minExperienceYears: null,
      maxExperienceYears: 2
    },
    sourceResumeStoragePath: null,
    embeddingModel: EMBEDDING_MODEL_NAME,
    embeddingModelVersion: EMBEDDING_MODEL_VERSION,
    embeddedAt: null,
    telemetryOptIn: false,
    onboardingCompletedAt: null,
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

function makeJob(id: string, overrides: Partial<JobForMatching> = {}): JobForMatching {
  return {
    id,
    ownerUserId: null,
    dedupeFingerprint: `fp-${id}`,
    sourceType: 'greenhouse',
    externalId: id,
    sourceUrl: `https://boards.greenhouse.io/demo/jobs/${id}`,
    applyUrl: `https://boards.greenhouse.io/demo/jobs/${id}#app`,
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
    salaryMin: 1_200_000,
    salaryMax: 1_800_000,
    salaryCurrency: 'INR',
    salaryPeriod: 'year',
    salaryMinLpa: 12,
    salaryMaxLpa: 18,
    descriptionClean: 'Build TypeScript, Node.js, PostgreSQL, Kafka services.',
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

describe('@jobpilot/ingestion 3-stage matching', () => {
  it('enforces India LPA, relocation, seniority, and experience hard filters', () => {
    const profile = makeProfile();
    const goodJob = makeJob('00000000-0000-4000-8000-000000000001');
    expect(evaluateHardFilters(profile, goodJob).passed).toBe(true);

    const lowLpa = makeJob('00000000-0000-4000-8000-000000000002', { salaryMaxLpa: 6 });
    expect(evaluateHardFilters(profile, lowLpa).passed).toBe(false);

    const wrongCity = makeJob('00000000-0000-4000-8000-000000000003', {
      city: 'Chennai',
      workMode: 'onsite'
    });
    expect(evaluateHardFilters(profile, wrongCity).passed).toBe(false);

    const tooSenior = makeJob('00000000-0000-4000-8000-000000000004', {
      seniority: 'staff',
      experienceMinYears: 8
    });
    expect(evaluateHardFilters(profile, tooSenior).passed).toBe(false);
  });

  it('runs vector retrieval + LLM re-rank and skips cached (jobId, profileVersion) matches', async () => {
    const profile = makeProfile();
    const job1 = makeJob('00000000-0000-4000-8000-000000000001');
    const job2 = makeJob('00000000-0000-4000-8000-000000000002', {
      title: 'Cached Job',
      embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 1 ? 1 : 0))
    });
    const failedJob = makeJob('00000000-0000-4000-8000-000000000003', { salaryMaxLpa: 5 });

    const cachedMatch: JobMatch = {
      jobId: job2.id,
      profileVersion: 3,
      hardFilterPassed: true,
      hardFilterReasons: [],
      vectorSimilarity: 0.7,
      llmScore: 84,
      matchReason: 'Cached result from previous run.',
      matchedSkills: ['TypeScript'],
      skillGaps: ['Kafka'],
      provider: 'gemini',
      model: 'gemini-live',
      dismissed: false,
      computedAt: new Date().toISOString()
    };

    const generateStructured = vi.fn(async () => ({
      data: {
        results: [
          {
            jobId: job1.id,
            score: 92,
            oneLineReason: 'Direct Node.js + Postgres fit in Bengaluru.',
            matchedSkills: ['TypeScript', 'Node.js', 'PostgreSQL'],
            skillGaps: ['Kafka']
          }
        ]
      },
      provider: 'gemini' as const,
      model: 'gemini-live',
      inputTokens: 120,
      outputTokens: 45,
      latencyMs: 110,
      estimatedCostUsd: 0.0001,
      retryCount: 0,
      usedRepair: false
    }));

    const mockLlm = {
      providerId: 'gemini',
      generateStructured
    } as unknown as LlmProvider;

    const result = await runThreeStageMatching({
      profile,
      jobs: [job1, job2, failedJob],
      profileEmbedding: {
        vector: Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? 1 : 0)),
        model: EMBEDDING_MODEL_NAME,
        version: EMBEDDING_MODEL_VERSION
      },
      existingMatchesByJobId: new Map([[job2.id, cachedMatch]]),
      llmProvider: mockLlm
    });

    expect(result.stats).toMatchObject({
      totalEvaluated: 3,
      hardFilterPassed: 2,
      hardFilterFailed: 1,
      reusedFromCache: 1,
      llmScored: 1
    });
    expect(generateStructured).toHaveBeenCalledTimes(1);
    const j1Match = result.matches.find((m) => m.jobId === job1.id);
    expect(j1Match?.llmScore).toBe(92);
    expect(j1Match?.skillGaps).toEqual(['Kafka']);
  });
});
