import type { PoliteHttpClient } from '../http/polite-fetch.js';
import { buildNormalizedJob, type ConnectorFetchResult } from './base.js';

interface JSearchResponse {
  data?: Array<{
    job_id?: string;
    employer_name?: string;
    employer_logo?: string | null;
    job_title?: string;
    job_apply_link?: string;
    job_google_link?: string;
    job_description?: string;
    job_is_remote?: boolean;
    job_posted_at_datetime_utc?: string;
    job_city?: string;
    job_state?: string;
    job_country?: string;
    job_min_salary?: number | null;
    job_max_salary?: number | null;
    job_salary_currency?: string | null;
    job_salary_period?: string | null;
  }>;
}

export async function fetchJSearchOptional(params: {
  rapidApiKey?: string;
  query?: string;
  page?: number;
  maxPagesPerRun?: number;
  http: PoliteHttpClient;
}): Promise<ConnectorFetchResult> {
  if (!params.rapidApiKey?.trim()) {
    return {
      jobs: [],
      etag: null,
      lastModified: null,
      notModified: false,
      skippedReason: 'JSEARCH_RAPIDAPI_KEY not set (optional free-tier connector disabled)'
    };
  }

  const page = params.page ?? 1;
  const maxPages = params.maxPagesPerRun ?? 1;
  if (page > maxPages) {
    return {
      jobs: [],
      etag: null,
      lastModified: null,
      notModified: false,
      skippedReason: `Exceeded JSEARCH_MAX_PAGES_PER_RUN=${maxPages} budget`
    };
  }

  const search = new URLSearchParams({
    query: params.query?.trim() || 'software engineer in India',
    page: String(page),
    num_pages: '1'
  });

  const url = `https://jsearch.p.rapidapi.com/search?${search.toString()}`;
  const res = await params.http.getJson<JSearchResponse>(url, {
    headers: {
      'X-RapidAPI-Key': params.rapidApiKey.trim(),
      'X-RapidAPI-Host': 'jsearch.p.rapidapi.com'
    }
  });

  if (!res.data) {
    return { jobs: [], etag: null, lastModified: null, notModified: false };
  }

  const jobs = (res.data.data ?? [])
    .map((item) => {
      const locationRaw = [item.job_city, item.job_state, item.job_country]
        .filter(Boolean)
        .join(', ');
      const period =
        item.job_salary_period?.toLowerCase() === 'month'
          ? 'month'
          : item.job_salary_period?.toLowerCase() === 'hour'
            ? 'hour'
            : 'year';

      return buildNormalizedJob({
        sourceType: 'jsearch',
        externalId: String(item.job_id ?? item.job_apply_link ?? ''),
        sourceUrl: item.job_apply_link ?? item.job_google_link ?? '',
        applyUrl: item.job_apply_link ?? null,
        companyName: item.employer_name ?? 'Employer',
        companyLogoUrl: item.employer_logo ?? null,
        title: item.job_title ?? '',
        locationRaw: locationRaw || 'India',
        workModeHint: item.job_is_remote ? 'remote' : null,
        descriptionHtmlOrText: item.job_description ?? '',
        postedAt: item.job_posted_at_datetime_utc ?? null,
        explicitSalaryMin: item.job_min_salary ?? null,
        explicitSalaryMax: item.job_max_salary ?? null,
        explicitSalaryCurrency: item.job_salary_currency ?? null,
        explicitSalaryPeriod:
          item.job_min_salary != null || item.job_max_salary != null ? period : null,
        rawPayload: item as unknown as Record<string, unknown>
      });
    })
    .filter((j): j is NonNullable<typeof j> => j !== null);

  return {
    jobs,
    etag: null,
    lastModified: null,
    notModified: false
  };
}
