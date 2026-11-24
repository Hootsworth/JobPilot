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

function stripHtmlTags(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findJobPostingNode(node: unknown): Record<string, unknown> | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findJobPostingNode(item);
      if (found) return found;
    }
    return null;
  }
  const obj = node as Record<string, unknown>;
  const rawType = obj['@type'];
  const types = Array.isArray(rawType) ? rawType : [rawType];
  if (types.some((t) => String(t).toLowerCase() === 'jobposting')) {
    return obj;
  }
  if (Array.isArray(obj['@graph'])) {
    return findJobPostingNode(obj['@graph']);
  }
  return null;
}

function extractJsonLdJobPosting(doc: Document): {
  title?: string;
  companyName?: string;
  locationRaw?: string;
  salaryText?: string;
  descriptionClean?: string;
} | null {
  const scripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));
  for (const script of scripts) {
    const raw = script.textContent?.trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      const posting = findJobPostingNode(parsed);
      if (!posting) continue;

      const title = typeof posting['title'] === 'string' ? posting['title'].trim() : undefined;
      const org = posting['hiringOrganization'] as Record<string, unknown> | undefined;
      const companyName = typeof org?.['name'] === 'string' ? org['name'].trim() : undefined;

      let locationRaw: string | undefined;
      const jobLoc = posting['jobLocation'] as
        | Record<string, unknown>
        | Array<Record<string, unknown>>
        | undefined;
      const firstLoc = Array.isArray(jobLoc) ? jobLoc[0] : jobLoc;
      const address = firstLoc?.['address'] as Record<string, unknown> | undefined;
      if (address) {
        locationRaw = [address['addressLocality'], address['addressRegion'], address['addressCountry']]
          .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
          .join(', ');
      }

      let salaryText: string | undefined;
      const baseSalary = posting['baseSalary'] as Record<string, unknown> | undefined;
      const valueObj = baseSalary?.['value'] as Record<string, unknown> | number | undefined;
      if (typeof valueObj === 'number') {
        salaryText = String(valueObj);
      } else if (valueObj && typeof valueObj === 'object') {
        const minV = valueObj['minValue'];
        const maxV = valueObj['maxValue'] ?? valueObj['value'];
        const cur = typeof baseSalary?.['currency'] === 'string' ? baseSalary['currency'] : '';
        if (minV != null && maxV != null) salaryText = `${cur} ${minV}–${maxV}`.trim();
        else if (maxV != null) salaryText = `${cur} ${maxV}`.trim();
      }

      const rawDesc = typeof posting['description'] === 'string' ? posting['description'] : '';
      const descriptionClean = rawDesc ? stripHtmlTags(rawDesc).slice(0, 20_000) : undefined;

      return { title, companyName, locationRaw, salaryText, descriptionClean };
    } catch {
      // Ignore malformed JSON-LD script tags
    }
  }
  return null;
}

export function buildGenericJobMetadata(
  doc: Document,
  url: URL,
  atsAdapter: AtsAdapterId
): CapturedJobMetadata {
  const jsonLd = extractJsonLdJobPosting(doc);

  const ogTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim();
  const ogSiteName = doc
    .querySelector('meta[property="og:site_name"]')
    ?.getAttribute('content')
    ?.trim();
  const ogDesc =
    doc.querySelector('meta[property="og:description"]')?.getAttribute('content')?.trim() ||
    doc.querySelector('meta[name="description"]')?.getAttribute('content')?.trim();

  const title =
    jsonLd?.title ||
    queryFirstText(doc, ['h1', 'h2', '[data-testid="job-title"]']) ||
    ogTitle ||
    doc.title.split(/[|\-–]/)[0]?.trim() ||
    'Application';
  const companyName =
    jsonLd?.companyName || ogSiteName || extractCompanySlugFromPath(url);
  const descriptionClean =
    jsonLd?.descriptionClean ||
    queryFirstText(doc, ['main', '#content', 'article']).slice(0, 20_000) ||
    ogDesc?.slice(0, 20_000) ||
    '';

  return {
    atsAdapter,
    sourceUrl: url.href,
    applyUrl: url.href,
    title,
    companyName,
    ...(jsonLd?.locationRaw ? { locationRaw: jsonLd.locationRaw } : {}),
    ...(jsonLd?.salaryText ? { salaryText: jsonLd.salaryText } : {}),
    ...(descriptionClean ? { descriptionClean } : {})
  };
}
