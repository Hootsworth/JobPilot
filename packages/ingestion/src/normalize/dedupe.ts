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

const ATS_SOURCES = new Set(['greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters']);

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

export function computeDedupeFingerprint(job: {
  companyName: string;
  title: string;
  city?: string | null;
  countryCode?: string | null;
  workMode?: string | null;
}): string {
  const company = normalizeCompanyName(job.companyName);
  const title = normalizeTitle(job.title);
  const locationBucket = (
    job.city ||
    (job.workMode === 'remote' ? `remote-${job.countryCode ?? 'global'}` : job.countryCode) ||
    'global'
  )
    .toLowerCase()
    .trim();
  return createHash('sha256')
    .update(`${company}::${title}::${locationBucket}`, 'utf8')
    .digest('hex');
}

export interface DedupedJobBundle {
  fingerprint: string;
  canonical: NormalizedJobInput;
  sightings: JobSighting[];
}

export function dedupeNormalizedJobs(jobs: NormalizedJobInput[]): DedupedJobBundle[] {
  const byFingerprint = new Map<string, DedupedJobBundle>();
  const nowIso = new Date().toISOString();

  for (const job of jobs) {
    const normalizedTitle = job.normalizedTitle || normalizeTitle(job.title);
    const cleanJob: NormalizedJobInput = {
      ...job,
      normalizedTitle,
      sourceUrl: canonicalizeUrl(job.sourceUrl),
      applyUrl: job.applyUrl ? canonicalizeUrl(job.applyUrl, { preserveHash: true }) : null
    };

    const fingerprint = computeDedupeFingerprint(cleanJob);
    const sighting: JobSighting = {
      sourceType: cleanJob.sourceType,
      externalId: cleanJob.externalId,
      sourceUrl: cleanJob.sourceUrl,
      seenAt: nowIso
    };

    const existing = byFingerprint.get(fingerprint);
    if (!existing) {
      byFingerprint.set(fingerprint, {
        fingerprint,
        canonical: cleanJob,
        sightings: [sighting]
      });
      continue;
    }

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

  return Array.from(byFingerprint.values());
}
