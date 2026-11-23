/**
 * ISOLATED BROWSER-SESSION ADAPTER: LinkedIn Jobs / Easy Apply
 *
 * HIGH ToS RISK WARNING: LinkedIn User Agreement Section 8.2 strictly prohibits automated scraping
 * and unauthorized automated software tools. NEVER scrape LinkedIn server-side. This module is OFF
 * by default, requests browser permission only when opted in, and strictly assists on explicit click
 * inside your own active Easy Apply dialog without ever auto-advancing or clicking Submit.
 */
import type { AtsSiteAdapter, FieldClassificationHint, RawFormControl } from '../types.js';
import { queryFirstText } from './base.js';

export const LinkedInAdapter: AtsSiteAdapter = {
  id: 'linkedin',
  displayName: 'LinkedIn (High ToS Risk — Opt-In)',
  category: 'non_api_session',
  defaultEnabled: false,
  tosRiskLevel: 'high',
  tosWarning:
    'HIGH ToS RISK (LinkedIn §8.2): Disabled by default. Only saves the active job card or assists open Easy Apply fields on explicit click — never auto-submits.',
  hostOriginPatterns: ['https://*.linkedin.com/*'],
  matchesHost: (url) => {
    const h = url.hostname.toLowerCase();
    return h === 'linkedin.com' || h.endsWith('.linkedin.com');
  },

  extractJobMetadata: (doc, url) => {
    const title =
      queryFirstText(doc, [
        '.job-details-jobs-unified-top-card__job-title h1',
        '.job-details-jobs-unified-top-card__job-title',
        '.jobs-unified-top-card__job-title',
        'h1'
      ]) || 'LinkedIn Job';
    const companyName =
      queryFirstText(doc, [
        '.job-details-jobs-unified-top-card__company-name a',
        '.job-details-jobs-unified-top-card__company-name',
        '.jobs-unified-top-card__company-name a'
      ]) || 'Employer on LinkedIn';
    const locationRaw = queryFirstText(doc, [
      '.job-details-jobs-unified-top-card__primary-description-container .tvm__text',
      '.jobs-unified-top-card__bullet'
    ]);
    const descriptionClean = queryFirstText(doc, [
      '.jobs-description__content',
      '.jobs-box__html-content',
      '#job-details'
    ]).slice(0, 20_000);

    return {
      atsAdapter: 'linkedin',
      sourceUrl: url.href,
      applyUrl: url.href,
      title,
      companyName,
      ...(locationRaw ? { locationRaw } : {}),
      ...(descriptionClean ? { descriptionClean } : {})
    };
  },

  classifyOverride: (raw: RawFormControl): FieldClassificationHint | null => {
    const label = raw.label.toLowerCase();
    const id = raw.id.toLowerCase();

    if (id.includes('phonenumber') || label.includes('mobile phone number')) {
      return { canonicalKey: 'phone', confidence: 0.96, reason: 'LinkedIn Easy Apply phone' };
    }
    if (label.includes('email address')) {
      return { canonicalKey: 'email', confidence: 0.96, reason: 'LinkedIn Easy Apply email' };
    }
    if (label.includes('how many years of work experience')) {
      return {
        canonicalKey: 'years_of_experience',
        confidence: 0.92,
        reason: 'LinkedIn YoE screening prompt'
      };
    }
    return null;
  }
};
