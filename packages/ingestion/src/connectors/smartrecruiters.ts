import type { HttpConditionalHeaders, PoliteHttpClient } from '../http/polite-fetch.js';
import { buildNormalizedJob, type ConnectorFetchResult } from './base.js';

interface SmartRecruitersResponse {
  content?: Array<{
    id?: string;
    name?: string;
    ref?: string;
    releasedDate?: string;
    location?: {
      city?: string;
      region?: string;
      country?: string;
      remote?: boolean;
    };
    experienceLevel?: {
      id?: string;
      label?: string;
    };
    department?: {
      label?: string;
    };
    typeOfEmployment?: {
      label?: string;
    };
  }>;
}

const ISO_COUNTRY_NAMES: Record<string, string> = {
  in: 'India',
  us: 'United States',
  gb: 'United Kingdom',
  uk: 'United Kingdom',
  de: 'Germany',
  sg: 'Singapore',
  ca: 'Canada',
  au: 'Australia',
  nl: 'Netherlands',
  ie: 'Ireland',
  ae: 'UAE'
};

export async function fetchSmartRecruitersBoard(params: {
  slug: string;
  companyName: string;
  http: PoliteHttpClient;
  conditional?: HttpConditionalHeaders;
}): Promise<ConnectorFetchResult> {
  const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(params.slug)}/postings?limit=50`;
  const res = await params.http.getJson<SmartRecruitersResponse>(url, {
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

  const jobs = (res.data.content ?? [])
    .map((item) => {
      if (!item.id) return null;
      const publicUrl = `https://jobs.smartrecruiters.com/${encodeURIComponent(params.slug)}/${encodeURIComponent(String(item.id))}`;
      const rawCountry = item.location?.country?.toLowerCase() ?? '';
      const countryDisplay = ISO_COUNTRY_NAMES[rawCountry] ?? item.location?.country?.toUpperCase();
      const locParts = [
        item.location?.city,
        item.location?.region,
        countryDisplay
      ].filter(Boolean);
      const locationRaw = item.location?.remote
        ? `Remote${locParts.length > 0 ? ` (${locParts.join(', ')})` : ''}`
        : locParts.join(', ') || 'Unspecified';

      const summaryLines = [
        item.department?.label ? `Department: ${item.department.label}` : '',
        item.experienceLevel?.label ? `Experience Level: ${item.experienceLevel.label}` : '',
        item.typeOfEmployment?.label ? `Employment Type: ${item.typeOfEmployment.label}` : '',
        `Location: ${locationRaw}`
      ].filter(Boolean);

      return buildNormalizedJob({
        sourceType: 'smartrecruiters',
        externalId: String(item.id),
        sourceUrl: publicUrl,
        applyUrl: publicUrl,
        companyName: params.companyName,
        title: item.name ?? '',
        locationRaw,
        workModeHint: item.location?.remote ? 'remote' : null,
        descriptionHtmlOrText: summaryLines.join('\n'),
        postedAt: item.releasedDate ?? null,
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
