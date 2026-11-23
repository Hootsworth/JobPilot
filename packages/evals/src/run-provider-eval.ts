import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { createLlmProvider, resolveMetaBaseUrl } from '@jobpilot/llm';
import { evaluateHardFilters, runThreeStageMatching, type JobForMatching } from '@jobpilot/ingestion';
import { runDualVerification } from '@jobpilot/tailoring';
import {
  CanonicalFieldKeySchema,
  createEmptyIndiaProfile,
  createEmptyJsonResume,
  JobRecordSchema,
  type LlmProviderId,
  type MasterProfile
} from '@jobpilot/shared';
import { computeHardFilterMetrics, computeNdcgAtK } from './metrics.js';

interface GoldenDataset {
  profiles: Array<{
    profileId: string;
    fullName: string;
    activeProfileVersion: number;
    jsonResume: Record<string, unknown>;
    indiaProfile: Record<string, unknown>;
    searchPreferences: Record<string, unknown>;
  }>;
  cases: Array<{
    profileId: string;
    expectedHardFilterPass: boolean;
    relevanceTier: number;
    job: Record<string, unknown>;
  }>;
}

function hydrateProfile(raw: GoldenDataset['profiles'][number]): MasterProfile {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    fullName: raw.fullName,
    email: 'eval@jobpilot.dev',
    phone: null,
    activeProfileVersion: raw.activeProfileVersion,
    jsonResume: { ...createEmptyJsonResume(), ...(raw.jsonResume as object) } as MasterProfile['jsonResume'],
    indiaProfile: { ...createEmptyIndiaProfile(), ...(raw.indiaProfile as object) } as MasterProfile['indiaProfile'],
    searchPreferences: raw.searchPreferences as MasterProfile['searchPreferences'],
    sourceResumeStoragePath: null,
    embeddingModel: null,
    embeddingModelVersion: null,
    embeddedAt: null,
    telemetryOptIn: false,
    onboardingCompletedAt: null,
    updatedAt: new Date().toISOString()
  };
}

function hydrateJob(raw: Record<string, unknown>): JobForMatching {
  const parsed = JobRecordSchema.parse({
    dedupeFingerprint: `eval-${raw['id']}`,
    sourceType: 'greenhouse',
    sourceUrl: `https://boards.greenhouse.io/eval/jobs/${raw['id']}`,
    lastSeenAt: new Date().toISOString(),
    ...raw
  });
  return { ...parsed, embedding: null };
}

async function main() {
  const dataset = JSON.parse(
    readFileSync(resolve(process.cwd(), 'fixtures/matching/golden-india-global.json'), 'utf8')
  ) as GoldenDataset;

  const providerTargets: Array<{
    provider: LlmProviderId;
    apiKey?: string;
    model?: string;
    baseUrl?: string;
  }> = [
    { provider: 'openai', apiKey: process.env['OPENAI_API_KEY'], model: process.env['EVAL_OPENAI_MODEL'] },
    { provider: 'gemini', apiKey: process.env['GEMINI_API_KEY'], model: process.env['EVAL_GEMINI_MODEL'] },
    {
      provider: 'meta',
      apiKey: process.env['META_API_KEY'],
      model: process.env['EVAL_META_MODEL'],
      baseUrl: resolveMetaBaseUrl()
    }
  ];

  const rows: string[] = [
    '| Provider | Model | Hard Filter Acc | Avg NDCG@10 | Hallucination Catch | Fallback Map Acc | LLM Calls | Latency (ms) | Est. Cost (USD) |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |'
  ];

  for (const target of providerTargets) {
    if (!target.apiKey?.trim()) {
      rows.push(`| ${target.provider} | *(skipped — no key)* | — | — | — | — | — | — | — |`);
      continue;
    }

    let totalLatency = 0;
    let totalCost = 0;
    let calls = 0;
    let resolvedModel = target.model ?? 'auto';

    const llm = createLlmProvider({
      provider: target.provider,
      apiKey: target.apiKey,
      defaultModel: target.model,
      baseUrl: target.baseUrl,
      logger: (entry) => {
        totalLatency += entry.latencyMs;
        totalCost += entry.estimatedCostUsd;
        calls += 1;
        resolvedModel = entry.model;
      }
    });

    const hfCases: Array<{ expectedPass: boolean; actualPass: boolean }> = [];
    const ndcgs: number[] = [];

    for (const pRaw of dataset.profiles) {
      const profile = hydrateProfile(pRaw);
      const pCases = dataset.cases.filter((c) => c.profileId === pRaw.profileId);
      const jobs = pCases.map((c) => hydrateJob(c.job));
      const relMap = new Map<string, number>();

      for (let i = 0; i < pCases.length; i++) {
        const c = pCases[i]!;
        const job = jobs[i]!;
        hfCases.push({
          expectedPass: c.expectedHardFilterPass,
          actualPass: evaluateHardFilters(profile, job).passed
        });
        relMap.set(job.id, c.relevanceTier);
      }

      const res = await runThreeStageMatching({
        profile,
        jobs,
        llmProvider: llm,
        topKVector: 10,
        topKLlm: 10
      });

      const orderedIds = res.matches
        .sort((a, b) => {
          if (a.hardFilterPassed !== b.hardFilterPassed) return a.hardFilterPassed ? -1 : 1;
          return (b.llmScore ?? 0) - (a.llmScore ?? 0);
        })
        .map((m) => m.jobId);

      ndcgs.push(computeNdcgAtK(orderedIds, relMap, 10));
    }

    const hf = computeHardFilterMetrics(hfCases);
    const avgNdcg = ndcgs.reduce((a, b) => a + b, 0) / Math.max(1, ndcgs.length);

    // 2. Shared Faithfulness Probe (hallucinated Rust claim must fail verification)
    const masterSample = hydrateProfile(dataset.profiles[0]!);
    const advResume = structuredClone(masterSample.jsonResume);
    advResume.skills = [
      ...(advResume.skills ?? []),
      { name: 'Hallucinated', level: '', keywords: ['Haskell-Quantum-Compiler'] }
    ];
    const verifyRes = await runDualVerification({
      masterProfile: masterSample,
      stories: [],
      tailoredResume: advResume,
      llmProvider: llm
    });
    const hallucinationCaught = !verifyRes.passed ? '100% (PASS)' : '0% (MISS)';

    // 3. Shared LLM Fallback Form-Mapping Probe
    const FallbackProbeSchema = z.object({
      suggestions: z
        .array(
          z.object({
            fieldId: z.string(),
            canonicalKey: CanonicalFieldKeySchema.catch('unknown'),
            proposedValue: z.string()
          })
        )
        .default([])
    });
    const fbRes = await llm.generateStructured({
      schema: FallbackProbeSchema,
      schemaName: 'eval_fallback_form_fill',
      taskType: 'form_draft',
      temperature: 0,
      maxTokens: 500,
      systemPrompt: 'Map each form field strictly from the candidate profile.',
      userPrompt: JSON.stringify({
        profile: masterSample,
        fields: [
          { fieldId: 'f1', label: 'How much annual compensation are you targeting (LPA)?' },
          { fieldId: 'f2', label: 'Preferred Indian work city?' }
        ]
      })
    });
    const f1Hit = fbRes.data.suggestions.some((s) => s.fieldId === 'f1' && s.proposedValue.trim().length > 0);
    const f2Hit = fbRes.data.suggestions.some((s) => s.fieldId === 'f2' && s.proposedValue.trim().length > 0);
    const fbScore = `${Math.round(((Number(f1Hit) + Number(f2Hit)) / 2) * 100)}%`;

    rows.push(
      `| ${target.provider} | \`${resolvedModel}\` | ${(hf.accuracy * 100).toFixed(1)}% | ${avgNdcg.toFixed(3)} | ${hallucinationCaught} | ${fbScore} | ${calls} | ${totalLatency} | $${totalCost.toFixed(5)} |`
    );
  }

  const report = `## JobPilot Multi-Provider Eval (Matching + Faithfulness + Form Fallback)\n\n${rows.join('\n')}\n`;
  console.log(report);
  if (process.env['GITHUB_STEP_SUMMARY']) {
    appendFileSync(process.env['GITHUB_STEP_SUMMARY'], `${report}\n`);
  }
}

main().catch((err) => {
  console.error('Multi-provider eval failed:', err);
  process.exit(1);
});
