import type { LlmProvider } from '@jobpilot/llm';
import {
  LlmVerifierOutputSchema,
  type JsonResume,
  type MasterProfile,
  type ProfileStory,
  type VerifierReport
} from '@jobpilot/shared';
import {
  buildVerifierReport,
  runDeterministicVerification,
  type TailoredSourceLinks
} from './deterministic-verifier.js';

export async function runDualVerification(params: {
  masterProfile: MasterProfile;
  stories?: ProfileStory[];
  tailoredResume: JsonResume;
  sourceLinks?: TailoredSourceLinks;
  llmProvider?: LlmProvider | null;
  model?: string;
}): Promise<VerifierReport> {
  const stories = params.stories ?? [];
  const det = runDeterministicVerification({
    masterProfile: params.masterProfile,
    stories,
    tailoredResume: params.tailoredResume,
    sourceLinks: params.sourceLinks
  });

  if (!params.llmProvider) {
    return buildVerifierReport({
      deterministicPassed: det.deterministicPassed,
      immutableFieldViolations: det.immutableFieldViolations,
      deterministicClaims: det.claims
    });
  }

  const systemPrompt = [
    'You are an adversarial resume faithfulness auditor.',
    'Compare every claim in the TAILORED RESUME against the MASTER PROFILE and STORY BANK.',
    'Rules:',
    '1. Mark a claim "verified" if directly supported, "rephrased_ok" if faithfully rephrased without inflating scope/metrics, or "flagged" if ANY skill, tool, employer, title inflation, date, degree, CGPA, or numeric metric is invented or exaggerated.',
    '2. Set severity="critical" on any flagged claim and explain the exact mismatch in "issue".',
    '3. Never approve an unsupported claim just because the job description asks for it.'
  ].join('\n');

  const userPrompt = [
    'MASTER PROFILE (JSON Resume + India Academic Fields):',
    JSON.stringify({
      jsonResume: params.masterProfile.jsonResume,
      indiaProfile: params.masterProfile.indiaProfile
    }),
    '',
    'STORY BANK:',
    JSON.stringify(stories),
    '',
    'TAILORED RESUME TO AUDIT:',
    JSON.stringify(params.tailoredResume)
  ].join('\n');

  const llmRes = await params.llmProvider.generateStructured({
    schema: LlmVerifierOutputSchema,
    schemaName: 'resume_faithfulness_verification',
    taskType: 'resume_verify',
    model: params.model,
    temperature: 0,
    maxTokens: 2500,
    systemPrompt,
    userPrompt
  });

  return buildVerifierReport({
    deterministicPassed: det.deterministicPassed,
    immutableFieldViolations: det.immutableFieldViolations,
    deterministicClaims: det.claims,
    llmClaims: llmRes.data.claims,
    llmNotes: llmRes.data.overallNotes
  });
}
