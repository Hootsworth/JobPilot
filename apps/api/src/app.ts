import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import {
  ApplicationStatusSchema,
  AtsScoreRequestSchema,
  CaptureExtensionJobRequestSchema,
  CreateCheckoutRequestSchema,
  CreateManualApplicationRequestSchema,
  CreateProfileVariantRequestSchema,
  CREDIT_PACKS,
  DismissJobRequestSchema,
  DraftAnswersRequestSchema,
  FallbackFillRequestSchema,
  GenerateCoverLetterRequestSchema,
  getPlanEntitlements,
  GithubImportRequestSchema,
  JdRequirementsSchema,
  JobFeedQuerySchema,
  LlmProviderIdSchema,
  PaymentProviderSchema,
  PLAN_CATALOG,
  RefreshMatchesRequestSchema,
  SyncJobsRequestSchema,
  TailorResumeRequestSchema,
  TestLlmKeyRequestSchema,
  UpdateApplicationRequestSchema,
  UpdateBillingPreferencesRequestSchema,
  UpdateCoverLetterRequestSchema,
  UpdateProfileRequestSchema,
  UpdateProfileVariantRequestSchema,
  UpsertLlmSettingsSchema,
  UpsertSavedAnswerRequestSchema,
  UpsertStoryRequestSchema,
  type AiQualityMode,
  type JobFeedItem,
  type JobMatch,
  type LlmProviderId,
  type LlmSettingsItem,
  type MasterProfile,
  type RecommendationsResponse
} from '@jobpilot/shared';
import {
  runDiscoverySync,
  runThreeStageMatching,
  type JobForMatching
} from '@jobpilot/ingestion';
import { resolveMetaBaseUrl, type LlmProvider } from '@jobpilot/llm';
import {
  formatCoverLetterPlainText,
  generateCoverLetterPipeline,
  generateTypstCoverLetterSource,
  renderCoverLetterPdf,
  runDualVerification,
  scoreResumeAgainstJd,
  tailorResumePipeline
} from '@jobpilot/tailoring';
import type { ApiConfig } from './config.js';
import { createAuthPreHandler, type AuthVerifier } from './plugins/auth.js';
import {
  createBillingCheckout,
  processVerifiedWebhookEvent,
  verifyWebhookSignature
} from './services/billing-gateway.js';
import { encryptSecret } from './services/crypto.js';
import {
  acquireLlmForAction,
  buildBillingSnapshot,
  EntitlementError,
  hasManagedServerKeys
} from './services/entitlements.js';
import { draftExtensionQuestionAnswers } from './services/extension-draft.js';
import { runExtensionLlmFallbackFill } from './services/extension-fallback-fill.js';
import {
  importFromGithub,
  ImporterError,
  parseLinkedinPdfExport
} from './services/importers.js';
import {
  getEnvApiKeyForProvider,
  resolveUserLlmProvider,
  type LlmProviderFactory
} from './services/llm-resolver.js';
import {
  MAX_RESUME_PDF_BYTES,
  parseResumePdfWithLlm,
  ResumeParseError
} from './services/resume-parser.js';
import { JobSyncService } from './services/job-sync.js';
import { matchesFeedBucket } from './store/memory-store.js';
import type { AuthUser, DataStore } from './store/types.js';

export interface BuildAppDeps {
  config: ApiConfig;
  store: DataStore;
  authVerifier: AuthVerifier;
  providerFactory?: LlmProviderFactory;
  fetchImpl?: typeof fetch;
  enableLogger?: boolean;
  syncRunner?: typeof runDiscoverySync;
  jobSync?: JobSyncService;
}

const ALL_PROVIDERS: LlmProviderId[] = ['openai', 'gemini', 'meta'];

export async function buildApp(deps: BuildAppDeps): Promise<FastifyInstance> {
  const { config, store, authVerifier, providerFactory } = deps;
  const jobSync =
    deps.jobSync ??
    new JobSyncService({
      store,
      config,
      syncRunner: deps.syncRunner
    });

  const app = Fastify({
    logger:
      deps.enableLogger === false
        ? false
        : {
            level: config.logLevel,
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                '*.apiKey',
                '*.encryptedApiKey',
                '*.encrypted_api_key',
                '*.OPENAI_API_KEY',
                '*.GEMINI_API_KEY',
                '*.META_API_KEY'
              ],
              censor: '[REDACTED]'
            }
          }
  });

  const allowedOrigins = config.corsOrigin
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  await app.register(cors, {
    origin: (origin, cb) => {
      const normalizedOrigin = origin?.replace(/\/+$/, '');
      if (
        !normalizedOrigin ||
        normalizedOrigin.startsWith('chrome-extension://') ||
        allowedOrigins.includes('*') ||
        allowedOrigins.includes(normalizedOrigin)
      ) {
        cb(null, true);
        return;
      }
      if (allowedOrigins.length === 0) {
        cb(null, true);
        return;
      }
      cb(null, false);
    },
    credentials: true,
    exposedHeaders: ['Content-Disposition']
  });

  await app.register(multipart, {
    limits: {
      fileSize: MAX_RESUME_PDF_BYTES,
      files: 1
    }
  });

  await app.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute'
  });

  const requireAuth = createAuthPreHandler(authVerifier);

  function replyEntitlementError(reply: { code: (status: number) => { send: (body: unknown) => unknown } }, err: EntitlementError) {
    return reply.code(err.statusCode).send(err.toJSON());
  }

  app.get('/health', async () => ({
    ok: true,
    service: 'jobpilot-api',
    version: '0.1.0',
    defaultProvider: config.llmProvider,
    billingMode: config.billingMode,
    managedAiEnabled: hasManagedServerKeys(config)
  }));

  // --- Billing, Plans & Unified Credits ---
  app.get('/api/billing/plans', async () => ({
    plans: Object.values(PLAN_CATALOG),
    creditPacks: Object.values(CREDIT_PACKS)
  }));

  app.get('/api/billing/status', { preHandler: requireAuth }, async (request) => {
    return buildBillingSnapshot(request.authUser!.id, config, store);
  });

  app.patch('/api/billing/preferences', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = UpdateBillingPreferencesRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid billing preferences payload', issues: parsed.error.issues });
    }
    const userId = request.authUser!.id;
    const sub = await store.getOrCreateSubscription(userId);
    const entitlements = getPlanEntitlements(sub.planId);

    if (
      parsed.data.aiModePreference &&
      !entitlements.allowedAiModes.includes(parsed.data.aiModePreference) &&
      !parsed.data.useByokOverride &&
      !sub.useByokOverride
    ) {
      return replyEntitlementError(
        reply,
        new EntitlementError({
          statusCode: 403,
          code: 'PLAN_UPGRADE_REQUIRED',
          requiredPlan: 'plus',
          message: 'Precision frontier models require the Plus plan.'
        })
      );
    }

    await store.updateSubscriptionPreferences(userId, parsed.data);
    return buildBillingSnapshot(userId, config, store);
  });

  app.post('/api/billing/checkout', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = CreateCheckoutRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid checkout payload', issues: parsed.error.issues });
    }
    try {
      return await createBillingCheckout({
        userId: request.authUser!.id,
        userEmail: request.authUser!.email,
        request: parsed.data,
        config,
        store,
        fetchImpl: deps.fetchImpl
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Checkout failed.';
      return reply.code(400).send({ error: message });
    }
  });

  await app.register(async (webhookScope) => {
    webhookScope.addContentTypeParser(
      'application/json',
      { parseAs: 'string' },
      (_req, body, done) => {
        done(null, body);
      }
    );

    webhookScope.post('/api/billing/webhook/:provider', async (request, reply) => {
      const { provider: rawProvider } = request.params as { provider: string };
      const provCheck = PaymentProviderSchema.safeParse(rawProvider);
      if (!provCheck.success || provCheck.data === 'manual') {
        return reply.code(400).send({ error: 'Unsupported payment webhook provider.' });
      }
      const provider = provCheck.data;
      const rawBody = typeof request.body === 'string' ? request.body : JSON.stringify(request.body ?? {});

      const sigHeader =
        provider === 'stripe'
          ? (request.headers['stripe-signature'] as string | undefined)
          : provider === 'razorpay'
            ? (request.headers['x-razorpay-signature'] as string | undefined)
            : (request.headers['webhook-signature'] as string | undefined) ??
              (request.headers['x-dodo-signature'] as string | undefined);

      const valid = verifyWebhookSignature({
        provider,
        rawBody,
        signatureHeader: sigHeader,
        config
      });
      if (!valid) {
        return reply.code(401).send({ error: 'Invalid webhook signature.' });
      }

      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(rawBody) as Record<string, unknown>;
      } catch {
        return reply.code(400).send({ error: 'Invalid JSON webhook body.' });
      }

      const result = await processVerifiedWebhookEvent({ provider, payload, store });
      return { ok: true, ...result };
    });
  });

  // --- Master Profile ---
  app.get('/api/profile', { preHandler: requireAuth }, async (request) => {
    return store.getOrCreateProfile(request.authUser!);
  });

  app.put('/api/profile', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = UpdateProfileRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid profile update payload',
        issues: parsed.error.issues
      });
    }
    return store.updateProfile(request.authUser!.id, parsed.data, true);
  });

  app.post('/api/profile/parse-resume', { preHandler: requireAuth }, async (request, reply) => {
    const user = request.authUser!;
    const query = request.query as { apply?: string; provider?: string; model?: string };
    const shouldApply = query.apply === 'true';

    let filePart: Awaited<ReturnType<typeof request.file>> | undefined;
    try {
      filePart = await request.file();
    } catch {
      return reply.code(400).send({ error: 'Expected multipart/form-data upload with a PDF file.' });
    }

    if (!filePart) {
      return reply.code(400).send({ error: 'No PDF file attached under multipart field.' });
    }

    const buffer = await filePart.toBuffer();
    const providerCheck = query.provider
      ? LlmProviderIdSchema.safeParse(query.provider)
      : null;
    if (providerCheck && !providerCheck.success) {
      return reply.code(400).send({ error: 'Invalid provider override parameter.' });
    }

    let acquired: Awaited<ReturnType<typeof acquireLlmForAction>> | null = null;
    try {
      acquired = await acquireLlmForAction({
        userId: user.id,
        action: 'resume_parse',
        providerOverride: providerCheck?.success ? providerCheck.data : undefined,
        modelOverride: query.model,
        config,
        store,
        providerFactory
      });

      const parseResult = await parseResumePdfWithLlm({
        buffer,
        provider: acquired.provider,
        model: query.model ?? acquired.model
      });

      const storagePath = await store.uploadRawResume(
        user.id,
        filePart.filename || 'resume.pdf',
        buffer
      );

      let appliedProfile = null;
      if (shouldApply) {
        const existing = await store.getOrCreateProfile(user);
        const signals = parseResult.parsed.extractedIndiaSignals;
        appliedProfile = await store.updateProfile(
          user.id,
          {
            fullName: parseResult.parsed.fullName || existing.fullName || undefined,
            email: parseResult.parsed.email || existing.email || undefined,
            phone: parseResult.parsed.phone || existing.phone || undefined,
            jsonResume: parseResult.parsed.jsonResume,
            indiaProfile: {
              ...existing.indiaProfile,
              collegeName: signals.collegeName ?? existing.indiaProfile.collegeName,
              degree: signals.degree ?? existing.indiaProfile.degree,
              branch: signals.branch ?? existing.indiaProfile.branch,
              graduationYear:
                signals.graduationYear !== undefined
                  ? signals.graduationYear
                  : existing.indiaProfile.graduationYear,
              cgpa: signals.cgpa !== undefined ? signals.cgpa : existing.indiaProfile.cgpa,
              cgpaScale: signals.cgpaScale ?? existing.indiaProfile.cgpaScale,
              tenthPercentage:
                signals.tenthPercentage !== undefined
                  ? signals.tenthPercentage
                  : existing.indiaProfile.tenthPercentage,
              twelfthPercentage:
                signals.twelfthPercentage !== undefined
                  ? signals.twelfthPercentage
                  : existing.indiaProfile.twelfthPercentage,
              isFresher:
                signals.isFresher !== undefined
                  ? signals.isFresher
                  : existing.indiaProfile.isFresher,
              preferredCities:
                signals.preferredCities && signals.preferredCities.length > 0
                  ? signals.preferredCities
                  : existing.indiaProfile.preferredCities
            },
            sourceResumeStoragePath: storagePath
          },
          true
        );
      } else {
        await store.updateProfile(user.id, { sourceResumeStoragePath: storagePath }, false);
      }

      return {
        storagePath,
        ...parseResult,
        ...(appliedProfile ? { appliedProfile } : {})
      };
    } catch (err) {
      await acquired?.refund('parse_failed');
      if (err instanceof EntitlementError) {
        return replyEntitlementError(reply, err);
      }
      if (err instanceof ResumeParseError) {
        return reply.code(err.statusCode).send({ error: err.message });
      }
      const message = err instanceof Error ? err.message : 'Resume parsing failed.';
      return reply.code(422).send({ error: message });
    }
  });

  // --- Profile Variants (#8) ---
  app.get('/api/profiles/variants', { preHandler: requireAuth }, async (request) => {
    return store.listProfileVariants(request.authUser!.id);
  });

  app.post('/api/profiles/variants', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = CreateProfileVariantRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid profile variant payload', issues: parsed.error.issues });
    }
    const userId = request.authUser!.id;
    const [existingVariants, sub] = await Promise.all([
      store.listProfileVariants(userId),
      store.getOrCreateSubscription(userId)
    ]);
    const entitlements = getPlanEntitlements(sub.planId);
    if (existingVariants.length >= entitlements.maxProfileVariants) {
      return replyEntitlementError(
        reply,
        new EntitlementError({
          statusCode: 403,
          code: 'PLAN_LIMIT_REACHED',
          requiredPlan: existingVariants.length < 3 ? 'pro' : 'plus',
          message: `Your ${PLAN_CATALOG[sub.planId].name} plan allows up to ${entitlements.maxProfileVariants} profile variant${entitlements.maxProfileVariants === 1 ? '' : 's'}. Upgrade to add more.`
        })
      );
    }

    const created = await store.createProfileVariant(userId, parsed.data);
    return reply.code(201).send(created);
  });

  app.put('/api/profiles/variants/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = UpdateProfileVariantRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid profile variant update', issues: parsed.error.issues });
    }
    const updated = await store.updateProfileVariant(request.authUser!.id, id, parsed.data);
    if (!updated) return reply.code(404).send({ error: 'Profile variant not found.' });
    return updated;
  });

  app.delete('/api/profiles/variants/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const variants = await store.listProfileVariants(request.authUser!.id);
    if (variants.length <= 1) {
      return reply.code(400).send({ error: 'Cannot delete your last remaining profile variant.' });
    }
    const ok = await store.deleteProfileVariant(request.authUser!.id, id);
    if (!ok) return reply.code(404).send({ error: 'Profile variant not found.' });
    return { ok: true };
  });

  // --- GitHub & LinkedIn PDF Profile Importers (#9) ---
  app.post('/api/profile/import/github', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = GithubImportRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid GitHub import request', issues: parsed.error.issues });
    }
    try {
      const candidate = await importFromGithub(parsed.data, deps.fetchImpl);
      return candidate;
    } catch (err) {
      if (err instanceof ImporterError) {
        return reply.code(err.statusCode).send({ error: err.message });
      }
      const message = err instanceof Error ? err.message : 'GitHub import failed.';
      return reply.code(502).send({ error: message });
    }
  });

  app.post(
    '/api/profile/import/linkedin-pdf',
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        const part = await request.file();
        if (!part) {
          return reply.code(400).send({ error: 'Please attach a LinkedIn PDF export file.' });
        }
        const buffer = await part.toBuffer();
        if (buffer.byteLength > MAX_RESUME_PDF_BYTES) {
          return reply.code(413).send({ error: 'PDF file exceeds maximum allowed size.' });
        }
        const candidate = await parseLinkedinPdfExport(buffer);
        return candidate;
      } catch (err) {
        if (err instanceof ImporterError) {
          return reply.code(err.statusCode).send({ error: err.message });
        }
        const message = err instanceof Error ? err.message : 'Failed to parse LinkedIn PDF.';
        return reply.code(422).send({ error: message });
      }
    }
  );

  // --- Story Bank ---
  app.get('/api/stories', { preHandler: requireAuth }, async (request) => {
    return store.listStories(request.authUser!.id);
  });

  app.post('/api/stories', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = UpsertStoryRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid story payload', issues: parsed.error.issues });
    }
    const created = await store.createStory(request.authUser!.id, parsed.data);
    return reply.code(201).send(created);
  });

  app.put('/api/stories/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = UpsertStoryRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid story payload', issues: parsed.error.issues });
    }
    const updated = await store.updateStory(request.authUser!.id, id, parsed.data);
    if (!updated) return reply.code(404).send({ error: 'Story not found.' });
    return updated;
  });

  app.delete('/api/stories/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleted = await store.deleteStory(request.authUser!.id, id);
    if (!deleted) return reply.code(404).send({ error: 'Story not found.' });
    return { ok: true };
  });

  // --- Saved Answers ---
  app.get('/api/answers', { preHandler: requireAuth }, async (request) => {
    return store.listSavedAnswers(request.authUser!.id);
  });

  app.post('/api/answers', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = UpsertSavedAnswerRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid saved answer payload', issues: parsed.error.issues });
    }
    const created = await store.createSavedAnswer(request.authUser!.id, parsed.data);
    return reply.code(201).send(created);
  });

  app.put('/api/answers/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = UpsertSavedAnswerRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid saved answer payload', issues: parsed.error.issues });
    }
    const updated = await store.updateSavedAnswer(request.authUser!.id, id, parsed.data);
    if (!updated) return reply.code(404).send({ error: 'Saved answer not found.' });
    return updated;
  });

  app.delete('/api/answers/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleted = await store.deleteSavedAnswer(request.authUser!.id, id);
    if (!deleted) return reply.code(404).send({ error: 'Saved answer not found.' });
    return { ok: true };
  });

  // --- LLM Settings & BYOK ---
  app.get('/api/settings/llm', { preHandler: requireAuth }, async (request) => {
    const userId = request.authUser!.id;
    const rows = await store.listLlmSettings(userId);
    const hasExplicitActive = rows.some((r) => r.isActive);

    const items: LlmSettingsItem[] = ALL_PROVIDERS.map((provider) => {
      const row = rows.find((r) => r.provider === provider);
      const hasKey = Boolean(row?.encryptedApiKey && row?.keyIv && row?.keyAuthTag);
      const hasEnvKey = Boolean(getEnvApiKeyForProvider(config, provider));
      return {
        provider,
        isActive: row ? row.isActive : !hasExplicitActive && provider === config.llmProvider,
        selectedModel:
          row?.selectedModel ??
          (provider === config.llmProvider ? (config.llmModel ?? null) : null),
        baseUrlOverride:
          row?.baseUrlOverride ?? (provider === 'meta' ? resolveMetaBaseUrl(undefined, { META_BASE_URL: config.metaBaseUrl }) : null),
        hasKey,
        keyHint: row?.keyHint ?? null,
        usingEnvFallback: !hasKey && hasEnvKey,
        detectedCapabilities: row?.detectedCapabilities ?? null,
        lastTestedAt: row?.lastTestedAt ?? null,
        lastTestStatus: row?.lastTestStatus ?? 'untested'
      };
    });

    return {
      defaultEnvProvider: config.llmProvider,
      items
    };
  });

  app.put('/api/settings/llm/:provider', { preHandler: requireAuth }, async (request, reply) => {
    const { provider: rawProvider } = request.params as { provider: string };
    const provCheck = LlmProviderIdSchema.safeParse(rawProvider);
    if (!provCheck.success) {
      return reply.code(400).send({ error: 'Unsupported provider. Expected openai, gemini, or meta.' });
    }
    const bodyCheck = UpsertLlmSettingsSchema.safeParse(request.body);
    if (!bodyCheck.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid LLM settings payload', issues: bodyCheck.error.issues });
    }

    const userId = request.authUser!.id;
    const provider = provCheck.data;
    const body = bodyCheck.data;
    const patch: Parameters<DataStore['upsertLlmSetting']>[2] = {};

    if (body.isActive !== undefined) patch.isActive = body.isActive;
    if (body.selectedModel !== undefined) patch.selectedModel = body.selectedModel;
    if (body.baseUrlOverride !== undefined) {
      patch.baseUrlOverride = body.baseUrlOverride === '' ? null : body.baseUrlOverride;
    }

    if (body.apiKey) {
      if (!config.appEncryptionKey) {
        return reply.code(500).send({
          error: 'APP_ENCRYPTION_KEY is not configured on the API server; cannot encrypt BYOK keys.'
        });
      }
      const enc = encryptSecret(body.apiKey, config.appEncryptionKey);
      patch.encryptedApiKey = enc.ciphertext;
      patch.keyIv = enc.iv;
      patch.keyAuthTag = enc.authTag;
      patch.keyHint = enc.keyHint;
      patch.lastTestStatus = 'untested';
    }

    const saved = await store.upsertLlmSetting(userId, provider, patch);
    const hasKey = Boolean(saved.encryptedApiKey && saved.keyIv && saved.keyAuthTag);
    const hasEnvKey = Boolean(getEnvApiKeyForProvider(config, provider));

    const safeResponse: LlmSettingsItem = {
      provider: saved.provider,
      isActive: saved.isActive,
      selectedModel: saved.selectedModel,
      baseUrlOverride: saved.baseUrlOverride,
      hasKey,
      keyHint: saved.keyHint,
      usingEnvFallback: !hasKey && hasEnvKey,
      detectedCapabilities: saved.detectedCapabilities,
      lastTestedAt: saved.lastTestedAt,
      lastTestStatus: saved.lastTestStatus
    };
    return safeResponse;
  });

  app.delete('/api/settings/llm/:provider/key', { preHandler: requireAuth }, async (request, reply) => {
    const { provider: rawProvider } = request.params as { provider: string };
    const provCheck = LlmProviderIdSchema.safeParse(rawProvider);
    if (!provCheck.success) {
      return reply.code(400).send({ error: 'Unsupported provider.' });
    }
    await store.clearLlmKey(request.authUser!.id, provCheck.data);
    return { ok: true };
  });

  app.get('/api/settings/llm/models', { preHandler: requireAuth }, async (request, reply) => {
    const query = request.query as { provider?: string };
    const provCheck = query.provider ? LlmProviderIdSchema.safeParse(query.provider) : null;
    if (provCheck && !provCheck.success) {
      return reply.code(400).send({ error: 'Invalid provider query parameter.' });
    }

    try {
      const { provider, providerId } = await resolveUserLlmProvider({
        userId: request.authUser!.id,
        config,
        store,
        providerOverride: provCheck?.success ? provCheck.data : undefined,
        providerFactory
      });
      const models = await provider.listModels();
      return { provider: providerId, models };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to list provider models.';
      return reply.code(400).send({ error: msg });
    }
  });

  app.post('/api/settings/llm/models', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = TestLlmKeyRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request body', issues: parsed.error.issues });
    }

    try {
      const { provider, providerId } = await resolveUserLlmProvider({
        userId: request.authUser!.id,
        config,
        store,
        providerOverride: parsed.data.provider,
        apiKeyOverride: parsed.data.apiKey,
        baseUrlOverride: parsed.data.baseUrlOverride,
        providerFactory
      });
      const models = await provider.listModels();
      return { provider: providerId, models };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to list provider models.';
      return reply.code(400).send({ error: msg });
    }
  });

  app.post('/api/settings/llm/test', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = TestLlmKeyRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid test key request', issues: parsed.error.issues });
    }

    const userId = request.authUser!.id;
    const { provider: providerId, apiKey, model, baseUrlOverride } = parsed.data;

    try {
      const resolved = await resolveUserLlmProvider({
        userId,
        config,
        store,
        providerOverride: providerId,
        apiKeyOverride: apiKey,
        modelOverride: model,
        baseUrlOverride,
        providerFactory
      });

      const result = await resolved.provider.testKey(model);

      // Update stored capability / test metadata if user wasn't passing an unrelated unsaved key,
      // or record result on existing setting
      const existing = await store.getLlmSetting(userId, providerId);
      if (existing || !apiKey) {
        await store.upsertLlmSetting(userId, providerId, {
          lastTestedAt: new Date().toISOString(),
          lastTestStatus: result.ok ? 'ok' : 'error',
          ...(result.detectedCapabilities
            ? { detectedCapabilities: result.detectedCapabilities }
            : {})
        });
      }

      return result;
    } catch (err) {
      return {
        ok: false,
        provider: providerId,
        modelTested: model ?? null,
        latencyMs: 0,
        modelsCount: 0,
        detectedCapabilities: null,
        message: err instanceof Error ? err.message : 'Key test failed.'
      };
    }
  });

  function collectDismissedCompanies(
    matches: JobMatch[],
    jobsById: Map<string, JobForMatching>
  ): Set<string> {
    const companies = new Set<string>();
    for (const m of matches) {
      if (m.dismissed && m.hardFilterReasons.includes('dismiss_reason:company')) {
        const job = jobsById.get(m.jobId);
        if (job?.companyName.trim()) {
          companies.add(job.companyName.trim().toLowerCase());
        }
      }
    }
    return companies;
  }

  async function computeUserMatches(opts: {
    user: AuthUser;
    useLlm: boolean;
    aiMode?: AiQualityMode;
    topKVector: number;
    topKLlm: number;
    forceRecompute: boolean;
  }) {
    const [profile, stories, profileEmbedding, jobs] = await Promise.all([
      store.getOrCreateProfile(opts.user),
      store.listStories(opts.user.id),
      store.getProfileEmbedding(opts.user.id),
      store.listActiveJobsForMatching(opts.user.id, 600)
    ]);

    const existingMatches = await store.listMatchesForProfileVersion(
      opts.user.id,
      profile.activeProfileVersion
    );
    const existingByJobId = new Map(existingMatches.map((m) => [m.jobId, m]));
    const jobsById = new Map(jobs.map((j) => [j.id, j]));
    const dismissedCompanies = collectDismissedCompanies(existingMatches, jobsById);

    let llmProvider: LlmProvider | null = null;
    let acquired: Awaited<ReturnType<typeof acquireLlmForAction>> | null = null;
    if (opts.useLlm) {
      try {
        acquired = await acquireLlmForAction({
          userId: opts.user.id,
          action: 'job_match_rerank',
          requestedAiMode: opts.aiMode,
          config,
          store,
          providerFactory
        });
        llmProvider = acquired.provider;
      } catch (err) {
        if (err instanceof EntitlementError) throw err;
        // No LLM key configured yet — run Stage 1 (hard filters) + Stage 2 (vector/skill/role baseline)
        llmProvider = null;
      }
    }

    try {
      const result = await runThreeStageMatching({
        profile,
        stories,
        jobs,
        profileEmbedding,
        existingMatchesByJobId: existingByJobId,
        llmProvider,
        topKVector: opts.topKVector,
        topKLlm: opts.topKLlm,
        forceRecompute: opts.forceRecompute,
        dismissedCompanies
      });

      await store.upsertJobMatches(opts.user.id, result.matches);

      return {
        profile,
        jobs,
        matches: result.matches,
        stats: result.stats,
        usedLlm: Boolean(llmProvider),
        dismissedCompanies
      };
    } catch (err) {
      await acquired?.refund('match_rerank_failed');
      throw err;
    }
  }

  // --- Jobs Feed, Auto Sync & Recommendations ---
  app.get('/api/jobs', { preHandler: requireAuth }, async (request, reply) => {
    const queryCheck = JobFeedQuerySchema.safeParse(request.query);
    if (!queryCheck.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid job feed query parameters', issues: queryCheck.error.issues });
    }
    const profile = await store.getOrCreateProfile(request.authUser!);
    return store.listJobsFeed(request.authUser!.id, profile.activeProfileVersion, queryCheck.data);
  });

  app.get('/api/jobs/sources', { preHandler: requireAuth }, async () => {
    return store.listJobSourcesAndRuns();
  });

  async function getUserSyncStaleHours(userId: string): Promise<number | undefined> {
    const sub = await store.getOrCreateSubscription(userId);
    return getPlanEntitlements(sub.planId).priorityJobSync ? 1 : undefined;
  }

  app.get('/api/jobs/sync/status', { preHandler: requireAuth }, async (request) => {
    const staleOverride = await getUserSyncStaleHours(request.authUser!.id);
    return jobSync.getStatus(request.authUser!.id, staleOverride);
  });

  app.post('/api/jobs/sync', { preHandler: requireAuth }, async (request, reply) => {
    const parsedBody = SyncJobsRequestSchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid sync request payload', issues: parsedBody.error.issues });
    }

    const user = request.authUser!;
    const [profile, staleHoursOverride] = await Promise.all([
      store.getOrCreateProfile(user),
      getUserSyncStaleHours(user.id)
    ]);
    const syncRes = await jobSync.syncNow({
      userId: user.id,
      profile,
      mode: parsedBody.data.mode,
      force: parsedBody.data.force,
      staleHoursOverride
    });

    try {
      const matchOut = await computeUserMatches({
        user,
        useLlm: parsedBody.data.includeLlm,
        topKVector: parsedBody.data.includeLlm ? 150 : 600,
        topKLlm: parsedBody.data.includeLlm ? 15 : 0,
        forceRecompute: false
      });

      const syncStatus = await jobSync.getStatus(user.id, staleHoursOverride);
      return {
        alreadyRunning: syncRes.alreadyRunning,
        skipped: syncRes.skipped,
        reason: syncRes.reason,
        insertedCount: syncRes.insertedCount,
        updatedCount: syncRes.updatedCount,
        rawJobsCount: syncRes.rawJobsCount,
        dedupedCount: syncRes.dedupedCount,
        boardSuccess: syncRes.boardSuccess,
        boardFailures: syncRes.boardFailures,
        aggregatorCount: syncRes.aggregatorCount,
        matchStats: matchOut.stats,
        syncStatus
      };
    } catch (err) {
      if (err instanceof EntitlementError) {
        return replyEntitlementError(reply, err);
      }
      throw err;
    }
  });

  app.get('/api/jobs/recommendations', { preHandler: requireAuth }, async (request) => {
    const user = request.authUser!;
    let [profile, activeJobs, existingMatches, apps] = await Promise.all([
      store.getOrCreateProfile(user),
      store.listActiveJobsForMatching(user.id, 600),
      Promise.resolve([] as JobMatch[]),
      store.listApplications(user.id)
    ]);

    existingMatches = await store.listMatchesForProfileVersion(
      user.id,
      profile.activeProfileVersion
    );

    const existingByJobId = new Map(existingMatches.map((m) => [m.jobId, m]));
    const unscoredCount = activeJobs.filter((j) => !existingByJobId.has(j.id)).length;
    let autoMatchedCount = 0;

    if (activeJobs.length > 0 && unscoredCount > 0) {
      const matched = await computeUserMatches({
        user,
        useLlm: false,
        topKVector: Math.max(200, activeJobs.length),
        topKLlm: 0,
        forceRecompute: false
      });
      activeJobs = matched.jobs;
      existingMatches = matched.matches;
      autoMatchedCount = matched.matches.length;
    }

    const matchByJob = new Map(existingMatches.map((m) => [m.jobId, m]));
    const jobsById = new Map(activeJobs.map((j) => [j.id, j]));
    const dismissedCompanies = collectDismissedCompanies(existingMatches, jobsById);
    const appStatusByJob = new Map(apps.map((a) => [a.jobId, a.status]));

    const feedItems: JobFeedItem[] = [];
    for (const job of activeJobs) {
      const match = matchByJob.get(job.id) ?? null;
      if (match?.dismissed) continue;
      const { embedding: _emb, ...cleanJob } = job;
      feedItems.push({
        job: cleanJob,
        match,
        applicationStatus: appStatusByJob.get(job.id) ?? null
      });
    }

    const rankItem = (item: JobFeedItem): number => {
      const base = item.match?.llmScore ?? 20;
      const companyPenalty = dismissedCompanies.has(item.job.companyName.trim().toLowerCase())
        ? 15
        : 0;
      return base - companyPenalty;
    };

    feedItems.sort((a, b) => {
      const scoreDiff = rankItem(b) - rankItem(a);
      if (scoreDiff !== 0) return scoreDiff;
      return (b.job.postedAt ?? b.job.lastSeenAt).localeCompare(a.job.postedAt ?? a.job.lastSeenAt);
    });

    const forYouAll = feedItems.filter((item) => matchesFeedBucket(item, 'for_you'));
    const freshAll = [...feedItems]
      .filter((item) => matchesFeedBucket(item, 'fresh', 48))
      .sort((a, b) =>
        (b.job.postedAt ?? b.job.lastSeenAt).localeCompare(a.job.postedAt ?? a.job.lastSeenAt)
      );
    const indiaAll = feedItems.filter((item) => matchesFeedBucket(item, 'india'));
    const remoteAll = feedItems.filter((item) => matchesFeedBucket(item, 'remote'));
    const nearAll = feedItems.filter((item) => matchesFeedBucket(item, 'near_matches'));

    const syncStatus = await jobSync.getStatus(user.id);
    const targetRoles =
      profile.searchPreferences.targetRoles.length > 0
        ? profile.searchPreferences.targetRoles
        : profile.jsonResume.basics.label
          ? [profile.jsonResume.basics.label]
          : [];
    const topSkills = Array.from(
      new Set(profile.jsonResume.skills.flatMap((g) => g.keywords).filter(Boolean))
    ).slice(0, 8);
    const hasProfileData = Boolean(
      profile.onboardingCompletedAt ||
        topSkills.length > 0 ||
        profile.jsonResume.work.length > 0 ||
        profile.jsonResume.projects.length > 0 ||
        targetRoles.length > 0
    );

    const payload: RecommendationsResponse = {
      buckets: {
        forYou: forYouAll.slice(0, 30),
        fresh: freshAll.slice(0, 30),
        india: indiaAll.slice(0, 30),
        remote: remoteAll.slice(0, 30),
        nearMatches: nearAll.slice(0, 30)
      },
      counts: {
        forYou: forYouAll.length,
        fresh: freshAll.length,
        india: indiaAll.length,
        remote: remoteAll.length,
        nearMatches: nearAll.length,
        totalActiveCatalog: syncStatus.totalActiveJobs
      },
      syncStatus,
      profileSignals: {
        targetRoles,
        topSkills,
        countries: profile.searchPreferences.countries,
        preferredCities: profile.indiaProfile.preferredCities,
        isFresher: profile.indiaProfile.isFresher,
        hasProfileData
      },
      autoMatchedCount
    };

    return payload;
  });

  app.get('/api/jobs/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const profile = await store.getOrCreateProfile(request.authUser!);
    const detail = await store.getJobDetail(request.authUser!.id, id, profile.activeProfileVersion);
    if (!detail) return reply.code(404).send({ error: 'Job not found.' });
    return detail;
  });

  app.post('/api/jobs/match/refresh', { preHandler: requireAuth }, async (request, reply) => {
    const parsedBody = RefreshMatchesRequestSchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid match refresh payload', issues: parsedBody.error.issues });
    }

    try {
      const out = await computeUserMatches({
        user: request.authUser!,
        useLlm: parsedBody.data.topKLlm > 0,
        aiMode: parsedBody.data.aiMode,
        topKVector: parsedBody.data.topKVector,
        topKLlm: parsedBody.data.topKLlm,
        forceRecompute: parsedBody.data.forceRecompute
      });

      return {
        profileVersion: out.profile.activeProfileVersion,
        usedLlm: out.usedLlm,
        stats: out.stats,
        matchesCount: out.matches.length
      };
    } catch (err) {
      if (err instanceof EntitlementError) {
        return replyEntitlementError(reply, err);
      }
      throw err;
    }
  });

  app.post('/api/jobs/:id/dismiss', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsedBody = DismissJobRequestSchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid dismiss payload', issues: parsedBody.error.issues });
    }
    const profile = await store.getOrCreateProfile(request.authUser!);
    const ok = await store.setMatchDismissed(
      request.authUser!.id,
      id,
      profile.activeProfileVersion,
      parsedBody.data.dismissed,
      parsedBody.data.reason
    );
    if (!ok) return reply.code(404).send({ error: 'Job not found.' });
    return { ok: true };
  });

  app.post('/api/jobs/:id/save', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const profile = await store.getOrCreateProfile(request.authUser!);
    const detail = await store.getJobDetail(request.authUser!.id, id, profile.activeProfileVersion);
    if (!detail) return reply.code(404).send({ error: 'Job not found.' });
    const appRow = await store.saveJobApplication(request.authUser!.id, id, 'web');
    return appRow;
  });

  // --- Resume Tailoring, Dual Verifier & ATS PDF ---
  app.post('/api/resumes/tailor', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = TailorResumeRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid tailor resume request', issues: parsed.error.issues });
    }

    const user = request.authUser!;
    const effective = await resolveEffectiveProfile(user, parsed.data.profileVariantId);
    if (!effective) {
      return reply.code(404).send({ error: 'Selected profile variant not found.' });
    }
    const stories = await store.listStories(user.id);
    const { profile, variantId } = effective;

    let targetTitle = parsed.data.customJob?.title ?? '';
    let targetCompany = parsed.data.customJob?.companyName ?? '';
    let targetDescription = parsed.data.customJob?.description ?? '';
    let cachedJdRequirements: unknown = null;
    let jobId: string | null = parsed.data.jobId ?? null;

    if (jobId) {
      const job = await store.getJobForTailoring(user.id, jobId);
      if (!job) return reply.code(404).send({ error: 'Target job not found.' });
      targetTitle = job.title;
      targetCompany = job.companyName;
      targetDescription = job.descriptionClean;
      cachedJdRequirements = job.parsedRequirements;
    }

    let acquired: Awaited<ReturnType<typeof acquireLlmForAction>> | null = null;
    try {
      acquired = await acquireLlmForAction({
        userId: user.id,
        action: 'resume_tailor',
        requestedAiMode: parsed.data.aiMode,
        config,
        store,
        providerFactory
      });

      const result = await tailorResumePipeline({
        profile,
        stories,
        targetJob: {
          jobId,
          title: targetTitle,
          companyName: targetCompany,
          description: targetDescription
        },
        cachedJdRequirements,
        llmProvider: acquired.provider,
        model: acquired.model,
        templateId: parsed.data.templateId,
        autoRepairFlagged: parsed.data.autoRepairFlagged,
        skipLlmVerifier:
          acquired.executionMode === 'managed' && !acquired.entitlements.dualLlmVerifier
      });

      if (jobId && !result.jdFromCache) {
        await store.saveJobParsedRequirements(jobId, result.jdRequirements);
      }

      const versionId = randomUUID();
      const pdfStoragePath = await store.uploadRenderedResumePdf(
        user.id,
        versionId,
        result.pdfBuffer
      );

      const label = parsed.data.label ?? `${targetCompany} — ${targetTitle}`.slice(0, 150);
      const version = await store.createResumeVersion(user.id, {
        id: versionId,
        jobId,
        profileVariantId: variantId,
        parentProfileVersion: profile.activeProfileVersion,
        label,
        jdRequirements: result.jdRequirements,
        tailoredJsonResume: result.tailoredJsonResume,
        diffSummary: result.diffSummary,
        verifierReport: result.verifierReport,
        verifierPassed: result.verifierReport.passed,
        templateId: parsed.data.templateId,
        typstSource: result.typstSource,
        pdfStoragePath,
        pdfEngine: result.pdfEngine,
        provider: acquired.providerId,
        model: result.modelUsed
      });

      return reply.code(201).send(version);
    } catch (err) {
      await acquired?.refund('tailor_failed');
      if (err instanceof EntitlementError) {
        return replyEntitlementError(reply, err);
      }
      const message = err instanceof Error ? err.message : 'Resume tailoring failed.';
      return reply.code(422).send({ error: message });
    }
  });

  app.get('/api/resumes/versions', { preHandler: requireAuth }, async (request) => {
    const query = request.query as { jobId?: string };
    return store.listResumeVersions(request.authUser!.id, query.jobId);
  });

  app.get('/api/resumes/versions/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const version = await store.getResumeVersion(request.authUser!.id, id);
    if (!version) return reply.code(404).send({ error: 'Resume version not found.' });
    return version;
  });

  app.get('/api/resumes/versions/:id/pdf', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const version = await store.getResumeVersion(request.authUser!.id, id);
    if (!version || !version.pdfStoragePath) {
      return reply.code(404).send({ error: 'Rendered PDF not found for this resume version.' });
    }
    const pdfBuf = await store.downloadRenderedResumePdf(
      request.authUser!.id,
      version.pdfStoragePath
    );
    if (!pdfBuf) {
      return reply.code(404).send({ error: 'Rendered PDF file missing from storage.' });
    }
    const { disposition } = request.query as { disposition?: string };
    const safeFilename = version.label.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 60) || 'resume';
    const contentDispositionType = disposition === 'inline' ? 'inline' : 'attachment';
    reply.header('Content-Type', 'application/pdf');
    reply.header(
      'Content-Disposition',
      `${contentDispositionType}; filename="jobpilot-v${version.versionNumber}-${safeFilename}.pdf"`
    );
    return reply.send(pdfBuf);
  });

  app.post('/api/resumes/ats-score', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = AtsScoreRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid ATS score request', issues: parsed.error.issues });
    }

    const user = request.authUser!;
    let targetResume = parsed.data.jsonResume;
    let targetIndiaProfile = undefined;
    let versionJdRequirements = undefined;

    if (parsed.data.resumeVersionId) {
      const version = await store.getResumeVersion(user.id, parsed.data.resumeVersionId);
      if (!version) return reply.code(404).send({ error: 'Resume version not found.' });
      targetResume = version.tailoredJsonResume;
      versionJdRequirements = version.jdRequirements;
      const base = await store.getOrCreateProfile(user);
      targetIndiaProfile = base.indiaProfile;
    } else if (!targetResume) {
      const effective = await resolveEffectiveProfile(user, parsed.data.profileVariantId);
      if (!effective) {
        return reply.code(404).send({ error: 'Profile variant not found.' });
      }
      targetResume = effective.profile.jsonResume;
      targetIndiaProfile = effective.profile.indiaProfile;
    }

    let jdRequirements = versionJdRequirements;
    let jdText = parsed.data.customJob?.description ?? '';
    let title = parsed.data.customJob?.title ?? '';
    let companyName = parsed.data.customJob?.companyName ?? '';

    if (parsed.data.jobId) {
      const job = await store.getJobForTailoring(user.id, parsed.data.jobId);
      if (!job) return reply.code(404).send({ error: 'Target job not found.' });
      title = job.title;
      companyName = job.companyName;
      jdText = job.descriptionClean;
      const cached = JdRequirementsSchema.safeParse(job.parsedRequirements);
      if (
        cached.success &&
        (cached.data.mustHaveSkills.length > 0 || cached.data.keywords.length > 0)
      ) {
        jdRequirements = cached.data;
      } else {
        jdRequirements = undefined;
      }
    } else if (parsed.data.customJob) {
      jdRequirements = undefined;
    }

    const report = scoreResumeAgainstJd({
      resume: targetResume,
      indiaProfile: targetIndiaProfile,
      jdRequirements,
      jdText,
      title,
      companyName
    });
    return report;
  });

  app.get('/api/resumes/versions/:id/typst', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const version = await store.getResumeVersion(request.authUser!.id, id);
    if (!version || !version.typstSource) {
      return reply.code(404).send({ error: 'Typst source not found for this resume version.' });
    }
    reply.header('Content-Type', 'text/plain; charset=utf-8');
    reply.header(
      'Content-Disposition',
      `attachment; filename="jobpilot-v${version.versionNumber}.typ"`
    );
    return reply.send(version.typstSource);
  });

  app.post('/api/resumes/versions/:id/verify', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.authUser!;
    const version = await store.getResumeVersion(user.id, id);
    if (!version) return reply.code(404).send({ error: 'Resume version not found.' });

    const [profile, stories, sub] = await Promise.all([
      store.getOrCreateProfile(user),
      store.listStories(user.id),
      store.getOrCreateSubscription(user.id)
    ]);
    const entitlements = getPlanEntitlements(sub.planId);

    let llmProvider: LlmProvider | null = null;
    let model: string | undefined;
    let acquired: Awaited<ReturnType<typeof acquireLlmForAction>> | null = null;
    if (entitlements.dualLlmVerifier || sub.useByokOverride || !hasManagedServerKeys(config)) {
      try {
        acquired = await acquireLlmForAction({
          userId: user.id,
          action: 'resume_verify',
          config,
          store,
          providerFactory
        });
        llmProvider = acquired.provider;
        model = acquired.model;
      } catch (err) {
        if (err instanceof EntitlementError) {
          return replyEntitlementError(reply, err);
        }
        llmProvider = null;
      }
    }

    try {
      const report = await runDualVerification({
        masterProfile: profile,
        stories,
        tailoredResume: version.tailoredJsonResume,
        llmProvider,
        model
      });

      const updated = await store.updateResumeVersionVerification(user.id, id, report);
      return updated ?? version;
    } catch (err) {
      await acquired?.refund('verify_failed');
      throw err;
    }
  });

  app.delete('/api/resumes/versions/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ok = await store.deleteResumeVersion(request.authUser!.id, id);
    if (!ok) return reply.code(404).send({ error: 'Resume version not found.' });
    return { ok: true };
  });

  // --- Grounded Cover Letters (#1) ---
  app.post('/api/cover-letters/generate', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = GenerateCoverLetterRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid cover letter request', issues: parsed.error.issues });
    }

    const user = request.authUser!;
    const effective = await resolveEffectiveProfile(user, parsed.data.profileVariantId);
    if (!effective) {
      return reply.code(404).send({ error: 'Selected profile variant not found.' });
    }
    const { profile, variantId } = effective;
    const stories = await store.listStories(user.id);

    let roleTitle = parsed.data.customJob?.title ?? '';
    let companyName = parsed.data.customJob?.companyName ?? '';
    let jdDescription = parsed.data.customJob?.description ?? '';
    let cachedJdRequirements = undefined;
    const jobId = parsed.data.jobId ?? null;

    if (jobId) {
      const job = await store.getJobForTailoring(user.id, jobId);
      if (!job) return reply.code(404).send({ error: 'Target job not found.' });
      roleTitle = job.title;
      companyName = job.companyName;
      jdDescription = job.descriptionClean;
      const parsedReqs = JdRequirementsSchema.safeParse(job.parsedRequirements);
      if (parsedReqs.success) cachedJdRequirements = parsedReqs.data;
    }

    let acquired: Awaited<ReturnType<typeof acquireLlmForAction>> | null = null;
    try {
      acquired = await acquireLlmForAction({
        userId: user.id,
        action: 'cover_letter',
        requestedAiMode: parsed.data.aiMode,
        config,
        store,
        providerFactory
      });
    } catch (err) {
      if (err instanceof EntitlementError) {
        return replyEntitlementError(reply, err);
      }
      acquired = null;
    }

    const llmProvider = acquired?.provider ?? null;
    const providerId = acquired?.providerId ?? null;

    let generated: Awaited<ReturnType<typeof generateCoverLetterPipeline>>;
    try {
      generated = await generateCoverLetterPipeline({
        masterProfile: profile,
        stories,
        companyName,
        roleTitle,
        jdDescription,
        cachedJdRequirements,
        tone: parsed.data.tone,
        customInstructions: parsed.data.customInstructions,
        autoRepairFlagged: parsed.data.autoRepairFlagged,
        llmProvider,
        model: acquired?.model
      });
    } catch (err) {
      await acquired?.refund('cover_letter_failed');
      throw err;
    }

    if (jobId && llmProvider && !cachedJdRequirements) {
      await store.saveJobParsedRequirements(jobId, generated.jdRequirements);
    }

    const coverLetterId = randomUUID();
    const pdfStoragePath = await store.uploadRenderedCoverLetterPdf(
      user.id,
      coverLetterId,
      generated.pdfBuffer
    );
    const label = parsed.data.label ?? `${companyName} — ${roleTitle} Cover Letter`.slice(0, 150);

    const record = await store.createCoverLetter(user.id, {
      id: coverLetterId,
      jobId,
      profileVariantId: variantId,
      parentProfileVersion: profile.activeProfileVersion,
      label,
      companyName,
      roleTitle,
      tone: parsed.data.tone,
      jdRequirements: generated.jdRequirements,
      content: generated.content,
      plainText: generated.plainText,
      verifierReport: generated.verifierReport,
      verifierPassed: generated.verifierReport.passed,
      typstSource: generated.typstSource,
      pdfStoragePath,
      pdfEngine: generated.pdfEngine,
      provider: generated.usedLlm ? providerId : null,
      model: generated.usedLlm ? (acquired?.model ?? null) : null
    });

    return reply.code(201).send(record);
  });

  app.get('/api/cover-letters', { preHandler: requireAuth }, async (request) => {
    const query = request.query as { jobId?: string };
    return store.listCoverLetters(request.authUser!.id, query.jobId);
  });

  app.get('/api/cover-letters/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const found = await store.getCoverLetter(request.authUser!.id, id);
    if (!found) return reply.code(404).send({ error: 'Cover letter not found.' });
    return found;
  });

  app.patch('/api/cover-letters/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = UpdateCoverLetterRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid cover letter update', issues: parsed.error.issues });
    }
    const user = request.authUser!;
    const existing = await store.getCoverLetter(user.id, id);
    if (!existing) return reply.code(404).send({ error: 'Cover letter not found.' });

    const profile = await store.getOrCreateProfile(user);
    let nextContent = parsed.data.content ?? existing.content;
    if (!parsed.data.content && parsed.data.plainText) {
      const blocks = parsed.data.plainText
        .split(/\n{2,}/)
        .map((b) => b.trim())
        .filter((b) => Boolean(b) && !/^Re:/i.test(b) && !/^Sincerely,?$/i.test(b));
      const salutation =
        blocks.find((b) => /^Dear /i.test(b)) ?? existing.content.salutation;
      const trimmed = blocks.filter(
        (b) => b !== salutation && b !== existing.content.signature
      );
      if (trimmed.length >= 2) {
        nextContent = {
          ...existing.content,
          salutation,
          openingHook: trimmed[0]!,
          bodyParagraphs: trimmed.slice(1, -1),
          closing: trimmed[trimmed.length - 1]!
        };
      } else if (trimmed.length === 1) {
        nextContent = {
          ...existing.content,
          salutation,
          openingHook: trimmed[0]!,
          bodyParagraphs: [],
          closing: existing.content.closing
        };
      }
    }

    const nextPlainText =
      parsed.data.plainText ??
      formatCoverLetterPlainText(nextContent, existing.companyName, existing.roleTitle);

    const typstSource = generateTypstCoverLetterSource({
      basics: profile.jsonResume.basics,
      companyName: existing.companyName,
      roleTitle: existing.roleTitle,
      content: nextContent
    });
    const pdf = await renderCoverLetterPdf({
      typstSource,
      basics: profile.jsonResume.basics,
      companyName: existing.companyName,
      roleTitle: existing.roleTitle,
      content: nextContent
    });
    const pdfStoragePath = await store.uploadRenderedCoverLetterPdf(
      user.id,
      id,
      pdf.pdfBuffer
    );

    const updated = await store.updateCoverLetter(user.id, id, {
      label: parsed.data.label,
      content: nextContent,
      plainText: nextPlainText,
      typstSource,
      pdfStoragePath,
      pdfEngine: pdf.engine
    });
    return updated ?? existing;
  });

  app.get('/api/cover-letters/:id/pdf', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { disposition } = request.query as { disposition?: string };
    const item = await store.getCoverLetter(request.authUser!.id, id);
    if (!item || !item.pdfStoragePath) {
      return reply.code(404).send({ error: 'Rendered PDF not found for this cover letter.' });
    }
    const pdfBuf = await store.downloadRenderedResumePdf(
      request.authUser!.id,
      item.pdfStoragePath
    );
    if (!pdfBuf) {
      return reply.code(404).send({ error: 'Rendered cover letter PDF missing from storage.' });
    }
    const safeFilename =
      item.label.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 60) || 'cover-letter';
    const contentDispositionType = disposition === 'inline' ? 'inline' : 'attachment';
    reply.header('Content-Type', 'application/pdf');
    reply.header(
      'Content-Disposition',
      `${contentDispositionType}; filename="jobpilot-cl-v${item.versionNumber}-${safeFilename}.pdf"`
    );
    return reply.send(pdfBuf);
  });

  app.get('/api/cover-letters/:id/typst', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const item = await store.getCoverLetter(request.authUser!.id, id);
    if (!item || !item.typstSource) {
      return reply.code(404).send({ error: 'Typst source not found for this cover letter.' });
    }
    reply.header('Content-Type', 'text/plain; charset=utf-8');
    reply.header(
      'Content-Disposition',
      `attachment; filename="jobpilot-cl-v${item.versionNumber}.typ"`
    );
    return reply.send(item.typstSource);
  });

  app.delete('/api/cover-letters/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ok = await store.deleteCoverLetter(request.authUser!.id, id);
    if (!ok) return reply.code(404).send({ error: 'Cover letter not found.' });
    return { ok: true };
  });

  // --- Chrome Extension Helpers ---
  app.post('/api/extension/capture-job', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = CaptureExtensionJobRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid capture job payload', issues: parsed.error.issues });
    }
    const result = await store.captureExtensionJob(request.authUser!.id, parsed.data);
    return reply.code(201).send(result);
  });

  app.post('/api/extension/draft-answers', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = DraftAnswersRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid draft answers payload', issues: parsed.error.issues });
    }

    const user = request.authUser!;
    const [profile, stories, savedAnswers] = await Promise.all([
      store.getOrCreateProfile(user),
      store.listStories(user.id),
      store.listSavedAnswers(user.id)
    ]);

    let acquired: Awaited<ReturnType<typeof acquireLlmForAction>> | null = null;
    try {
      acquired = await acquireLlmForAction({
        userId: user.id,
        action: 'form_draft',
        requestedAiMode: parsed.data.aiMode,
        config,
        store,
        providerFactory
      });
    } catch (err) {
      if (err instanceof EntitlementError) {
        return replyEntitlementError(reply, err);
      }
      acquired = null;
    }

    try {
      const result = await draftExtensionQuestionAnswers({
        request: parsed.data,
        profile,
        stories,
        savedAnswers,
        llmProvider: acquired?.provider ?? null
      });
      return result;
    } catch (err) {
      await acquired?.refund('form_draft_failed');
      throw err;
    }
  });

  app.post('/api/extension/fallback-fill', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = FallbackFillRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid fallback fill payload', issues: parsed.error.issues });
    }

    const user = request.authUser!;
    const [profile, stories, savedAnswers] = await Promise.all([
      store.getOrCreateProfile(user),
      store.listStories(user.id),
      store.listSavedAnswers(user.id)
    ]);

    let acquired: Awaited<ReturnType<typeof acquireLlmForAction>> | null = null;
    try {
      acquired = await acquireLlmForAction({
        userId: user.id,
        action: 'fallback_fill',
        requestedAiMode: parsed.data.aiMode,
        config,
        store,
        providerFactory
      });
    } catch (err) {
      if (err instanceof EntitlementError) {
        return replyEntitlementError(reply, err);
      }
      acquired = null;
    }

    try {
      return await runExtensionLlmFallbackFill({
        request: parsed.data,
        profile,
        stories,
        savedAnswers,
        llmProvider: acquired?.provider ?? null
      });
    } catch (err) {
      await acquired?.refund('fallback_fill_failed');
      throw err;
    }
  });

  async function resolveEffectiveProfile(
    user: AuthUser,
    profileVariantId?: string
  ): Promise<{ profile: MasterProfile; variantId: string | null } | null> {
    const base = await store.getOrCreateProfile(user);
    if (!profileVariantId) {
      return { profile: base, variantId: null };
    }
    const variant = await store.getProfileVariant(user.id, profileVariantId);
    if (!variant) return null;
    return {
      variantId: variant.id,
      profile: {
        ...base,
        activeProfileVersion: variant.version,
        jsonResume: variant.jsonResume,
        indiaProfile: variant.indiaProfile
      }
    };
  }

  // --- Application Tracker (Phase 6) ---
  app.get('/api/applications', { preHandler: requireAuth }, async (request, reply) => {
    const rawStatus = (request.query as Record<string, unknown> | undefined)?.['status'];
    let statusFilter: ReturnType<typeof ApplicationStatusSchema.parse> | undefined;
    if (typeof rawStatus === 'string' && rawStatus.trim().length > 0) {
      const parsedStatus = ApplicationStatusSchema.safeParse(rawStatus);
      if (!parsedStatus.success) {
        return reply
          .code(400)
          .send({ error: 'Invalid status filter', issues: parsedStatus.error.issues });
      }
      statusFilter = parsedStatus.data;
    }
    const items = await store.listApplications(request.authUser!.id, statusFilter);
    return { items };
  });

  app.get('/api/applications/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const detail = await store.getApplicationDetail(request.authUser!.id, id);
    if (!detail) {
      return reply.code(404).send({ error: 'Application not found' });
    }
    return detail;
  });

  app.post('/api/applications', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = CreateManualApplicationRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid application payload', issues: parsed.error.issues });
    }
    const created = await store.createManualApplication(request.authUser!.id, parsed.data);
    return reply.code(201).send(created);
  });

  app.patch('/api/applications/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = UpdateApplicationRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'Invalid application update payload', issues: parsed.error.issues });
    }
    const updated = await store.updateApplication(request.authUser!.id, id, parsed.data);
    if (!updated) {
      return reply.code(404).send({ error: 'Application not found' });
    }
    return updated;
  });

  app.delete('/api/applications/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleted = await store.deleteApplication(request.authUser!.id, id);
    if (!deleted) {
      return reply.code(404).send({ error: 'Application not found' });
    }
    return { ok: true };
  });

  // --- Usage Dashboard ---
  app.get('/api/usage', { preHandler: requireAuth }, async (request) => {
    return store.getUsageSummary(request.authUser!.id);
  });

  // --- Privacy: Export & Delete Account ---
  app.get('/api/account/export', { preHandler: requireAuth }, async (request, reply) => {
    const payload = await store.exportAccountData(request.authUser!);
    reply.header('Content-Disposition', 'attachment; filename="jobpilot-export.json"');
    return payload;
  });

  app.delete('/api/account', { preHandler: requireAuth }, async (request) => {
    await store.deleteAccount(request.authUser!.id);
    return { ok: true };
  });

  return app;
}
