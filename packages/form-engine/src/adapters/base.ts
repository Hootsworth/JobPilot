import type { AtsAdapterId, CapturedJobMetadata } from '@jobpilot/shared';

export function queryFirstText(doc: Document, selectors: string[]): string {
  for (const selector of selectors) {
    const el = doc.querySelector(selector);
    const text = el?.textContent?.replace(/\s+/g, ' ').trim();
    if (text) return text;
  }
  return '';
}

export function extractCompanySlugFromPath(url: URL): string {
  const seg = url.pathname
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)[0];
  if (!seg) return url.hostname;
  return seg
    .split(/[-_]+/)
    .map((part) => (part ? part[0]!.toUpperCase() + part.slice(1) : ''))
    .join(' ');
}

export function buildGenericJobMetadata(
  doc: Document,
  url: URL,
  atsAdapter: AtsAdapterId
): CapturedJobMetadata {
  const title =
    queryFirstText(doc, ['h1', 'h2', '[data-testid="job-title"]']) ||
    doc.title.split(/[|\-–]/)[0]?.trim() ||
    'Application';
  const companyName =
    doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content')?.trim() ||
    extractCompanySlugFromPath(url);
  const descriptionClean = queryFirstText(doc, ['main', '#content', 'article']).slice(0, 20_000);

  return {
    atsAdapter,
    sourceUrl: url.href,
    applyUrl: url.href,
    title,
    companyName,
    ...(descriptionClean ? { descriptionClean } : {})
  };
}
