import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { MemoryDataStore } from '../store/memory-store.js';

const testConfig = loadConfig({
  APP_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  CORS_ORIGIN: 'http://localhost:3000'
});

const TEST_USER = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'student@iitb.ac.in',
  fullName: 'Aarav Sharma'
};

describe('Phase 6 Application Tracker API (/api/applications/*)', () => {
  it('creates manual application, links tailored resume version, tracks status & follow-up reminders, records audit events, and exports', async () => {
    const store = new MemoryDataStore();
    await store.getOrCreateProfile(TEST_USER);

    // Create a tailored resume version in store so we can link it to an application
    const resumeVersionId = '22222222-2222-4222-8222-222222222222';
    await store.createResumeVersion(TEST_USER.id, {
      id: resumeVersionId,
      jobId: null,
      parentProfileVersion: 1,
      label: 'Razorpay — SDE 1 Backend',
      jdRequirements: {
        roleTitle: 'SDE 1 Backend',
        companyName: 'Razorpay',
        mustHaveSkills: ['Node.js', 'PostgreSQL'],
        niceToHaveSkills: ['Kafka'],
        keyResponsibilities: ['Build payment microservices'],
        seniorityHint: 'junior',
        keywords: ['Node.js', 'PostgreSQL', 'Payments']
      },
      tailoredJsonResume: {
        basics: {
          name: 'Aarav Sharma',
          label: 'Backend Engineer',
          email: 'student@iitb.ac.in',
          phone: '+91 9876543210',
          url: '',
          summary: 'Backend engineer skilled in Node.js and PostgreSQL.',
          location: { city: 'Bengaluru', region: 'Karnataka', countryCode: 'IN' },
          profiles: []
        },
        work: [],
        education: [],
        skills: [],
        projects: [],
        awards: [],
        certificates: [],
        languages: []
      },
      diffSummary: {
        summaryChanged: true,
        previousSummary: '',
        newSummary: 'Backend engineer skilled in Node.js and PostgreSQL.',
        includedWorkCount: 0,
        totalProfileWorkCount: 0,
        includedProjectCount: 0,
        totalProfileProjectCount: 0,
        matchedSkillsHighlighted: ['Node.js', 'PostgreSQL'],
        bulletChanges: []
      },
      verifierReport: {
        passed: true,
        deterministicPassed: true,
        llmVerifierPassed: true,
        totalClaimsChecked: 1,
        unsupportedClaimCount: 0,
        immutableFieldViolations: 0,
        unsupportedClaimRate: 0,
        claims: []
      },
      verifierPassed: true,
      templateId: 'ats-classic',
      typstSource: '',
      pdfStoragePath: `${TEST_USER.id}/${resumeVersionId}.pdf`,
      pdfEngine: 'builtin-ats-pdf',
      provider: 'gemini',
      model: 'gemini-2.5-flash'
    });

    const app = await buildApp({
      config: testConfig,
      store,
      authVerifier: {
        verifyToken: async () => TEST_USER
      },
      providerFactory: () => {
        throw new Error('Not used');
      }
    });

    // 1. Create a manual application in 'saved' status with linked resumeVersionId
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/applications',
      headers: { authorization: 'Bearer test-token' },
      payload: {
        title: 'SDE 1 Backend',
        companyName: 'Razorpay',
        sourceUrl: 'https://razorpay.com/jobs/sde-1',
        locationRaw: 'Bengaluru, India',
        status: 'saved',
        resumeVersionId,
        notes: 'Referred by senior alum'
      }
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json();
    expect(created.status).toBe('saved');
    expect(created.appliedAt).toBeNull();
    expect(created.resumeVersionId).toBe(resumeVersionId);
    expect(created.resumeVersion.versionNumber).toBe(1);
    expect(created.resumeVersion.label).toBe('Razorpay — SDE 1 Backend');
    expect(created.job.companyName).toBe('Razorpay');

    // 2. Transition status to 'applied' and schedule a follow-up reminder
    const followUpIso = '2026-12-01T09:00:00.000Z';
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/applications/${created.id}`,
      headers: { authorization: 'Bearer test-token' },
      payload: {
        status: 'applied',
        nextFollowUpAt: followUpIso,
        followUpNote: 'Follow up with recruiter on email',
        salaryOffered: '22 LPA'
      }
    });
    expect(patchRes.statusCode).toBe(200);
    const patched = patchRes.json();
    expect(patched.status).toBe('applied');
    expect(patched.appliedAt).toBeTruthy();
    expect(patched.nextFollowUpAt).toBe(followUpIso);
    expect(patched.followUpNote).toBe('Follow up with recruiter on email');
    expect(patched.salaryOffered).toBe('22 LPA');

    // 3. Transition status to 'interview' -> 'offer'
    const offerRes = await app.inject({
      method: 'PATCH',
      url: `/api/applications/${created.id}`,
      headers: { authorization: 'Bearer test-token' },
      payload: {
        status: 'offer',
        notes: 'Received offer letter: 22 LPA base + 2 LPA joining bonus'
      }
    });
    expect(offerRes.statusCode).toBe(200);
    expect(offerRes.json().status).toBe('offer');

    // 4. Fetch detail and verify audit events timeline
    const detailRes = await app.inject({
      method: 'GET',
      url: `/api/applications/${created.id}`,
      headers: { authorization: 'Bearer test-token' }
    });
    expect(detailRes.statusCode).toBe(200);
    const detail = detailRes.json();
    expect(detail.application.id).toBe(created.id);
    expect(detail.events.length).toBeGreaterThanOrEqual(3);
    const eventTypes = detail.events.map((e: { eventType: string }) => e.eventType);
    expect(eventTypes).toContain('application_created');
    expect(eventTypes).toContain('status_changed');
    expect(eventTypes).toContain('follow_up_scheduled');

    // 5. Filter list by status
    const listOfferRes = await app.inject({
      method: 'GET',
      url: '/api/applications?status=offer',
      headers: { authorization: 'Bearer test-token' }
    });
    expect(listOfferRes.statusCode).toBe(200);
    expect(listOfferRes.json().items).toHaveLength(1);

    const listRejectedRes = await app.inject({
      method: 'GET',
      url: '/api/applications?status=rejected',
      headers: { authorization: 'Bearer test-token' }
    });
    expect(listRejectedRes.statusCode).toBe(200);
    expect(listRejectedRes.json().items).toHaveLength(0);

    // 6. Export account data includes applications
    const exportRes = await app.inject({
      method: 'GET',
      url: '/api/account/export',
      headers: { authorization: 'Bearer test-token' }
    });
    expect(exportRes.statusCode).toBe(200);
    expect(exportRes.json().applications).toHaveLength(1);

    // 7. Delete application
    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/applications/${created.id}`,
      headers: { authorization: 'Bearer test-token' }
    });
    expect(delRes.statusCode).toBe(200);

    const listAfterDel = await app.inject({
      method: 'GET',
      url: '/api/applications',
      headers: { authorization: 'Bearer test-token' }
    });
    expect(listAfterDel.json().items).toHaveLength(0);

    await app.close();
  });
});
