import type { HttpConditionalHeaders, PoliteHttpClient } from '../http/polite-fetch.js';
import { buildNormalizedJob, type ConnectorFetchResult } from './base.js';

interface WorkableResponse {
  jobs?: Array<{
    id?: string | number;
    shortcode?: string;
    title?: string;
    url?: string;
    shortlink?: string;
    application_url?: string;
    telecommuting?: boolean;
    workplace_type?: string;
    published_on?: string;
    department?: string;
    location?: {
      city?: string;
      region?: string;
      country?: string;
      country_code?: string;
    };
    city?: string;
    country?: string;
    description?: string;
  }>;
}

export async function fetchWorkableBoard(params: {
  slug: string;
  companyName: string;
  http: PoliteHttpClient;
  conditional?: HttpConditionalHeaders;
}): Promise<ConnectorFetchResult> {
  const url = `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(params.slug)}`;
  const res = await params.http.getJson<WorkableResponse>(url, {
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
      const locationParts = [
        item.location?.city ?? item.city,
        item.location?.region,
        item.location?.country ?? item.country
      ].filter(Boolean);
      const extId = String(item.shortcode ?? item.id ?? '');
      const sourceUrl = item.url ?? item.shortlink ?? `https://apply.workable.com/${params.slug}/j/${extId}/`;

      return buildNormalizedJob({
        sourceType: 'workable',
        externalId: extId || sourceUrl,
        sourceUrl,
        applyUrl: item.application_url ?? sourceUrl,
        companyName: params.companyName,
        title: item.title ?? '',
        locationRaw: locationParts.join(', '),
        workModeHint: item.telecommuting ? 'remote' : item.workplace_type ?? null,
        descriptionHtmlOrText: item.description ?? `${item.title ?? ''} ${item.department ?? ''}`,
        postedAt: item.published_on ?? null,
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
