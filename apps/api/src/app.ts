import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import {
  ApplicationStatusSchema,
  CaptureExtensionJobRequestSchema,
  CreateManualApplicationRequestSchema,
  DraftAnswersRequestSchema,
  FallbackFillRequestSchema,
  JobFeedQuerySchema,
  LlmProviderIdSchema,
  RefreshMatchesRequestSchema,
  TailorResumeRequestSchema,
  TestLlmKeyRequestSchema,
  UpdateApplicationRequestSchema,
  UpdateProfileRequestSchema,
  UpsertLlmSettingsSchema,
  UpsertSavedAnswerRequestSchema,
  UpsertStoryRequestSchema,
  type LlmProviderId,
  type LlmSettingsItem
} from '@jobpilot/shared';
import { runThreeStageMatching } from '@jobpilot/ingestion';
import { resolveMetaBaseUrl, type LlmProvider } from '@jobpilot/llm';
import { runDualVerification, tailorResumePipeline } from '@jobpilot/tailoring';
import type { ApiConfig } from './config.js';
import { createAuthPreHandler, type AuthVerifier } from './plugins/auth.js';
import { encryptSecret } from './services/crypto.js';
import { draftExtensionQuestionAnswers } from './services/extension-draft.js';
import { runExtensionLlmFallbackFill } from './services/extension-fallback-fill.js';
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
import type { DataStore } from './store/types.js';

export interface BuildAppDeps {
  config: ApiConfig;
  store: DataStore;
  authVerifier: AuthVerifier;
  providerFactory?: LlmProviderFactory;
  enableLogger?: boolean;
}

const ALL_PROVIDERS: LlmProviderId[] = ['openai', 'gemini', 'meta'];

export async function buildApp(deps: BuildAppDeps): Promise<FastifyInstance> {
  const { config, store, authVerifier, providerFactory } = deps;

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
    .map((s) => s.trim())
    .filter(Boolean);

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || origin.startsWith('chrome-extension://') || allowedOrigins.includes(origin)) {
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

  app.get('/health', async () => ({
    ok: true,
    service: 'jobpilot-api',
    version: '0.1.0',
    defaultProvider: config.llmProvider
  }));

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

    try {
      const { provider } = await resolveUserLlmProvider({
        userId: user.id,
        config,
        store,
        providerOverride: providerCheck?.success ? providerCheck.data : undefined,
        modelOverride: query.model,
        providerFactory
      });

      const parseResult = await parseResumePdfWithLlm({
        buffer,
        provider,
        model: query.model
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
      if (err instanceof ResumeParseError) {
        return reply.code(err.statusCode).send({ error: err.message });
      }
      const message = err instanceof Error ? err.message : 'Resume parsing failed.';
      return reply.code(422).send({ error: message });
    }
  });

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

  // --- Jobs Feed & 3-Stage Matching ---
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

    const user = request.authUser!;
    const [profile, stories, profileEmbedding, jobs] = await Promise.all([
      store.getOrCreateProfile(user),
      store.listStories(user.id),
      store.getProfileEmbedding(user.id),
      store.listActiveJobsForMatching(user.id, 200)
    ]);

    const existingMatches = await store.listMatchesForProfileVersion(
      user.id,
      profile.activeProfileVersion
    );
    const existingByJobId = new Map(existingMatches.map((m) => [m.jobId, m]));

    let llmProvider: LlmProvider | null = null;
    try {
      const resolved = await resolveUserLlmProvider({
        userId: user.id,
        config,
        store,
        providerFactory
      });
      llmProvider = resolved.provider;
    } catch {
      // No LLM key configured yet — run Stage 1 (hard filters) + Stage 2 (vector/skill baseline)
      llmProvider = null;
    }

    const result = await runThreeStageMatching({
      profile,
      stories,
      jobs,
      profileEmbedding,
      existingMatchesByJobId: existingByJobId,
      llmProvider,
      topKVector: parsedBody.data.topKVector,
      topKLlm: parsedBody.data.topKLlm,
      forceRecompute: parsedBody.data.forceRecompute
    });

    await store.upsertJobMatches(user.id, result.matches);

    return {
      profileVersion: profile.activeProfileVersion,
      usedLlm: Boolean(llmProvider),
      stats: result.stats,
      matchesCount: result.matches.length
    };
  });

  app.post('/api/jobs/:id/dismiss', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { dismissed?: boolean };
    const profile = await store.getOrCreateProfile(request.authUser!);
    const ok = await store.setMatchDismissed(
      request.authUser!.id,
      id,
      profile.activeProfileVersion,
      body.dismissed ?? true
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
    const [profile, stories] = await Promise.all([
      store.getOrCreateProfile(user),
      store.listStories(user.id)
    ]);

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

    try {
      const { provider, providerId } = await resolveUserLlmProvider({
        userId: user.id,
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
        llmProvider: provider,
        templateId: parsed.data.templateId,
        autoRepairFlagged: parsed.data.autoRepairFlagged
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
        provider: providerId,
        model: result.modelUsed
      });

      return reply.code(201).send(version);
    } catch (err) {
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
    const safeFilename = version.label.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 60) || 'resume';
    reply.header('Content-Type', 'application/pdf');
    reply.header(
      'Content-Disposition',
      `attachment; filename="jobpilot-v${version.versionNumber}-${safeFilename}.pdf"`
    );
    return reply.send(pdfBuf);
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

    const [profile, stories] = await Promise.all([
      store.getOrCreateProfile(user),
      store.listStories(user.id)
    ]);

    let llmProvider: LlmProvider | null = null;
    try {
      const resolved = await resolveUserLlmProvider({
        userId: user.id,
        config,
        store,
        providerFactory
      });
      llmProvider = resolved.provider;
    } catch {
      llmProvider = null;
    }

    const report = await runDualVerification({
      masterProfile: profile,
      stories,
      tailoredResume: version.tailoredJsonResume,
      llmProvider
    });

    const updated = await store.updateResumeVersionVerification(user.id, id, report);
    return updated ?? version;
  });

  app.delete('/api/resumes/versions/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ok = await store.deleteResumeVersion(request.authUser!.id, id);
    if (!ok) return reply.code(404).send({ error: 'Resume version not found.' });
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

    const llmProvider = await tryResolveOptionalLlm(user.id);
    const result = await draftExtensionQuestionAnswers({
      request: parsed.data,
      profile,
      stories,
      savedAnswers,
      llmProvider
    });
    return result;
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

    const llmProvider = await tryResolveOptionalLlm(user.id);
    return runExtensionLlmFallbackFill({
      request: parsed.data,
      profile,
      stories,
      savedAnswers,
      llmProvider
    });
  });

  async function tryResolveOptionalLlm(userId: string): Promise<LlmProvider | null> {
    try {
      const resolved = await resolveUserLlmProvider({
        userId,
        config,
        store,
        providerFactory
      });
      return resolved.provider;
    } catch {
      return null;
    }
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
