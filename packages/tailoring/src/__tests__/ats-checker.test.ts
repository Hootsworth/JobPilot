import { describe, expect, it } from 'vitest';
import { createEmptyJsonResume } from '@jobpilot/shared';
import { scoreResumeAgainstJd } from '../index.js';

describe('@jobpilot/tailoring deterministic ATS checker', () => {
  it('scores synonym matches, missing skills, bullet impact, and parseability deterministically', () => {
    const resume = createEmptyJsonResume();
    resume.basics = {
      name: 'Ananya Rao',
      label: 'Backend Engineer',
      email: 'ananya@example.com',
      phone: '+91-9876543210',
      url: 'https://github.com/ananya',
      summary: 'Backend developer focused on TS APIs, Postgres schemas, and container deployments.',
      location: { address: '', postalCode: '', city: 'Bengaluru', countryCode: 'IN', region: '' },
      profiles: []
    };
    resume.skills = [
      {
        name: 'Core',
        level: '',
        keywords: ['TS', 'NodeJS', 'Postgres', 'Docker', 'Redis', 'REST']
      }
    ];
    resume.work = [
      {
        id: 'w-1',
        name: 'FinStack',
        position: 'Software Engineer',
        url: '',
        location: 'Bengaluru',
        employmentType: 'Full-time',
        startDate: '2024-01',
        endDate: 'Present',
        summary: '',
        highlights: [
          'Reduced p99 checkout latency by 48% across 120k daily transactions using Redis.',
          'Built REST APIs in TS and Postgres handling idempotent webhooks.'
        ]
      }
    ];
    resume.education = [
      {
        id: 'e-1',
        institution: 'NIT Surathkal',
        url: '',
        area: 'Computer Science',
        studyType: 'B.Tech',
        startDate: '2020',
        endDate: '2024',
        score: '8.9',
        courses: []
      }
    ];

    const start = performance.now();
    const report = scoreResumeAgainstJd({
      resume,
      jdRequirements: {
        roleTitle: 'Backend Engineer',
        companyName: 'Razorpay',
        mustHaveSkills: ['TypeScript', 'PostgreSQL', 'Node.js', 'Kubernetes'],
        niceToHaveSkills: ['Redis', 'Kafka'],
        keyResponsibilities: ['Design payments APIs'],
        keywords: ['Docker', 'REST APIs', 'GraphQL'],
        senioritySignals: ['0-2 years'],
        domainTerms: ['fintech']
      }
    });
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(50);
    // Synonym normalization: TS -> TypeScript, Postgres -> PostgreSQL, NodeJS -> Node.js
    expect(report.matchedMustHave).toEqual(
      expect.arrayContaining(['TypeScript', 'PostgreSQL', 'Node.js'])
    );
    expect(report.missingMustHave).toEqual(['Kubernetes']);
    expect(report.mustHaveCoverage).toBe(75);
    expect(report.matchedNiceToHave).toEqual(['Redis']);
    expect(report.missingNiceToHave).toEqual(['Kafka']);
    expect(report.sectionQuality.totalBullets).toBe(2);
    expect(report.sectionQuality.quantifiedBullets).toBe(1);
    expect(report.sectionQuality.strongVerbBullets).toBe(2);
    expect(report.overallScore).toBeGreaterThanOrEqual(65);
    expect(report.recommendations.some((r) => r.includes('Kubernetes'))).toBe(true);
  });

  it('extracts JD terms deterministically when raw jdText is provided standalone', () => {
    const resume = createEmptyJsonResume();
    resume.basics.name = 'Dev User';
    resume.basics.email = 'dev@example.com';
    resume.basics.phone = '1234567890';
    resume.skills = [{ name: 'Stack', level: '', keywords: ['Python', 'FastAPI', 'Docker'] }];

    const report = scoreResumeAgainstJd({
      resume,
      jdText: `
        Requirements:
        We need Python, FastAPI, PostgreSQL, and Docker for backend APIs.
        Nice to have: Kubernetes and Terraform.
      `,
      title: 'Backend Developer'
    });

    expect(report.matchedMustHave).toEqual(expect.arrayContaining(['Python', 'FastAPI', 'Docker']));
    expect(report.missingMustHave).toContain('PostgreSQL');
    expect(report.missingNiceToHave).toEqual(expect.arrayContaining(['Kubernetes', 'Terraform']));
  });
});
