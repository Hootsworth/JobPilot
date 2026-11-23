/**
 * ISOLATED BROWSER-SESSION ADAPTER: Wellfound (formerly AngelList Talent)
 *
 * ToS Risk Notice: Wellfound's public GraphQL endpoints require session cookies and prohibit
 * server-side scraping. Opt-in active-tab assist only with explicit review before submit.
 */
import type { AtsSiteAdapter, FieldClassificationHint, RawFormControl } from '../types.js';
import { queryFirstText } from './base.js';

export const WellfoundAdapter: AtsSiteAdapter = {
  id: 'wellfound',
  displayName: 'Wellfound (Session Assist)',
  category: 'non_api_session',
  defaultEnabled: false,
  tosRiskLevel: 'moderate',
  tosWarning:
    'Wellfound restricts automated scraping. Active-tab user assist only; hiring notes and answers always pause for your approval.',
  hostOriginPatterns: ['https://*.wellfound.com/*', 'https://*.angel.co/*'],
  matchesHost: (url) => {
    const h = url.hostname.toLowerCase();
    return (
      h === 'wellfound.com' ||
      h.endsWith('.wellfound.com') ||
      h === 'angel.co' ||
      h.endsWith('.angel.co')
    );
  },

  extractJobMetadata: (doc, url) => {
    const title =
      queryFirstText(doc, ['[data-test="JobDetailTitle"]', 'h1', 'h2']) || 'Wellfound Role';
    const companyName =
      queryFirstText(doc, ['[data-test="StartupResultTitle"]', '.company-name', 'h2 a']) ||
      'Startup on Wellfound';
    const locationRaw = queryFirstText(doc, ['[data-test="JobDetailLocation"]', '.location']);
    const salaryText = queryFirstText(doc, ['[data-test="JobDetailCompensation"]', '.compensation']);
    const descriptionClean = queryFirstText(doc, [
      '[data-test="JobDescription"]',
      'main'
    ]).slice(0, 20_000);

    return {
      atsAdapter: 'wellfound',
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
    if (
      raw.name.toLowerCase() === 'usernote' ||
      raw.label.toLowerCase().includes('what excites you') ||
      raw.label.toLowerCase().includes('note to')
    ) {
      return {
        canonicalKey: 'cover_letter',
        confidence: 0.9,
        reason: 'Wellfound hiring note prompt'
      };
    }
    return null;
  }
};
