import type { HttpConditionalHeaders, PoliteHttpClient } from '../http/polite-fetch.js';
import { buildNormalizedJob, type ConnectorFetchResult } from './base.js';

interface ArbeitnowResponse {
  data?: Array<{
    slug: string;
    company_name?: string;
    title?: string;
    description?: string;
    remote?: boolean;
    url?: string;
    tags?: string[];
    job_types?: string[];
    location?: string;
    created_at?: number;
  }>;
}

export async function fetchArbeitnowFeed(params: {
  page?: number;
  http: PoliteHttpClient;
  conditional?: HttpConditionalHeaders;
}): Promise<ConnectorFetchResult> {
  const page = params.page ?? 1;
  const url = `https://www.arbeitnow.com/api/job-board-api?page=${page}`;
  const res = await params.http.getJson<ArbeitnowResponse>(url, {
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

  const jobs = (res.data.data ?? [])
    .map((item) =>
      buildNormalizedJob({
        sourceType: 'arbeitnow',
        externalId: item.slug,
        sourceUrl: item.url ?? '',
        applyUrl: item.url ?? null,
        companyName: item.company_name ?? '',
        title: item.title ?? '',
        locationRaw: item.location ?? (item.remote ? 'Remote' : ''),
        workModeHint: item.remote ? 'remote' : null,
        descriptionHtmlOrText: item.description ?? '',
        explicitTags: item.tags ?? [],
        postedAt: item.created_at ? new Date(item.created_at * 1000).toISOString() : null,
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
