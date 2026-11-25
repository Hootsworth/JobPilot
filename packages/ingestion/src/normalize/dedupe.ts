import { createHash } from 'node:crypto';
import type { JobSighting, NormalizedJobInput } from '@jobpilot/shared';

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gh_src',
  'gh_jid',
  'lever-source',
  'ref',
  'referrer',
  'source',
  'fbclid',
  'gclid'
]);

const ATS_SOURCES = new Set([
  'greenhouse',
  'lever',
  'ashby',
  'workable',
  'smartrecruiters',
  'workday'
]);

export function canonicalizeUrl(
  rawUrl: string,
  options: { preserveHash?: boolean } = {}
): string {
  try {
    const parsed = new URL(rawUrl);
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) {
        parsed.searchParams.delete(key);
      }
    }
    if (!options.preserveHash) {
      parsed.hash = '';
    }
    const str = parsed.toString();
    return str.endsWith('/') && parsed.pathname !== '/' ? str.slice(0, -1) : str;
  } catch {
    return rawUrl.trim();
  }
}

export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(private|pvt|ltd|limited|inc|llc|corp|technologies|software|india)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9+#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getLocationBucket(job: {
  city?: string | null;
  countryCode?: string | null;
  workMode?: string | null;
}): string {
  return (
    job.city ||
    (job.workMode === 'remote' ? `remote-${job.countryCode ?? 'global'}` : job.countryCode) ||
    'global'
  )
    .toLowerCase()
    .trim();
}

export function computeDedupeFingerprint(job: {
  companyName: string;
  title: string;
  city?: string | null;
  countryCode?: string | null;
  workMode?: string | null;
}): string {
  const company = normalizeCompanyName(job.companyName);
  const title = normalizeTitle(job.title);
  const locationBucket = getLocationBucket(job);
  return createHash('sha256')
    .update(`${company}::${title}::${locationBucket}`, 'utf8')
    .digest('hex');
}

function buildTokenTrigrams(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  const grams = new Set<string>();
  for (let i = 0; i <= tokens.length - 3; i++) {
    grams.add(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
  }
  return grams;
}

export function computeDescriptionSimilarity(aText: string, bText: string): number {
  const cleanA = aText.trim();
  const cleanB = bText.trim();
  if (cleanA.length < 120 || cleanB.length < 120) return 0;
  const gramsA = buildTokenTrigrams(cleanA.slice(0, 2500));
  const gramsB = buildTokenTrigrams(cleanB.slice(0, 2500));
  if (gramsA.size < 8 || gramsB.size < 8) return 0;

  let intersection = 0;
  for (const g of gramsA) {
    if (gramsB.has(g)) intersection++;
  }
  const union = gramsA.size + gramsB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

export interface DedupedJobBundle {
  fingerprint: string;
  canonical: NormalizedJobInput;
  sightings: JobSighting[];
}

function mergeBundleWithIncoming(
  existing: DedupedJobBundle,
  cleanJob: NormalizedJobInput,
  sighting: JobSighting
): void {
  const alreadySeen = existing.sightings.some(
    (s) => s.sourceType === sighting.sourceType && s.externalId === sighting.externalId
  );
  if (!alreadySeen) {
    existing.sightings.push(sighting);
  }

  const existingIsAts = ATS_SOURCES.has(existing.canonical.sourceType);
  const incomingIsAts = ATS_SOURCES.has(cleanJob.sourceType);
  const preferIncomingSource = incomingIsAts && !existingIsAts;

  const mergedSkills = Array.from(
    new Set([...existing.canonical.extractedSkills, ...cleanJob.extractedSkills])
  ).sort();

  existing.canonical = {
    ...existing.canonical,
    sourceType: preferIncomingSource ? cleanJob.sourceType : existing.canonical.sourceType,
    externalId: preferIncomingSource ? cleanJob.externalId : existing.canonical.externalId,
    sourceUrl: preferIncomingSource ? cleanJob.sourceUrl : existing.canonical.sourceUrl,
    applyUrl: preferIncomingSource
      ? (cleanJob.applyUrl ?? existing.canonical.applyUrl)
      : (existing.canonical.applyUrl ?? cleanJob.applyUrl),
    city: existing.canonical.city ?? cleanJob.city,
    countryCode: existing.canonical.countryCode ?? cleanJob.countryCode,
    workMode:
      existing.canonical.workMode === 'unknown' && cleanJob.workMode !== 'unknown'
        ? cleanJob.workMode
        : existing.canonical.workMode,
    seniority:
      existing.canonical.seniority === 'unknown' && cleanJob.seniority !== 'unknown'
        ? cleanJob.seniority
        : existing.canonical.seniority,
    employmentType:
      existing.canonical.employmentType === 'unknown' && cleanJob.employmentType !== 'unknown'
        ? cleanJob.employmentType
        : existing.canonical.employmentType,
    fresherEligible: existing.canonical.fresherEligible ?? cleanJob.fresherEligible,
    stipendMonthlyInr: existing.canonical.stipendMonthlyInr ?? cleanJob.stipendMonthlyInr,
    careerCategory:
      existing.canonical.careerCategory === 'other' && cleanJob.careerCategory !== 'other'
        ? cleanJob.careerCategory
        : existing.canonical.careerCategory,
    boardKey: preferIncomingSource
      ? (cleanJob.boardKey ?? existing.canonical.boardKey)
      : (existing.canonical.boardKey ?? cleanJob.boardKey),
    experienceMinYears:
      existing.canonical.experienceMinYears ?? cleanJob.experienceMinYears,
    experienceMaxYears:
      existing.canonical.experienceMaxYears ?? cleanJob.experienceMaxYears,
    salaryMin: existing.canonical.salaryMin ?? cleanJob.salaryMin,
    salaryMax: existing.canonical.salaryMax ?? cleanJob.salaryMax,
    salaryCurrency: existing.canonical.salaryCurrency ?? cleanJob.salaryCurrency,
    salaryPeriod: existing.canonical.salaryPeriod ?? cleanJob.salaryPeriod,
    salaryMinLpa: existing.canonical.salaryMinLpa ?? cleanJob.salaryMinLpa,
    salaryMaxLpa: existing.canonical.salaryMaxLpa ?? cleanJob.salaryMaxLpa,
    descriptionClean:
      cleanJob.descriptionClean.length > existing.canonical.descriptionClean.length
        ? cleanJob.descriptionClean
        : existing.canonical.descriptionClean,
    extractedSkills: mergedSkills,
    postedAt: existing.canonical.postedAt ?? cleanJob.postedAt
  };
}

export function dedupeNormalizedJobs(jobs: NormalizedJobInput[]): DedupedJobBundle[] {
  const bundles: DedupedJobBundle[] = [];
  const byFingerprint = new Map<string, DedupedJobBundle>();
  const byExternalKey = new Map<string, DedupedJobBundle>();
  const byUrl = new Map<string, DedupedJobBundle>();
  const byCompanyLocation = new Map<string, DedupedJobBundle[]>();
  const nowIso = new Date().toISOString();

  for (const job of jobs) {
    const normalizedTitle = job.normalizedTitle || normalizeTitle(job.title);
    const cleanSourceUrl = canonicalizeUrl(job.sourceUrl);
    const cleanApplyUrl = job.applyUrl ? canonicalizeUrl(job.applyUrl, { preserveHash: true }) : null;
    const cleanJob: NormalizedJobInput = {
      ...job,
      normalizedTitle,
      sourceUrl: cleanSourceUrl,
      applyUrl: cleanApplyUrl
    };

    const fingerprint = computeDedupeFingerprint(cleanJob);
    const externalKey = `${cleanJob.sourceType}::${cleanJob.externalId}`;
    const applyUrlLookup = cleanApplyUrl ? canonicalizeUrl(cleanApplyUrl) : null;
    const companyBucketKey = `${normalizeCompanyName(cleanJob.companyName)}::${getLocationBucket(cleanJob)}`;

    const sighting: JobSighting = {
      sourceType: cleanJob.sourceType,
      externalId: cleanJob.externalId,
      sourceUrl: cleanJob.sourceUrl,
      seenAt: nowIso
    };

    let existing =
      byExternalKey.get(externalKey) ??
      byUrl.get(cleanSourceUrl) ??
      (applyUrlLookup ? byUrl.get(applyUrlLookup) : undefined) ??
      byFingerprint.get(fingerprint);

    if (!existing) {
      const sameCompanyCandidates = byCompanyLocation.get(companyBucketKey) ?? [];
      for (const candidate of sameCompanyCandidates) {
        if (
          computeDescriptionSimilarity(
            candidate.canonical.descriptionClean,
            cleanJob.descriptionClean
          ) >= 0.72
        ) {
          existing = candidate;
          break;
        }
      }
    }

    if (!existing) {
      const created: DedupedJobBundle = {
        fingerprint,
        canonical: cleanJob,
        sightings: [sighting]
      };
      bundles.push(created);
      byFingerprint.set(fingerprint, created);
      byExternalKey.set(externalKey, created);
      byUrl.set(cleanSourceUrl, created);
      if (applyUrlLookup) byUrl.set(applyUrlLookup, created);
      const list = byCompanyLocation.get(companyBucketKey) ?? [];
      list.push(created);
      byCompanyLocation.set(companyBucketKey, list);
      continue;
    }

    mergeBundleWithIncoming(existing, cleanJob, sighting);
    byExternalKey.set(externalKey, existing);
    byUrl.set(cleanSourceUrl, existing);
    if (applyUrlLookup) byUrl.set(applyUrlLookup, existing);
  }

  return bundles;
}
