import { describe, expect, it, vi } from 'vitest';
import type { LlmProvider } from '@jobpilot/llm';
import {
  createEmptyIndiaProfile,
  createEmptyJsonResume,
  type MasterProfile
} from '@jobpilot/shared';
import { escapeTypst, generateTypstResumeSource, tailorResumePipeline } from '../index.js';

function makeMasterProfile(): MasterProfile {
  const jsonResume = createEmptyJsonResume();
  jsonResume.basics.name = 'Kabir Mehta';
  jsonResume.basics.email = 'kabir@example.com';
  jsonResume.basics.summary = 'Software engineer skilled in Node.js and PostgreSQL.';
  jsonResume.work = [
    {
      id: 'work-1',
      name: 'Acme Cloud',
      position: 'Software Engineer',
      url: '',
      location: 'Bengaluru',
      employmentType: 'Full-time',
      startDate: '2024-01',
      endDate: 'Present',
      summary: '',
      highlights: ['Built Fastify REST APIs and indexed PostgreSQL tables (45% faster queries).']
    }
  ];
  jsonResume.projects = [
    {
      id: 'proj-1',
      name: 'DocSearch',
      description: 'Vector search tool',
      highlights: ['Indexed 20k markdown docs in PostgreSQL.'],
      keywords: ['TypeScript', 'PostgreSQL'],
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
      institution: 'NIT Surathkal',
      url: '',
      area: 'CSE',
      studyType: 'B.Tech',
      startDate: '2020',
      endDate: '2024',
      score: '8.7',
      courses: []
    }
  ];
  jsonResume.skills = [
    { name: 'Backend', level: '', keywords: ['TypeScript', 'Node.js', 'Fastify', 'PostgreSQL'] }
  ];

  const indiaProfile = createEmptyIndiaProfile();
  indiaProfile.tenthPercentage = 95;
  indiaProfile.twelfthPercentage = 94;

  return {
    id: '11111111-1111-4111-8111-111111111111',
    fullName: 'Kabir Mehta',
    email: 'kabir@example.com',
    phone: null,
    activeProfileVersion: 1,
    jsonResume,
    indiaProfile,
    searchPreferences: {
      targetRoles: [],
      workModes: ['remote', 'hybrid', 'onsite'],
      seniorityLevels: ['junior', 'mid'],
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
  };
}

describe('@jobpilot/tailoring pipeline & typst escaping', () => {
  it('escapes Typst special characters cleanly', () => {
    expect(escapeTypst('C# & $100 @ 99% [fast]')).toBe('C\\# & \\$100 \\@ 99% \\[fast\\]');
    const src = generateTypstResumeSource(makeMasterProfile().jsonResume, makeMasterProfile().indiaProfile);
    expect(src).toContain('NIT Surathkal');
    expect(src).toContain('Class XII: 94%');
  });

  it('reuses cached JD, flags unsupported hallucination, auto-repairs, and produces diff + PDF', async () => {
    const profile = makeMasterProfile();
    let tailorCalls = 0;

    const generateStructured = vi.fn(async (req: { taskType?: string }) => {
      if (req.taskType === 'resume_tailor') {
        tailorCalls++;
        if (tailorCalls === 1) {
          // First draft hallucinates Go & 90%
          return {
            data: {
              summary: 'Backend engineer specializing in TypeScript and Go.',
              selectedWork: [
                {
                  sourceId: 'work-1',
                  name: 'Acme Cloud',
                  position: 'Software Engineer',
                  startDate: '2024-01',
                  endDate: 'Present',
                  highlights: ['Cut query latency by 90% using Go.']
                }
              ],
              selectedProjects: [],
              selectedEducation: [],
              reorderedSkills: [
                { name: 'Backend', level: '', keywords: ['TypeScript', 'Go', 'PostgreSQL'] }
              ],
              tailoringRationale: 'Draft 1'
            },
            provider: 'gemini' as const,
            model: 'gemini-live',
            inputTokens: 100,
            outputTokens: 60,
            latencyMs: 80,
            estimatedCostUsd: 0.0001,
            retryCount: 0,
            usedRepair: false
          };
        }
        // Auto-repair pass removes Go and restores grounded 45% metric
        return {
          data: {
            summary: 'Backend engineer specializing in TypeScript, Node.js, and PostgreSQL.',
            selectedWork: [
              {
                sourceId: 'work-1',
                name: 'Acme Cloud',
                position: 'Software Engineer',
                startDate: '2024-01',
                endDate: 'Present',
                highlights: ['Engineered Fastify REST APIs and indexed PostgreSQL tables (45% faster queries).']
              }
            ],
            selectedProjects: [
              {
                sourceId: 'proj-1',
                name: 'DocSearch',
                keywords: ['PostgreSQL', 'TypeScript'],
                highlights: ['Indexed 20k markdown docs in PostgreSQL.']
              }
            ],
            selectedEducation: [],
            reorderedSkills: [
              { name: 'Backend', level: '', keywords: ['PostgreSQL', 'TypeScript', 'Node.js', 'Fastify'] }
            ],
            tailoringRationale: 'Repaired grounded draft'
          },
          provider: 'gemini' as const,
          model: 'gemini-live',
          inputTokens: 110,
          outputTokens: 65,
          latencyMs: 85,
          estimatedCostUsd: 0.0001,
          retryCount: 0,
          usedRepair: false
        };
      }

      // resume_verify pass
      return {
        data: {
          claims: [
            {
              section: 'work.highlights',
              claim: '45% faster queries',
              sourceId: 'work-1',
              status: 'verified',
              severity: 'info',
              evidence: '45% faster queries',
              issue: ''
            }
          ],
          overallNotes: 'Verified'
        },
        provider: 'gemini' as const,
        model: 'gemini-live',
        inputTokens: 80,
        outputTokens: 30,
        latencyMs: 50,
        estimatedCostUsd: 0.0001,
        retryCount: 0,
        usedRepair: false
      };
    });

    const mockLlm = {
      providerId: 'gemini',
      generateStructured
    } as unknown as LlmProvider;

    const result = await tailorResumePipeline({
      profile,
      targetJob: {
        title: 'Backend Engineer',
        companyName: 'Razorpay',
        description: 'PostgreSQL, TypeScript, Go.'
      },
      cachedJdRequirements: {
        roleTitle: 'Backend Engineer',
        companyName: 'Razorpay',
        mustHaveSkills: ['PostgreSQL', 'TypeScript', 'Go'],
        niceToHaveSkills: [],
        keyResponsibilities: ['Build backend APIs'],
        keywords: ['PostgreSQL', 'TypeScript'],
        senioritySignals: [],
        domainTerms: []
      },
      llmProvider: mockLlm,
      autoRepairFlagged: true
    });

    expect(result.jdFromCache).toBe(true);
    expect(tailorCalls).toBe(2);
    expect(result.verifierReport.passed).toBe(true);
    expect(result.diffSummary.summaryChanged).toBe(true);
    expect(result.diffSummary.skillsReordered).toBe(true);
    expect(result.pdfBuffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('retains master work experiences and projects when the LLM omits selectedWork or selectedProjects', async () => {
    const profile = makeMasterProfile();
    const generateStructured = vi.fn(async () => ({
      data: {
        summary: 'Backend engineer skilled in Node.js and PostgreSQL.',
        selectedWork: [],
        selectedProjects: [],
        selectedEducation: [],
        reorderedSkills: [],
        tailoringRationale: 'Minimal response'
      },
      provider: 'gemini' as const,
      model: 'gemini-live',
      inputTokens: 50,
      outputTokens: 20,
      latencyMs: 30,
      estimatedCostUsd: 0.0001,
      retryCount: 0,
      usedRepair: false
    }));

    const mockLlm = {
      providerId: 'gemini',
      generateStructured
    } as unknown as LlmProvider;

    const result = await tailorResumePipeline({
      profile,
      targetJob: {
        title: 'Backend Engineer',
        companyName: 'Razorpay',
        description: 'Build reliable Node.js and PostgreSQL services.'
      },
      cachedJdRequirements: {
        roleTitle: 'Backend Engineer',
        companyName: 'Razorpay',
        mustHaveSkills: ['Node.js', 'PostgreSQL'],
        niceToHaveSkills: [],
        keyResponsibilities: [],
        keywords: ['PostgreSQL'],
        senioritySignals: [],
        domainTerms: []
      },
      llmProvider: mockLlm,
      autoRepairFlagged: false
    });

    expect(result.tailoredJsonResume.work).toHaveLength(1);
    expect(result.tailoredJsonResume.work[0]?.name).toBe('Acme Cloud');
    expect(result.tailoredJsonResume.projects).toHaveLength(1);
    expect(result.tailoredJsonResume.projects[0]?.name).toBe('DocSearch');
    expect(result.typstSource).toContain('Acme Cloud');
    expect(result.typstSource).toContain('DocSearch');
  });
});
