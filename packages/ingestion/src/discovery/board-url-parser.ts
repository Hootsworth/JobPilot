import type { SeedBoard } from '@jobpilot/shared';

const SLUG_REGEX = /^[a-zA-Z0-9._-]{2,80}$/;

function humanizeSlug(slug: string): string {
  const cleaned = slug.replace(/[-_.]+/g, ' ').trim();
  if (!cleaned) return slug;
  return cleaned
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function firstPathSegment(pathname: string): string | null {
  const segments = pathname
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
  return segments[0] ?? null;
}

/**
 * Parses a public company ATS career page URL into a validated SeedBoard config.
 * Only allows documented public ATS hostnames to prevent SSRF against internal hosts.
 */
export function parseCompanyBoardUrl(
  rawUrl: string,
  opts: { displayName?: string; regionFocus?: SeedBoard['regionFocus'] } = {}
): SeedBoard | null {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return null;
  }

  const host = url.hostname.toLowerCase();
  const regionFocus = opts.regionFocus ?? 'india';
  const providedName = opts.displayName?.trim();

  // Greenhouse: boards.greenhouse.io/<slug>, job-boards.greenhouse.io/<slug>, boards.eu.greenhouse.io/<slug>, or ?for=<slug>
  if (
    host === 'boards.greenhouse.io' ||
    host === 'job-boards.greenhouse.io' ||
    host === 'boards.eu.greenhouse.io' ||
    host === 'job-boards.eu.greenhouse.io'
  ) {
    const fromQuery = url.searchParams.get('for')?.trim() ?? null;
    const rawSeg = firstPathSegment(url.pathname);
    const slugCandidate = fromQuery || (rawSeg && rawSeg !== 'embed' ? rawSeg : null);
    if (!slugCandidate || !SLUG_REGEX.test(slugCandidate)) return null;
    return {
      sourceType: 'greenhouse',
      slug: slugCandidate,
      displayName: providedName || humanizeSlug(slugCandidate),
      regionFocus,
      careersUrl: `https://${host}/${slugCandidate}`,
      refreshTier: 'high_volume',
      enabled: true
    };
  }

  // Lever: jobs.lever.co/<slug> or jobs.eu.lever.co/<slug>
  if (host === 'jobs.lever.co' || host === 'jobs.eu.lever.co') {
    const slug = firstPathSegment(url.pathname);
    if (!slug || !SLUG_REGEX.test(slug)) return null;
    return {
      sourceType: 'lever',
      slug,
      displayName: providedName || humanizeSlug(slug),
      regionFocus,
      careersUrl: `https://${host}/${slug}`,
      refreshTier: 'high_volume',
      enabled: true
    };
  }

  // Ashby: jobs.ashbyhq.com/<slug>
  if (host === 'jobs.ashbyhq.com') {
    const slug = firstPathSegment(url.pathname);
    if (!slug || !SLUG_REGEX.test(slug)) return null;
    return {
      sourceType: 'ashby',
      slug,
      displayName: providedName || humanizeSlug(slug),
      regionFocus,
      careersUrl: `https://jobs.ashbyhq.com/${slug}`,
      refreshTier: 'high_volume',
      enabled: true
    };
  }

  // SmartRecruiters: jobs.smartrecruiters.com/<slug> or careers.smartrecruiters.com/<slug>
  if (host === 'jobs.smartrecruiters.com' || host === 'careers.smartrecruiters.com') {
    const slug = firstPathSegment(url.pathname);
    if (!slug || !SLUG_REGEX.test(slug)) return null;
    return {
      sourceType: 'smartrecruiters',
      slug,
      displayName: providedName || humanizeSlug(slug),
      regionFocus,
      careersUrl: `https://jobs.smartrecruiters.com/${slug}`,
      refreshTier: 'high_volume',
      enabled: true
    };
  }

  // Workable: apply.workable.com/<slug>
  if (host === 'apply.workable.com') {
    const slug = firstPathSegment(url.pathname);
    if (!slug || !SLUG_REGEX.test(slug)) return null;
    return {
      sourceType: 'workable',
      slug,
      displayName: providedName || humanizeSlug(slug),
      regionFocus,
      careersUrl: `https://apply.workable.com/${slug}`,
      refreshTier: 'high_volume',
      enabled: true
    };
  }

  return null;
}
