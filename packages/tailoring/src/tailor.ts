import type { LlmProvider } from '@jobpilot/llm';
import {
  TailorLlmOutputSchema,
  type JdRequirements,
  type JsonResume,
  type MasterProfile,
  type ProfileStory,
  type ResumeDiffSummary,
  type ResumeTemplateId,
  type TailorLlmOutput,
  type VerifierReport
} from '@jobpilot/shared';
import { computeResumeDiff } from './diff.js';
import type { TailoredSourceLinks } from './deterministic-verifier.js';
import { extractJdRequirements } from './jd-extractor.js';
import { runDualVerification } from './llm-verifier.js';
import { renderAtsPdf } from './pdf-renderer.js';
import { generateTypstResumeSource } from './typst-template.js';

export interface TailorTargetJob {
  jobId?: string | null;
  title: string;
  companyName: string;
  description: string;
}

export interface TailorPipelineResult {
  jdRequirements: JdRequirements;
  jdFromCache: boolean;
  tailoredJsonResume: JsonResume;
  diffSummary: ResumeDiffSummary;
  verifierReport: VerifierReport;
  typstSource: string;
  pdfBuffer: Buffer;
  pdfEngine: 'typst' | 'builtin-ats-pdf';
  tailoringRationale: string;
  providerUsed: string;
  modelUsed: string;
}

function materializeTailoredResume(
  master: JsonResume,
  output: TailorLlmOutput
): { resume: JsonResume; sourceLinks: TailoredSourceLinks } {
  const workSourceIds: Record<number, string> = {};
  const projectSourceIds: Record<number, string> = {};
  const educationSourceIds: Record<number, string> = {};

  const work = output.selectedWork.map((w, idx) => {
    workSourceIds[idx] = w.sourceId;
    return {
      id: w.sourceId,
      name: w.name,
      position: w.position,
      url: '',
      location: w.location ?? '',
      employmentType: '',
      startDate: w.startDate,
      endDate: w.endDate ?? '',
      summary: w.summary ?? '',
      highlights: w.highlights
    };
  });

  const projects = output.selectedProjects.map((p, idx) => {
    projectSourceIds[idx] = p.sourceId;
    return {
      id: p.sourceId,
      name: p.name,
      description: p.description ?? '',
      highlights: p.highlights,
      keywords: p.keywords ?? [],
      startDate: p.startDate ?? '',
      endDate: p.endDate ?? '',
      url: p.url ?? '',
      roles: [],
      entity: '',
      type: ''
    };
  });

  const education = (
    output.selectedEducation.length > 0
      ? output.selectedEducation.map((e, idx) => {
          educationSourceIds[idx] = e.sourceId;
          return {
            id: e.sourceId,
            institution: e.institution,
            url: '',
            area: e.area ?? '',
            studyType: e.studyType ?? '',
            startDate: e.startDate ?? '',
            endDate: e.endDate ?? '',
            score: e.score ?? '',
            courses: e.courses ?? []
          };
        })
      : master.education.map((e, idx) => {
          educationSourceIds[idx] = e.id;
          return e;
        })
  );

  return {
    resume: {
      ...master,
      basics: {
        ...master.basics,
        summary: output.summary || master.basics.summary || ''
      },
      work,
      projects,
      education,
      skills: output.reorderedSkills.length > 0 ? output.reorderedSkills : master.skills
    },
    sourceLinks: {
      workSourceIds,
      projectSourceIds,
      educationSourceIds
    }
  };
}

export async function tailorResumePipeline(params: {
  profile: MasterProfile;
  stories?: ProfileStory[];
  targetJob: TailorTargetJob;
  cachedJdRequirements?: unknown;
  llmProvider: LlmProvider;
  model?: string;
  templateId?: ResumeTemplateId;
  autoRepairFlagged?: boolean;
  typstBin?: string;
}): Promise<TailorPipelineResult> {
  const stories = params.stories ?? [];
  const templateId = params.templateId ?? 'ats-classic';
  const autoRepairFlagged = params.autoRepairFlagged ?? true;

  // 1. Extract JD requirements (reusing cached requirements when available)
  const jdStage = await extractJdRequirements({
    title: params.targetJob.title,
    companyName: params.targetJob.companyName,
    description: params.targetJob.description,
    cachedRequirements: params.cachedJdRequirements,
    llmProvider: params.llmProvider,
    model: params.model
  });

  // 2. Grounded tailoring pass (Master Profile + Story Bank ONLY)
  const tailorSystemPrompt = [
    'You are a grounded technical resume editor.',
    'STRICT NON-HALLUCINATION CONTRACT:',
    '1. Select, reorder, and rephrase content ONLY from the provided MASTER PROFILE and STORY BANK.',
    '2. NEVER invent skills, tools, employers, job titles, dates, colleges, GPAs, or numeric metrics.',
    '3. Keep every employer name, startDate, endDate, institution, and score/CGPA IDENTICAL to the master entry.',
    '4. Every work, project, and education item MUST reference its exact sourceId from the master profile or story bank.',
    '5. If the JD asks for a skill the candidate lacks, DO NOT add it to the resume.'
  ].join('\n');

  const baseUserPrompt = [
    `TARGET ROLE: ${params.targetJob.title} at ${params.targetJob.companyName}`,
    'EXTRACTED JD REQUIREMENTS:',
    JSON.stringify(jdStage.requirements),
    '',
    'MASTER PROFILE:',
    JSON.stringify({
      jsonResume: params.profile.jsonResume,
      indiaProfile: params.profile.indiaProfile
    }),
    '',
    'STORY BANK:',
    JSON.stringify(stories)
  ].join('\n');

  let tailorRes = await params.llmProvider.generateStructured({
    schema: TailorLlmOutputSchema,
    schemaName: 'tailored_resume_output',
    taskType: 'resume_tailor',
    model: params.model,
    temperature: 0.2,
    maxTokens: 4000,
    systemPrompt: tailorSystemPrompt,
    userPrompt: baseUserPrompt
  });

  let materialized = materializeTailoredResume(params.profile.jsonResume, tailorRes.data);

  // 3. Dual Verifier (Layer 1 deterministic + Layer 2 independent LLM audit)
  let verifierReport = await runDualVerification({
    masterProfile: params.profile,
    stories,
    tailoredResume: materialized.resume,
    sourceLinks: materialized.sourceLinks,
    llmProvider: params.llmProvider,
    model: params.model
  });

  // 4. Corrective pass if autoRepairFlagged is enabled and claims were flagged
  if (autoRepairFlagged && !verifierReport.passed) {
    const flaggedIssues = verifierReport.claims
      .filter((c) => c.status === 'flagged')
      .map((c) => `- [${c.section}] "${c.claim}": ${c.issue}`)
      .join('\n');

    tailorRes = await params.llmProvider.generateStructured({
      schema: TailorLlmOutputSchema,
      schemaName: 'tailored_resume_output',
      taskType: 'resume_tailor',
      model: params.model,
      temperature: 0,
      maxTokens: 4000,
      systemPrompt: tailorSystemPrompt,
      userPrompt: [
        baseUserPrompt,
        '',
        'PREVIOUS DRAFT HAD UNSUPPORTED CLAIMS FLAGGED BY THE VERIFIER. REMOVE OR FIX EVERY FLAGGED ITEM:',
        flaggedIssues
      ].join('\n')
    });

    materialized = materializeTailoredResume(params.profile.jsonResume, tailorRes.data);
    verifierReport = await runDualVerification({
      masterProfile: params.profile,
      stories,
      tailoredResume: materialized.resume,
      sourceLinks: materialized.sourceLinks,
      llmProvider: params.llmProvider,
      model: params.model
    });
  }

  // 5. Diff + Typst + ATS-safe PDF
  const diffSummary = computeResumeDiff(params.profile.jsonResume, materialized.resume);
  const typstSource = generateTypstResumeSource(
    materialized.resume,
    params.profile.indiaProfile,
    templateId
  );
  const pdf = await renderAtsPdf({
    typstSource,
    jsonResume: materialized.resume,
    indiaProfile: params.profile.indiaProfile,
    templateId,
    typstBin: params.typstBin
  });

  return {
    jdRequirements: jdStage.requirements,
    jdFromCache: jdStage.fromCache,
    tailoredJsonResume: materialized.resume,
    diffSummary,
    verifierReport,
    typstSource,
    pdfBuffer: pdf.pdfBuffer,
    pdfEngine: pdf.engine,
    tailoringRationale: tailorRes.data.tailoringRationale,
    providerUsed: tailorRes.provider,
    modelUsed: tailorRes.model
  };
}
