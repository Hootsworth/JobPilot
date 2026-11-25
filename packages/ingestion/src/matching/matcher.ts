import {
  cosineSimilarity,
  EMBEDDING_MODEL_NAME,
  EMBEDDING_MODEL_VERSION
} from '@jobpilot/embeddings';
import type { LlmProvider } from '@jobpilot/llm';
import {
  LlmMatchRerankOutputSchema,
  type JobMatch,
  type JobRecord,
  type MasterProfile,
  type ProfileStory
} from '@jobpilot/shared';
import { evaluateHardFilters } from './hard-filter.js';

export interface JobForMatching extends JobRecord {
  embedding?: number[] | null;
}

export interface RunThreeStageMatchingParams {
  profile: MasterProfile;
  stories?: ProfileStory[];
  jobs: JobForMatching[];
  profileEmbedding?: {
    vector: number[];
    model: string;
    version: string;
  } | null;
  existingMatchesByJobId?: Map<string, JobMatch>;
  llmProvider?: LlmProvider | null;
  llmModel?: string;
  topKVector?: number;
  topKLlm?: number;
  forceRecompute?: boolean;
  dismissedCompanies?: Set<string>;
}

export interface MatchingRunResult {
  matches: JobMatch[];
  stats: {
    totalEvaluated: number;
    hardFilterPassed: number;
    hardFilterFailed: number;
    reusedFromCache: number;
    llmScored: number;
    heuristicScored: number;
  };
}

const ROLE_ALIAS_GROUPS: Array<[string, RegExp]> = [
  ['software', /\b(sde|swe|software|developer|programmer|engineer)\b/i],
  ['backend', /\b(backend|back-end|back end|api|server|distributed|systems)\b/i],
  ['frontend', /\b(frontend|front-end|front end|ui|react|next\.js|angular|vue)\b/i],
  ['fullstack', /\b(fullstack|full-stack|full stack)\b/i],
  ['ml_ai', /\b(ml|ai|machine learning|deep learning|llm|nlp|genai)\b/i],
  ['data', /\b(data|analytics|etl|warehouse|spark|bi)\b/i],
  ['devops', /\b(devops|sre|platform|cloud|infra|infrastructure|kubernetes)\b/i],
  ['mobile', /\b(mobile|android|ios|flutter|react native)\b/i],
  ['cybersecurity', /\b(security|cybersecurity|appsec|infosec|soc|pentest|penetration|threat|vulnerability)\b/i],
  ['product', /\b(product manager|product management|\bpm\b|product owner)\b/i],
  ['design', /\b(design|designer|ux|ui\/ux|figma)\b/i]
];

export function computeRoleTitleRelevance(
  profile: MasterProfile,
  job: Pick<JobRecord, 'title' | 'normalizedTitle' | 'descriptionClean'>
): number {
  const candidatePhrases = [
    ...profile.searchPreferences.targetRoles,
    profile.jsonResume.basics.label,
    ...profile.jsonResume.work.slice(0, 2).map((w) => w.position)
  ]
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p));

  if (candidatePhrases.length === 0) return 0.5;

  const candText = candidatePhrases.join(' ').toLowerCase();
  const jobTitleText = `${job.title} ${job.normalizedTitle ?? ''}`.toLowerCase();

  const candGroups = new Set<string>();
  const jobGroups = new Set<string>();
  for (const [group, pattern] of ROLE_ALIAS_GROUPS) {
    if (pattern.test(candText)) candGroups.add(group);
    if (pattern.test(jobTitleText)) jobGroups.add(group);
  }

  let aliasScore = 0;
  if (candGroups.size > 0 && jobGroups.size > 0) {
    let hits = 0;
    for (const g of candGroups) {
      if (jobGroups.has(g)) hits++;
    }
    aliasScore = hits / candGroups.size;
  }

  const candTokens = Array.from(
    new Set(
      candText
        .replace(/[^a-z0-9]+/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length >= 2 && !['and', 'the', 'for', 'with'].includes(t))
    )
  );
  let tokenHits = 0;
  for (const tok of candTokens) {
    if (jobTitleText.includes(tok)) tokenHits++;
  }
  const tokenScore = candTokens.length > 0 ? tokenHits / candTokens.length : 0;

  return Math.round(Math.min(1, Math.max(aliasScore, tokenScore * 0.9 + aliasScore * 0.2)) * 1000) / 1000;
}

export function computeFreshnessBoost(postedAt: string | null | undefined): number {
  if (!postedAt) return 0;
  const ms = Date.parse(postedAt);
  if (!Number.isFinite(ms)) return 0;
  const ageHours = (Date.now() - ms) / (1000 * 60 * 60);
  if (ageHours <= 48) return 5;
  if (ageHours <= 24 * 7) return 3;
  return 0;
}

export function computeEducationAndStageBoost(
  profile: MasterProfile,
  job: Pick<JobRecord, 'employmentType' | 'fresherEligible' | 'seniority' | 'experienceMinYears'>
): number {
  const currentYear = new Date().getFullYear();
  const gradYear = profile.indiaProfile.graduationYear;
  const recentOrUpcomingGrad = gradYear != null && gradYear >= currentYear - 1;
  const seekingIntern = profile.indiaProfile.internshipStatus === 'seeking_internship';
  const isInternRole = job.employmentType === 'internship' || job.seniority === 'intern';
  const isEarlyCareerRole =
    Boolean(job.fresherEligible) ||
    job.seniority === 'fresher' ||
    job.seniority === 'junior' ||
    (job.experienceMinYears != null && job.experienceMinYears <= 1);

  if (seekingIntern) {
    if (isInternRole) return 6;
    if (isEarlyCareerRole) return 2;
    return 0;
  }

  if (profile.indiaProfile.isFresher || recentOrUpcomingGrad) {
    if (job.fresherEligible || job.seniority === 'fresher') return 5;
    if (isInternRole || isEarlyCareerRole) return 2;
  }

  return 0;
}

export function computeStretchScore(similarity: number, reasons: string[]): number {
  let score = Math.round(similarity * 68 + 10);
  for (const reason of reasons) {
    if (/\bstaff\b|\blead\b|\bmanager\b|exceeds max preference|requires\s+(?:[4-9]|\d{2})\+/i.test(reason)) {
      score -= 24;
    } else {
      score -= 12;
    }
  }
  return Math.max(5, Math.min(68, score));
}

export function preserveDismissReasonTags(reasons: string[], existing?: JobMatch): string[] {
  const tags = (existing?.hardFilterReasons ?? []).filter((r) => r.startsWith('dismiss_reason:'));
  if (tags.length === 0) return reasons;
  return Array.from(new Set([...reasons, ...tags]));
}

export function extractProfileSkills(
  profile: MasterProfile,
  stories: ProfileStory[] = []
): Set<string> {
  const skills = new Set<string>();
  for (const group of profile.jsonResume.skills) {
    for (const kw of group.keywords) {
      if (kw.trim()) skills.add(kw.trim().toLowerCase());
    }
  }
  for (const proj of profile.jsonResume.projects) {
    for (const kw of proj.keywords ?? []) {
      if (kw.trim()) skills.add(kw.trim().toLowerCase());
    }
  }
  for (const story of stories) {
    for (const s of story.skillsUsed) {
      if (s.trim()) skills.add(s.trim().toLowerCase());
    }
  }
  return skills;
}

export function computeDeterministicSkillOverlap(
  candidateSkills: Set<string>,
  job: Pick<JobRecord, 'extractedSkills' | 'title' | 'descriptionClean'>
): {
  matchedSkills: string[];
  skillGaps: string[];
  similarity: number;
} {
  const matchedSkills: string[] = [];
  const skillGaps: string[] = [];

  for (const skill of job.extractedSkills) {
    if (candidateSkills.has(skill.toLowerCase())) {
      matchedSkills.push(skill);
    } else {
      skillGaps.push(skill);
    }
  }

  if (job.extractedSkills.length > 0) {
    const ratio = matchedSkills.length / job.extractedSkills.length;
    return {
      matchedSkills,
      skillGaps,
      similarity: Math.round(ratio * 1000) / 1000
    };
  }

  // Fallback token overlap against title + description
  const text = `${job.title} ${job.descriptionClean}`.toLowerCase();
  let hits = 0;
  for (const s of candidateSkills) {
    if (text.includes(s)) {
      hits++;
      matchedSkills.push(s);
    }
  }
  const sim = candidateSkills.size > 0 ? Math.min(1, hits / Math.min(candidateSkills.size, 8)) : 0.3;
  return {
    matchedSkills: matchedSkills.slice(0, 8),
    skillGaps: [],
    similarity: Math.round(sim * 1000) / 1000
  };
}

function summarizeCandidateForLlm(profile: MasterProfile, stories: ProfileStory[]): string {
  const { jsonResume, indiaProfile, searchPreferences } = profile;
  const skills = jsonResume.skills.map((g) => `${g.name}: ${g.keywords.join(', ')}`).join(' | ');
  const work = jsonResume.work
    .slice(0, 4)
    .map((w) => `${w.position} @ ${w.name} (${w.startDate}–${w.endDate || 'Present'})`)
    .join('; ');
  const projects = jsonResume.projects
    .slice(0, 4)
    .map((p) => `${p.name} [${(p.keywords ?? []).join(', ')}]: ${p.highlights[0] ?? p.description}`)
    .join('; ');
  const education = jsonResume.education
    .slice(0, 2)
    .map((e) => `${e.studyType} ${e.area} @ ${e.institution} (${e.endDate || 'Ongoing'})`.trim())
    .join('; ');

  return [
    `Headline: ${jsonResume.basics.label || 'Software Engineer'}`,
    `India/Eligibility: fresher=${indiaProfile.isFresher}, graduationYear=${indiaProfile.graduationYear ?? 'unspecified'}, internship=${indiaProfile.internshipStatus}, expectedCtcLpa=${indiaProfile.expectedCtcLpa ?? 'unspecified'}, noticeDays=${indiaProfile.noticePeriodDays ?? 'unspecified'}, preferredCities=${indiaProfile.preferredCities.join(', ') || 'any'}, willingToRelocate=${indiaProfile.willingToRelocate}`,
    `Preferences: targetRoles=${searchPreferences.targetRoles.join(', ') || 'any'}, workModes=${searchPreferences.workModes.join(', ')}`,
    education ? `Education: ${education}` : '',
    skills ? `Skills: ${skills}` : '',
    work ? `Experience: ${work}` : '',
    projects ? `Projects: ${projects}` : '',
    stories.length > 0
      ? `Key Stories: ${stories.slice(0, 3).map((s) => `${s.title} (${s.skillsUsed.join(', ')})`).join('; ')}`
      : ''
  ]
    .filter(Boolean)
    .join('\n');
}

export async function runThreeStageMatching(
  params: RunThreeStageMatchingParams
): Promise<MatchingRunResult> {
  const {
    profile,
    stories = [],
    jobs,
    profileEmbedding,
    existingMatchesByJobId = new Map<string, JobMatch>(),
    llmProvider,
    llmModel,
    topKVector = 30,
    topKLlm = 15,
    forceRecompute = false,
    dismissedCompanies
  } = params;

  const nowIso = new Date().toISOString();
  const candidateSkills = extractProfileSkills(profile, stories);

  const canCompareVectors = Boolean(
    profileEmbedding &&
      profileEmbedding.model === EMBEDDING_MODEL_NAME &&
      profileEmbedding.version === EMBEDDING_MODEL_VERSION
  );

  // Stage 1: Hard filters
  const passedJobs: Array<{
    job: JobForMatching;
    similarity: number;
    overlap: ReturnType<typeof computeDeterministicSkillOverlap>;
  }> = [];
  const failedMatches: JobMatch[] = [];

  for (const job of jobs) {
    const existing = existingMatchesByJobId.get(job.id);
    const hf = evaluateHardFilters(profile, job);
    const overlap = computeDeterministicSkillOverlap(candidateSkills, job);
    const roleRelevance = computeRoleTitleRelevance(profile, job);
    const stageBoost = computeEducationAndStageBoost(profile, job);

    let similarity =
      0.55 * overlap.similarity +
      0.35 * roleRelevance +
      0.1 * (job.extractedSkills.length > 0 ? 0.5 : 0.3) +
      stageBoost * 0.012;
    if (
      canCompareVectors &&
      profileEmbedding &&
      job.embedding &&
      job.embeddingModel === EMBEDDING_MODEL_NAME &&
      job.embeddingModelVersion === EMBEDDING_MODEL_VERSION
    ) {
      const vecSim = cosineSimilarity(profileEmbedding.vector, job.embedding);
      // Blend vector similarity with explicit skill coverage and role relevance
      similarity =
        0.65 * Math.max(0, vecSim) +
        0.2 * overlap.similarity +
        0.15 * roleRelevance +
        stageBoost * 0.01;
    }
    similarity = Math.round(Math.max(0, Math.min(1, similarity)) * 1000) / 1000;

    if (!hf.passed) {
      const stretchScore = computeStretchScore(similarity, hf.reasons);
      failedMatches.push({
        jobId: job.id,
        profileVersion: profile.activeProfileVersion,
        hardFilterPassed: false,
        hardFilterReasons: preserveDismissReasonTags(hf.reasons, existing),
        vectorSimilarity: similarity,
        llmScore: stretchScore,
        matchReason: hf.reasons[0] ?? 'Filtered out by hard constraints.',
        matchedSkills: overlap.matchedSkills,
        skillGaps: overlap.skillGaps,
        provider: null,
        model: null,
        dismissed: existing?.dismissed ?? false,
        computedAt: nowIso
      });
      continue;
    }

    passedJobs.push({ job, similarity, overlap });
  }

  // Stage 2: Vector / deterministic retrieval top-K
  passedJobs.sort((a, b) => b.similarity - a.similarity);
  const vectorCandidates = passedJobs.slice(0, topKVector);
  const llmSlice = vectorCandidates.slice(0, topKLlm);
  const remainderSlice = vectorCandidates.slice(topKLlm);

  let reusedFromCache = 0;
  let llmScored = 0;
  let heuristicScored = 0;

  const finalPassedMatches: JobMatch[] = [];
  const uncachedForLlm: typeof llmSlice = [];

  for (const item of llmSlice) {
    const existing = existingMatchesByJobId.get(item.job.id);
    const cacheHasLlm = !llmProvider || existing?.provider !== null;
    if (
      !forceRecompute &&
      existing &&
      existing.profileVersion === profile.activeProfileVersion &&
      existing.hardFilterPassed &&
      existing.llmScore !== null &&
      cacheHasLlm
    ) {
      reusedFromCache++;
      finalPassedMatches.push({
        ...existing,
        vectorSimilarity: item.similarity
      });
    } else {
      uncachedForLlm.push(item);
    }
  }

  // Stage 3: LLM re-rank in small batches (5 jobs per batch)
  const candidateSummary = summarizeCandidateForLlm(profile, stories);
  if (llmProvider && uncachedForLlm.length > 0) {
    const BATCH_SIZE = 5;
    for (let i = 0; i < uncachedForLlm.length; i += BATCH_SIZE) {
      const batch = uncachedForLlm.slice(i, i + BATCH_SIZE);
      const jobsPromptBlock = batch
        .map(({ job, similarity }) =>
          [
            `JOB_ID: ${job.id}`,
            `Title: ${job.title}`,
            `Company: ${job.companyName}`,
            `Location: ${job.locationRaw || 'Unspecified'} (${job.workMode}, seniority=${job.seniority})`,
            `SalaryLPA: ${job.salaryMinLpa ?? '?'}-${job.salaryMaxLpa ?? '?'}`,
            `VectorSim: ${similarity}`,
            `Skills: ${job.extractedSkills.join(', ') || 'None listed'}`,
            `Snippet: ${job.descriptionClean.slice(0, 700)}`
          ].join('\n')
        )
        .join('\n---\n');

      try {
        const res = await llmProvider.generateStructured({
          schema: LlmMatchRerankOutputSchema,
          schemaName: 'job_match_rerank',
          taskType: 'job_match_rerank',
          model: llmModel,
          temperature: 0.1,
          maxTokens: 1500,
          systemPrompt: [
            'You are a strict career matching analyst for India and global software jobs.',
            'Score each job from 0 to 100 based ONLY on the candidate profile and job facts.',
            'Return one concise reason (<180 chars), matchedSkills present in both profile and JD, and explicit skillGaps required by the JD that are missing from the profile.',
            'Preserve exact JOB_ID values.'
          ].join('\n'),
          userPrompt: `CANDIDATE PROFILE:\n${candidateSummary}\n\nJOBS TO SCORE:\n${jobsPromptBlock}`
        });

        const byId = new Map(res.data.results.map((r) => [r.jobId, r]));
        for (const item of batch) {
          const existing = existingMatchesByJobId.get(item.job.id);
          const scored = byId.get(item.job.id);
          if (scored) {
            llmScored++;
            finalPassedMatches.push({
              jobId: item.job.id,
              profileVersion: profile.activeProfileVersion,
              hardFilterPassed: true,
              hardFilterReasons: preserveDismissReasonTags([], existing),
              vectorSimilarity: item.similarity,
              llmScore: scored.score,
              matchReason: scored.oneLineReason,
              matchedSkills: scored.matchedSkills,
              skillGaps: scored.skillGaps,
              provider: res.provider,
              model: res.model,
              dismissed: existing?.dismissed ?? false,
              computedAt: nowIso
            });
          } else {
            heuristicScored++;
            finalPassedMatches.push(
              buildHeuristicMatch(
                item,
                profile,
                existing?.dismissed ?? false,
                nowIso,
                dismissedCompanies,
                existing
              )
            );
          }
        }
      } catch {
        // Degrade gracefully to deterministic scoring if an LLM batch fails
        for (const item of batch) {
          const existing = existingMatchesByJobId.get(item.job.id);
          heuristicScored++;
          finalPassedMatches.push(
            buildHeuristicMatch(
              item,
              profile,
              existing?.dismissed ?? false,
              nowIso,
              dismissedCompanies,
              existing
            )
          );
        }
      }
    }
  } else {
    for (const item of uncachedForLlm) {
      const existing = existingMatchesByJobId.get(item.job.id);
      if (
        !forceRecompute &&
        existing &&
        existing.profileVersion === profile.activeProfileVersion &&
        existing.hardFilterPassed &&
        existing.llmScore !== null
      ) {
        reusedFromCache++;
        finalPassedMatches.push({
          ...existing,
          vectorSimilarity: item.similarity
        });
      } else {
        heuristicScored++;
        finalPassedMatches.push(
          buildHeuristicMatch(
            item,
            profile,
            existing?.dismissed ?? false,
            nowIso,
            dismissedCompanies,
            existing
          )
        );
      }
    }
  }

  for (const item of remainderSlice) {
    const existing = existingMatchesByJobId.get(item.job.id);
    if (
      !forceRecompute &&
      existing &&
      existing.profileVersion === profile.activeProfileVersion &&
      existing.hardFilterPassed &&
      existing.llmScore !== null
    ) {
      reusedFromCache++;
      finalPassedMatches.push({
        ...existing,
        vectorSimilarity: item.similarity
      });
    } else {
      heuristicScored++;
      finalPassedMatches.push(
        buildHeuristicMatch(
          item,
          profile,
          existing?.dismissed ?? false,
          nowIso,
          dismissedCompanies,
          existing
        )
      );
    }
  }

  return {
    matches: [...finalPassedMatches, ...failedMatches],
    stats: {
      totalEvaluated: jobs.length,
      hardFilterPassed: passedJobs.length,
      hardFilterFailed: failedMatches.length,
      reusedFromCache,
      llmScored,
      heuristicScored
    }
  };
}

function buildHeuristicMatch(
  item: {
    job: JobForMatching;
    similarity: number;
    overlap: ReturnType<typeof computeDeterministicSkillOverlap>;
  },
  profile: MasterProfile,
  dismissed: boolean,
  computedAt: string,
  dismissedCompanies?: Set<string>,
  existing?: JobMatch
): JobMatch {
  const freshness = computeFreshnessBoost(item.job.postedAt);
  const stageBoost = computeEducationAndStageBoost(profile, item.job);
  const companyPenalty = dismissedCompanies?.has(item.job.companyName.trim().toLowerCase())
    ? 15
    : 0;
  const heuristicScore = Math.max(
    15,
    Math.min(94, Math.round(item.similarity * 82 + 12) + freshness + stageBoost - companyPenalty)
  );
  const matchedSummary =
    item.overlap.matchedSkills.length > 0
      ? `Matches ${item.overlap.matchedSkills.slice(0, 4).join(', ')}`
      : 'Matches target role, location, and eligibility filters';

  return {
    jobId: item.job.id,
    profileVersion: profile.activeProfileVersion,
    hardFilterPassed: true,
    hardFilterReasons: preserveDismissReasonTags([], existing),
    vectorSimilarity: item.similarity,
    llmScore: heuristicScore,
    matchReason: `${matchedSummary} (auto-ranked).`,
    matchedSkills: item.overlap.matchedSkills,
    skillGaps: item.overlap.skillGaps,
    provider: null,
    model: null,
    dismissed,
    computedAt
  };
}
