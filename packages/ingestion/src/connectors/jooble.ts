import type { PoliteHttpClient } from '../http/polite-fetch.js';
import { buildNormalizedJob, type ConnectorFetchResult } from './base.js';

interface JoobleResponse {
  jobs?: Array<{
    id?: string | number;
    title?: string;
    location?: string;
    snippet?: string;
    salary?: string;
    source?: string;
    type?: string;
    link?: string;
    company?: string;
    updated?: string;
  }>;
}

export async function fetchJoobleIndia(params: {
  apiKey?: string;
  keywords?: string;
  location?: string;
  page?: number;
  http: PoliteHttpClient;
}): Promise<ConnectorFetchResult> {
  if (!params.apiKey?.trim()) {
    return {
      jobs: [],
      etag: null,
      lastModified: null,
      notModified: false,
      skippedReason: 'JOOBLE_API_KEY not set'
    };
  }

  const url = `https://jooble.org/api/${encodeURIComponent(params.apiKey.trim())}`;
  const res = await params.http.postJson<JoobleResponse>(url, {
    keywords: params.keywords?.trim() || 'software engineer developer',
    location: params.location?.trim() || 'India',
    page: params.page ?? 1
  });

  if (!res.data) {
    return { jobs: [], etag: null, lastModified: null, notModified: false };
  }

  const jobs = (res.data.jobs ?? [])
    .map((item) =>
      buildNormalizedJob({
        sourceType: 'jooble',
        externalId: String(item.id ?? item.link ?? ''),
        sourceUrl: item.link ?? '',
        applyUrl: item.link ?? null,
        companyName: item.company || item.source || 'Employer via Jooble',
        title: item.title ?? '',
        locationRaw: item.location ?? 'India',
        descriptionHtmlOrText: [item.snippet ?? '', item.salary ? `Salary: ${item.salary}` : '']
          .filter(Boolean)
          .join('\n'),
        postedAt: item.updated ?? null,
        rawPayload: item as unknown as Record<string, unknown>
      })
    )
    .filter((j): j is NonNullable<typeof j> => j !== null);

  return {
    jobs,
    etag: null,
    lastModified: null,
    notModified: false
  };
}
