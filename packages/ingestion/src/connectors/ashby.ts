import type { HttpConditionalHeaders, PoliteHttpClient } from '../http/polite-fetch.js';
import { buildNormalizedJob, type ConnectorFetchResult } from './base.js';

interface AshbyResponse {
  jobs?: Array<{
    id: string;
    title?: string;
    location?: string;
    secondaryLocations?: Array<{ location?: string }>;
    isRemote?: boolean;
    workplaceType?: string;
    jobUrl?: string;
    applyUrl?: string;
    descriptionHtml?: string;
    descriptionPlain?: string;
    publishedAt?: string;
  }>;
}

export async function fetchAshbyBoard(params: {
  slug: string;
  companyName: string;
  http: PoliteHttpClient;
  conditional?: HttpConditionalHeaders;
}): Promise<ConnectorFetchResult> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(params.slug)}?includeCompensation=true`;
  const res = await params.http.getJson<AshbyResponse>(url, {
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
    .map((item) => {
      const secondary = (item.secondaryLocations ?? [])
        .map((s) => s.location)
        .filter(Boolean)
        .join(', ');
      const locationRaw = [item.location, secondary].filter(Boolean).join(' / ');
      const workModeHint = item.isRemote ? 'remote' : item.workplaceType ?? null;

      return buildNormalizedJob({
        sourceType: 'ashby',
        externalId: String(item.id),
        sourceUrl: item.jobUrl ?? `https://jobs.ashbyhq.com/${params.slug}/${item.id}`,
        applyUrl: item.applyUrl ?? item.jobUrl ?? null,
        companyName: params.companyName,
        title: item.title ?? '',
        locationRaw,
        workModeHint,
        boardKey: `ashby:${params.slug}`,
        descriptionHtmlOrText: item.descriptionHtml ?? item.descriptionPlain ?? '',
        postedAt: item.publishedAt ?? null,
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
