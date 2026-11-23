import type { HttpConditionalHeaders, PoliteHttpClient } from '../http/polite-fetch.js';
import { buildNormalizedJob, type ConnectorFetchResult } from './base.js';

interface RemoteOkEntry {
  legal?: string;
  id?: string | number;
  epoch?: number;
  date?: string;
  company?: string;
  company_logo?: string;
  position?: string;
  tags?: string[];
  location?: string;
  salary_min?: number;
  salary_max?: number;
  description?: string;
  url?: string;
  apply_url?: string;
}

export async function fetchRemoteOkFeed(params: {
  http: PoliteHttpClient;
  conditional?: HttpConditionalHeaders;
}): Promise<ConnectorFetchResult> {
  const url = 'https://remoteok.com/api';
  const res = await params.http.getJson<RemoteOkEntry[]>(url, {
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

  // Index 0 in RemoteOK API is a legal notice object without position/company
  const jobs = res.data
    .filter((item) => Boolean(item.id && item.position && item.company && !item.legal))
    .map((item) =>
      buildNormalizedJob({
        sourceType: 'remoteok',
        externalId: String(item.id),
        sourceUrl: item.url ?? `https://remoteok.com/remote-jobs/${item.id}`,
        applyUrl: item.apply_url ?? item.url ?? null,
        companyName: item.company ?? '',
        companyLogoUrl: item.company_logo || null,
        title: item.position ?? '',
        locationRaw: item.location ? `Remote (${item.location})` : 'Remote (Worldwide)',
        workModeHint: 'remote',
        descriptionHtmlOrText: item.description ?? '',
        explicitTags: item.tags ?? [],
        explicitSalaryMin: item.salary_min && item.salary_min > 0 ? item.salary_min : null,
        explicitSalaryMax: item.salary_max && item.salary_max > 0 ? item.salary_max : null,
        explicitSalaryCurrency:
          item.salary_min || item.salary_max ? 'USD' : null,
        explicitSalaryPeriod: item.salary_min || item.salary_max ? 'year' : null,
        postedAt: item.date ?? (item.epoch ? new Date(item.epoch * 1000).toISOString() : null),
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
