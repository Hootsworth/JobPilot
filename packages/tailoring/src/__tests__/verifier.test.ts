import { describe, expect, it } from 'vitest';
import {
  createEmptyIndiaProfile,
  createEmptyJsonResume,
  type MasterProfile,
  type ProfileStory
} from '@jobpilot/shared';
import { runDeterministicVerification } from '../index.js';

function makeTestProfile(): { profile: MasterProfile; stories: ProfileStory[] } {
  const jsonResume = createEmptyJsonResume();
  jsonResume.basics.name = 'Ananya Sharma';
  jsonResume.basics.summary = 'CS senior focused on distributed backend APIs.';
  jsonResume.work = [
    {
      id: 'work-1',
      name: 'FinPay India',
      position: 'Backend Engineer Intern',
      url: '',
      location: 'Bengaluru',
      employmentType: 'Internship',
      startDate: '2025-05',
      endDate: '2025-07',
      summary: '',
      highlights: ['Built TypeScript and PostgreSQL payment webhooks handling 10k req/min.']
    }
  ];
  jsonResume.projects = [
    {
      id: 'proj-1',
      name: 'QueueFlow',
      description: 'Async job runner',
      highlights: ['Reduced job retry latency by 40% using Redis streams.'],
      keywords: ['TypeScript', 'Node.js', 'Redis'],
      startDate: '',
      endDate: '',
      url: '',
      roles: [],
      entity: '',
      type: ''
    }
  ];
  jsonResume.education = [
    {
      id: 'edu-1',
      institution: 'IIIT Hyderabad',
      url: '',
      area: 'Computer Science',
      studyType: 'B.Tech',
      startDate: '2022',
      endDate: '2026',
      score: '9.1',
      courses: []
    }
  ];
  jsonResume.skills = [
    { name: 'Backend', level: '', keywords: ['TypeScript', 'Node.js', 'PostgreSQL', 'Redis'] }
  ];

  const indiaProfile = createEmptyIndiaProfile();
  indiaProfile.collegeName = 'IIIT Hyderabad';
  indiaProfile.cgpa = 9.1;

  const stories: ProfileStory[] = [
    {
      id: 'story-1',
      userId: '11111111-1111-4111-8111-111111111111',
      title: 'Checkout Cache Optimization',
      category: 'optimization',
      situation: 'High DB load',
      task: 'Optimize reads',
      action: 'Added Redis read-through cache and connection pooling.',
      result: 'Improved p95 latency by 62%.',
      metrics: [{ label: 'p95 latency', value: '62', unit: '%' }],
      skillsUsed: ['Redis', 'PostgreSQL'],
      linkedExperienceId: 'work-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ];

  return {
    profile: {
      id: '11111111-1111-4111-8111-111111111111',
      fullName: 'Ananya Sharma',
      email: 'ananya@example.com',
      phone: null,
      activeProfileVersion: 1,
      jsonResume,
      indiaProfile,
      searchPreferences: {
        targetRoles: [],
        workModes: ['remote', 'hybrid', 'onsite'],
        seniorityLevels: ['intern', 'fresher', 'junior'],
        countries: ['IN'],
        minSalaryLpa: null,
        minExperienceYears: null,
        maxExperienceYears: null
      },
      sourceResumeStoragePath: null,
      embeddingModel: null,
      embeddingModelVersion: null,
      embeddedAt: null,
      telemetryOptIn: false,
      onboardingCompletedAt: null,
      updatedAt: new Date().toISOString()
    },
    stories
  };
}

describe('@jobpilot/tailoring deterministic verifier', () => {
  it('approves faithful rephrasing grounded in master profile and story bank metrics', () => {
    const { profile, stories } = makeTestProfile();
    const tailored = structuredClone(profile.jsonResume);
    tailored.work[0]!.highlights = [
      'Engineered payment webhooks in TypeScript and PostgreSQL supporting 10k req/min and cutting p95 latency by 62%.'
    ];

    const res = runDeterministicVerification({
      masterProfile: profile,
      stories,
      tailoredResume: tailored
    });

    expect(res.deterministicPassed).toBe(true);
    expect(res.immutableFieldViolations).toBe(0);
    expect(res.claims.filter((c) => c.status === 'flagged')).toEqual([]);
  });

  it('catches invented skills, altered employers/dates/CGPA, and fabricated metrics', () => {
    const { profile, stories } = makeTestProfile();
    const bad = structuredClone(profile.jsonResume);
    bad.skills.push({ name: 'Cloud', level: '', keywords: ['Kubernetes'] });
    bad.work[0]!.name = 'Stripe India';
    bad.work[0]!.startDate = '2024-01';
    bad.work[0]!.highlights = ['Reduced latency by 88% across 500k daily requests.'];
    bad.education[0]!.score = '9.8';

    const res = runDeterministicVerification({
      masterProfile: profile,
      stories,
      tailoredResume: bad
    });

    expect(res.deterministicPassed).toBe(false);
    expect(res.immutableFieldViolations).toBeGreaterThanOrEqual(2);
    const issues = res.claims.filter((c) => c.status === 'flagged').map((c) => c.issue);
    expect(issues.some((i) => i.includes('Kubernetes'))).toBe(true);
    expect(issues.some((i) => i.includes('88%') || i.includes('500k'))).toBe(true);
    expect(issues.some((i) => i.includes('CGPA') || i.includes('score'))).toBe(true);
  });
});
