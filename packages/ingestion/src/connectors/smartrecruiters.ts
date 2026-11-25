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

interface SmartRecruitersDetailResponse {
  jobAd?: {
    sections?: {
      companyDescription?: { text?: string };
      jobDescription?: { text?: string };
      qualifications?: { text?: string };
      additionalInformation?: { text?: string };
    };
  };
  applyUrl?: string;
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
  enrichDetailLimit?: number;
}): Promise<ConnectorFetchResult> {
  const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(params.slug)}/postings?limit=100`;
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

  const items = (res.data.content ?? []).filter((item) => Boolean(item.id));
  const detailLimit = Math.max(0, Math.min(params.enrichDetailLimit ?? 12, 25));
  const detailMap = new Map<string, SmartRecruitersDetailResponse>();

  // Prioritize India & engineering/product/AI postings for detail description enrichment
  const candidatesForDetail = [...items]
    .sort((a, b) => {
      const aIn = a.location?.country?.toLowerCase() === 'in' ? 0 : 1;
      const bIn = b.location?.country?.toLowerCase() === 'in' ? 0 : 1;
      return aIn - bIn;
    })
    .slice(0, detailLimit);

  await Promise.all(
    candidatesForDetail.map(async (item) => {
      if (!item.id) return;
      try {
        const detailUrl = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(params.slug)}/postings/${encodeURIComponent(String(item.id))}`;
        const detailRes = await params.http.getJson<SmartRecruitersDetailResponse>(detailUrl);
        if (detailRes.data) {
          detailMap.set(String(item.id), detailRes.data);
        }
      } catch {
        // Fall back cleanly to summary metadata when detail fetch fails
      }
    })
  );

  const boardKey = `smartrecruiters:${params.slug}`;

  const jobs = items
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

      const detail = detailMap.get(String(item.id));
      const sections = detail?.jobAd?.sections;
      const richHtml = [
        sections?.jobDescription?.text,
        sections?.qualifications?.text,
        sections?.additionalInformation?.text
      ]
        .filter(Boolean)
        .join('\n');

      return buildNormalizedJob({
        sourceType: 'smartrecruiters',
        externalId: String(item.id),
        sourceUrl: publicUrl,
        applyUrl: detail?.applyUrl ?? publicUrl,
        companyName: params.companyName,
        title: item.name ?? '',
        locationRaw,
        workModeHint: item.location?.remote ? 'remote' : null,
        explicitEmploymentType: item.typeOfEmployment?.label ?? null,
        boardKey,
        descriptionHtmlOrText: richHtml || summaryLines.join('\n'),
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
