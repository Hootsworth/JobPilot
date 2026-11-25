import type { PoliteHttpClient } from '../http/polite-fetch.js';
import { buildNormalizedJob, type ConnectorFetchResult } from './base.js';

interface WorkdayPosting {
  title?: string;
  externalPath?: string;
  locationsText?: string;
  postedOn?: string;
  bulletFields?: string[];
  remoteType?: string;
}

interface WorkdayCxsResponse {
  total?: number;
  jobPostings?: WorkdayPosting[];
}

export function parseWorkdayPostedOn(raw: string | null | undefined, nowMs: number = Date.now()): string | null {
  if (!raw) return null;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return null;

  if (normalized.includes('today')) {
    return new Date(nowMs).toISOString();
  }
  if (normalized.includes('yesterday')) {
    return new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
  }
  // Never fabricate exact dates for vague ranges like "Posted 30+ Days Ago"
  if (normalized.includes('+')) {
    return null;
  }
  const daysMatch = normalized.match(/(\d+)\s+days?\s+ago/);
  if (daysMatch?.[1]) {
    const days = Number.parseInt(daysMatch[1], 10);
    if (Number.isFinite(days) && days >= 0 && days <= 90) {
      return new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();
    }
  }
  return null;
}

export async function fetchWorkdayBoard(params: {
  slug: string;
  companyName: string;
  host: string;
  tenant: string;
  site: string;
  http: PoliteHttpClient;
  maxPages?: number;
  pageSize?: number;
}): Promise<ConnectorFetchResult> {
  const maxPages = Math.max(1, Math.min(params.maxPages ?? 2, 5));
  const pageSize = Math.max(1, Math.min(params.pageSize ?? 20, 20));
  const endpoint = `https://${params.host}/wday/cxs/${encodeURIComponent(params.tenant)}/${encodeURIComponent(params.site)}/jobs`;
  const boardKey = `workday:${params.slug}`;

  const collected: WorkdayPosting[] = [];
  for (let page = 0; page < maxPages; page++) {
    const offset = page * pageSize;
    const res = await params.http.postJson<WorkdayCxsResponse>(
      endpoint,
      {
        appliedFacets: {},
        limit: pageSize,
        offset,
        searchText: ''
      },
      {
        headers: {
          Accept: 'application/json'
        }
      }
    );

    const postings = res.data?.jobPostings ?? [];
    if (postings.length === 0) break;
    collected.push(...postings);

    const total = res.data?.total ?? 0;
    if (offset + postings.length >= total || postings.length < pageSize) {
      break;
    }
  }

  const jobs = collected
    .map((item) => {
      const path = item.externalPath?.trim();
      if (!path) return null;
      const cleanPath = path.startsWith('/') ? path : `/${path}`;
      const publicUrl = `https://${params.host}/en-US/${encodeURIComponent(params.site)}${cleanPath}`;
      const externalId = cleanPath.split('/').filter(Boolean).pop() ?? cleanPath;
      const bulletSummary = (item.bulletFields ?? []).filter(Boolean).join(' · ');
      const description = [
        item.title ? `Role: ${item.title}` : '',
        item.locationsText ? `Location: ${item.locationsText}` : '',
        bulletSummary ? `Details: ${bulletSummary}` : ''
      ]
        .filter(Boolean)
        .join('\n');

      return buildNormalizedJob({
        sourceType: 'workday',
        externalId,
        sourceUrl: publicUrl,
        applyUrl: publicUrl,
        companyName: params.companyName,
        title: item.title ?? '',
        locationRaw: item.locationsText ?? '',
        workModeHint: item.remoteType ?? item.locationsText ?? null,
        boardKey,
        descriptionHtmlOrText: description,
        postedAt: parseWorkdayPostedOn(item.postedOn),
        rawPayload: item as unknown as Record<string, unknown>
      });
    })
    .filter((j): j is NonNullable<typeof j> => j !== null);

  return {
    jobs,
    etag: null,
    lastModified: null,
    notModified: false
  };
}
