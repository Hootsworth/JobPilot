import type { HttpConditionalHeaders, PoliteHttpClient } from '../http/polite-fetch.js';
import { buildNormalizedJob, type ConnectorFetchResult } from './base.js';

interface TheMuseResponse {
  results?: Array<{
    id?: number | string;
    name?: string;
    contents?: string;
    publication_date?: string;
    locations?: Array<{ name?: string }>;
    levels?: Array<{ name?: string; short_name?: string }>;
    categories?: Array<{ name?: string }>;
    company?: { name?: string };
    refs?: { landing_page?: string };
  }>;
}

export async function fetchTheMuseFeed(params: {
  category?: string;
  page?: number;
  http: PoliteHttpClient;
  conditional?: HttpConditionalHeaders;
}): Promise<ConnectorFetchResult> {
  const query = new URLSearchParams({
    category: params.category?.trim() || 'Software Engineering',
    page: String(params.page ?? 1)
  });
  const url = `https://www.themuse.com/api/public/jobs?${query.toString()}`;
  const res = await params.http.getJson<TheMuseResponse>(url, {
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

  const jobs = (res.data.results ?? [])
    .map((item) => {
      const locationNames = (item.locations ?? [])
        .map((l) => l.name?.trim())
        .filter((l): l is string => Boolean(l));
      const locationRaw = locationNames.slice(0, 3).join(', ') || 'Unspecified';
      const hasRemote = locationNames.some((l) => /remote|flexible/i.test(l));
      const levelsText = (item.levels ?? []).map((l) => l.name ?? '').join(', ');
      const description = levelsText
        ? `Level: ${levelsText}\n\n${item.contents ?? ''}`
        : (item.contents ?? '');

      return buildNormalizedJob({
        sourceType: 'themuse',
        externalId: String(item.id ?? item.refs?.landing_page ?? ''),
        sourceUrl: item.refs?.landing_page ?? '',
        applyUrl: item.refs?.landing_page ?? null,
        companyName: item.company?.name ?? '',
        title: item.name ?? '',
        locationRaw,
        workModeHint: hasRemote ? 'remote' : null,
        descriptionHtmlOrText: description,
        explicitTags: (item.categories ?? [])
          .map((c) => c.name?.trim())
          .filter((c): c is string => Boolean(c)),
        postedAt: item.publication_date ?? null,
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
