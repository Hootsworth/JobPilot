import type { PoliteHttpClient } from '../http/polite-fetch.js';
import { buildNormalizedJob, type ConnectorFetchResult } from './base.js';

interface AdzunaResponse {
  results?: Array<{
    id: string | number;
    title?: string;
    description?: string;
    redirect_url?: string;
    created?: string;
    salary_min?: number;
    salary_max?: number;
    company?: { display_name?: string };
    location?: { display_name?: string; area?: string[] };
  }>;
}

export async function fetchAdzunaIndia(params: {
  appId?: string;
  appKey?: string;
  query?: string;
  page?: number;
  http: PoliteHttpClient;
}): Promise<ConnectorFetchResult> {
  if (!params.appId?.trim() || !params.appKey?.trim()) {
    return {
      jobs: [],
      etag: null,
      lastModified: null,
      notModified: false,
      skippedReason: 'ADZUNA_APP_ID / ADZUNA_APP_KEY not set'
    };
  }

  const page = params.page ?? 1;
  const search = new URLSearchParams({
    app_id: params.appId.trim(),
    app_key: params.appKey.trim(),
    results_per_page: '50',
    what: params.query?.trim() || 'software engineer'
  });

  const url = `https://api.adzuna.com/v1/api/jobs/in/search/${page}?${search.toString()}`;
  const res = await params.http.getJson<AdzunaResponse>(url);

  if (res.notModified || !res.data) {
    return { jobs: [], etag: res.etag, lastModified: res.lastModified, notModified: res.notModified };
  }

  const jobs = (res.data.results ?? [])
    .map((item) =>
      buildNormalizedJob({
        sourceType: 'adzuna',
        externalId: String(item.id),
        sourceUrl: item.redirect_url ?? '',
        applyUrl: item.redirect_url ?? null,
        companyName: item.company?.display_name ?? 'Unknown Company',
        title: item.title ?? '',
        locationRaw: item.location?.display_name || item.location?.area?.join(', ') || 'India',
        descriptionHtmlOrText: item.description ?? '',
        postedAt: item.created ?? null,
        explicitSalaryMin: item.salary_min ?? null,
        explicitSalaryMax: item.salary_max ?? null,
        explicitSalaryCurrency: item.salary_min != null || item.salary_max != null ? 'INR' : null,
        explicitSalaryPeriod: item.salary_min != null || item.salary_max != null ? 'year' : null,
        rawPayload: item as unknown as Record<string, unknown>
      })
    )
    .filter((j): j is NonNullable<typeof j> => j !== null);

  return {
    jobs,
    etag: res.etag,
    lastModified: res.lastModified,
    notModified: false
  };
}
