import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { LlmProvider } from '@jobpilot/llm';
import type { LlmProviderId } from '@jobpilot/shared';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { MemoryDataStore } from '../store/memory-store.js';

describe('Phase 4 API: Chrome Extension CORS, draft-answers & capture-job', () => {
  it('allows chrome-extension:// origins via CORS and exposes Content-Disposition', async () => {
    const store = new MemoryDataStore();
    const app = await buildApp({
      config: loadConfig({
        APP_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
        CORS_ORIGIN: 'http://localhost:3000'
      }),
      store,
      authVerifier: {
        verifyToken: async () => ({ id: '11111111-1111-4111-8111-111111111111' })
      },
      enableLogger: false
    });

    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/resumes/versions/123/pdf',
      headers: {
        origin: 'chrome-extension://abcdefghijklmnop',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization'
      }
    });

    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(
      'chrome-extension://abcdefghijklmnop'
    );
    expect(String(preflight.headers['access-control-expose-headers'] ?? '')).toContain(
      'Content-Disposition'
    );
  });

  it('drafts extension answers from Saved Answers first and calls LLM only for remaining questions', async () => {
    const store = new MemoryDataStore();
    const userId = '11111111-1111-4111-8111-111111111111';
    const headers = { authorization: 'Bearer valid-jwt' };

    const generateStructured = vi.fn(async () => ({
      data: {
        drafts: [
          {
            fieldId: 'q-why',
            answer: 'Excited to contribute TypeScript and PostgreSQL reliability from my internship at Kestrel Labs.',
            rationale: 'Grounded in Kestrel Labs internship.'
          }
        ]
      },
      provider: 'gemini' as const,
      model: 'gemini-live',
      inputTokens: 90,
      outputTokens: 40,
      latencyMs: 55,
      estimatedCostUsd: 0.0001,
      retryCount: 0,
      usedRepair: false
    }));

    const app = await buildApp({
      config: loadConfig({
        APP_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
        LLM_PROVIDER: 'gemini',
        GEMINI_API_KEY: 'gm-server-key'
      }),
      store,
      authVerifier: {
        verifyToken: async (jwt) => (jwt === 'valid-jwt' ? { id: userId, fullName: 'Asha' } : null)
      },
      providerFactory: (cfg: { provider: LlmProviderId }) =>
        ({
          providerId: cfg.provider,
          generateStructured
        }) as unknown as LlmProvider,
      enableLogger: false
    });

    await app.inject({
      method: 'POST',
      url: '/api/answers',
      headers,
      payload: {
        questionKey: 'notice_period',
        questionPattern: 'What is your current notice period?',
        answer: 'Immediate joiner (0 days notice period; graduating May 2026).',
        tags: ['notice period', 'availability']
      }
    });

    const draftRes = await app.inject({
      method: 'POST',
      url: '/api/extension/draft-answers',
      headers,
      payload: {
        jobTitle: 'Backend Engineer',
        companyName: 'Razorpay',
        questions: [
          { fieldId: 'q-notice', label: 'What is your notice period?' },
          { fieldId: 'q-why', label: 'Why do you want to join Razorpay?' }
        ]
      }
    });

    expect(draftRes.statusCode).toBe(200);
    const body = draftRes.json();
    expect(body.usedLlm).toBe(true);
    expect(body.drafts).toHaveLength(2);
    expect(body.drafts[0]).toMatchObject({
      fieldId: 'q-notice',
      source: 'saved_answer',
      confidence: 0.94
    });
    expect(body.drafts[1]).toMatchObject({
      fieldId: 'q-why',
      source: 'llm_draft',
      confidence: 0.74
    });
    expect(generateStructured).toHaveBeenCalledTimes(1);

    // Without an active LLM key, saved answers still match and open questions stay unmapped gracefully
    const noKeyApp = await buildApp({
      config: loadConfig({
        APP_ENCRYPTION_KEY: randomBytes(32).toString('hex')
      }),
      store,
      authVerifier: {
        verifyToken: async (jwt) => (jwt === 'valid-jwt' ? { id: userId } : null)
      },
      enableLogger: false
    });

    const fallbackRes = await noKeyApp.inject({
      method: 'POST',
      url: '/api/extension/draft-answers',
      headers,
      payload: {
        jobTitle: 'Backend Engineer',
        companyName: 'Razorpay',
        questions: [
          { fieldId: 'q-notice', label: 'Notice period availability' },
          { fieldId: 'q-why', label: 'Why Razorpay?' }
        ]
      }
    });
    expect(fallbackRes.statusCode).toBe(200);
    expect(fallbackRes.json().usedLlm).toBe(false);
    expect(fallbackRes.json().drafts[0].source).toBe('saved_answer');
    expect(fallbackRes.json().drafts[1].source).toBe('unmapped');
  });

  it('captures jobs from the extension idempotently and links tailored resumeVersionId', async () => {
    const store = new MemoryDataStore();
    const userId = '11111111-1111-4111-8111-111111111111';
    const headers = { authorization: 'Bearer valid-jwt' };

    const app = await buildApp({
      config: loadConfig({ APP_ENCRYPTION_KEY: randomBytes(32).toString('hex') }),
      store,
      authVerifier: {
        verifyToken: async (jwt) => (jwt === 'valid-jwt' ? { id: userId } : null)
      },
      enableLogger: false
    });

    const resumeVersionId = randomUUID();
    const first = await app.inject({
      method: 'POST',
      url: '/api/extension/capture-job',
      headers,
      payload: {
        sourceType: 'greenhouse',
        sourceUrl: 'https://boards.greenhouse.io/razorpay/jobs/999',
        title: 'SDE 1',
        companyName: 'Razorpay',
        locationRaw: 'Bengaluru, India',
        resumeVersionId
      }
    });

    expect(first.statusCode).toBe(201);
    const firstBody = first.json();
    expect(firstBody.status).toBe('saved');
    expect(firstBody.resumeVersionId).toBe(resumeVersionId);

    // Repeat capture of same normalized URL updates the same private job + application
    const second = await app.inject({
      method: 'POST',
      url: '/api/extension/capture-job',
      headers,
      payload: {
        sourceType: 'greenhouse',
        sourceUrl: 'https://boards.greenhouse.io/razorpay/jobs/999/',
        title: 'SDE 1 (Backend)',
        companyName: 'Razorpay'
      }
    });

    expect(second.statusCode).toBe(201);
    expect(second.json().jobId).toBe(firstBody.jobId);
    expect(second.json().applicationId).toBe(firstBody.applicationId);

    // Capturing Naukri session job with salaryText succeeds
    const naukriCapture = await app.inject({
      method: 'POST',
      url: '/api/extension/capture-job',
      headers,
      payload: {
        sourceType: 'naukri',
        sourceUrl: 'https://www.naukri.com/job-listings-backend-555',
        title: 'Backend Engineer',
        companyName: 'Swiggy',
        locationRaw: 'Bengaluru',
        salaryText: '18-24 LPA'
      }
    });
    expect(naukriCapture.statusCode).toBe(201);
  });

  it('runs grounded LLM fallback filler, enforces option constraints, caps confidence <= 0.85, and handles missing keys', async () => {
    const store = new MemoryDataStore();
    const userId = '11111111-1111-4111-8111-111111111111';
    const headers = { authorization: 'Bearer valid-jwt' };

    const generateStructured = vi.fn(async () => ({
      data: {
        suggestions: [
          {
            fieldId: 'wd-source',
            canonicalKey: 'unknown',
            proposedValue: 'company website',
            confidence: 0.99, // must be clamped to <= 0.85
            rationale: 'Direct application portal',
            groundedIn: 'Default safe choice'
          },
          {
            fieldId: 'wd-hallucinated-opt',
            canonicalKey: 'degree',
            proposedValue: 'PhD in Astrophysics', // NOT in allowed options -> must be dropped!
            confidence: 0.8,
            rationale: 'Should be dropped',
            groundedIn: 'Hallucinated'
          }
        ]
      },
      provider: 'openai' as const,
      model: 'gpt-4o-mini',
      inputTokens: 120,
      outputTokens: 60,
      latencyMs: 70,
      estimatedCostUsd: 0.0001,
      retryCount: 0,
      usedRepair: false
    }));

    const app = await buildApp({
      config: loadConfig({
        APP_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
        LLM_PROVIDER: 'openai',
        OPENAI_API_KEY: 'sk-test-key'
      }),
      store,
      authVerifier: {
        verifyToken: async (jwt) => (jwt === 'valid-jwt' ? { id: userId, fullName: 'Kabir' } : null)
      },
      providerFactory: (cfg: { provider: LlmProviderId }) =>
        ({
          providerId: cfg.provider,
          generateStructured
        }) as unknown as LlmProvider,
      enableLogger: false
    });

    const fbRes = await app.inject({
      method: 'POST',
      url: '/api/extension/fallback-fill',
      headers,
      payload: {
        atsAdapter: 'workday',
        jobTitle: 'SDE 1',
        companyName: 'Atlassian',
        fields: [
          {
            fieldId: 'wd-source',
            label: 'How did you hear about us?',
            controlType: 'select',
            options: ['LinkedIn', 'Company Website', 'Referral']
          },
          {
            fieldId: 'wd-hallucinated-opt',
            label: 'Highest Degree',
            controlType: 'select',
            options: ['B.Tech', 'M.Tech']
          }
        ]
      }
    });

    expect(fbRes.statusCode).toBe(200);
    const body = fbRes.json();
    expect(body.usedLlm).toBe(true);
    // Snaps case-insensitively to exact option "Company Website", clamps confidence to 0.85, and drops invalid option
    expect(body.suggestions).toHaveLength(1);
    expect(body.suggestions[0]).toMatchObject({
      fieldId: 'wd-source',
      proposedValue: 'Company Website',
      confidence: 0.85
    });

    // Without an active LLM key -> returns usedLlm: false with helpful note
    const noKeyApp = await buildApp({
      config: loadConfig({ APP_ENCRYPTION_KEY: randomBytes(32).toString('hex') }),
      store,
      authVerifier: {
        verifyToken: async (jwt) => (jwt === 'valid-jwt' ? { id: userId } : null)
      },
      enableLogger: false
    });
    const noKeyRes = await noKeyApp.inject({
      method: 'POST',
      url: '/api/extension/fallback-fill',
      headers,
      payload: {
        atsAdapter: 'naukri',
        jobTitle: 'SDE 1',
        companyName: 'Razorpay',
        fields: [{ fieldId: 'q1', label: 'Current notice period?', controlType: 'text' }]
      }
    });
    expect(noKeyRes.statusCode).toBe(200);
    expect(noKeyRes.json().usedLlm).toBe(false);
    expect(noKeyRes.json().suggestions).toHaveLength(0);
  });
});
