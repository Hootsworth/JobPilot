import type { HttpConditionalHeaders, PoliteHttpClient } from '../http/polite-fetch.js';
import { buildNormalizedJob, type ConnectorFetchResult } from './base.js';

interface LeverPosting {
  id: string;
  text?: string;
  hostedUrl?: string;
  applyUrl?: string;
  workplaceType?: string;
  categories?: {
    location?: string;
    commitment?: string;
    team?: string;
  };
  description?: string;
  descriptionPlain?: string;
  lists?: Array<{ text?: string; content?: string }>;
  createdAt?: number;
}

export async function fetchLeverBoard(params: {
  slug: string;
  companyName: string;
  http: PoliteHttpClient;
  conditional?: HttpConditionalHeaders;
}): Promise<ConnectorFetchResult> {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(params.slug)}?mode=json`;
  const res = await params.http.getJson<LeverPosting[]>(url, {
    conditional: params.conditional
  });

  if (res.notModified || !Array.isArray(res.data)) {
    return {
      jobs: [],
      etag: res.etag,
      lastModified: res.lastModified,
      notModified: res.notModified
    };
  }

  const jobs = res.data
    .map((item) => {
      const listHtml = (item.lists ?? [])
        .map((l) => `<h3>${l.text ?? ''}</h3>${l.content ?? ''}`)
        .join('\n');
      const fullDescription = [item.description ?? item.descriptionPlain ?? '', listHtml]
        .filter(Boolean)
        .join('\n');

      return buildNormalizedJob({
        sourceType: 'lever',
        externalId: String(item.id),
        sourceUrl: item.hostedUrl ?? `https://jobs.lever.co/${params.slug}/${item.id}`,
        applyUrl: item.applyUrl ?? item.hostedUrl ?? null,
        companyName: params.companyName,
        title: item.text ?? '',
        locationRaw: item.categories?.location ?? '',
        workModeHint: item.workplaceType ?? null,
        descriptionHtmlOrText: fullDescription,
        postedAt: item.createdAt ? new Date(item.createdAt).toISOString() : null,
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
