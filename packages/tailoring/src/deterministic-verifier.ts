import type {
  JsonResume,
  MasterProfile,
  ProfileStory,
  VerifierClaim,
  VerifierReport
} from '@jobpilot/shared';

export interface TailoredSourceLinks {
  workSourceIds?: Record<number, string>;
  projectSourceIds?: Record<number, string>;
  educationSourceIds?: Record<number, string>;
}

function normalizeStr(s: string | undefined | null): string {
  return (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function collectMasterCorpusText(profile: MasterProfile, stories: ProfileStory[]): string {
  const r = profile.jsonResume;
  const ind = profile.indiaProfile;
  const chunks: string[] = [
    r.basics.name,
    r.basics.label ?? '',
    r.basics.summary ?? '',
    r.basics.url ?? '',
    ind.collegeName,
    ind.degree,
    ind.branch,
    ind.cgpa != null ? String(ind.cgpa) : '',
    ind.tenthPercentage != null ? String(ind.tenthPercentage) : '',
    ind.twelfthPercentage != null ? String(ind.twelfthPercentage) : '',
    ind.graduationYear != null ? String(ind.graduationYear) : '',
    ...r.work.flatMap((w) => [w.name, w.position, w.location ?? '', w.startDate, w.endDate ?? '', w.summary ?? '', ...w.highlights]),
    ...r.projects.flatMap((p) => [p.name, p.description ?? '', p.startDate ?? '', p.endDate ?? '', ...(p.keywords ?? []), ...p.highlights]),
    ...r.education.flatMap((e) => [e.institution, e.studyType ?? '', e.area ?? '', e.score ?? '', e.startDate ?? '', e.endDate ?? '', ...(e.courses ?? [])]),
    ...r.skills.flatMap((g) => [g.name, ...g.keywords]),
    ...(r.certificates ?? []).flatMap((c) => [c.name, c.issuer ?? '']),
    ...(r.awards ?? []).flatMap((a) => [a.title, a.awarder ?? '', a.summary ?? '']),
    ...stories.flatMap((s) => [
      s.title,
      s.situation,
      s.task,
      s.action,
      s.result,
      ...s.skillsUsed,
      ...s.metrics.flatMap((m) => [m.label, m.value, m.unit ?? '', `${m.value}${m.unit ?? ''}`])
    ])
  ];
  return chunks.filter(Boolean).join('\n');
}

export function extractNumericFingerprints(text: string): string[] {
  const results: string[] = [];
  const regex = /[$₹€£]?\d+(?:[.,]\d+)?(?:\s*(?:k|m|b|lpa|lakhs?|cr|ms|s|x|%|\+))?/gi;
  for (const match of text.matchAll(regex)) {
    const raw = match[0].trim();
    const cleaned = raw.replace(/[,$₹€£\s]/g, '').toLowerCase();
    // Ignore standard 4-digit calendar years (1980..2035)
    if (/^\d{4}$/.test(cleaned)) {
      const year = Number.parseInt(cleaned, 10);
      if (year >= 1980 && year <= 2035) continue;
    }
    if (cleaned.length > 0) results.push(cleaned);
  }
  return results;
}

function containsTokenInCorpus(token: string, corpusLower: string): boolean {
  const needle = token.trim().toLowerCase();
  if (!needle) return true;
  if (needle.length <= 2 || /[^a-z0-9]/i.test(needle)) {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, 'i').test(corpusLower);
  }
  return corpusLower.includes(needle);
}

export function runDeterministicVerification(params: {
  masterProfile: MasterProfile;
  stories?: ProfileStory[];
  tailoredResume: JsonResume;
  sourceLinks?: TailoredSourceLinks;
}): {
  deterministicPassed: boolean;
  immutableFieldViolations: number;
  claims: VerifierClaim[];
} {
  const stories = params.stories ?? [];
  const master = params.masterProfile.jsonResume;
  const tailored = params.tailoredResume;
  const corpus = collectMasterCorpusText(params.masterProfile, stories);
  const corpusLower = corpus.toLowerCase();

  const allowedNumbers = new Set(extractNumericFingerprints(corpus));
  // Also allow raw base digits of any compound token (e.g. "62%" allows "62")
  for (const tok of Array.from(allowedNumbers)) {
    const numOnly = tok.match(/^\d+(?:\.\d+)?/)?.[0];
    if (numOnly) allowedNumbers.add(numOnly);
  }

  const masterWorkById = new Map(master.work.map((w) => [w.id, w]));
  const masterProjById = new Map(master.projects.map((p) => [p.id, p]));
  const masterEduById = new Map(master.education.map((e) => [e.id, e]));
  const storyById = new Map(stories.map((s) => [s.id, s]));

  const claims: VerifierClaim[] = [];
  let immutableFieldViolations = 0;

  // 1. Verify Work entries (immutable employer + dates + metrics)
  tailored.work.forEach((w, idx) => {
    const srcId = params.sourceLinks?.workSourceIds?.[idx] ?? w.id;
    const masterItem =
      masterWorkById.get(srcId) ??
      master.work.find(
        (mw) => normalizeStr(mw.name) === normalizeStr(w.name) && normalizeStr(mw.startDate) === normalizeStr(w.startDate)
      );

    if (!masterItem) {
      immutableFieldViolations++;
      claims.push({
        section: 'work',
        claim: `${w.position} at ${w.name} (${w.startDate}–${w.endDate || 'Present'})`,
        sourceId: srcId,
        status: 'flagged',
        severity: 'critical',
        evidence: '',
        issue: `Employer/work entry "${w.name}" (sourceId=${srcId}) does not exist in master profile.`
      });
      return;
    }

    if (normalizeStr(masterItem.name) !== normalizeStr(w.name)) {
      immutableFieldViolations++;
      claims.push({
        section: 'work',
        claim: `Employer: ${w.name}`,
        sourceId: masterItem.id,
        status: 'flagged',
        severity: 'critical',
        evidence: masterItem.name,
        issue: `Employer altered from "${masterItem.name}" to "${w.name}".`
      });
    } else if (
      normalizeStr(masterItem.startDate) !== normalizeStr(w.startDate) ||
      normalizeStr(masterItem.endDate) !== normalizeStr(w.endDate)
    ) {
      immutableFieldViolations++;
      claims.push({
        section: 'work',
        claim: `${w.name} dates: ${w.startDate} – ${w.endDate || ''}`,
        sourceId: masterItem.id,
        status: 'flagged',
        severity: 'critical',
        evidence: `${masterItem.startDate} – ${masterItem.endDate || ''}`,
        issue: `Employment dates altered from "${masterItem.startDate}–${masterItem.endDate || ''}".`
      });
    } else {
      claims.push({
        section: 'work',
        claim: `${w.position} at ${w.name} (${w.startDate}–${w.endDate || 'Present'})`,
        sourceId: masterItem.id,
        status: 'verified',
        severity: 'info',
        evidence: `${masterItem.position} at ${masterItem.name}`,
        issue: ''
      });
    }

    for (const bullet of w.highlights) {
      const nums = extractNumericFingerprints(bullet);
      const unsupportedNums = nums.filter((n) => !allowedNumbers.has(n));
      if (unsupportedNums.length > 0) {
        claims.push({
          section: 'work.highlights',
          claim: bullet,
          sourceId: masterItem.id,
          status: 'flagged',
          severity: 'critical',
          evidence: masterItem.highlights.join(' | '),
          issue: `Unsupported metric(s) not found in master profile or story bank: ${unsupportedNums.join(', ')}`
        });
      }
    }
  });

  // 2. Verify Projects (valid sourceId + metrics)
  tailored.projects.forEach((p, idx) => {
    const srcId = params.sourceLinks?.projectSourceIds?.[idx] ?? p.id;
    const masterProj =
      masterProjById.get(srcId) ??
      master.projects.find((mp) => normalizeStr(mp.name) === normalizeStr(p.name));
    const linkedStory = storyById.get(srcId);

    if (!masterProj && !linkedStory) {
      immutableFieldViolations++;
      claims.push({
        section: 'projects',
        claim: `Project: ${p.name}`,
        sourceId: srcId,
        status: 'flagged',
        severity: 'critical',
        evidence: '',
        issue: `Project "${p.name}" (sourceId=${srcId}) not found in master projects or story bank.`
      });
      return;
    }

    const sourceName = masterProj?.name ?? linkedStory?.title ?? '';
    claims.push({
      section: 'projects',
      claim: `Project: ${p.name}`,
      sourceId: srcId,
      status: normalizeStr(sourceName) === normalizeStr(p.name) ? 'verified' : 'rephrased_ok',
      severity: 'info',
      evidence: sourceName,
      issue: ''
    });

    for (const bullet of p.highlights) {
      const nums = extractNumericFingerprints(bullet);
      const unsupportedNums = nums.filter((n) => !allowedNumbers.has(n));
      if (unsupportedNums.length > 0) {
        claims.push({
          section: 'projects.highlights',
          claim: bullet,
          sourceId: srcId,
          status: 'flagged',
          severity: 'critical',
          evidence: masterProj?.highlights.join(' | ') ?? linkedStory?.result ?? '',
          issue: `Unsupported metric(s) in project bullet: ${unsupportedNums.join(', ')}`
        });
      }
    }
  });

  // 3. Verify Education (immutable institution & score/CGPA)
  tailored.education.forEach((e, idx) => {
    const srcId = params.sourceLinks?.educationSourceIds?.[idx] ?? e.id;
    const masterEdu =
      masterEduById.get(srcId) ??
      master.education.find((me) => normalizeStr(me.institution) === normalizeStr(e.institution));

    if (!masterEdu) {
      immutableFieldViolations++;
      claims.push({
        section: 'education',
        claim: `${e.studyType ?? ''} ${e.area ?? ''} at ${e.institution}`.trim(),
        sourceId: srcId,
        status: 'flagged',
        severity: 'critical',
        evidence: '',
        issue: `Institution "${e.institution}" does not exist in master education.`
      });
      return;
    }

    if (normalizeStr(masterEdu.institution) !== normalizeStr(e.institution)) {
      immutableFieldViolations++;
      claims.push({
        section: 'education',
        claim: e.institution,
        sourceId: masterEdu.id,
        status: 'flagged',
        severity: 'critical',
        evidence: masterEdu.institution,
        issue: `Institution altered from "${masterEdu.institution}" to "${e.institution}".`
      });
    } else if ((e.score ?? '').trim() && normalizeStr(masterEdu.score) !== normalizeStr(e.score)) {
      immutableFieldViolations++;
      claims.push({
        section: 'education',
        claim: `${e.institution} score: ${e.score}`,
        sourceId: masterEdu.id,
        status: 'flagged',
        severity: 'critical',
        evidence: masterEdu.score ?? '',
        issue: `Education score/CGPA altered from "${masterEdu.score ?? 'none'}" to "${e.score}".`
      });
    } else {
      claims.push({
        section: 'education',
        claim: `${e.studyType ?? ''} at ${e.institution}`.trim(),
        sourceId: masterEdu.id,
        status: 'verified',
        severity: 'info',
        evidence: masterEdu.institution,
        issue: ''
      });
    }
  });

  // 4. Verify every skill keyword exists in master profile or story bank
  for (const grp of tailored.skills) {
    for (const kw of grp.keywords) {
      if (!containsTokenInCorpus(kw, corpusLower)) {
        claims.push({
          section: 'skills',
          claim: kw,
          sourceId: null,
          status: 'flagged',
          severity: 'critical',
          evidence: '',
          issue: `Skill "${kw}" does not appear anywhere in master profile or story bank.`
        });
      } else {
        claims.push({
          section: 'skills',
          claim: kw,
          sourceId: null,
          status: 'verified',
          severity: 'info',
          evidence: 'Found in master profile/story bank',
          issue: ''
        });
      }
    }
  }

  // 5. Verify numeric metrics inside tailored summary
  if (tailored.basics.summary?.trim()) {
    const summaryNums = extractNumericFingerprints(tailored.basics.summary);
    const badSummaryNums = summaryNums.filter((n) => !allowedNumbers.has(n));
    if (badSummaryNums.length > 0) {
      claims.push({
        section: 'basics.summary',
        claim: tailored.basics.summary,
        sourceId: 'basics',
        status: 'flagged',
        severity: 'critical',
        evidence: master.basics.summary ?? '',
        issue: `Unsupported metric(s) in summary: ${badSummaryNums.join(', ')}`
      });
    }
  }

  const flaggedCount = claims.filter((c) => c.status === 'flagged').length;
  return {
    deterministicPassed: flaggedCount === 0 && immutableFieldViolations === 0,
    immutableFieldViolations,
    claims
  };
}

export function buildVerifierReport(params: {
  deterministicPassed: boolean;
  immutableFieldViolations: number;
  deterministicClaims: VerifierClaim[];
  llmClaims?: VerifierClaim[];
  llmNotes?: string;
}): VerifierReport {
  const merged = [...params.deterministicClaims];
  const seen = new Set(
    merged.map((c) => `${c.section.toLowerCase()}::${c.claim.trim().toLowerCase()}::${c.status}`)
  );

  for (const lc of params.llmClaims ?? []) {
    const key = `${lc.section.toLowerCase()}::${lc.claim.trim().toLowerCase()}::${lc.status}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(lc);
    }
  }

  const unsupportedClaimCount = merged.filter((c) => c.status === 'flagged').length;
  const totalClaimsChecked = merged.length;
  const llmFlaggedCount = (params.llmClaims ?? []).filter((c) => c.status === 'flagged').length;
  const llmVerifierPassed = llmFlaggedCount === 0;
  const unsupportedClaimRate =
    totalClaimsChecked > 0
      ? Math.round((unsupportedClaimCount / totalClaimsChecked) * 10000) / 10000
      : 0;

  return {
    passed: params.deterministicPassed && llmVerifierPassed && params.immutableFieldViolations === 0,
    deterministicPassed: params.deterministicPassed,
    llmVerifierPassed,
    totalClaimsChecked,
    unsupportedClaimCount,
    immutableFieldViolations: params.immutableFieldViolations,
    unsupportedClaimRate,
    claims: merged,
    overallNotes:
      params.llmNotes ||
      (unsupportedClaimCount === 0
        ? 'All claims, employers, dates, skills, and numeric metrics traced to master profile.'
        : `${unsupportedClaimCount} unsupported or altered claim(s) flagged.`)
  };
}
