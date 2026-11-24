import type { PoliteHttpClient } from '../http/polite-fetch.js';
import { cleanHtmlDescription } from '../normalize/html-clean.js';
import { buildNormalizedJob, type ConnectorFetchResult } from './base.js';

interface AlgoliaStoriesResponse {
  hits?: Array<{
    objectID?: string;
    title?: string;
    created_at?: string;
  }>;
}

interface AlgoliaCommentsResponse {
  hits?: Array<{
    objectID?: string;
    parent_id?: number | string;
    comment_text?: string;
    created_at?: string;
  }>;
}

function extractFirstApplyUrl(html: string): string | null {
  const hrefMatches = html.matchAll(/href=["'](https?:\/\/[^"'\s>]+)["']/gi);
  for (const m of hrefMatches) {
    const candidate = m[1];
    if (!candidate || candidate.includes('news.ycombinator.com')) continue;
    try {
      return new URL(candidate).toString();
    } catch {
      // ignore invalid URL
    }
  }
  const plainMatches = html.matchAll(/\bhttps?:\/\/[^\s<>"')\]]+/gi);
  for (const m of plainMatches) {
    const candidate = m[0]?.replace(/[.,;!?]+$/, '');
    if (!candidate || candidate.includes('news.ycombinator.com')) continue;
    try {
      return new URL(candidate).toString();
    } catch {
      // ignore invalid URL
    }
  }
  return null;
}

function parseHnHeaderLine(commentHtml: string): {
  companyName: string;
  title: string;
  locationRaw: string;
  cleanText: string;
} | null {
  const cleanText = cleanHtmlDescription(commentHtml);
  const firstLine = cleanText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return null;

  const parts = firstLine
    .split('|')
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length < 2) return null;

  const companyName = parts[0]!.slice(0, 120);
  const title = parts[1]!.slice(0, 180);
  const remaining = parts.slice(2);

  const locationHint =
    remaining.find((p) =>
      /\b(remote|hybrid|onsite|india|bengaluru|bangalore|us|usa|uk|london|europe|nyc|sf|global|worldwide|timezone)\b/i.test(
        p
      )
    ) ??
    remaining[0] ??
    'Remote / Unspecified';

  return {
    companyName,
    title,
    locationRaw: locationHint,
    cleanText
  };
}

export async function fetchHackerNewsHiringFeed(params: {
  hitsPerPage?: number;
  http: PoliteHttpClient;
}): Promise<ConnectorFetchResult> {
  const storySearchUrl =
    'https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&query=who+is+hiring&hitsPerPage=1';
  const storyRes = await params.http.getJson<AlgoliaStoriesResponse>(storySearchUrl);
  const storyId = storyRes.data?.hits?.[0]?.objectID;

  if (!storyId) {
    return {
      jobs: [],
      etag: null,
      lastModified: null,
      notModified: false
    };
  }

  const limit = Math.min(120, Math.max(10, params.hitsPerPage ?? 80));
  const commentsUrl = `https://hn.algolia.com/api/v1/search_by_date?tags=comment,story_${encodeURIComponent(storyId)}&hitsPerPage=${limit}`;
  const commentsRes = await params.http.getJson<AlgoliaCommentsResponse>(commentsUrl);

  const jobs = (commentsRes.data?.hits ?? [])
    .filter((hit) => {
      if (!hit.objectID || !hit.comment_text) return false;
      if (hit.parent_id != null && String(hit.parent_id) !== String(storyId)) return false;
      return true;
    })
    .map((hit) => {
      const parsed = parseHnHeaderLine(hit.comment_text!);
      if (!parsed) return null;

      const sourceUrl = `https://news.ycombinator.com/item?id=${hit.objectID}`;
      const applyUrl = extractFirstApplyUrl(hit.comment_text!) ?? sourceUrl;

      return buildNormalizedJob({
        sourceType: 'hackernews',
        externalId: String(hit.objectID),
        sourceUrl,
        applyUrl,
        companyName: parsed.companyName,
        title: parsed.title,
        locationRaw: parsed.locationRaw,
        workModeHint: /\bremote\b/i.test(parsed.locationRaw) ? 'remote' : null,
        descriptionHtmlOrText: parsed.cleanText,
        postedAt: hit.created_at ?? null,
        rawPayload: hit as unknown as Record<string, unknown>
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
