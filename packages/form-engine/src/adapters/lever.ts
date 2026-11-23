import type { AtsSiteAdapter, FieldClassificationHint, RawFormControl } from '../types.js';
import { extractCompanySlugFromPath, queryFirstText } from './base.js';

const LEVER_HOSTS = new Set(['jobs.lever.co', 'jobs.eu.lever.co']);

export const LeverAdapter: AtsSiteAdapter = {
  id: 'lever',
  displayName: 'Lever',
  category: 'official_ats',
  defaultEnabled: true,
  tosRiskLevel: 'none',
  tosWarning: '',
  hostOriginPatterns: ['https://jobs.lever.co/*', 'https://jobs.eu.lever.co/*'],
  matchesHost: (url) => LEVER_HOSTS.has(url.hostname.toLowerCase()),

  extractJobMetadata: (doc, url) => {
    const title =
      queryFirstText(doc, ['.posting-headline h2', 'h1', 'h2']) || 'Lever Application';
    const titleParts = doc.title.split(/\s*[-–|]\s*/);
    const companyName =
      (titleParts.length > 1 ? titleParts[0]?.trim() : '') || extractCompanySlugFromPath(url);
    const locationRaw = queryFirstText(doc, [
      '.posting-categories .location',
      '.posting-category.location'
    ]);
    const descriptionClean = queryFirstText(doc, [
      '.posting-requirements',
      '.section-wrapper',
      'main'
    ]).slice(0, 20_000);

    return {
      atsAdapter: 'lever',
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

    if (name === 'name' || id === 'fullname-input') {
      return { canonicalKey: 'full_name', confidence: 0.98, reason: 'Lever input[name="name"]' };
    }
    if (name === 'email') {
      return { canonicalKey: 'email', confidence: 0.98, reason: 'Lever input[name="email"]' };
    }
    if (name === 'phone') {
      return { canonicalKey: 'phone', confidence: 0.98, reason: 'Lever input[name="phone"]' };
    }
    if (name === 'org') {
      return { canonicalKey: 'current_company', confidence: 0.96, reason: 'Lever input[name="org"]' };
    }
    if (name === 'location') {
      return { canonicalKey: 'location_city', confidence: 0.96, reason: 'Lever input[name="location"]' };
    }
    if (name === 'urls[linkedin]') {
      return { canonicalKey: 'linkedin_url', confidence: 0.98, reason: 'Lever LinkedIn URL' };
    }
    if (name === 'urls[github]') {
      return { canonicalKey: 'github_url', confidence: 0.98, reason: 'Lever GitHub URL' };
    }
    if (name === 'urls[portfolio]' || name === 'urls[other]') {
      return { canonicalKey: 'portfolio_url', confidence: 0.95, reason: 'Lever Portfolio URL' };
    }
    if (raw.controlType === 'file' && (name === 'resume' || id.includes('resume'))) {
      return { canonicalKey: 'resume_file', confidence: 0.98, reason: 'Lever resume file input' };
    }
    if (name === 'comments') {
      return { canonicalKey: 'cover_letter', confidence: 0.9, reason: 'Lever comments / cover letter' };
    }
    return null;
  }
};
