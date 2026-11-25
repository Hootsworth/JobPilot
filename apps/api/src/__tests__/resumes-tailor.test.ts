import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL_NAME, EMBEDDING_MODEL_VERSION } from '@jobpilot/embeddings';
import type { JobForMatching } from '@jobpilot/ingestion';
import type { LlmProvider } from '@jobpilot/llm';
import type { LlmProviderId } from '@jobpilot/shared';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { MemoryDataStore } from '../store/memory-store.js';

function makeSeedJob(id: string): JobForMatching {
  return {
    id,
    ownerUserId: null,
    dedupeFingerprint: `fp-${id}`,
    sourceType: 'greenhouse',
    externalId: id,
    sourceUrl: `https://boards.greenhouse.io/razorpay/jobs/${id}`,
    applyUrl: `https://boards.greenhouse.io/razorpay/jobs/${id}#app`,
    companyName: 'Razorpay',
    companyDomain: null,
    companyLogoUrl: null,
    title: 'Software Engineer 1 (Backend)',
    normalizedTitle: 'software engineer 1 backend',
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
    salaryMin: 1_600_000,
    salaryMax: 2_200_000,
    salaryCurrency: 'INR',
    salaryPeriod: 'year',
    salaryMinLpa: 16,
    salaryMaxLpa: 22,
    descriptionClean:
      'Build scalable Node.js, TypeScript, and PostgreSQL payments microservices. Strong API latency optimization required.',
    extractedSkills: ['TypeScript', 'Node.js', 'PostgreSQL'],
    postedAt: new Date().toISOString(),
    isActive: true,
    lastSeenAt: new Date().toISOString(),
    embeddingModel: EMBEDDING_MODEL_NAME,
    embeddingModelVersion: EMBEDDING_MODEL_VERSION,
    embeddedAt: new Date().toISOString(),
    sightingsCount: 1,
    embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? 1 : 0))
  };
}

describe('Phase 3 API: Resume tailoring, JD cache, auto-repair, immutable versions & PDF/Typst download', () => {
  it('tailors from catalog job + caches JD requirements, auto-repairs ungrounded claims, versions v1/v2, and serves PDF + Typst', async () => {
    const store = new MemoryDataStore();
    const userId = '11111111-1111-4111-8111-111111111111';
    const headers = { authorization: 'Bearer valid-jwt' };

    const j1 = makeSeedJob('30000000-0000-4000-8000-000000000001');
    store.seedJobsForTest([j1]);

    let jdCalls = 0;
    let tailorCalls = 0;
    let forceHallucinateOnly = false;

    const generateStructured = vi.fn(async (req: { taskType?: string }) => {
      if (req.taskType === 'jd_extract') {
        jdCalls++;
        return {
          data: {
            roleTitle: 'Software Engineer 1 (Backend)',
            companyName: 'Razorpay',
            mustHaveSkills: ['TypeScript', 'Node.js', 'PostgreSQL'],
            niceToHaveSkills: ['Redis'],
            keyResponsibilities: ['Build scalable payment APIs', 'Optimize database queries'],
            keywords: ['TypeScript', 'Node.js', 'PostgreSQL', 'microservices'],
            senioritySignals: ['0-2 years'],
            domainTerms: ['payments']
          },
          provider: 'gemini' as const,
          model: 'gemini-live',
          inputTokens: 120,
          outputTokens: 60,
          latencyMs: 60,
          estimatedCostUsd: 0.0001,
          retryCount: 0,
          usedRepair: false
        };
      }

      if (req.taskType === 'resume_tailor') {
        tailorCalls++;
        // First call on v1 (or when forceHallucinateOnly is enabled) emits ungrounded Rust + 99%
        if (tailorCalls === 1 || forceHallucinateOnly) {
          return {
            data: {
              summary: 'Backend engineer specializing in Rust and Node.js systems.',
              selectedWork: [
                {
                  sourceId: 'work-1',
                  name: 'Kestrel Labs',
                  position: 'Backend Intern',
                  location: 'Bengaluru',
                  startDate: '2024-05',
                  endDate: '2024-08',
                  summary: '',
                  highlights: ['Rewrote payments gateway in Rust cutting latency by 99%.']
                }
              ],
              selectedProjects: [],
              selectedEducation: [
                {
                  sourceId: 'edu-1',
                  institution: 'RV College of Engineering',
                  area: 'Computer Science',
                  studyType: 'B.E.',
                  startDate: '2021',
                  endDate: '2025',
                  score: '8.9',
                  courses: []
                }
              ],
              reorderedSkills: [
                { name: 'Backend', level: '', keywords: ['Rust', 'TypeScript', 'Node.js'] }
              ],
              tailoringRationale: 'Draft with ungrounded Rust & 99% claim.'
            },
            provider: 'gemini' as const,
            model: 'gemini-live',
            inputTokens: 180,
            outputTokens: 120,
            latencyMs: 95,
            estimatedCostUsd: 0.0002,
            retryCount: 0,
            usedRepair: false
          };
        }

        // Grounded draft / auto-repaired draft
        return {
          data: {
            summary: 'Backend Software Engineer experienced with TypeScript, Node.js, and PostgreSQL APIs.',
            selectedWork: [
              {
                sourceId: 'work-1',
                name: 'Kestrel Labs',
                position: 'Backend Intern',
                location: 'Bengaluru',
                startDate: '2024-05',
                endDate: '2024-08',
                summary: '',
                highlights: [
                  'Engineered TypeScript and Node.js APIs with PostgreSQL indexing for 42% faster p95 reads.'
                ]
              }
            ],
            selectedProjects: [
              {
                sourceId: 'proj-1',
                name: 'PayLedger',
                description: 'Idempotent ledger service',
                keywords: ['Node.js', 'PostgreSQL'],
                url: '',
                startDate: '',
                endDate: '',
                highlights: ['Processed 15k simulated transactions safely using PostgreSQL transactions.']
              }
            ],
            selectedEducation: [
              {
                sourceId: 'edu-1',
                institution: 'RV College of Engineering',
                area: 'Computer Science',
                studyType: 'B.E.',
                startDate: '2021',
                endDate: '2025',
                score: '8.9',
                courses: []
              }
            ],
            reorderedSkills: [
              { name: 'Core Stack', level: '', keywords: ['PostgreSQL', 'TypeScript', 'Node.js'] }
            ],
            tailoringRationale: 'Prioritized Node.js + PostgreSQL highlights.'
          },
          provider: 'gemini' as const,
          model: 'gemini-live',
          inputTokens: 190,
          outputTokens: 130,
          latencyMs: 100,
          estimatedCostUsd: 0.0002,
          retryCount: 0,
          usedRepair: false
        };
      }

      // resume_verify
      return {
        data: {
          claims: [
            {
              section: 'work.highlights',
              claim: forceHallucinateOnly ? 'Rewrote payments gateway in Rust cutting latency by 99%.' : '42% faster p95 reads',
              sourceId: 'work-1',
              status: forceHallucinateOnly ? ('flagged' as const) : ('verified' as const),
              severity: forceHallucinateOnly ? ('critical' as const) : ('info' as const),
              evidence: forceHallucinateOnly ? '' : 'Reduced p95 latency by 42% via PostgreSQL indexing',
              issue: forceHallucinateOnly ? 'Rust and 99% metric not found in master profile.' : ''
            }
          ],
          overallNotes: forceHallucinateOnly ? 'Unsupported Rust/99% detected.' : 'All claims grounded.'
        },
        provider: 'gemini' as const,
        model: 'gemini-live',
        inputTokens: 100,
        outputTokens: 50,
        latencyMs: 60,
        estimatedCostUsd: 0.0001,
        retryCount: 0,
        usedRepair: false
      };
    });

    const app = await buildApp({
      config: loadConfig({
        APP_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
        LLM_PROVIDER: 'gemini',
        GEMINI_API_KEY: 'gm-server-key'
      }),
      store,
      authVerifier: {
        verifyToken: async (jwt) =>
          jwt === 'valid-jwt' ? { id: userId, email: 'kiran@rvce.edu.in', fullName: 'Kiran Rao' } : null
      },
      providerFactory: (cfg: { provider: LlmProviderId }) =>
        ({
          providerId: cfg.provider,
          generateStructured
        }) as unknown as LlmProvider,
      enableLogger: false
    });

    // Seed master profile + story
    await app.inject({
      method: 'PUT',
      url: '/api/profile',
      headers,
      payload: {
        fullName: 'Kiran Rao',
        jsonResume: {
          basics: {
            name: 'Kiran Rao',
            label: 'Backend Engineer',
            email: 'kiran@rvce.edu.in',
            summary: 'CS student building TypeScript and PostgreSQL systems.'
          },
          work: [
            {
              id: 'work-1',
              name: 'Kestrel Labs',
              position: 'Backend Intern',
              location: 'Bengaluru',
              startDate: '2024-05',
              endDate: '2024-08',
              highlights: [
                'Built TypeScript Node.js services and reduced p95 latency by 42% via PostgreSQL indexing.'
              ]
            }
          ],
          projects: [
            {
              id: 'proj-1',
              name: 'PayLedger',
              description: 'Idempotent ledger service',
              keywords: ['Node.js', 'PostgreSQL'],
              highlights: ['Processed 15k simulated transactions in PostgreSQL.']
            }
          ],
          education: [
            {
              id: 'edu-1',
              institution: 'RV College of Engineering',
              area: 'Computer Science',
              studyType: 'B.E.',
              startDate: '2021',
              endDate: '2025',
              score: '8.9'
            }
          ],
          skills: [{ name: 'Core Stack', level: '', keywords: ['TypeScript', 'Node.js', 'PostgreSQL'] }]
        },
        indiaProfile: {
          expectedCtcLpa: 15,
          preferredCities: ['Bengaluru'],
          cgpa: 8.9,
          tenthPercentage: 95,
          twelfthPercentage: 94,
          isFresher: true
        }
      }
    });

    await app.inject({
      method: 'POST',
      url: '/api/stories',
      headers,
      payload: {
        title: 'PostgreSQL Query Tuning',
        metrics: ['42% faster p95 reads'],
        skills: ['PostgreSQL', 'Node.js']
      }
    });

    // 1. First tailor call -> auto-repairs ungrounded Rust/99% draft -> v1 passes
    const resV1 = await app.inject({
      method: 'POST',
      url: '/api/resumes/tailor',
      headers,
      payload: {
        jobId: j1.id,
        templateId: 'ats-classic',
        autoRepairFlagged: true
      }
    });
    expect(resV1.statusCode).toBe(201);
    const v1 = resV1.json();
    expect(v1.versionNumber).toBe(1);
    expect(v1.verifierPassed).toBe(true);
    expect(v1.pdfStoragePath).toBeTruthy();
    expect(v1.typstSource).toContain('RV College of Engineering');
    expect(v1.diffSummary.skillsReordered).toBe(true);
    expect(jdCalls).toBe(1);
    expect(tailorCalls).toBe(2); // initial hallucinated draft + auto-repair draft

    // Download PDF + Typst for v1
    const pdfRes = await app.inject({
      method: 'GET',
      url: `/api/resumes/versions/${v1.id}/pdf`,
      headers
    });
    expect(pdfRes.statusCode).toBe(200);
    expect(pdfRes.headers['content-type']).toContain('application/pdf');
    expect(pdfRes.rawPayload.subarray(0, 5).toString('ascii')).toBe('%PDF-');

    const typstRes = await app.inject({
      method: 'GET',
      url: `/api/resumes/versions/${v1.id}/typst`,
      headers
    });
    expect(typstRes.statusCode).toBe(200);
    expect(typstRes.payload).toContain('Kestrel Labs');

    // 2. Second tailor call for SAME catalog job reuses cached parsed_requirements -> jdCalls stays 1
    const resV2 = await app.inject({
      method: 'POST',
      url: '/api/resumes/tailor',
      headers,
      payload: {
        jobId: j1.id,
        templateId: 'ats-compact',
        label: 'Razorpay — Compact Pass'
      }
    });
    expect(resV2.statusCode).toBe(201);
    const v2 = resV2.json();
    expect(v2.versionNumber).toBe(2);
    expect(v2.label).toBe('Razorpay — Compact Pass');
    expect(jdCalls).toBe(1);

    // 3. Custom JD with autoRepairFlagged=false preserves verifierPassed=false when LLM hallucinates
    forceHallucinateOnly = true;
    const resV3 = await app.inject({
      method: 'POST',
      url: '/api/resumes/tailor',
      headers,
      payload: {
        customJob: {
          title: 'Systems Engineer',
          companyName: 'CustomCo',
          description: 'Need Rust and Node.js engineer to build low-latency payment rails in Bengaluru.'
        },
        templateId: 'ats-classic',
        autoRepairFlagged: false
      }
    });
    expect(resV3.statusCode).toBe(201);
    const v3 = resV3.json();
    expect(v3.versionNumber).toBe(3);
    expect(v3.jobId).toBeNull();
    expect(v3.verifierPassed).toBe(false);
    expect(v3.verifierReport.unsupportedClaimCount).toBeGreaterThan(0);

    // Re-verify v3 after toggling flag off -> updates verifierReport
    forceHallucinateOnly = false;
    const reverifyRes = await app.inject({
      method: 'POST',
      url: `/api/resumes/versions/${v3.id}/verify`,
      headers
    });
    expect(reverifyRes.statusCode).toBe(200);
    // Deterministic checks still catch Rust & 99% in v3.tailoredJsonResume
    expect(reverifyRes.json().verifierPassed).toBe(false);

    // List versions & check account export includes resumeVersions
    const listRes = await app.inject({ method: 'GET', url: '/api/resumes/versions', headers });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json()).toHaveLength(3);

    const exportRes = await app.inject({ method: 'GET', url: '/api/account/export', headers });
    expect(exportRes.statusCode).toBe(200);
    expect(exportRes.json().resumeVersions).toHaveLength(3);

    // Delete v3
    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/resumes/versions/${v3.id}`,
      headers
    });
    expect(delRes.statusCode).toBe(200);
    const afterDelGet = await app.inject({
      method: 'GET',
      url: `/api/resumes/versions/${v3.id}`,
      headers
    });
    expect(afterDelGet.statusCode).toBe(404);
  });
});
