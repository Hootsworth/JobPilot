import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { LlmProvider } from '@jobpilot/llm';
import type { LlmProviderId } from '@jobpilot/shared';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { AuthVerifier } from '../plugins/auth.js';
import { MemoryDataStore } from '../store/memory-store.js';

function createMinimalValidPdfBuffer(textContent: string): Buffer {
  // Minimal valid PDF 1.4 containing extractable Helvetica text stream
  const escaped = textContent.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const streamBody = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj',
    `4 0 obj << /Length ${Buffer.byteLength(streamBody, 'ascii')} >> stream\n${streamBody}\nendstream endobj`,
    '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj'
  ];

  let body = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(body, 'ascii'));
    body += `${obj}\n`;
  }
  const xrefOffset = Buffer.byteLength(body, 'ascii');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'ascii');
}

function buildMultipartPayload(filename: string, contentType: string, content: Buffer) {
  const boundary = '----JobPilotTestBoundary7e12';
  const header = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    'utf8'
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return {
    boundary,
    payload: Buffer.concat([header, content, footer])
  };
}

describe('JobPilot Fastify API integration', () => {
  const encKey = randomBytes(32).toString('hex');
  const testUser = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'student@iit.ac.in',
    fullName: 'Ananya Sharma'
  };

  function setupTestApp() {
    const store = new MemoryDataStore();
    const config = loadConfig({
      APP_ENCRYPTION_KEY: encKey,
      LLM_PROVIDER: 'meta',
      META_BASE_URL: 'https://api.llama.com/compat/v1/'
    });

    const authVerifier: AuthVerifier = {
      verifyToken: async (jwt) => (jwt === 'valid-jwt' ? testUser : null)
    };

    const capturedProviderConfigs: Array<{ provider: LlmProviderId; apiKey: string; baseUrl?: string }> = [];

    const providerFactory = (cfg: {
      provider: LlmProviderId;
      apiKey: string;
      baseUrl?: string;
      userId?: string | null;
      logger?: (entry: {
        userId?: string | null;
        taskType: 'resume_parse' | 'key_test';
        provider: LlmProviderId;
        model: string;
        inputTokens: number;
        outputTokens: number;
        latencyMs: number;
        estimatedCostUsd: number;
        retryCount: number;
        usedRepair: boolean;
        status: 'ok' | 'error';
      }) => Promise<void> | void;
    }): LlmProvider => {
      capturedProviderConfigs.push({
        provider: cfg.provider,
        apiKey: cfg.apiKey,
        baseUrl: cfg.baseUrl
      });

      return {
        providerId: cfg.provider,
        getCapabilities: () => ({
          structuredOutputMode: 'json_schema',
          supportsTemperature: true,
          tokenLimitParam: 'max_completion_tokens'
        }),
        listModels: async () => [
          { id: `${cfg.provider}-live-model`, displayName: `${cfg.provider} Live Model` }
        ],
        testKey: async () => {
          await cfg.logger?.({
            userId: cfg.userId,
            taskType: 'key_test',
            provider: cfg.provider,
            model: `${cfg.provider}-live-model`,
            inputTokens: 8,
            outputTokens: 2,
            latencyMs: 42,
            estimatedCostUsd: 0.00001,
            retryCount: 0,
            usedRepair: false,
            status: 'ok'
          });
          return {
            ok: true,
            provider: cfg.provider,
            modelTested: `${cfg.provider}-live-model`,
            latencyMs: 42,
            modelsCount: 1,
            detectedCapabilities: {
              structuredOutputMode: 'json_schema',
              supportsTemperature: true,
              tokenLimitParam: 'max_completion_tokens'
            },
            message: 'OK'
          };
        },
        generateText: async () => ({
          text: 'OK',
          model: `${cfg.provider}-live-model`,
          inputTokens: 5,
          outputTokens: 2,
          latencyMs: 20,
          estimatedCostUsd: 0
        }),
        generateStructured: async () => {
          await cfg.logger?.({
            userId: cfg.userId,
            taskType: 'resume_parse',
            provider: cfg.provider,
            model: `${cfg.provider}-live-model`,
            inputTokens: 250,
            outputTokens: 180,
            latencyMs: 180,
            estimatedCostUsd: 0.0002,
            retryCount: 0,
            usedRepair: false,
            status: 'ok'
          });
          return {
            data: {
              fullName: 'Ananya Sharma',
              email: 'ananya@example.com',
              phone: '+91-9876543210',
              jsonResume: {
                basics: {
                  name: 'Ananya Sharma',
                  label: 'Final Year CS Student',
                  email: 'ananya@example.com',
                  phone: '+91-9876543210',
                  url: '',
                  summary: 'Built distributed backend APIs.',
                  location: { address: '', postalCode: '', city: 'Bengaluru', countryCode: 'IN', region: 'KA' },
                  profiles: []
                },
                work: [],
                education: [
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
                ],
                projects: [],
                skills: [{ name: 'Backend', level: '', keywords: ['Node.js', 'TypeScript', 'Postgres'] }],
                certificates: [],
                awards: [],
                publications: [],
                languages: []
              },
              extractedIndiaSignals: {
                collegeName: 'IIIT Hyderabad',
                degree: 'B.Tech',
                branch: 'Computer Science',
                graduationYear: 2026,
                cgpa: 9.1,
                cgpaScale: 10,
                isFresher: true,
                preferredCities: ['Bengaluru']
              },
              extractionNotes: []
            },
            provider: cfg.provider,
            model: `${cfg.provider}-live-model`,
            inputTokens: 250,
            outputTokens: 180,
            latencyMs: 180,
            estimatedCostUsd: 0.0002,
            retryCount: 0,
            usedRepair: false
          };
        }
      } as unknown as LlmProvider;
    };

    return { store, config, authVerifier, providerFactory, capturedProviderConfigs };
  }

  it('requires valid Bearer JWT on protected routes', async () => {
    const ctx = setupTestApp();
    const app = await buildApp({ ...ctx, enableLogger: false });

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);

    const unauth = await app.inject({ method: 'GET', url: '/api/profile' });
    expect(unauth.statusCode).toBe(401);

    const badAuth = await app.inject({
      method: 'GET',
      url: '/api/profile',
      headers: { authorization: 'Bearer wrong-token' }
    });
    expect(badAuth.statusCode).toBe(401);
  });

  it('encrypts BYOK keys, masks responses, lists live models, and logs usage', async () => {
    const ctx = setupTestApp();
    const app = await buildApp({ ...ctx, enableLogger: false });
    const headers = { authorization: 'Bearer valid-jwt' };

    const secretKey = 'llama-super-secret-byok-9911';
    const putRes = await app.inject({
      method: 'PUT',
      url: '/api/settings/llm/meta',
      headers,
      payload: {
        isActive: true,
        apiKey: secretKey,
        selectedModel: 'meta-live-model'
      }
    });

    expect(putRes.statusCode).toBe(200);
    const putBody = putRes.json();
    expect(putBody.hasKey).toBe(true);
    expect(putBody.keyHint).toBe('••••9911');
    expect(JSON.stringify(putBody)).not.toContain(secretKey);

    const getRes = await app.inject({ method: 'GET', url: '/api/settings/llm', headers });
    expect(getRes.statusCode).toBe(200);
    expect(JSON.stringify(getRes.json())).not.toContain(secretKey);

    const modelsRes = await app.inject({
      method: 'GET',
      url: '/api/settings/llm/models?provider=meta',
      headers
    });
    expect(modelsRes.statusCode).toBe(200);
    expect(modelsRes.json().models[0].id).toBe('meta-live-model');
    expect(ctx.capturedProviderConfigs[0]).toMatchObject({
      provider: 'meta',
      apiKey: secretKey,
      baseUrl: 'https://api.llama.com/compat/v1/'
    });

    const testRes = await app.inject({
      method: 'POST',
      url: '/api/settings/llm/test',
      headers,
      payload: { provider: 'meta' }
    });
    expect(testRes.statusCode).toBe(200);
    expect(testRes.json().ok).toBe(true);

    const usageRes = await app.inject({ method: 'GET', url: '/api/usage', headers });
    expect(usageRes.statusCode).toBe(200);
    expect(usageRes.json().totalCalls).toBe(1);
    expect(usageRes.json().recentLogs[0].taskType).toBe('key_test');
  });

  it('rejects non-PDF uploads and parses valid PDF resumes into Master Profile', async () => {
    const ctx = setupTestApp();
    const app = await buildApp({ ...ctx, enableLogger: false });
    const headers = { authorization: 'Bearer valid-jwt' };

    // Save BYOK key first
    await app.inject({
      method: 'PUT',
      url: '/api/settings/llm/meta',
      headers,
      payload: { isActive: true, apiKey: 'llama-key-1234' }
    });

    // Reject spoofed non-PDF file
    const badFile = buildMultipartPayload('fake.pdf', 'application/pdf', Buffer.from('not a pdf'));
    const badRes = await app.inject({
      method: 'POST',
      url: '/api/profile/parse-resume',
      headers: {
        ...headers,
        'content-type': `multipart/form-data; boundary=${badFile.boundary}`
      },
      payload: badFile.payload
    });
    expect(badRes.statusCode).toBe(400);

    // Parse real valid minimal PDF and apply to profile
    const validPdf = createMinimalValidPdfBuffer(
      'Ananya Sharma - BTech CS IIIT Hyderabad CGPA 9.1 TypeScript Node.js PostgreSQL Bengaluru'
    );
    const goodFile = buildMultipartPayload('ananya_resume.pdf', 'application/pdf', validPdf);
    const parseRes = await app.inject({
      method: 'POST',
      url: '/api/profile/parse-resume?apply=true',
      headers: {
        ...headers,
        'content-type': `multipart/form-data; boundary=${goodFile.boundary}`
      },
      payload: goodFile.payload
    });

    expect(parseRes.statusCode).toBe(200);
    const body = parseRes.json();
    expect(body.parsed.fullName).toBe('Ananya Sharma');
    expect(body.appliedProfile.activeProfileVersion).toBe(2);
    expect(body.appliedProfile.indiaProfile.collegeName).toBe('IIIT Hyderabad');
    expect(body.appliedProfile.indiaProfile.cgpa).toBe(9.1);
  });

  it('supports profile edits, story bank, saved answers, export, and account deletion', async () => {
    const ctx = setupTestApp();
    const app = await buildApp({ ...ctx, enableLogger: false });
    const headers = { authorization: 'Bearer valid-jwt' };

    const updateProfile = await app.inject({
      method: 'PUT',
      url: '/api/profile',
      headers,
      payload: {
        indiaProfile: {
          currentCtcLpa: 0,
          expectedCtcLpa: 18,
          noticePeriodDays: 0,
          preferredCities: ['Bengaluru', 'Hyderabad'],
          willingToRelocate: true,
          isFresher: true,
          internshipStatus: 'completed_internship',
          cgpa: 8.9,
          cgpaScale: 10,
          collegeName: 'IIIT Hyderabad',
          tenthPercentage: 96,
          twelfthPercentage: 95
        },
        markOnboardingComplete: true
      }
    });
    expect(updateProfile.statusCode).toBe(200);
    expect(updateProfile.json().activeProfileVersion).toBe(2);
    expect(updateProfile.json().indiaProfile.expectedCtcLpa).toBe(18);

    const storyRes = await app.inject({
      method: 'POST',
      url: '/api/stories',
      headers,
      payload: {
        title: 'Distributed Queue Throughput',
        category: 'optimization',
        action: 'Batched Postgres writes',
        result: '3x throughput',
        metrics: [{ label: 'Throughput', value: '3x', unit: 'RPS' }],
        skillsUsed: ['PostgreSQL', 'Node.js']
      }
    });
    expect(storyRes.statusCode).toBe(201);

    const answerRes = await app.inject({
      method: 'POST',
      url: '/api/answers',
      headers,
      payload: {
        questionKey: 'notice_period_india',
        questionPattern: 'What is your notice period?',
        answer: 'Immediate joiner (2026 graduate).',
        tags: ['india']
      }
    });
    expect(answerRes.statusCode).toBe(201);

    const exportRes = await app.inject({
      method: 'GET',
      url: '/api/account/export',
      headers
    });
    expect(exportRes.statusCode).toBe(200);
    const exported = exportRes.json();
    expect(exported.stories).toHaveLength(1);
    expect(exported.savedAnswers).toHaveLength(1);

    const delRes = await app.inject({
      method: 'DELETE',
      url: '/api/account',
      headers
    });
    expect(delRes.statusCode).toBe(200);

    const afterDeleteStories = await app.inject({
      method: 'GET',
      url: '/api/stories',
      headers
    });
    expect(afterDeleteStories.json()).toEqual([]);
  });
});
