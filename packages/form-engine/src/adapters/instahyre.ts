/**
 * ISOLATED BROWSER-SESSION ADAPTER: Instahyre
 *
 * ToS Risk Notice: Instahyre has no public API for third-party crawlers. Opt-in user-session
 * assist only; delete this file and remove from registry to disable completely.
 */
import type { AtsSiteAdapter } from '../types.js';
import { queryFirstText } from './base.js';

export const InstahyreAdapter: AtsSiteAdapter = {
  id: 'instahyre',
  displayName: 'Instahyre (Session Assist)',
  category: 'non_api_session',
  defaultEnabled: false,
  tosRiskLevel: 'moderate',
  tosWarning:
    'Instahyre has no public API. Active-tab user assist only — never scrapes in the background or auto-submits.',
  hostOriginPatterns: ['https://*.instahyre.com/*'],
  matchesHost: (url) => {
    const h = url.hostname.toLowerCase();
    return h === 'instahyre.com' || h.endsWith('.instahyre.com');
  },

  extractJobMetadata: (doc, url) => {
    const title = queryFirstText(doc, ['.job-title', 'h1']) || 'Instahyre Job Listing';
    const companyName =
      queryFirstText(doc, ['.company-name', '.employer-name']) || 'Employer on Instahyre';
    const locationRaw = queryFirstText(doc, ['.job-locations', '.location-tag']);
    const salaryText = queryFirstText(doc, ['.salary-info', '.ctc-range']);
    const descriptionClean = queryFirstText(doc, ['.job-description', '#job-details', 'main']).slice(
      0,
      20_000
    );

    return {
      atsAdapter: 'instahyre',
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
