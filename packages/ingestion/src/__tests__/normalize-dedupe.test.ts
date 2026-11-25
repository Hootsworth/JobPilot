import { describe, expect, it } from 'vitest';
import {
  canonicalizeUrl,
  cleanHtmlDescription,
  dedupeNormalizedJobs,
  extractExperienceYears,
  extractSalary,
  extractSkillsFromText,
  inferSeniority,
  parseLocation
} from '../index.js';
import { buildNormalizedJob } from '../connectors/base.js';

describe('@jobpilot/ingestion normalization & cross-source dedupe', () => {
  it('cleans double-encoded HTML and normalizes Indian hubs + LPA compensation', () => {
    const clean = cleanHtmlDescription('&lt;p&gt;Hiring in Bangalore!&lt;/p&gt;&lt;ul&gt;&lt;li&gt;TypeScript &amp; PostgreSQL&lt;/li&gt;&lt;/ul&gt;');
    expect(clean).toContain('Hiring in Bangalore!');
    expect(clean).toContain('TypeScript & PostgreSQL');

    const loc = parseLocation('Bangalore, Karnataka, India', 'hybrid');
    expect(loc).toMatchObject({
      city: 'Bengaluru',
      countryCode: 'IN',
      workMode: 'hybrid'
    });

    const lpa = extractSalary({ description: 'Compensation: ₹14 - 22 LPA plus ESOPs' });
    expect(lpa).toMatchObject({
      salaryCurrency: 'INR',
      salaryMinLpa: 14,
      salaryMaxLpa: 22
    });

    const stipend = extractSalary({ description: 'Internship stipend ₹50,000/month' });
    expect(stipend.salaryMinLpa).toBe(6);
    expect(stipend.stipendMonthlyInr).toBe(50000);

    const undisclosed = extractSalary({ description: 'Build resilient APIs with Go and Postgres.' });
    expect(undisclosed.salaryMinLpa).toBeNull();
    expect(undisclosed.stipendMonthlyInr).toBeNull();

    const usd = extractSalary({ description: 'Base pay $100k - $150k per year' });
    expect(usd.salaryCurrency).toBe('USD');
    expect(usd.salaryMinLpa).toBe(84);
  });

  it('infers seniority, experience bounds, and core skills', () => {
    expect(inferSeniority('Software Engineer Intern')).toBe('intern');
    expect(inferSeniority('SDE-1 (Backend)')).toBe('junior');
    expect(inferSeniority('Senior Platform Engineer')).toBe('senior');
    expect(extractExperienceYears('Backend Engineer', 'Requires 2-4 years in Node.js')).toEqual({
      minYears: 2,
      maxYears: 4
    });

    const skills = extractSkillsFromText('Build microservices using TypeScript, Node.js, PostgreSQL, Redis, and Docker.');
    expect(skills).toEqual(expect.arrayContaining(['TypeScript', 'Node.js', 'PostgreSQL', 'Redis', 'Docker', 'Microservices']));
  });

  it('deduplicates cross-source jobs and prefers direct ATS apply URLs', () => {
    expect(
      canonicalizeUrl('https://boards.greenhouse.io/razorpay/jobs/101?utm_source=adzuna&gh_src=abc')
    ).toBe('https://boards.greenhouse.io/razorpay/jobs/101');

    const fromAggregator = buildNormalizedJob({
      sourceType: 'adzuna',
      externalId: 'adz-999',
      sourceUrl: 'https://www.adzuna.in/land/ad/999?utm_medium=api',
      companyName: 'Razorpay Software Private Limited',
      title: 'Backend Engineer (SDE-1)',
      locationRaw: 'Bangalore, India',
      descriptionHtmlOrText: 'Node.js role',
      explicitSalaryMin: 1_500_000,
      explicitSalaryMax: 2_000_000,
      explicitSalaryCurrency: 'INR',
      explicitSalaryPeriod: 'year'
    })!;

    const fromAts = buildNormalizedJob({
      sourceType: 'greenhouse',
      externalId: 'gh-101',
      sourceUrl: 'https://boards.greenhouse.io/razorpay/jobs/101?gh_src=feed',
      applyUrl: 'https://boards.greenhouse.io/razorpay/jobs/101#app',
      companyName: 'Razorpay',
      title: 'Backend Engineer',
      locationRaw: 'Bengaluru, Karnataka, India',
      descriptionHtmlOrText:
        '<p>Full backend job description working with Node.js, PostgreSQL, Kafka, and Redis at high scale.</p>'
    })!;

    const bundles = dedupeNormalizedJobs([fromAggregator, fromAts]);
    expect(bundles).toHaveLength(1);
    expect(bundles[0]?.sightings).toHaveLength(2);
    expect(bundles[0]?.canonical.sourceType).toBe('greenhouse');
    expect(bundles[0]?.canonical.applyUrl).toBe('https://boards.greenhouse.io/razorpay/jobs/101#app');
    expect(bundles[0]?.canonical.salaryMinLpa).toBe(15);
    expect(bundles[0]?.canonical.extractedSkills).toContain('Kafka');
  });

  it('deduplicates slight title rewrites via description similarity and normalizes internship/fresher metadata', () => {
    const sharedCore =
      'Join our Bengaluru Security Engineering team for B.Tech freshers 2025/2026 graduates working on Application Security, Kubernetes, Python, threat modeling, SAST/DAST pipelines, API security reviews, and cloud vulnerability scanning across multi-region microservices deployments. Collaborate closely with SRE, platform engineering, and infrastructure leads to automate guardrails and ship secure developer tooling every sprint. ';
    const sharedJd = `<p>${sharedCore}Stipend INR 45,000 per month during 6-month internship.</p>`;

    const atsIntern = buildNormalizedJob({
      sourceType: 'greenhouse',
      externalId: 'sec-1',
      sourceUrl: 'https://boards.greenhouse.io/acme/jobs/sec-1',
      companyName: 'Acme Cloud',
      title: 'Application Security Intern (Freshers)',
      locationRaw: 'Bengaluru, India',
      descriptionHtmlOrText: sharedJd,
      boardKey: 'greenhouse:acme'
    })!;

    expect(atsIntern.employmentType).toBe('internship');
    expect(atsIntern.fresherEligible).toBe(true);
    expect(atsIntern.stipendMonthlyInr).toBe(45000);
    expect(atsIntern.careerCategory).toBe('cybersecurity');
    expect(atsIntern.boardKey).toBe('greenhouse:acme');
    expect(atsIntern.postedAt).toBeNull();

    const aggregatorRewritten = buildNormalizedJob({
      sourceType: 'jooble',
      externalId: 'jbl-901',
      sourceUrl: 'https://in.jooble.org/desc/901',
      companyName: 'Acme Cloud India Pvt Ltd',
      title: 'AppSec Intern - Graduate 2026',
      locationRaw: 'Bangalore, India',
      descriptionHtmlOrText: `${sharedCore}Immediate joining available.`
    })!;

    const merged = dedupeNormalizedJobs([aggregatorRewritten, atsIntern]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.canonical.sourceType).toBe('greenhouse');
    expect(merged[0]?.canonical.stipendMonthlyInr).toBe(45000);
    expect(merged[0]?.sightings).toHaveLength(2);
  });
});
