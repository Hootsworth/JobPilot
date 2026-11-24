import type { HttpConditionalHeaders, PoliteHttpClient } from '../http/polite-fetch.js';
import { buildNormalizedJob, type ConnectorFetchResult } from './base.js';

interface JobicyResponse {
  jobs?: Array<{
    id?: number | string;
    url?: string;
    jobTitle?: string;
    companyName?: string;
    companyLogo?: string | null;
    jobIndustry?: string[];
    jobType?: string[];
    jobGeo?: string;
    jobLevel?: string;
    jobExcerpt?: string;
    jobDescription?: string;
    pubDate?: string;
    annualSalaryMin?: string | number | null;
    annualSalaryMax?: string | number | null;
    salaryCurrency?: string | null;
  }>;
}

function parsePositiveNum(raw: string | number | null | undefined): number | null {
  if (raw == null || raw === '') return null;
  const num = typeof raw === 'number' ? raw : Number.parseFloat(raw);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function mapJobicyItems(rawJobs: JobicyResponse['jobs']) {
  return (rawJobs ?? [])
    .map((item) => {
      const minSal = parsePositiveNum(item.annualSalaryMin);
      const maxSal = parsePositiveNum(item.annualSalaryMax);
      return buildNormalizedJob({
        sourceType: 'jobicy',
        externalId: String(item.id ?? item.url ?? ''),
        sourceUrl: item.url ?? '',
        applyUrl: item.url ?? null,
        companyName: item.companyName ?? '',
        companyLogoUrl: item.companyLogo?.startsWith('http') ? item.companyLogo : null,
        title: item.jobTitle ?? '',
        locationRaw: item.jobGeo ? `Remote (${item.jobGeo})` : 'Remote (Worldwide)',
        workModeHint: 'remote',
        descriptionHtmlOrText: item.jobDescription || item.jobExcerpt || '',
        explicitTags: [...(item.jobIndustry ?? []), ...(item.jobType ?? [])],
        explicitSalaryMin: minSal,
        explicitSalaryMax: maxSal,
        explicitSalaryCurrency:
          minSal != null || maxSal != null ? item.salaryCurrency || 'USD' : null,
        explicitSalaryPeriod: minSal != null || maxSal != null ? 'year' : null,
        postedAt: item.pubDate ?? null,
        rawPayload: item as unknown as Record<string, unknown>
      });
    })
    .filter((j): j is NonNullable<typeof j> => j !== null);
}

export async function fetchJobicyFeed(params: {
  count?: number;
  tag?: string;
  http: PoliteHttpClient;
  conditional?: HttpConditionalHeaders;
}): Promise<ConnectorFetchResult> {
  const search = new URLSearchParams({
    count: String(params.count ?? 50)
  });
  if (params.tag?.trim()) {
    search.set('tag', params.tag.trim().toLowerCase());
  }

  const primaryUrl = `https://jobicy.com/api/v2/remote-jobs?${search.toString()}`;
  const res = await params.http.getJson<JobicyResponse>(primaryUrl, {
    conditional: params.conditional
  });

  if (res.notModified) {
    return {
      jobs: [],
      etag: res.etag,
      lastModified: res.lastModified,
      notModified: true
    };
  }

  let jobs = mapJobicyItems(res.data?.jobs);

  if (jobs.length === 0 && params.tag?.trim()) {
    const fallbackUrl = `https://jobicy.com/api/v2/remote-jobs?count=${params.count ?? 50}`;
    const fallbackRes = await params.http.getJson<JobicyResponse>(fallbackUrl);
    jobs = mapJobicyItems(fallbackRes.data?.jobs);
    return {
      jobs,
      etag: fallbackRes.etag ?? res.etag,
      lastModified: fallbackRes.lastModified ?? res.lastModified,
      notModified: false
    };
  }

  return {
    jobs,
    etag: res.etag,
    lastModified: res.lastModified,
    notModified: false
  };
}
