import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { LlmProvider } from '@jobpilot/llm';
import type { LlmProviderId } from '@jobpilot/shared';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { AuthVerifier } from '../plugins/auth.js';
import { MemoryDataStore } from '../store/memory-store.js';

describe('Managed AI tiers, unified credits, and entitlements', () => {
  const encKey = randomBytes(32).toString('hex');
  const userId = '22222222-2222-4222-8222-222222222222';
  const headers = { authorization: 'Bearer valid-jwt' };

  function setupManagedApp(opts?: {
    failLlm?: boolean;
    razorpayWebhookSecret?: string;
  }) {
    const store = new MemoryDataStore();
    const config = loadConfig({
      APP_ENCRYPTION_KEY: encKey,
      BILLING_MODE: 'managed',
      ALLOW_DEMO_BILLING: 'true',
      MANAGED_FAST_PROVIDER: 'gemini',
      MANAGED_FAST_MODEL: 'gemini-3.5-flash-lite',
      MANAGED_PRECISION_PROVIDER: 'gemini',
      MANAGED_PRECISION_MODEL: 'gemini-3.8-flash',
      GEMINI_API_KEY: 'managed-gemini-key',
      OPENAI_API_KEY: 'unused-openai-key',
      ...(opts?.razorpayWebhookSecret
        ? { RAZORPAY_WEBHOOK_SECRET: opts.razorpayWebhookSecret }
        : {})
    });

    const authVerifier: AuthVerifier = {
      verifyToken: async (jwt) =>
        jwt === 'valid-jwt'
          ? { id: userId, email: 'candidate@example.com', fullName: 'Riya Patel' }
          : null
    };

    const recordedCalls: Array<{
      provider: LlmProviderId;
      apiKey: string;
      model?: string;
      taskType: string;
    }> = [];

    const providerFactory = (cfg: {
      provider: LlmProviderId;
      apiKey: string;
      defaultModel?: string;
    }): LlmProvider => ({
      providerId: cfg.provider,
      getCapabilities: () => ({
        structuredOutputMode: 'json_schema',
        supportsTemperature: true,
        tokenLimitParam: 'max_completion_tokens'
      }),
      listModels: async () => [{ id: cfg.defaultModel ?? 'mock-model', displayName: 'Mock' }],
      testKey: async () => ({
        ok: true,
        provider: cfg.provider,
        modelTested: cfg.defaultModel ?? 'mock-model',
        latencyMs: 12,
        modelsCount: 1,
        detectedCapabilities: null,
        message: 'ok'
      }),
      generateStructured: async (req) => {
        recordedCalls.push({
          provider: cfg.provider,
          apiKey: cfg.apiKey,
          model: req.model ?? cfg.defaultModel,
          taskType: req.taskType
        });

        if (opts?.failLlm) {
          throw new Error('Upstream provider timeout');
        }

        if (req.taskType === 'jd_extract') {
          return {
            data: {
              roleTitle: 'Backend Engineer',
              companyName: 'Razorpay',
              mustHaveSkills: ['TypeScript', 'PostgreSQL'],
              niceToHaveSkills: ['Redis'],
              keyResponsibilities: ['Build resilient APIs'],
              keywords: ['TypeScript', 'PostgreSQL', 'Node.js'],
              senioritySignals: ['SDE-1'],
              domainTerms: ['fintech']
            } as never,
            rawText: '{}',
            provider: cfg.provider,
            model: req.model ?? cfg.defaultModel ?? 'mock-model',
            inputTokens: 100,
            outputTokens: 60,
            latencyMs: 15,
            estimatedCostUsd: 0.001,
            retryCount: 0,
            usedRepair: false
          };
        }

        if (req.taskType === 'resume_tailor') {
          return {
            data: {
              summary: 'Backend engineer working with TypeScript and PostgreSQL.',
              selectedWork: [
                {
                  sourceId: 'work-1',
                  name: 'Acme Tech',
                  position: 'Backend Intern',
                  location: 'Bengaluru',
                  startDate: '2025-01',
                  endDate: '2025-06',
                  summary: '',
                  highlights: ['Built TypeScript and PostgreSQL services for billing APIs.']
                }
              ],
              selectedProjects: [],
              selectedEducation: [],
              reorderedSkills: [{ name: 'Backend', level: '', keywords: ['TypeScript', 'PostgreSQL'] }],
              tailoringRationale: 'Highlighted TypeScript and PostgreSQL experience.'
            } as never,
            rawText: '{}',
            provider: cfg.provider,
            model: req.model ?? cfg.defaultModel ?? 'mock-model',
            inputTokens: 200,
            outputTokens: 150,
            latencyMs: 25,
            estimatedCostUsd: 0.002,
            retryCount: 0,
            usedRepair: false
          };
        }

        if (req.taskType === 'resume_verify') {
          return {
            data: {
              claims: [],
              overallNotes: 'LLM verification passed.'
            } as never,
            rawText: '{}',
            provider: cfg.provider,
            model: req.model ?? cfg.defaultModel ?? 'mock-model',
            inputTokens: 80,
            outputTokens: 30,
            latencyMs: 10,
            estimatedCostUsd: 0.0005,
            retryCount: 0,
            usedRepair: false
          };
        }

        if (req.taskType === 'cover_letter') {
          return {
            data: {
              salutation: 'Dear Hiring Team,',
              openingHook: 'I am excited to apply for the Backend Engineer role at Razorpay.',
              bodyParagraphs: [
                'At Acme Tech, I built TypeScript and PostgreSQL services for billing APIs.'
              ],
              closing: 'Thank you for your consideration.',
              selectedStoryIds: [],
              highlightedAchievements: ['TypeScript and PostgreSQL services'],
              rationale: 'Aligned to JD.'
            } as never,
            rawText: '{}',
            provider: cfg.provider,
            model: req.model ?? cfg.defaultModel ?? 'mock-model',
            inputTokens: 120,
            outputTokens: 90,
            latencyMs: 20,
            estimatedCostUsd: 0.001,
            retryCount: 0,
            usedRepair: false
          };
        }

        return {
          data: {
            drafts: [
              {
                fieldId: 'q1',
                answer: 'I built TypeScript and PostgreSQL APIs at Acme Tech.',
                confidence: 0.9,
                source: 'llm_draft',
                rationale: 'Grounded in Acme Tech internship.'
              }
            ]
          } as never,
          rawText: '{}',
          provider: cfg.provider,
          model: req.model ?? cfg.defaultModel ?? 'mock-model',
          inputTokens: 50,
          outputTokens: 40,
          latencyMs: 10,
          estimatedCostUsd: 0.0005,
          retryCount: 0,
          usedRepair: false
        };
      }
    });

    return { store, config, authVerifier, providerFactory, recordedCalls };
  }

  async function seedProfile(app: Awaited<ReturnType<typeof buildApp>>) {
    await app.inject({
      method: 'PUT',
      url: '/api/profile',
      headers,
      payload: {
        fullName: 'Riya Patel',
        email: 'candidate@example.com',
        jsonResume: {
          basics: {
            name: 'Riya Patel',
            label: 'Backend Engineer',
            email: 'candidate@example.com',
            summary: 'Backend engineer with TypeScript and PostgreSQL.'
          },
          work: [
            {
              id: 'work-1',
              name: 'Acme Tech',
              position: 'Backend Intern',
              location: 'Bengaluru',
              startDate: '2025-01',
              endDate: '2025-06',
              highlights: ['Built TypeScript and PostgreSQL services for billing APIs.']
            }
          ],
          projects: [],
          education: [],
          skills: [{ name: 'Backend', level: '', keywords: ['TypeScript', 'PostgreSQL'] }]
        }
      }
    });
  }

  it('provisions Free tier (25 credits, 1 variant cap, deterministic-only verifier, non-API adapters locked)', async () => {
    const { store, config, authVerifier, providerFactory, recordedCalls } = setupManagedApp();
    const app = await buildApp({ config, store, authVerifier, providerFactory, enableLogger: false });
    await seedProfile(app);

    const statusRes = await app.inject({ method: 'GET', url: '/api/billing/status', headers });
    expect(statusRes.statusCode).toBe(200);
    const snap = statusRes.json();
    expect(snap.subscription.planId).toBe('free');
    expect(snap.totalCreditsRemaining).toBe(25);
    expect(snap.entitlements.maxProfileVariants).toBe(1);
    expect(snap.entitlements.dualLlmVerifier).toBe(false);
    expect(snap.entitlements.nonApiAdaptersUnlocked).toBe(false);

    // Free plan caps profile variants at 1
    await app.inject({ method: 'GET', url: '/api/profiles/variants', headers });
    const varRes = await app.inject({
      method: 'POST',
      url: '/api/profiles/variants',
      headers,
      payload: { name: 'Second Variant', targetRole: 'Frontend' }
    });
    expect(varRes.statusCode).toBe(403);
    expect(varRes.json().code).toBe('PLAN_LIMIT_REACHED');
    expect(varRes.json().requiredPlan).toBe('pro');

    // Tailor on Free routes to Fast managed model, deducts 3 credits, and skips LLM verifier
    const tailorRes = await app.inject({
      method: 'POST',
      url: '/api/resumes/tailor',
      headers,
      payload: {
        customJob: {
          title: 'Backend Engineer',
          companyName: 'Razorpay',
          description: 'Looking for TypeScript and PostgreSQL backend engineers in Bengaluru.'
        }
      }
    });
    expect(tailorRes.statusCode).toBe(201);
    expect(recordedCalls.some((c) => c.taskType === 'resume_verify')).toBe(false);
    expect(recordedCalls[0]?.apiKey).toBe('managed-gemini-key');
    expect(recordedCalls[0]?.model).toBe('gemini-3.5-flash-lite');

    const afterStatus = await app.inject({ method: 'GET', url: '/api/billing/status', headers });
    expect(afterStatus.json().totalCreditsRemaining).toBe(22);

    await app.close();
  });

  it('enforces 402 Insufficient Credits, supports top-ups (monthly spent first), and refunds on LLM failure', async () => {
    const { store, config, authVerifier, providerFactory } = setupManagedApp();
    const app = await buildApp({ config, store, authVerifier, providerFactory, enableLogger: false });
    await seedProfile(app);

    // Drain monthly credits to 2 (less than 3 required for resume_tailor)
    await store.debitCredits(userId, {
      amount: 23,
      reason: 'test_drain',
      aiMode: 'fast'
    });

    const failTailor = await app.inject({
      method: 'POST',
      url: '/api/resumes/tailor',
      headers,
      payload: {
        customJob: {
          title: 'Backend Engineer',
          companyName: 'Razorpay',
          description: 'Looking for TypeScript and PostgreSQL backend engineers in Bengaluru.'
        }
      }
    });
    expect(failTailor.statusCode).toBe(402);
    expect(failTailor.json().code).toBe('INSUFFICIENT_CREDITS');
    expect(failTailor.json().creditsRequired).toBe(3);
    expect(failTailor.json().creditsRemaining).toBe(2);

    // Purchase 150 top-up pack
    const topupRes = await app.inject({
      method: 'POST',
      url: '/api/billing/checkout',
      headers,
      payload: { kind: 'topup', packId: 'pack_150', currency: 'INR' }
    });
    expect(topupRes.statusCode).toBe(200);
    expect(topupRes.json().snapshot.subscription.monthlyCreditsRemaining).toBe(2);
    expect(topupRes.json().snapshot.subscription.topupCreditsRemaining).toBe(150);

    // Tailor again (costs 3: should drain remaining 2 monthly + 1 topup = 0 monthly, 149 topup)
    const okTailor = await app.inject({
      method: 'POST',
      url: '/api/resumes/tailor',
      headers,
      payload: {
        customJob: {
          title: 'Backend Engineer',
          companyName: 'Razorpay',
          description: 'Looking for TypeScript and PostgreSQL backend engineers in Bengaluru.'
        }
      }
    });
    expect(okTailor.statusCode).toBe(201);

    const afterSub = await store.getOrCreateSubscription(userId);
    expect(afterSub.monthlyCreditsRemaining).toBe(0);
    expect(afterSub.topupCreditsRemaining).toBe(149);
    await app.close();

    // Now test automatic credit refund when LLM fails
    const failSetup = setupManagedApp({ failLlm: true });
    const failApp = await buildApp({
      config: failSetup.config,
      store: failSetup.store,
      authVerifier: failSetup.authVerifier,
      providerFactory: failSetup.providerFactory,
      enableLogger: false
    });
    await seedProfile(failApp);
    const errRes = await failApp.inject({
      method: 'POST',
      url: '/api/resumes/tailor',
      headers,
      payload: {
        customJob: {
          title: 'Backend Engineer',
          companyName: 'Razorpay',
          description: 'Looking for TypeScript and PostgreSQL backend engineers in Bengaluru.'
        }
      }
    });
    expect(errRes.statusCode).toBe(422);
    const refundedSub = await failSetup.store.getOrCreateSubscription(userId);
    expect(refundedSub.monthlyCreditsRemaining).toBe(25);
    await failApp.close();
  });

  it('gates Precision frontier mode to Plus, unlocks Pro/Plus features, and handles 90-day Sprint Pass expiry', async () => {
    const { store, config, authVerifier, providerFactory, recordedCalls } = setupManagedApp();
    const app = await buildApp({ config, store, authVerifier, providerFactory, enableLogger: false });
    await seedProfile(app);

    // Precision requested on Free -> 403 PLAN_UPGRADE_REQUIRED
    const freePrec = await app.inject({
      method: 'POST',
      url: '/api/cover-letters/generate',
      headers,
      payload: {
        customJob: {
          title: 'Backend Engineer',
          companyName: 'Razorpay',
          description: 'Build distributed payments APIs using TypeScript and PostgreSQL.'
        },
        aiMode: 'precision'
      }
    });
    expect(freePrec.statusCode).toBe(403);
    expect(freePrec.json().code).toBe('PLAN_UPGRADE_REQUIRED');
    expect(freePrec.json().requiredPlan).toBe('plus');

    // Upgrade to Plus -> Precision works, routes exclusively to Gemini 2.5 Pro, and runs Dual LLM Verifier on tailor
    const plusRes = await app.inject({
      method: 'POST',
      url: '/api/billing/checkout',
      headers,
      payload: { kind: 'plan', planId: 'plus', currency: 'USD' }
    });
    expect(plusRes.statusCode).toBe(200);
    expect(plusRes.json().snapshot.totalCreditsRemaining).toBe(1200);

    const plusTailor = await app.inject({
      method: 'POST',
      url: '/api/resumes/tailor',
      headers,
      payload: {
        aiMode: 'precision',
        customJob: {
          title: 'Backend Engineer',
          companyName: 'Razorpay',
          description: 'Build distributed payments APIs using TypeScript and PostgreSQL.'
        }
      }
    });
    expect(plusTailor.statusCode).toBe(201);
    expect(recordedCalls.some((c) => c.taskType === 'resume_verify')).toBe(true);
    expect(
      recordedCalls.some((c) => c.apiKey === 'managed-gemini-key' && c.model === 'gemini-3.8-flash')
    ).toBe(true);
    expect(recordedCalls.some((c) => c.provider === 'openai')).toBe(false);

    const afterPlus = await store.getOrCreateSubscription(userId);
    expect(afterPlus.monthlyCreditsRemaining).toBe(1190); // 1200 - 10 precision tailor

    // 90-day Sprint Pass grants 900 credits and preserves top-ups when expired
    await app.inject({
      method: 'POST',
      url: '/api/billing/checkout',
      headers,
      payload: { kind: 'topup', packId: 'pack_150', currency: 'INR' }
    });
    await app.inject({
      method: 'POST',
      url: '/api/billing/checkout',
      headers,
      payload: { kind: 'plan', planId: 'sprint_90', currency: 'INR' }
    });
    const sprintSub = await store.getOrCreateSubscription(userId);
    expect(sprintSub.planId).toBe('sprint_90');
    expect(sprintSub.monthlyCreditsRemaining).toBe(900);
    expect(sprintSub.topupCreditsRemaining).toBe(150);

    // Simulate sprint pass expiry directly in memory store map
    const internalMap = (store as unknown as { subscriptionsByUser: Map<string, { currentPeriodEnd: string }> }).subscriptionsByUser;
    internalMap.get(userId)!.currentPeriodEnd = new Date(Date.now() - 60_000).toISOString();

    const expiredStatus = await app.inject({ method: 'GET', url: '/api/billing/status', headers });
    expect(expiredStatus.statusCode).toBe(200);
    expect(expiredStatus.json().subscription.planId).toBe('free');
    expect(expiredStatus.json().subscription.monthlyCreditsRemaining).toBe(25);
    expect(expiredStatus.json().subscription.topupCreditsRemaining).toBe(150);

    await app.close();
  });

  it('supports Developer BYOK override with 0 managed credit deduction and verifies webhook HMAC', async () => {
    const webhookSecret = 'whsec_test_razorpay_123';
    const { store, config, authVerifier, providerFactory, recordedCalls } = setupManagedApp({
      razorpayWebhookSecret: webhookSecret
    });
    const app = await buildApp({ config, store, authVerifier, providerFactory, enableLogger: false });
    await seedProfile(app);

    // Save BYOK key and enable useByokOverride
    await app.inject({
      method: 'PUT',
      url: '/api/settings/llm/openai',
      headers,
      payload: { isActive: true, apiKey: 'sk-user-byok-secret', selectedModel: 'gpt-4o-mini' }
    });
    await app.inject({
      method: 'PATCH',
      url: '/api/billing/preferences',
      headers,
      payload: { useByokOverride: true }
    });

    const draftRes = await app.inject({
      method: 'POST',
      url: '/api/extension/draft-answers',
      headers,
      payload: {
        jobTitle: 'Backend Engineer',
        companyName: 'Razorpay',
        questions: [{ fieldId: 'q1', label: 'Why Razorpay?' }]
      }
    });
    expect(draftRes.statusCode).toBe(200);
    expect(recordedCalls[0]?.apiKey).toBe('sk-user-byok-secret');

    // Credits remain untouched at 25
    const sub = await store.getOrCreateSubscription(userId);
    expect(sub.monthlyCreditsRemaining).toBe(25);

    // Webhook invalid signature -> 401
    const rawWebhookPayload = JSON.stringify({
      metadata: { userId, kind: 'plan', planId: 'pro', currency: 'INR' }
    });
    const badSig = await app.inject({
      method: 'POST',
      url: '/api/billing/webhook/razorpay',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': 'invalid-sig'
      },
      payload: rawWebhookPayload
    });
    expect(badSig.statusCode).toBe(401);

    // Webhook valid HMAC -> upgrades user to Pro
    const validSig = createHmac('sha256', webhookSecret).update(rawWebhookPayload).digest('hex');
    const goodSig = await app.inject({
      method: 'POST',
      url: '/api/billing/webhook/razorpay',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': validSig
      },
      payload: rawWebhookPayload
    });
    expect(goodSig.statusCode).toBe(200);
    expect(goodSig.json().handled).toBe(true);

    const proSub = await store.getOrCreateSubscription(userId);
    expect(proSub.planId).toBe('pro');
    expect(proSub.monthlyCreditsRemaining).toBe(300);

    await app.close();
  });
});
