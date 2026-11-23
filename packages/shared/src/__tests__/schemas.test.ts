import { describe, expect, it } from 'vitest';
import {
  ApplicationRecordSchema,
  CaptureExtensionJobRequestSchema,
  CreateManualApplicationRequestSchema,
  createEmptyIndiaProfile,
  createEmptyJsonResume,
  DetectedFormFieldSchema,
  DraftAnswersRequestSchema,
  FallbackFillRequestSchema,
  FallbackFillResponseSchema,
  FillPlanItemSchema,
  formatLpa,
  formatSalaryRange,
  IndiaProfileSchema,
  JobFeedQuerySchema,
  JobMatchSchema,
  JsonResumeSchema,
  LlmMatchRerankOutputSchema,
  NormalizedJobInputSchema,
  ProfileStorySchema,
  SeedBoardSchema,
  TailorLlmOutputSchema,
  TailorResumeRequestSchema,
  toInrLpa,
  UpdateApplicationRequestSchema,
  VerifierReportSchema
} from '../index.js';

describe('@jobpilot/shared schemas & utilities', () => {
  it('creates valid empty JSON Resume & India profile defaults', () => {
    const resume = createEmptyJsonResume();
    const india = createEmptyIndiaProfile();

    expect(JsonResumeSchema.parse(resume).work).toEqual([]);
    expect(IndiaProfileSchema.parse(india).ctcCurrency).toBe('INR');
    expect(india.cgpaScale).toBe(10);
    expect(india.activeBacklogs).toBe(0);
  });

  it('validates India-specific bounds', () => {
    const valid = IndiaProfileSchema.parse({
      currentCtcLpa: 8.5,
      expectedCtcLpa: 14,
      noticePeriodDays: 30,
      isServingNotice: true,
      preferredCities: ['Bengaluru', 'Pune'],
      willingToRelocate: true,
      isFresher: false,
      internshipStatus: 'completed_internship',
      cgpa: 8.74,
      cgpaScale: 10,
      collegeName: 'NIT Trichy',
      tenthPercentage: 95.2,
      twelfthPercentage: 94.0
    });
    expect(valid.collegeName).toBe('NIT Trichy');

    expect(() =>
      IndiaProfileSchema.parse({ currentCtcLpa: -2 })
    ).toThrow();
    expect(() =>
      IndiaProfileSchema.parse({ tenthPercentage: 105 })
    ).toThrow();
  });

  it('validates story bank metrics', () => {
    const story = ProfileStorySchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      userId: '22222222-2222-4222-8222-222222222222',
      title: 'Reduced API p95 latency',
      category: 'optimization',
      action: 'Introduced Redis caching and indexed slow Postgres queries.',
      result: 'Cut p95 latency by 62% during peak traffic.',
      metrics: [{ label: 'p95 latency reduction', value: '62', unit: '%' }],
      skillsUsed: ['PostgreSQL', 'Redis', 'Node.js'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    expect(story.metrics[0]?.value).toBe('62');
  });

  it('converts foreign and Indian currencies into LPA accurately', () => {
    expect(toInrLpa(1_200_000, 'INR', 'year')).toBe(12);
    expect(toInrLpa(100_000, 'INR', 'month')).toBe(12);
    expect(toInrLpa(100_000, 'USD', 'year')).toBe(84);
    expect(formatLpa(12.5)).toBe('12.5 LPA');
    expect(formatSalaryRange(null, null, 'INR', 12, 18)).toBe('12 LPA – 18 LPA');
  });

  it('validates normalized job inputs, job matches, feed queries, and seed boards', () => {
    const job = NormalizedJobInputSchema.parse({
      sourceType: 'greenhouse',
      externalId: 'gh-42',
      sourceUrl: 'https://boards.greenhouse.io/razorpay/jobs/42',
      applyUrl: 'https://boards.greenhouse.io/razorpay/jobs/42#app',
      companyName: 'Razorpay',
      title: 'Software Development Engineer 1',
      locationRaw: 'Bengaluru, India',
      city: 'Bengaluru',
      countryCode: 'IN',
      workMode: 'hybrid',
      seniority: 'junior',
      salaryMinLpa: 14,
      salaryMaxLpa: 22,
      extractedSkills: ['Node.js', 'PostgreSQL']
    });
    expect(job.workMode).toBe('hybrid');

    const match = JobMatchSchema.parse({
      jobId: '11111111-1111-4111-8111-111111111111',
      profileVersion: 2,
      hardFilterPassed: true,
      vectorSimilarity: 0.87,
      llmScore: 91,
      matchReason: 'Strong Node.js + Postgres match in Bengaluru within LPA expectations.',
      matchedSkills: ['Node.js', 'PostgreSQL'],
      skillGaps: ['Kafka'],
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      computedAt: new Date().toISOString()
    });
    expect(match.llmScore).toBe(91);

    const query = JobFeedQuerySchema.parse({ onlyPassed: 'true', minSalaryLpa: '12' });
    expect(query.onlyPassed).toBe(true);
    expect(query.minSalaryLpa).toBe(12);

    const seed = SeedBoardSchema.parse({
      sourceType: 'lever',
      slug: 'browserstack',
      displayName: 'BrowserStack',
      regionFocus: 'india'
    });
    expect(seed.enabled).toBe(true);

    const rerank = LlmMatchRerankOutputSchema.parse({
      results: [
        {
          jobId: '11111111-1111-4111-8111-111111111111',
          score: 88,
          oneLineReason: 'Direct backend fit.',
          matchedSkills: ['TypeScript'],
          skillGaps: ['Go']
        }
      ]
    });
    expect(rerank.results[0]?.score).toBe(88);
  });

  it('validates tailoring request, LLM output, and verifier report schemas', () => {
    expect(() => TailorResumeRequestSchema.parse({ templateId: 'ats-classic' })).toThrow();
    const req = TailorResumeRequestSchema.parse({
      customJob: {
        title: 'Backend Engineer',
        companyName: 'Acme',
        description: 'Build reliable Node.js and PostgreSQL microservices with TypeScript.'
      }
    });
    expect(req.autoRepairFlagged).toBe(true);

    const out = TailorLlmOutputSchema.parse({
      summary: 'Backend engineer skilled in TypeScript.',
      selectedWork: [
        {
          sourceId: 'work-1',
          name: 'FinTech',
          position: 'Intern',
          startDate: '2025-05',
          endDate: '2025-07',
          highlights: ['Built TypeScript APIs']
        }
      ],
      reorderedSkills: [{ name: 'Backend', level: '', keywords: ['TypeScript', 'PostgreSQL'] }]
    });
    expect(out.selectedWork[0]?.sourceId).toBe('work-1');

    const report = VerifierReportSchema.parse({
      passed: true,
      deterministicPassed: true,
      llmVerifierPassed: true,
      totalClaimsChecked: 3,
      unsupportedClaimCount: 0,
      immutableFieldViolations: 0,
      unsupportedClaimRate: 0,
      claims: []
    });
    expect(report.passed).toBe(true);
  });

  it('validates Phase 4 extension field detection, fill plan, draft answers, and capture schemas', () => {
    const field = DetectedFormFieldSchema.parse({
      fieldId: 'gh-email',
      atsAdapter: 'greenhouse',
      controlType: 'email',
      canonicalKey: 'email',
      label: 'Email',
      confidence: 0.98
    });
    expect(field.framePath).toBe('top');

    const item = FillPlanItemSchema.parse({
      fieldId: 'gh-email',
      canonicalKey: 'email',
      controlType: 'email',
      proposedValue: 'dev@iit.ac.in',
      displayValue: 'dev@iit.ac.in',
      confidence: 0.98,
      source: 'profile'
    });
    expect(item.included).toBe(true);

    const draftReq = DraftAnswersRequestSchema.parse({
      jobTitle: 'Backend Engineer',
      companyName: 'Razorpay',
      questions: [{ fieldId: 'q1', label: 'Why Razorpay?' }]
    });
    expect(draftReq.questions).toHaveLength(1);

    const capture = CaptureExtensionJobRequestSchema.parse({
      sourceType: 'naukri',
      sourceUrl: 'https://www.naukri.com/job-listings-123',
      title: 'Backend Engineer',
      companyName: 'Razorpay',
      salaryText: '18-24 LPA'
    });
    expect(capture.sourceType).toBe('naukri');
    expect(capture.salaryText).toBe('18-24 LPA');

    const fbReq = FallbackFillRequestSchema.parse({
      atsAdapter: 'workday',
      jobTitle: 'SDE 1',
      companyName: 'Atlassian',
      fields: [{ fieldId: 'wd-1', label: 'How did you hear about us?', controlType: 'select' }]
    });
    expect(fbReq.atsAdapter).toBe('workday');

    const fbRes = FallbackFillResponseSchema.parse({
      usedLlm: true,
      suggestions: [
        {
          fieldId: 'wd-1',
          canonicalKey: 'unknown',
          proposedValue: 'LinkedIn',
          confidence: 0.78,
          rationale: 'Matches standard referral choice',
          groundedIn: 'profile'
        }
      ]
    });
    expect(fbRes.suggestions[0]?.confidence).toBeLessThanOrEqual(0.85);
  });

  it('validates Phase 6 application tracker schemas', () => {
    const manual = CreateManualApplicationRequestSchema.parse({
      title: 'SDE 1 Backend',
      companyName: 'Razorpay',
      sourceUrl: 'https://razorpay.com/jobs/sde1',
      status: 'applied',
      resumeVersionId: '11111111-1111-4111-8111-111111111111',
      nextFollowUpAt: '2026-12-01T10:00:00.000Z',
      followUpNote: 'Ping hiring manager on LinkedIn',
      salaryOffered: '20 LPA'
    });
    expect(manual.status).toBe('applied');

    const patch = UpdateApplicationRequestSchema.parse({
      status: 'interview',
      notes: 'Cleared online assessment'
    });
    expect(patch.status).toBe('interview');

    const rec = ApplicationRecordSchema.parse({
      id: '22222222-2222-4222-8222-222222222222',
      userId: '33333333-3333-4333-8333-333333333333',
      jobId: '44444444-4444-4444-8444-444444444444',
      resumeVersionId: '11111111-1111-4111-8111-111111111111',
      status: 'interview',
      appliedAt: '2026-11-23T12:00:00.000Z',
      nextFollowUpAt: '2026-12-01T10:00:00.000Z',
      followUpNote: 'Follow up with HR',
      salaryOffered: '20 LPA',
      notes: 'Round 1 scheduled',
      sourceChannel: 'web',
      createdAt: '2026-11-23T12:00:00.000Z',
      updatedAt: '2026-11-23T12:00:00.000Z',
      job: {
        id: '44444444-4444-4444-8444-444444444444',
        title: 'SDE 1 Backend',
        companyName: 'Razorpay',
        locationRaw: 'Bengaluru, India',
        sourceType: 'greenhouse',
        sourceUrl: 'https://razorpay.com/jobs/sde1',
        applyUrl: 'https://razorpay.com/jobs/sde1',
        salaryMinLpa: 18,
        salaryMaxLpa: 24
      },
      resumeVersion: {
        id: '11111111-1111-4111-8111-111111111111',
        versionNumber: 2,
        label: 'Razorpay — SDE 1 Backend',
        verifierPassed: true,
        templateId: 'ats-classic'
      }
    });
    expect(rec.resumeVersion?.versionNumber).toBe(2);
  });
});

