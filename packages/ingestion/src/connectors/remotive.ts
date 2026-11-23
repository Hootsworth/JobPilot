import type { HttpConditionalHeaders, PoliteHttpClient } from '../http/polite-fetch.js';
import { buildNormalizedJob, type ConnectorFetchResult } from './base.js';

interface RemotiveResponse {
  jobs?: Array<{
    id: number | string;
    url?: string;
    title?: string;
    company_name?: string;
    company_logo?: string;
    category?: string;
    tags?: string[];
    job_type?: string;
    publication_date?: string;
    candidate_required_location?: string;
    salary?: string;
    description?: string;
  }>;
}

export async function fetchRemotiveFeed(params: {
  category?: string;
  limit?: number;
  http: PoliteHttpClient;
  conditional?: HttpConditionalHeaders;
}): Promise<ConnectorFetchResult> {
  const query = new URLSearchParams({
    category: params.category ?? 'software-dev',
    limit: String(params.limit ?? 100)
  });
  const url = `https://remotive.com/api/remote-jobs?${query.toString()}`;
  const res = await params.http.getJson<RemotiveResponse>(url, {
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
    .map((item) =>
      buildNormalizedJob({
        sourceType: 'remotive',
        externalId: String(item.id),
        sourceUrl: item.url ?? '',
        applyUrl: item.url ?? null,
        companyName: item.company_name ?? '',
        companyLogoUrl: item.company_logo || null,
        title: item.title ?? '',
        locationRaw: item.candidate_required_location
          ? `Remote (${item.candidate_required_location})`
          : 'Remote (Worldwide)',
        workModeHint: 'remote',
        descriptionHtmlOrText: [item.description ?? '', item.salary ? `Compensation: ${item.salary}` : '']
          .filter(Boolean)
          .join('\n'),
        explicitTags: item.tags ?? [],
        postedAt: item.publication_date ?? null,
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
