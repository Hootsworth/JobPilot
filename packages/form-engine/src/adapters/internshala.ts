/**
 * ISOLATED BROWSER-SESSION ADAPTER: Internshala
 *
 * ToS Risk Notice: Internshala forbids automated scraping or mass-applying without user intent.
 * Runs solely on user-initiated click inside your active tab and never submits forms automatically.
 */
import type { AtsSiteAdapter, FieldClassificationHint, RawFormControl } from '../types.js';
import { queryFirstText } from './base.js';

export const InternshalaAdapter: AtsSiteAdapter = {
  id: 'internshala',
  displayName: 'Internshala (Session Assist)',
  category: 'non_api_session',
  defaultEnabled: false,
  tosRiskLevel: 'moderate',
  tosWarning:
    'Internshala restricts automated scraping/submitting. Runs strictly inside your own session on click and always pauses for review.',
  hostOriginPatterns: ['https://*.internshala.com/*'],
  matchesHost: (url) => {
    const h = url.hostname.toLowerCase();
    return h === 'internshala.com' || h.endsWith('.internshala.com');
  },

  extractJobMetadata: (doc, url) => {
    const title =
      queryFirstText(doc, ['.profile .heading_4_5', '.individual_internship_header h1', 'h1']) ||
      'Internshala Opportunity';
    const companyName =
      queryFirstText(doc, ['.company_name .link_display_like_text', '.company_name']) ||
      'Employer on Internshala';
    const locationRaw = queryFirstText(doc, ['#location_names a', '#location_names', '.location_link']);
    const salaryText = queryFirstText(doc, ['.stipend', '.salary']);
    const descriptionClean = queryFirstText(doc, [
      '.internship_details .text-container',
      '.internship_details',
      'main'
    ]).slice(0, 20_000);

    return {
      atsAdapter: 'internshala',
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
    const id = raw.id.toLowerCase();
    const label = raw.label.toLowerCase();
    if (id === 'cover_letter' || label.includes('why should you be hired')) {
      return {
        canonicalKey: 'cover_letter',
        confidence: 0.94,
        reason: 'Internshala cover letter / why hire prompt'
      };
    }
    if (label.includes('available for') || label.includes('duration')) {
      return {
        canonicalKey: 'custom_question',
        confidence: 0.85,
        reason: 'Internshala availability prompt'
      };
    }
    return null;
  }
};
