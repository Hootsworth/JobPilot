import { describe, expect, it } from 'vitest';
import { extractText, getDocumentProxy } from 'unpdf';
import { createEmptyIndiaProfile, createEmptyJsonResume } from '@jobpilot/shared';
import { generateTypstResumeSource, renderAtsPdf } from '../index.js';

describe('@jobpilot/tailoring ATS-safe PDF rendering round-trip', () => {
  it('renders a single-column ATS-safe PDF extractable by unpdf', async () => {
    const resume = createEmptyJsonResume();
    resume.basics = {
      name: 'Priya Deshmukh',
      label: 'Full-Stack Software Engineer',
      email: 'priya@example.com',
      phone: '+91-9811122233',
      url: 'https://github.com/priya',
      summary: 'Built scalable TypeScript and PostgreSQL systems for fintech workflows.',
      location: { address: '', postalCode: '', city: 'Bengaluru', countryCode: 'IN', region: '' },
      profiles: []
    };
    resume.skills = [
      { name: 'Languages', level: '', keywords: ['TypeScript', 'Python', 'SQL'] },
      { name: 'Systems', level: '', keywords: ['Node.js', 'Fastify', 'PostgreSQL', 'Redis'] }
    ];
    resume.work = [
      {
        id: 'work-1',
        name: 'PayGrid India',
        position: 'Software Engineer Intern',
        url: '',
        location: 'Bengaluru',
        employmentType: 'Internship',
        startDate: '2025-05',
        endDate: '2025-07',
        summary: '',
        highlights: [
          'Reduced API p95 latency by 62% via Redis caching and composite Postgres indexes.',
          'Processed 50k webhook events per day with idempotent retry queues.'
        ]
      }
    ];
    resume.projects = [
      {
        id: 'proj-1',
        name: 'JobPilot CLI',
        description: 'Resume matcher',
        highlights: ['Implemented deterministic claim verifier and single-column PDF export.'],
        keywords: ['TypeScript', 'PostgreSQL'],
        startDate: '',
        endDate: '',
        url: '',
        roles: [],
        entity: '',
        type: ''
      }
    ];
    resume.education = [
      {
        id: 'edu-1',
        institution: 'BITS Pilani',
        url: '',
        area: 'Computer Science',
        studyType: 'B.E.',
        startDate: '2022',
        endDate: '2026',
        score: '9.05',
        courses: []
      }
    ];

    const india = createEmptyIndiaProfile();
    india.tenthPercentage = 96;
    india.twelfthPercentage = 95;

    const typstSource = generateTypstResumeSource(resume, india, 'ats-classic');
    const rendered = await renderAtsPdf({
      typstSource,
      jsonResume: resume,
      indiaProfile: india,
      templateId: 'ats-classic',
      typstBin: '__nonexistent_typst_binary__'
    });

    expect(rendered.engine).toBe('builtin-ats-pdf');
    expect(rendered.pdfBuffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');

    const proxy = await getDocumentProxy(new Uint8Array(rendered.pdfBuffer));
    const extracted = await extractText(proxy, { mergePages: true });
    const text = String(extracted.text);

    expect(text).toContain('Priya Deshmukh');
    expect(text).toContain('PayGrid India');
    expect(text).toContain('BITS Pilani');
    expect(text).toContain('Reduced API p95 latency by 62%');
    expect(text).toContain('Class XII: 95%');
  });

  it('renders ats-detailed with certifications, coursework, and page numbers and ats-executive with Times serif fonts', async () => {
    const resume = createEmptyJsonResume();
    resume.basics = {
      name: 'Rohan Kulkarni',
      label: 'Staff Systems Engineer',
      email: 'rohan@example.com',
      phone: '+91-9800011122',
      url: 'https://github.com/rohan',
      summary: 'Architected low-latency ledger microservices.',
      location: { address: '', postalCode: '', city: 'Mumbai', countryCode: 'IN', region: '' },
      profiles: []
    };
    resume.education = [
      {
        id: 'edu-1',
        institution: 'IIT Bombay',
        url: '',
        area: 'Computer Science',
        studyType: 'B.Tech',
        startDate: '2018',
        endDate: '2022',
        score: '9.4',
        courses: ['Distributed Systems', 'Operating Systems']
      }
    ];
    resume.certificates = [
      { name: 'AWS Solutions Architect', date: '2024', issuer: 'Amazon', url: '' }
    ];
    resume.awards = [
      { title: 'ICPC Regionalist', date: '2021', awarder: 'ICPC', summary: 'Top 15' }
    ];

    const india = createEmptyIndiaProfile();

    const detailedTypst = generateTypstResumeSource(resume, india, 'ats-detailed');
    expect(detailedTypst).toContain('Relevant Coursework');
    expect(detailedTypst).toContain('Certifications');

    const detailedPdf = await renderAtsPdf({
      typstSource: detailedTypst,
      jsonResume: resume,
      indiaProfile: india,
      templateId: 'ats-detailed',
      typstBin: '__nonexistent_typst_binary__'
    });
    const proxyDetailed = await getDocumentProxy(new Uint8Array(detailedPdf.pdfBuffer));
    const detailedText = String((await extractText(proxyDetailed, { mergePages: true })).text);
    expect(detailedText).toContain('Distributed Systems');
    expect(detailedText).toContain('AWS Solutions Architect');
    expect(detailedText).toContain('ICPC Regionalist');
    expect(detailedText).toContain('Page 1 /');

    const execTypst = generateTypstResumeSource(resume, india, 'ats-executive');
    expect(execTypst).toContain('Liberation Serif');

    const execPdf = await renderAtsPdf({
      typstSource: execTypst,
      jsonResume: resume,
      indiaProfile: india,
      templateId: 'ats-executive',
      typstBin: '__nonexistent_typst_binary__'
    });
    expect(execPdf.pdfBuffer.toString('latin1')).toContain('/Times-Roman');
    const proxyExec = await getDocumentProxy(new Uint8Array(execPdf.pdfBuffer));
    const execText = String((await extractText(proxyExec, { mergePages: true })).text);
    expect(execText).toContain('EXECUTIVE SUMMARY');
  });
});
