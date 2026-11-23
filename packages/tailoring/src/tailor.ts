import type { LlmProvider } from '@jobpilot/llm';
import {
  TailorLlmOutputSchema,
  type JdRequirements,
  type JsonResume,
  type MasterProfile,
  type ProfileStory,
  type ResumeDiffSummary,
  type ResumeProject,
  type ResumeTemplateId,
  type ResumeWork,
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

function norm(s: string | undefined | null): string {
  return (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function scoreTextRelevanceToJd(text: string, jd?: JdRequirements): number {
  if (!jd) return 0;
  const hay = text.toLowerCase();
  let score = 0;
  for (const skill of jd.mustHaveSkills) {
    if (skill && hay.includes(skill.toLowerCase())) score += 3;
  }
  for (const skill of jd.niceToHaveSkills) {
    if (skill && hay.includes(skill.toLowerCase())) score += 2;
  }
  for (const kw of jd.keywords) {
    if (kw && hay.includes(kw.toLowerCase())) score += 1;
  }
  return score;
}

export function materializeTailoredResume(
  master: JsonResume,
  output: TailorLlmOutput,
  stories: ProfileStory[] = [],
  jdRequirements?: JdRequirements
): { resume: JsonResume; sourceLinks: TailoredSourceLinks } {
  const workSourceIds: Record<number, string> = {};
  const projectSourceIds: Record<number, string> = {};
  const educationSourceIds: Record<number, string> = {};

  const includedWorkMasterIds = new Set<string>();
  const work: ResumeWork[] = [];

  for (const w of output.selectedWork) {
    const matchedMaster =
      master.work.find((mw) => mw.id === w.sourceId) ??
      master.work.find((mw) => norm(mw.name) === norm(w.name)) ??
      (master.work.length === 1 ? master.work[0] : undefined);

    const resolvedId = matchedMaster?.id ?? w.sourceId;
    includedWorkMasterIds.add(resolvedId);
    const idx = work.length;
    workSourceIds[idx] = resolvedId;

    const highlights =
      w.highlights.filter((h) => h.trim().length > 0).length > 0
        ? w.highlights.filter((h) => h.trim().length > 0)
        : matchedMaster?.highlights && matchedMaster.highlights.length > 0
          ? [...matchedMaster.highlights]
          : matchedMaster?.summary
            ? [matchedMaster.summary]
            : [];

    work.push({
      id: resolvedId,
      // Lock immutable employer name and dates to master when matched so LLM date formatting never breaks verification
      name: matchedMaster ? matchedMaster.name : w.name,
      position: w.position?.trim() || matchedMaster?.position || 'Engineer',
      url: matchedMaster?.url ?? '',
      location: w.location?.trim() || matchedMaster?.location || '',
      employmentType: matchedMaster?.employmentType ?? '',
      startDate: matchedMaster ? matchedMaster.startDate : w.startDate,
      endDate: matchedMaster ? (matchedMaster.endDate ?? '') : (w.endDate ?? ''),
      summary: w.summary?.trim() || matchedMaster?.summary || '',
      highlights
    });
  }

  // Non-Omission Guardrail for Work Experience:
  // Ensure master work entries (up to 5) are never silently omitted by the LLM.
  const remainingMasterWork = master.work
    .filter((mw) => !includedWorkMasterIds.has(mw.id))
    .sort((a, b) => {
      const aScore = scoreTextRelevanceToJd(
        `${a.name} ${a.position} ${a.summary ?? ''} ${a.highlights.join(' ')}`,
        jdRequirements
      );
      const bScore = scoreTextRelevanceToJd(
        `${b.name} ${b.position} ${b.summary ?? ''} ${b.highlights.join(' ')}`,
        jdRequirements
      );
      return bScore - aScore;
    });

  for (const mw of remainingMasterWork) {
    if (work.length >= 5) break;
    const idx = work.length;
    workSourceIds[idx] = mw.id;
    work.push({
      ...mw,
      highlights:
        mw.highlights.length > 0
          ? [...mw.highlights]
          : mw.summary
            ? [mw.summary]
            : []
    });
  }

  // Materialize Projects with non-omission guardrail
  const includedProjectMasterIds = new Set<string>();
  const projects: ResumeProject[] = [];

  for (const p of output.selectedProjects) {
    const matchedProj =
      master.projects.find((mp) => mp.id === p.sourceId) ??
      master.projects.find((mp) => norm(mp.name) === norm(p.name)) ??
      (master.projects.length === 1 ? master.projects[0] : undefined);
    const matchedStory = stories.find(
      (s) => s.id === p.sourceId || norm(s.title) === norm(p.name)
    );

    const resolvedId = matchedProj?.id ?? matchedStory?.id ?? p.sourceId;
    includedProjectMasterIds.add(resolvedId);
    const idx = projects.length;
    projectSourceIds[idx] = resolvedId;

    const highlights =
      p.highlights.filter((h) => h.trim().length > 0).length > 0
        ? p.highlights.filter((h) => h.trim().length > 0)
        : matchedProj && matchedProj.highlights.length > 0
          ? [...matchedProj.highlights]
          : matchedProj?.description
            ? [matchedProj.description]
            : matchedStory
              ? [matchedStory.action, matchedStory.result].filter((s) => s.trim().length > 0)
              : [];

    const keywords =
      p.keywords && p.keywords.length > 0
        ? p.keywords
        : matchedProj?.keywords && matchedProj.keywords.length > 0
          ? [...matchedProj.keywords]
          : matchedStory?.skillsUsed ?? [];

    projects.push({
      id: resolvedId,
      name: matchedProj ? matchedProj.name : p.name,
      description: p.description?.trim() || matchedProj?.description || '',
      highlights,
      keywords,
      startDate: p.startDate?.trim() || matchedProj?.startDate || '',
      endDate: p.endDate?.trim() || matchedProj?.endDate || '',
      url: p.url?.trim() || matchedProj?.url || '',
      roles: matchedProj?.roles ?? [],
      entity: matchedProj?.entity ?? '',
      type: matchedProj?.type ?? ''
    });
  }

  // Non-Omission Guardrail for Projects:
  // Retain all master projects (up to 5) ordered by relevance to the target JD.
  const remainingMasterProjects = master.projects
    .filter((mp) => !includedProjectMasterIds.has(mp.id))
    .sort((a, b) => {
      const aScore = scoreTextRelevanceToJd(
        `${a.name} ${a.description ?? ''} ${(a.keywords ?? []).join(' ')} ${a.highlights.join(' ')}`,
        jdRequirements
      );
      const bScore = scoreTextRelevanceToJd(
        `${b.name} ${b.description ?? ''} ${(b.keywords ?? []).join(' ')} ${b.highlights.join(' ')}`,
        jdRequirements
      );
      return bScore - aScore;
    });

  for (const mp of remainingMasterProjects) {
    if (projects.length >= 5) break;
    const idx = projects.length;
    projectSourceIds[idx] = mp.id;
    projects.push({
      ...mp,
      highlights:
        mp.highlights.length > 0
          ? [...mp.highlights]
          : mp.description
            ? [mp.description]
            : []
    });
  }

  // If the user has 0 master projects in jsonResume.projects but added projects in the Story Bank, include them
  if (projects.length === 0 && stories.length > 0) {
    const projectStories = stories.filter(
      (s) => !includedProjectMasterIds.has(s.id) && (s.action || s.result)
    );
    for (const s of projectStories.slice(0, 3)) {
      const idx = projects.length;
      projectSourceIds[idx] = s.id;
      projects.push({
        id: s.id,
        name: s.title,
        description: s.task || s.situation || '',
        highlights: [s.action, s.result].filter((line) => line.trim().length > 0),
        keywords: [...s.skillsUsed],
        startDate: '',
        endDate: '',
        url: '',
        roles: [],
        entity: '',
        type: ''
      });
    }
  }

  // Materialize Education (preserving immutable institution & score)
  const education =
    output.selectedEducation.length > 0
      ? output.selectedEducation.map((e, idx) => {
          const matchedEdu =
            master.education.find((me) => me.id === e.sourceId) ??
            master.education.find((me) => norm(me.institution) === norm(e.institution)) ??
            (master.education.length === 1 ? master.education[0] : undefined);
          const resolvedId = matchedEdu?.id ?? e.sourceId;
          educationSourceIds[idx] = resolvedId;
          return {
            id: resolvedId,
            institution: matchedEdu ? matchedEdu.institution : e.institution,
            url: matchedEdu?.url ?? '',
            area: e.area?.trim() || matchedEdu?.area || '',
            studyType: e.studyType?.trim() || matchedEdu?.studyType || '',
            startDate: matchedEdu ? (matchedEdu.startDate ?? '') : (e.startDate ?? ''),
            endDate: matchedEdu ? (matchedEdu.endDate ?? '') : (e.endDate ?? ''),
            score: matchedEdu ? (matchedEdu.score ?? '') : (e.score ?? ''),
            courses: e.courses && e.courses.length > 0 ? e.courses : (matchedEdu?.courses ?? [])
          };
        })
      : master.education.map((e, idx) => {
          educationSourceIds[idx] = e.id;
          return e;
        });

  const nonEmptyReorderedSkills = output.reorderedSkills.filter((g) => g.keywords.length > 0);
  const skills = nonEmptyReorderedSkills.length > 0 ? nonEmptyReorderedSkills : master.skills;

  return {
    resume: {
      ...master,
      basics: {
        ...master.basics,
        summary: output.summary?.trim() || master.basics.summary || ''
      },
      work,
      projects,
      education,
      skills
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
    'You are an expert technical resume editor and ATS optimization specialist.',
    'STRICT NON-HALLUCINATION & COMPLETENESS CONTRACT:',
    '1. NEVER OMIT WORK EXPERIENCE OR PROJECTS: You MUST include ALL work experience / internship entries from MASTER PROFILE.jsonResume.work in `selectedWork` and ALL project entries from MASTER PROFILE.jsonResume.projects (up to 5) in `selectedProjects`, ordered by relevance to the target JD.',
    '2. RICH ACTION-ORIENTED BULLETS: For every work and project entry, preserve at least the same number of bullet points (`highlights`) as the master entry (aim for 2 to 4 strong impact bullets per entry). Rephrase bullets using active engineering verbs so the JD must-have skills and keywords appear naturally where applicable.',
    '3. STRICT GROUNDING: Select, reorder, and rephrase content ONLY from the provided MASTER PROFILE and STORY BANK. NEVER invent skills, tools, employers, job titles, dates, colleges, GPAs, or numeric metrics.',
    '4. IMMUTABLE ANCHORS: Keep every employer `name`, `startDate`, `endDate`, `institution`, and `score`/CGPA character-for-character IDENTICAL to the master entry, and set `sourceId` to the exact `id` from the master profile.',
    '5. SKILLS ORDERING: Include all valid skill categories from the master profile in `reorderedSkills`, placing the skills that match the JD at the front of their respective category `keywords` list. If the JD asks for a skill the candidate does not have, DO NOT add it.'
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
    maxTokens: 8192,
    systemPrompt: tailorSystemPrompt,
    userPrompt: baseUserPrompt
  });

  let materialized = materializeTailoredResume(
    params.profile.jsonResume,
    tailorRes.data,
    stories,
    jdStage.requirements
  );

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
      maxTokens: 8192,
      systemPrompt: tailorSystemPrompt,
      userPrompt: [
        baseUserPrompt,
        '',
        'PREVIOUS DRAFT HAD UNSUPPORTED CLAIMS FLAGGED BY THE VERIFIER.',
        'Fix ONLY the flagged bullets/skills below by reverting ungrounded metrics or skills to the exact master profile wording. DO NOT omit or delete any work experience or project entry:',
        flaggedIssues
      ].join('\n')
    });

    materialized = materializeTailoredResume(
      params.profile.jsonResume,
      tailorRes.data,
      stories,
      jdStage.requirements
    );
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
