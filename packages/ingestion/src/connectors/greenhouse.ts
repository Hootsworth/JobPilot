import type { HttpConditionalHeaders, PoliteHttpClient } from '../http/polite-fetch.js';
import { buildNormalizedJob, type ConnectorFetchResult } from './base.js';

interface GreenhouseApiResponse {
  jobs?: Array<{
    id: number | string;
    title?: string;
    absolute_url?: string;
    location?: { name?: string };
    content?: string;
    updated_at?: string;
    first_published?: string;
  }>;
}

export async function fetchGreenhouseBoard(params: {
  slug: string;
  companyName: string;
  http: PoliteHttpClient;
  conditional?: HttpConditionalHeaders;
}): Promise<ConnectorFetchResult> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(params.slug)}/jobs?content=true`;
  const res = await params.http.getJson<GreenhouseApiResponse>(url, {
    conditional: params.conditional
  });

  if (res.notModified || !res.data) {
    return {
      jobs: [],
      etag: res.etag,
      lastModified: res.lastModified,
      notModified: true
    };
  }

  const jobs = (res.data.jobs ?? [])
    .map((item) =>
      buildNormalizedJob({
        sourceType: 'greenhouse',
        externalId: String(item.id),
        sourceUrl: item.absolute_url ?? `https://boards.greenhouse.io/${params.slug}/jobs/${item.id}`,
        applyUrl: item.absolute_url ? `${item.absolute_url}#app` : null,
        companyName: params.companyName,
        title: item.title ?? '',
        locationRaw: item.location?.name ?? '',
        boardKey: `greenhouse:${params.slug}`,
        descriptionHtmlOrText: item.content ?? '',
        postedAt: item.first_published ?? item.updated_at ?? null,
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
