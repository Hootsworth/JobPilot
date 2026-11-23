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

  return [
    `Headline: ${jsonResume.basics.label || 'Software Engineer'}`,
    `India/Eligibility: fresher=${indiaProfile.isFresher}, internship=${indiaProfile.internshipStatus}, expectedCtcLpa=${indiaProfile.expectedCtcLpa ?? 'unspecified'}, noticeDays=${indiaProfile.noticePeriodDays ?? 'unspecified'}, preferredCities=${indiaProfile.preferredCities.join(', ') || 'any'}, willingToRelocate=${indiaProfile.willingToRelocate}`,
    `Preferences: targetRoles=${searchPreferences.targetRoles.join(', ') || 'any'}, workModes=${searchPreferences.workModes.join(', ')}`,
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
    forceRecompute = false
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

    let similarity = overlap.similarity;
    if (
      canCompareVectors &&
      profileEmbedding &&
      job.embedding &&
      job.embeddingModel === EMBEDDING_MODEL_NAME &&
      job.embeddingModelVersion === EMBEDDING_MODEL_VERSION
    ) {
      const vecSim = cosineSimilarity(profileEmbedding.vector, job.embedding);
      // Blend vector similarity with explicit skill coverage for clean Stage 2 ranking
      similarity = Math.round((0.8 * Math.max(0, vecSim) + 0.2 * overlap.similarity) * 1000) / 1000;
    }

    if (!hf.passed) {
      failedMatches.push({
        jobId: job.id,
        profileVersion: profile.activeProfileVersion,
        hardFilterPassed: false,
        hardFilterReasons: hf.reasons,
        vectorSimilarity: similarity,
        llmScore: 0,
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

  // Stage 2: Vector retrieval top-K
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
              hardFilterReasons: [],
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
              buildHeuristicMatch(item, profile.activeProfileVersion, existing?.dismissed ?? false, nowIso)
            );
          }
        }
      } catch {
        // Degrade gracefully to deterministic scoring if an LLM batch fails
        for (const item of batch) {
          const existing = existingMatchesByJobId.get(item.job.id);
          heuristicScored++;
          finalPassedMatches.push(
            buildHeuristicMatch(item, profile.activeProfileVersion, existing?.dismissed ?? false, nowIso)
          );
        }
      }
    }
  } else {
    for (const item of uncachedForLlm) {
      const existing = existingMatchesByJobId.get(item.job.id);
      heuristicScored++;
      finalPassedMatches.push(
        buildHeuristicMatch(item, profile.activeProfileVersion, existing?.dismissed ?? false, nowIso)
      );
    }
  }

  for (const item of remainderSlice) {
    const existing = existingMatchesByJobId.get(item.job.id);
    heuristicScored++;
    finalPassedMatches.push(
      buildHeuristicMatch(item, profile.activeProfileVersion, existing?.dismissed ?? false, nowIso)
    );
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
  profileVersion: number,
  dismissed: boolean,
  computedAt: string
): JobMatch {
  const heuristicScore = Math.max(15, Math.min(96, Math.round(item.similarity * 85 + 12)));
  const matchedSummary =
    item.overlap.matchedSkills.length > 0
      ? `Matches ${item.overlap.matchedSkills.slice(0, 4).join(', ')}`
      : 'Passed location, seniority, and salary filters';

  return {
    jobId: item.job.id,
    profileVersion,
    hardFilterPassed: true,
    hardFilterReasons: [],
    vectorSimilarity: item.similarity,
    llmScore: heuristicScore,
    matchReason: `${matchedSummary} (vector/skill baseline).`,
    matchedSkills: item.overlap.matchedSkills,
    skillGaps: item.overlap.skillGaps,
    provider: null,
    model: null,
    dismissed,
    computedAt
  };
}
