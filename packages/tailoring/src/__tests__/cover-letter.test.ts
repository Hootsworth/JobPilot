import { describe, expect, it } from 'vitest';
import { extractText, getDocumentProxy } from 'unpdf';
import {
  CoverLetterLlmOutputSchema,
  JdRequirementsSchema,
  SearchPreferencesSchema,
  createEmptyIndiaProfile,
  createEmptyJsonResume,
  type MasterProfile,
  type ProfileStory
} from '@jobpilot/shared';
import type { LlmProvider } from '@jobpilot/llm';
import { generateCoverLetterPipeline } from '../index.js';

function makeMasterProfile(): MasterProfile {
  const resume = createEmptyJsonResume();
  resume.basics = {
    name: 'Kabir Mehta',
    label: 'Backend Engineer',
    email: 'kabir@example.com',
    phone: '+91-9988776655',
    url: 'https://github.com/kabir',
    summary: 'Built TypeScript and PostgreSQL services for real-time billing systems.',
    location: { address: '', postalCode: '', city: 'Bengaluru', countryCode: 'IN', region: '' },
    profiles: []
  };
  resume.skills = [
    { name: 'Languages & Data', level: '', keywords: ['TypeScript', 'PostgreSQL', 'Redis', 'Node.js'] }
  ];
  resume.work = [
    {
      id: 'work-1',
      name: 'PayAxis',
      position: 'Backend Engineer',
      url: '',
      location: 'Bengaluru',
      employmentType: 'Full-time',
      startDate: '2024-06',
      endDate: 'Present',
      summary: '',
      highlights: ['Cut settlement batch latency by 45% across 80k daily ledger entries.']
    }
  ];
  return {
    id: '11111111-1111-4111-8111-111111111111',
    fullName: 'Kabir Mehta',
    email: 'kabir@example.com',
    phone: '+91-9988776655',
    activeProfileVersion: 2,
    jsonResume: resume,
    indiaProfile: createEmptyIndiaProfile(),
    searchPreferences: SearchPreferencesSchema.parse({}),
    sourceResumeStoragePath: null,
    embeddingModel: null,
    embeddingModelVersion: null,
    embeddedAt: null,
    telemetryOptIn: false,
    onboardingCompletedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  };
}

const sampleStories: ProfileStory[] = [
  {
    id: '22222222-2222-4222-8222-222222222222',
    userId: '11111111-1111-4111-8111-111111111111',
    title: 'Ledger Reconciliation Worker',
    category: 'optimization',
    situation: 'Nightly reconciliation jobs timed out under peak volume.',
    task: 'Redesign Postgres locking and worker batching.',
    action: 'Implemented SKIP LOCKED queues and batched upserts.',
    result: 'Completed reconciliation within SLA with zero double-writes.',
    metrics: [{ label: 'Latency reduction', value: '45%', unit: 'p95' }],
    skillsUsed: ['PostgreSQL', 'TypeScript'],
    linkedExperienceId: 'work-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
];

describe('@jobpilot/tailoring grounded cover letter pipeline', () => {
  it('generates a deterministic verified cover letter and readable PDF without an LLM key', async () => {
    const res = await generateCoverLetterPipeline({
      masterProfile: makeMasterProfile(),
      stories: sampleStories,
      companyName: 'Razorpay',
      roleTitle: 'SDE 1 Backend',
      jdDescription: 'Build Go/TypeScript payment APIs backed by PostgreSQL and Redis.',
      tone: 'concise-technical',
      typstBin: '__nonexistent_typst_binary__'
    });

    expect(res.usedLlm).toBe(false);
    expect(res.verifierReport.passed).toBe(true);
    expect(res.plainText).toContain('Razorpay');
    expect(res.plainText).toContain('45%');
    expect(res.pdfBuffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');

    const proxy = await getDocumentProxy(new Uint8Array(res.pdfBuffer));
    const extracted = String((await extractText(proxy, { mergePages: true })).text);
    expect(extracted).toContain('Kabir Mehta');
    expect(extracted).toContain('Razorpay');
  });

  it('auto-repairs paragraphs containing fabricated numeric claims from an LLM', async () => {
    const mockProvider: LlmProvider = {
      id: 'gemini',
      async testConnection() {
        return { ok: true, latencyMs: 1 };
      },
      async generateStructured({ schemaName }) {
        if (schemaName === 'jd_requirements') {
          return {
            data: JdRequirementsSchema.parse({
              roleTitle: 'SDE 1',
              companyName: 'Razorpay',
              mustHaveSkills: ['TypeScript', 'PostgreSQL'],
              keywords: ['Redis']
            }) as never,
            usage: { inputTokens: 10, outputTokens: 10, latencyMs: 5 },
            model: 'gemini-mock'
          };
        }
        return {
          data: CoverLetterLlmOutputSchema.parse({
            salutation: 'Dear Razorpay Team,',
            openingHook: 'Excited to apply for SDE 1 at Razorpay.',
            bodyParagraphs: [
              'At PayAxis, I scaled systems by 999% across 50M global users.',
              'On the Ledger Reconciliation Worker project, SKIP LOCKED batching achieved 45% lower latency.'
            ],
            closing: 'Looking forward to speaking with the Razorpay team.',
            selectedStoryIds: ['22222222-2222-4222-8222-222222222222'],
            highlightedAchievements: ['45% lower latency'],
            rationale: 'Mocked test'
          }) as never,
          usage: { inputTokens: 10, outputTokens: 10, latencyMs: 5 },
          model: 'gemini-mock'
        };
      }
    };

    const res = await generateCoverLetterPipeline({
      masterProfile: makeMasterProfile(),
      stories: sampleStories,
      companyName: 'Razorpay',
      roleTitle: 'SDE 1',
      jdDescription: 'TypeScript and PostgreSQL backend engineer role.',
      llmProvider: mockProvider,
      autoRepairFlagged: true,
      typstBin: '__nonexistent_typst_binary__'
    });

    expect(res.usedLlm).toBe(true);
    expect(res.verifierReport.passed).toBe(true);
    expect(res.plainText).not.toContain('999%');
    expect(res.plainText).not.toContain('50M');
    expect(res.plainText).toContain('45%');
  });
});
