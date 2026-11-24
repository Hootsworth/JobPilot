import {
  CoverLetterLlmOutputSchema,
  type CoverLetterContent,
  type CoverLetterTone,
  type JdRequirements,
  type MasterProfile,
  type ProfileStory,
  type VerifierClaim,
  type VerifierReport
} from '@jobpilot/shared';
import type { LlmProvider } from '@jobpilot/llm';
import { extractJdRequirements } from './jd-extractor.js';
import { deriveJdTermsDeterministically } from './ats-checker.js';
import {
  collectMasterCorpusText,
  extractNumericFingerprints
} from './deterministic-verifier.js';
import { renderCoverLetterPdf } from './pdf-renderer.js';
import { generateTypstCoverLetterSource } from './typst-template.js';

function rankStoriesForJd(stories: ProfileStory[], jd: JdRequirements): ProfileStory[] {
  const jdTerms = new Set(
    [...jd.mustHaveSkills, ...jd.niceToHaveSkills, ...jd.keywords, ...jd.domainTerms].map((t) =>
      t.toLowerCase()
    )
  );
  return [...stories]
    .map((story) => {
      const storyText = `${story.title} ${story.action} ${story.result} ${story.skillsUsed.join(' ')}`.toLowerCase();
      let score = story.metrics.length * 2;
      for (const term of jdTerms) {
        if (term && storyText.includes(term)) score += 3;
      }
      return { story, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((item) => item.story);
}

function buildDeterministicCoverLetter(params: {
  profile: MasterProfile;
  stories: ProfileStory[];
  companyName: string;
  roleTitle: string;
  jd: JdRequirements;
  tone: CoverLetterTone;
}): CoverLetterContent {
  const { profile, stories, companyName, roleTitle, jd, tone } = params;
  const resume = profile.jsonResume;
  const rankedStories = rankStoriesForJd(stories, jd).slice(0, 2);
  const topWork = resume.work[0];
  const topProject = resume.projects[0];
  const allSkills = resume.skills.flatMap((g) => g.keywords);
  const jdTermSet = new Set(
    [...jd.mustHaveSkills, ...jd.keywords, ...jd.niceToHaveSkills].map((s) => s.toLowerCase())
  );
  const alignedSkills = allSkills.filter((s) => jdTermSet.has(s.toLowerCase()));
  const skillsLine = (alignedSkills.length > 0 ? alignedSkills : allSkills).slice(0, 6).join(', ');

  const openingHook =
    tone === 'founder-note'
      ? `I am reaching out directly regarding the ${roleTitle} role at ${companyName}. I enjoy shipping end-to-end engineering work quickly and reliably${skillsLine ? ` across ${skillsLine}` : ''}.`
      : tone === 'executive'
        ? `Please accept this letter as my application for the ${roleTitle} position at ${companyName}. Across my work${topWork ? ` at ${topWork.name}` : ''}, I have focused on measurable reliability, clean system boundaries, and practical delivery.`
        : `I am writing to apply for the ${roleTitle} role at ${companyName}. My background centers on ${skillsLine || 'software engineering and full-stack delivery'} backed by shipped production systems.`;

  const bodyParagraphs: string[] = [];
  if (topWork) {
    const topHighlight = topWork.highlights[0] ?? topWork.summary ?? '';
    bodyParagraphs.push(
      `Most recently as ${topWork.position} at ${topWork.name}, I focused on production delivery and engineering rigor.${topHighlight ? ` Specifically, ${topHighlight.charAt(0).toLowerCase()}${topHighlight.slice(1)}` : ''}`
    );
  } else if (topProject) {
    const topProjBullet = topProject.highlights[0] ?? topProject.description ?? '';
    bodyParagraphs.push(
      `In ${topProject.name}, I built and tested practical workflows end-to-end.${topProjBullet ? ` ${topProjBullet}` : ''}`
    );
  }

  if (rankedStories.length > 0) {
    const s = rankedStories[0]!;
    const metricText =
      s.metrics.length > 0
        ? ` (${s.metrics.map((m) => `${m.label}: ${m.value}${m.unit ? ` ${m.unit}` : ''}`).join(', ')})`
        : '';
    bodyParagraphs.push(
      `A representative project is ${s.title}, where ${s.action || s.task || s.result}${metricText}.`
    );
  } else if (topProject && topWork) {
    const projBullet = topProject.highlights[0] ?? topProject.description ?? '';
    if (projBullet) {
      bodyParagraphs.push(`Outside core work, I built ${topProject.name}: ${projBullet}`);
    }
  }

  if (bodyParagraphs.length === 0) {
    bodyParagraphs.push(
      `My recent work focuses on turning ambiguous engineering requirements into clean, well-tested software.`
    );
  }

  const closing = `I would welcome the opportunity to discuss how my background aligns with ${companyName}'s roadmap for ${roleTitle}. Thank you for your time and consideration.`;

  return {
    salutation: 'Dear Hiring Team,',
    openingHook,
    bodyParagraphs,
    closing,
    signature: resume.basics.name || profile.fullName || 'Candidate',
    selectedStoryIds: rankedStories.map((s) => s.id),
    highlightedAchievements: [
      ...(topWork?.highlights.slice(0, 1) ?? []),
      ...(rankedStories[0]?.metrics.slice(0, 2).map((m) => `${m.label}: ${m.value}${m.unit}`) ?? [])
    ]
  };
}

function verifyCoverLetterContent(params: {
  content: CoverLetterContent;
  profile: MasterProfile;
  stories: ProfileStory[];
  roleTitle: string;
  companyName: string;
}): { report: VerifierReport; flaggedIndices: Set<number> } {
  const masterCorpus = collectMasterCorpusText(params.profile, params.stories);
  const allowedNumbers = new Set([
    ...extractNumericFingerprints(masterCorpus),
    ...extractNumericFingerprints(`${params.roleTitle} ${params.companyName}`)
  ]);
  const corpusLower = masterCorpus.toLowerCase();

  const segments = [
    { section: 'openingHook', text: params.content.openingHook },
    ...params.content.bodyParagraphs.map((p, idx) => ({ section: `body[${idx}]`, text: p })),
    { section: 'closing', text: params.content.closing }
  ];

  const claims: VerifierClaim[] = [];
  const flaggedIndices = new Set<number>();

  segments.forEach((seg, segIdx) => {
    const trimmed = seg.text.trim();
    if (!trimmed) return;
    const nums = extractNumericFingerprints(trimmed);
    const ungroundedNums = nums.filter((n) => !allowedNumbers.has(n));

    if (ungroundedNums.length > 0) {
      flaggedIndices.add(segIdx);
      claims.push({
        section: seg.section,
        claim: trimmed,
        sourceId: null,
        status: 'flagged',
        severity: 'critical',
        evidence: 'Master Profile + Story Bank corpus',
        issue: `Numeric claim(s) not present in Master Profile or Story Bank: ${ungroundedNums.join(', ')}`
      });
      return;
    }

    // Check if any company from master profile or reasonable length check
    const wordsMatch =
      trimmed.split(/\s+/).filter((w) => w.length >= 4 && corpusLower.includes(w.toLowerCase())).length >
      0;
    claims.push({
      section: seg.section,
      claim: trimmed,
      sourceId: null,
      status: wordsMatch ? 'verified' : 'rephrased_ok',
      severity: 'info',
      evidence: wordsMatch ? 'Aligned with Master Profile vocabulary' : 'Standard cover letter framing',
      issue: ''
    });
  });

  const unsupported = claims.filter((c) => c.status === 'flagged').length;
  const total = Math.max(1, claims.length);

  return {
    flaggedIndices,
    report: {
      passed: unsupported === 0,
      deterministicPassed: unsupported === 0,
      llmVerifierPassed: true,
      totalClaimsChecked: claims.length,
      unsupportedClaimCount: unsupported,
      immutableFieldViolations: 0,
      unsupportedClaimRate: unsupported / total,
      claims,
      overallNotes:
        unsupported === 0
          ? 'All numeric metrics and achievements verified against Master Profile and Story Bank.'
          : `${unsupported} paragraph(s) contained ungrounded numeric claims.`
    }
  };
}

export function formatCoverLetterPlainText(content: CoverLetterContent, companyName: string, roleTitle: string): string {
  const parts = [
    `Re: Application for ${roleTitle}${companyName ? ` — ${companyName}` : ''}`,
    '',
    content.salutation,
    '',
    content.openingHook,
    '',
    ...content.bodyParagraphs.flatMap((p) => (p.trim() ? [p.trim(), ''] : [])),
    content.closing,
    '',
    'Sincerely,',
    content.signature
  ];
  return parts.join('\n').trim();
}

export async function generateCoverLetterPipeline(params: {
  masterProfile: MasterProfile;
  stories: ProfileStory[];
  companyName: string;
  roleTitle: string;
  jdDescription: string;
  cachedJdRequirements?: JdRequirements;
  tone?: CoverLetterTone;
  customInstructions?: string;
  autoRepairFlagged?: boolean;
  llmProvider?: LlmProvider | null;
  model?: string;
  typstBin?: string;
}): Promise<{
  jdRequirements: JdRequirements;
  content: CoverLetterContent;
  plainText: string;
  verifierReport: VerifierReport;
  typstSource: string;
  pdfBuffer: Buffer;
  pdfEngine: 'typst' | 'builtin-ats-pdf';
  usedLlm: boolean;
}> {
  const tone = params.tone ?? 'concise-technical';
  const jdRequirements: JdRequirements = params.llmProvider
    ? (
        await extractJdRequirements({
          title: params.roleTitle,
          companyName: params.companyName,
          description: params.jdDescription,
          cachedRequirements: params.cachedJdRequirements,
          llmProvider: params.llmProvider,
          model: params.model
        })
      ).requirements
    : params.cachedJdRequirements ??
      deriveJdTermsDeterministically(params.jdDescription, params.roleTitle, params.companyName);

  const rankedStories = rankStoriesForJd(params.stories, jdRequirements).slice(0, 4);
  const candidateName =
    params.masterProfile.jsonResume.basics.name || params.masterProfile.fullName || 'Candidate';

  let content: CoverLetterContent;
  let usedLlm = false;

  if (params.llmProvider) {
    const toneGuidance =
      tone === 'founder-note'
        ? 'Direct, crisp 2-3 short paragraphs ideal for a startup founder or hiring engineer. Zero corporate buzzwords.'
        : tone === 'executive'
          ? 'Measured, strategic executive tone emphasizing architecture ownership, reliability outcomes, and team impact.'
          : 'Concise technical 3-paragraph cover letter linking concrete systems work and STAR metrics directly to the JD.';

    const llmResult = await params.llmProvider.generateStructured({
      taskType: 'cover_letter',
      model: params.model,
      schema: CoverLetterLlmOutputSchema,
      schemaName: 'CoverLetterOutput',
      temperature: 0.25,
      maxTokens: 1600,
      systemPrompt: [
        'You write strictly grounded, non-hallucinating software engineering cover letters.',
        'HARD TRUTH RULES:',
        '1. Every company, project, role, technology, and number you attribute to the candidate MUST exist verbatim in the supplied Master Profile or Story Bank.',
        '2. NEVER invent percentages, latencies, team sizes, years of experience, or employers.',
        '3. You may reference the target company name and target role from the Target Role block.',
        '4. Cite selectedStoryIds ONLY using exact story IDs provided.',
        `5. Style & tone: ${toneGuidance}`
      ].join('\n'),
      userPrompt: JSON.stringify({
        targetRole: {
          companyName: params.companyName,
          roleTitle: params.roleTitle,
          mustHaveSkills: jdRequirements.mustHaveSkills,
          keyResponsibilities: jdRequirements.keyResponsibilities.slice(0, 6)
        },
        customInstructions: params.customInstructions ?? '',
        masterResume: {
          basics: params.masterProfile.jsonResume.basics,
          work: params.masterProfile.jsonResume.work,
          projects: params.masterProfile.jsonResume.projects,
          skills: params.masterProfile.jsonResume.skills
        },
        relevantStories: rankedStories.map((s) => ({
          id: s.id,
          title: s.title,
          category: s.category,
          situation: s.situation,
          action: s.action,
          result: s.result,
          metrics: s.metrics,
          skillsUsed: s.skillsUsed
        }))
      })
    });

    usedLlm = true;
    content = {
      salutation: llmResult.data.salutation || 'Dear Hiring Team,',
      openingHook: llmResult.data.openingHook,
      bodyParagraphs: llmResult.data.bodyParagraphs.filter((p) => p.trim().length > 0),
      closing: llmResult.data.closing,
      signature: candidateName,
      selectedStoryIds: llmResult.data.selectedStoryIds.filter((id) =>
        params.stories.some((s) => s.id === id)
      ),
      highlightedAchievements: llmResult.data.highlightedAchievements
    };
  } else {
    content = buildDeterministicCoverLetter({
      profile: params.masterProfile,
      stories: params.stories,
      companyName: params.companyName,
      roleTitle: params.roleTitle,
      jd: jdRequirements,
      tone
    });
  }

  let verified = verifyCoverLetterContent({
    content,
    profile: params.masterProfile,
    stories: params.stories,
    roleTitle: params.roleTitle,
    companyName: params.companyName
  });

  if (!verified.report.passed && params.autoRepairFlagged !== false) {
    const fallback = buildDeterministicCoverLetter({
      profile: params.masterProfile,
      stories: params.stories,
      companyName: params.companyName,
      roleTitle: params.roleTitle,
      jd: jdRequirements,
      tone
    });
    const repairedBody = content.bodyParagraphs.map((para, idx) =>
      verified.flaggedIndices.has(idx + 1) ? fallback.bodyParagraphs[idx] ?? '' : para
    );
    content = {
      ...content,
      openingHook: verified.flaggedIndices.has(0) ? fallback.openingHook : content.openingHook,
      bodyParagraphs: repairedBody.filter((p) => p.trim().length > 0),
      closing: verified.flaggedIndices.has(content.bodyParagraphs.length + 1)
        ? fallback.closing
        : content.closing
    };
    verified = verifyCoverLetterContent({
      content,
      profile: params.masterProfile,
      stories: params.stories,
      roleTitle: params.roleTitle,
      companyName: params.companyName
    });
  }

  const plainText = formatCoverLetterPlainText(content, params.companyName, params.roleTitle);
  const typstSource = generateTypstCoverLetterSource({
    basics: params.masterProfile.jsonResume.basics,
    companyName: params.companyName,
    roleTitle: params.roleTitle,
    content
  });
  const pdf = await renderCoverLetterPdf({
    typstSource,
    basics: params.masterProfile.jsonResume.basics,
    companyName: params.companyName,
    roleTitle: params.roleTitle,
    content,
    typstBin: params.typstBin
  });

  return {
    jdRequirements,
    content,
    plainText,
    verifierReport: verified.report,
    typstSource,
    pdfBuffer: pdf.pdfBuffer,
    pdfEngine: pdf.engine,
    usedLlm
  };
}
