/**
 * ISOLATED BROWSER-SESSION ADAPTER: Naukri.com
 *
 * ToS Risk Notice: Naukri does not expose an official public job/apply API for personal automation.
 * Automated scraping or unattended applying violates Info Edge (Naukri) Terms of Use.
 * This module runs ONLY inside the user's own logged-in tab when explicitly enabled by the user,
 * never submits forms automatically, and can be deleted cleanly without touching core packages.
 */
import type { AtsSiteAdapter, FieldClassificationHint, RawFormControl } from '../types.js';
import { queryFirstText } from './base.js';

export const NaukriAdapter: AtsSiteAdapter = {
  id: 'naukri',
  displayName: 'Naukri (Session Assist)',
  category: 'non_api_session',
  defaultEnabled: false,
  tosRiskLevel: 'moderate',
  tosWarning:
    'Naukri has no public API. Runs strictly in your active browser session on explicit click; never scrapes server-side or submits automatically.',
  hostOriginPatterns: ['https://*.naukri.com/*'],
  matchesHost: (url) => {
    const h = url.hostname.toLowerCase();
    return h === 'naukri.com' || h.endsWith('.naukri.com');
  },

  extractJobMetadata: (doc, url) => {
    const title =
      queryFirstText(doc, [
        '[class*="styles_jd-header-title"]',
        'h1.jd-header-title',
        'h1'
      ]) || 'Naukri Job Listing';
    const companyName =
      queryFirstText(doc, [
        '[class*="styles_jd-header-comp-name"] a',
        '[class*="styles_jd-header-comp-name"]',
        '.jd-header-comp-name a'
      ]) || 'Employer on Naukri';
    const locationRaw = queryFirstText(doc, [
      '[class*="styles_jhc__loc"]',
      '.location a',
      '.loc'
    ]);
    const salaryText = queryFirstText(doc, ['[class*="styles_jhc__salary"]', '.salary']);
    const descriptionClean = queryFirstText(doc, [
      '[class*="styles_JDC__dang-inner-html"]',
      '.dang-inner-html',
      'section.job-desc'
    ]).slice(0, 20_000);

    return {
      atsAdapter: 'naukri',
      sourceUrl: url.href,
      applyUrl: url.href,
      title,
      companyName,
      ...(locationRaw ? { locationRaw } : {}),
      ...(salaryText ? { salaryText } : {}),
      ...(descriptionClean ? { descriptionClean } : {})
    };
  },

  classifyOverride: (raw: RawFormControl): FieldClassificationHint | null => {
    const text = `${raw.id} ${raw.name} ${raw.placeholder}`.toLowerCase();
    if (text.includes('currentctc') || text.includes('current_ctc')) {
      return { canonicalKey: 'current_ctc_lpa', confidence: 0.96, reason: 'Naukri Current CTC' };
    }
    if (text.includes('expectedctc') || text.includes('expected_ctc')) {
      return { canonicalKey: 'expected_ctc_lpa', confidence: 0.96, reason: 'Naukri Expected CTC' };
    }
    if (text.includes('noticeperiod') || text.includes('notice_period')) {
      return {
        canonicalKey: 'notice_period_days',
        confidence: 0.96,
        reason: 'Naukri Notice Period'
      };
    }
    return null;
  }
};
