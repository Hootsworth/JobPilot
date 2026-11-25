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
import {
  computeEducationAndStageBoost,
  computeRoleTitleRelevance,
  computeStretchScore,
  evaluateHardFilters,
  runThreeStageMatching,
  type JobForMatching
} from '../index.js';

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
    employmentType: 'full_time',
    fresherEligible: null,
    stipendMonthlyInr: null,
    careerCategory: 'software_engineering',
    boardKey: null,
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

  it('scores without embeddings using role relevance, produces non-zero stretch scores, upgrades heuristic matches with LLM, and preserves company dismiss penalties', async () => {
    const profile = makeProfile();
    const roleMatchJob = makeJob('00000000-0000-4000-8000-000000000011', {
      title: 'Server Software Engineer (SDE-1)',
      companyName: 'DismissedCorp',
      embedding: null
    });
    const stretchJob = makeJob('00000000-0000-4000-8000-000000000012', {
      title: 'Backend Engineer',
      city: 'Chennai',
      workMode: 'onsite',
      embedding: null
    });

    expect(computeRoleTitleRelevance(profile, roleMatchJob)).toBeGreaterThan(0.5);
    expect(computeStretchScore(0.6, ['City mismatch'])).toBeGreaterThan(20);

    // Day-1 auto-match without embeddings & without LLM
    const heuristicRun = await runThreeStageMatching({
      profile,
      jobs: [roleMatchJob, stretchJob],
      profileEmbedding: null,
      existingMatchesByJobId: new Map([
        [
          roleMatchJob.id,
          {
            jobId: roleMatchJob.id,
            profileVersion: 3,
            hardFilterPassed: true,
            hardFilterReasons: ['dismiss_reason:company'],
            vectorSimilarity: null,
            llmScore: null,
            matchReason: null,
            matchedSkills: [],
            skillGaps: [],
            provider: null,
            model: null,
            dismissed: true,
            computedAt: new Date().toISOString()
          }
        ]
      ]),
      dismissedCompanies: new Set(['dismissedcorp'])
    });

    const autoMatch = heuristicRun.matches.find((m) => m.jobId === roleMatchJob.id)!;
    const stretchMatch = heuristicRun.matches.find((m) => m.jobId === stretchJob.id)!;
    expect(autoMatch.provider).toBeNull();
    expect(autoMatch.llmScore).toBeGreaterThanOrEqual(15);
    expect(autoMatch.hardFilterReasons).toContain('dismiss_reason:company');
    expect(stretchMatch.hardFilterPassed).toBe(false);
    expect(stretchMatch.llmScore).toBeGreaterThan(0);
    expect(stretchMatch.llmScore).toBeLessThanOrEqual(68);

    // Heuristic-only match gets upgraded when LLM provider is supplied
    const generateStructured = vi.fn(async () => ({
      data: {
        results: [
          {
            jobId: roleMatchJob.id,
            score: 88,
            oneLineReason: 'Upgraded by LLM.',
            matchedSkills: ['TypeScript'],
            skillGaps: []
          }
        ]
      },
      provider: 'gemini' as const,
      model: 'gemini-live',
      inputTokens: 50,
      outputTokens: 30,
      latencyMs: 60,
      estimatedCostUsd: 0.0001,
      retryCount: 0,
      usedRepair: false
    }));

    const llmUpgradeRun = await runThreeStageMatching({
      profile,
      jobs: [roleMatchJob],
      profileEmbedding: null,
      existingMatchesByJobId: new Map([[roleMatchJob.id, autoMatch]]),
      llmProvider: {
        providerId: 'gemini',
        generateStructured
      } as unknown as LlmProvider
    });

    expect(generateStructured).toHaveBeenCalledTimes(1);
    const upgraded = llmUpgradeRun.matches.find((m) => m.jobId === roleMatchJob.id)!;
    expect(upgraded.provider).toBe('gemini');
    expect(upgraded.llmScore).toBe(88);
    expect(upgraded.hardFilterReasons).toContain('dismiss_reason:company');
  });

  it('scores cybersecurity aliases and boosts internship/fresher matches based on graduation stage', () => {
    const internProfile = makeProfile();
    internProfile.jsonResume.basics.label = 'Security Analyst';
    internProfile.jsonResume.work = [];
    internProfile.indiaProfile.internshipStatus = 'seeking_internship';
    internProfile.indiaProfile.graduationYear = new Date().getFullYear() + 1;
    internProfile.searchPreferences.targetRoles = ['Cybersecurity Analyst'];
    internProfile.searchPreferences.minSalaryLpa = null;
    internProfile.jsonResume.skills = [
      { name: 'Security', level: '', keywords: ['Python', 'AppSec', 'Kubernetes'] }
    ];

    const secIntern = makeJob('sec-intern', {
      title: 'Application Security Intern',
      normalizedTitle: 'application security intern',
      seniority: 'intern',
      employmentType: 'internship',
      fresherEligible: true,
      stipendMonthlyInr: 45000,
      salaryMin: null,
      salaryMax: null,
      salaryMinLpa: null,
      salaryMaxLpa: null,
      extractedSkills: ['Python', 'AppSec', 'Kubernetes'],
      careerCategory: 'cybersecurity'
    });

    expect(computeRoleTitleRelevance(internProfile, secIntern)).toBeGreaterThan(0.5);
    expect(computeEducationAndStageBoost(internProfile, secIntern)).toBe(6);
  });
});
