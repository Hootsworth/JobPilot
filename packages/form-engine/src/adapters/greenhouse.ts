import type { AtsSiteAdapter, FieldClassificationHint, RawFormControl } from '../types.js';
import { extractCompanySlugFromPath, queryFirstText } from './base.js';

const GREENHOUSE_HOSTS = new Set([
  'boards.greenhouse.io',
  'job-boards.greenhouse.io',
  'boards.eu.greenhouse.io',
  'job-boards.eu.greenhouse.io'
]);

export const GreenhouseAdapter: AtsSiteAdapter = {
  id: 'greenhouse',
  displayName: 'Greenhouse',
  category: 'official_ats',
  defaultEnabled: true,
  tosRiskLevel: 'none',
  tosWarning: '',
  hostOriginPatterns: [
    'https://boards.greenhouse.io/*',
    'https://job-boards.greenhouse.io/*',
    'https://boards.eu.greenhouse.io/*',
    'https://job-boards.eu.greenhouse.io/*'
  ],
  matchesHost: (url) => GREENHOUSE_HOSTS.has(url.hostname.toLowerCase()),

  extractJobMetadata: (doc, url) => {
    const title =
      queryFirstText(doc, ['h1.app-title', '.job__title h1', '.header h1', 'h1']) ||
      doc.title.split('-')[0]?.trim() ||
      'Greenhouse Application';

    const rawCompany = queryFirstText(doc, ['.company-name', 'span.company-name'])
      .replace(/^at\s+/i, '')
      .trim();
    const companyName = rawCompany || extractCompanySlugFromPath(url);
    const locationRaw = queryFirstText(doc, ['.location', '.job__location']);
    const descriptionClean = queryFirstText(doc, ['#content', '.job__description', 'main']).slice(
      0,
      20_000
    );

    return {
      atsAdapter: 'greenhouse',
      sourceUrl: url.href,
      applyUrl: url.href,
      title,
      companyName,
      ...(locationRaw ? { locationRaw } : {}),
      ...(descriptionClean ? { descriptionClean } : {})
    };
  },

  classifyOverride: (raw: RawFormControl): FieldClassificationHint | null => {
    const id = raw.id.toLowerCase();
    const name = raw.name.toLowerCase();

    if (id === 'first_name' || name === 'job_application[first_name]') {
      return { canonicalKey: 'first_name', confidence: 0.98, reason: 'Greenhouse #first_name' };
    }
    if (id === 'last_name' || name === 'job_application[last_name]') {
      return { canonicalKey: 'last_name', confidence: 0.98, reason: 'Greenhouse #last_name' };
    }
    if (id === 'email' || name === 'job_application[email]') {
      return { canonicalKey: 'email', confidence: 0.98, reason: 'Greenhouse #email' };
    }
    if (id === 'phone' || name === 'job_application[phone]') {
      return { canonicalKey: 'phone', confidence: 0.98, reason: 'Greenhouse #phone' };
    }
    if (id === 'job_application_location' || name === 'job_application[location]') {
      return {
        canonicalKey: 'location_city',
        confidence: 0.96,
        reason: 'Greenhouse location selector'
      };
    }
    if (
      raw.controlType === 'file' &&
      (id === 'resume' || name.includes('resume') || /resume|cv/i.test(raw.label))
    ) {
      return { canonicalKey: 'resume_file', confidence: 0.98, reason: 'Greenhouse resume upload' };
    }
    if (id === 'cover_letter_text' || name === 'job_application[cover_letter_text]') {
      return { canonicalKey: 'cover_letter', confidence: 0.96, reason: 'Greenhouse cover letter' };
    }
    return null;
  }
};
