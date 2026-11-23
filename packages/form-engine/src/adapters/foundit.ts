/**
 * ISOLATED BROWSER-SESSION ADAPTER: Foundit (formerly Monster India)
 *
 * ToS Risk Notice: Foundit does not offer a public apply API. This adapter operates solely inside
 * the user's open logged-in tab when opted in, never scrapes server-side, and pauses for review.
 */
import type { AtsSiteAdapter } from '../types.js';
import { queryFirstText } from './base.js';

export const FounditAdapter: AtsSiteAdapter = {
  id: 'foundit',
  displayName: 'Foundit (Session Assist)',
  category: 'non_api_session',
  defaultEnabled: false,
  tosRiskLevel: 'moderate',
  tosWarning:
    'Foundit has no public API. Opt-in active-tab assist only; always pauses for your manual review before submit.',
  hostOriginPatterns: ['https://*.foundit.in/*'],
  matchesHost: (url) => {
    const h = url.hostname.toLowerCase();
    return h === 'foundit.in' || h.endsWith('.foundit.in');
  },

  extractJobMetadata: (doc, url) => {
    const title =
      queryFirstText(doc, ['.jobTitle', '[data-testid="job-title"]', 'h1']) ||
      'Foundit Job Listing';
    const companyName =
      queryFirstText(doc, ['.companyName', '[data-testid="company-name"]', '.jd-company']) ||
      'Employer on Foundit';
    const locationRaw = queryFirstText(doc, ['.jobLocation', '.location-text']);
    const salaryText = queryFirstText(doc, ['.salaryRange', '.package']);
    const descriptionClean = queryFirstText(doc, ['.jobDescription', '.jd-text', 'main']).slice(
      0,
      20_000
    );

    return {
      atsAdapter: 'foundit',
      sourceUrl: url.href,
      applyUrl: url.href,
      title,
      companyName,
      ...(locationRaw ? { locationRaw } : {}),
      ...(salaryText ? { salaryText } : {}),
      ...(descriptionClean ? { descriptionClean } : {})
    };
  }
};
