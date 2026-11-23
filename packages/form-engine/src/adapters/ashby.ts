import type { AtsSiteAdapter, FieldClassificationHint, RawFormControl } from '../types.js';
import { extractCompanySlugFromPath, queryFirstText } from './base.js';

const ASHBY_HOSTS = new Set(['jobs.ashbyhq.com']);

export const AshbyAdapter: AtsSiteAdapter = {
  id: 'ashby',
  displayName: 'Ashby',
  category: 'official_ats',
  defaultEnabled: true,
  tosRiskLevel: 'none',
  tosWarning: '',
  hostOriginPatterns: ['https://jobs.ashbyhq.com/*'],
  matchesHost: (url) => ASHBY_HOSTS.has(url.hostname.toLowerCase()),

  extractJobMetadata: (doc, url) => {
    const title =
      queryFirstText(doc, ['h1.ashby-job-posting-heading', 'h1']) || 'Ashby Application';
    const companyName =
      doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content')?.trim() ||
      extractCompanySlugFromPath(url);
    const locationRaw = queryFirstText(doc, [
      '.ashby-job-posting-brief-list p',
      '[data-testid="job-location"]'
    ]);
    const descriptionClean = queryFirstText(doc, [
      '#overview',
      '.ashby-job-posting-description',
      'main'
    ]).slice(0, 20_000);

    return {
      atsAdapter: 'ashby',
      sourceUrl: url.href,
      applyUrl: url.href,
      title,
      companyName,
      ...(locationRaw ? { locationRaw } : {}),
      ...(descriptionClean ? { descriptionClean } : {})
    };
  },

  classifyOverride: (raw: RawFormControl): FieldClassificationHint | null => {
    const name = raw.name.toLowerCase();
    const id = raw.id.toLowerCase();

    if (name === '_systemfield_name' || id === '_systemfield_name') {
      return { canonicalKey: 'full_name', confidence: 0.98, reason: 'Ashby _systemfield_name' };
    }
    if (name === '_systemfield_email' || id === '_systemfield_email') {
      return { canonicalKey: 'email', confidence: 0.98, reason: 'Ashby _systemfield_email' };
    }
    if (name === '_systemfield_phone' || id === '_systemfield_phone') {
      return { canonicalKey: 'phone', confidence: 0.98, reason: 'Ashby _systemfield_phone' };
    }
    if (name === '_systemfield_location' || id === '_systemfield_location') {
      return { canonicalKey: 'location_city', confidence: 0.97, reason: 'Ashby _systemfield_location' };
    }
    if (
      raw.controlType === 'file' &&
      (name === '_systemfield_resume' || id.includes('_systemfield_resume'))
    ) {
      return { canonicalKey: 'resume_file', confidence: 0.98, reason: 'Ashby _systemfield_resume' };
    }
    return null;
  }
};
