import type { HttpConditionalHeaders, PoliteHttpClient } from '../http/polite-fetch.js';
import { buildNormalizedJob, type ConnectorFetchResult } from './base.js';

interface HimalayasResponse {
  jobs?: Array<{
    title?: string;
    excerpt?: string;
    description?: string;
    companyName?: string;
    companyLogo?: string | null;
    employmentType?: string;
    minSalary?: number | null;
    maxSalary?: number | null;
    currency?: string | null;
    locationRestrictions?: string[];
    categories?: string[];
    seniority?: string[];
    pubDate?: number | string | null;
    applicationLink?: string;
    guid?: string;
  }>;
}

function parsePubDate(raw: number | string | null | undefined): string | null {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const ms = raw < 1e12 ? raw * 1000 : raw;
    return new Date(ms).toISOString();
  }
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim();
  }
  return null;
}

export async function fetchHimalayasFeed(params: {
  limit?: number;
  offset?: number;
  http: PoliteHttpClient;
  conditional?: HttpConditionalHeaders;
}): Promise<ConnectorFetchResult> {
  const query = new URLSearchParams({
    limit: String(params.limit ?? 50),
    offset: String(params.offset ?? 0)
  });
  const url = `https://himalayas.app/jobs/api?${query.toString()}`;
  const res = await params.http.getJson<HimalayasResponse>(url, {
    conditional: params.conditional
  });

  if (res.notModified || !res.data) {
    return {
      jobs: [],
      etag: res.etag,
      lastModified: res.lastModified,
      notModified: res.notModified
    };
  }

  const jobs = (res.data.jobs ?? [])
    .map((item) => {
      const sourceUrl =
        (item.applicationLink?.startsWith('http') ? item.applicationLink : null) ??
        (item.guid?.startsWith('http') ? item.guid : null) ??
        '';
      if (!sourceUrl) return null;

      const restrictions = (item.locationRestrictions ?? []).filter(Boolean);
      const locationRaw =
        restrictions.length > 0
          ? `Remote (${restrictions.slice(0, 3).join(', ')})`
          : 'Remote (Worldwide)';

      const salaryMin =
        typeof item.minSalary === 'number' && item.minSalary > 0 ? item.minSalary : null;
      const salaryMax =
        typeof item.maxSalary === 'number' && item.maxSalary > 0 ? item.maxSalary : null;

      return buildNormalizedJob({
        sourceType: 'himalayas',
        externalId: String(item.guid || item.applicationLink || `${item.companyName}-${item.title}`),
        sourceUrl,
        applyUrl: item.applicationLink?.startsWith('http') ? item.applicationLink : sourceUrl,
        companyName: item.companyName ?? '',
        companyLogoUrl: item.companyLogo?.startsWith('http') ? item.companyLogo : null,
        title: item.title ?? '',
        locationRaw,
        workModeHint: 'remote',
        descriptionHtmlOrText: item.description || item.excerpt || '',
        explicitTags: [...(item.categories ?? []), ...(item.seniority ?? [])],
        explicitSalaryMin: salaryMin,
        explicitSalaryMax: salaryMax,
        explicitSalaryCurrency:
          salaryMin != null || salaryMax != null ? item.currency || 'USD' : null,
        explicitSalaryPeriod: salaryMin != null || salaryMax != null ? 'year' : null,
        postedAt: parsePubDate(item.pubDate),
        rawPayload: item as unknown as Record<string, unknown>
      });
    })
    .filter((j): j is NonNullable<typeof j> => j !== null);

  return {
    jobs,
    etag: res.etag,
    lastModified: res.lastModified,
    notModified: false
  };
}
