import type { AtsSiteAdapter, FieldClassificationHint, RawFormControl } from '../types.js';
import { queryFirstText } from './base.js';

export const WorkdayAdapter: AtsSiteAdapter = {
  id: 'workday',
  displayName: 'Workday',
  category: 'official_ats',
  defaultEnabled: true,
  tosRiskLevel: 'none',
  tosWarning: '',
  hostOriginPatterns: ['https://*.myworkdayjobs.com/*', 'https://*.myworkdaysite.com/*'],
  matchesHost: (url) => {
    const h = url.hostname.toLowerCase();
    return h.endsWith('.myworkdayjobs.com') || h.endsWith('.myworkdaysite.com');
  },

  extractJobMetadata: (doc, url) => {
    const title =
      queryFirstText(doc, ['h2[data-automation-id="jobPostingHeader"]', 'h1', 'h2']) ||
      doc.title.split('|')[0]?.trim() ||
      'Workday Application';
    const companyName =
      url.hostname.split('.')[0]?.replace(/wd\d+$/i, '').replace(/[-_]/g, ' ').trim() ||
      'Workday Employer';
    const locationRaw = queryFirstText(doc, [
      '[data-automation-id="locations"] dd',
      '[data-automation-id="location"]'
    ]);
    const descriptionClean = queryFirstText(doc, [
      '[data-automation-id="jobPostingDescription"]',
      'main'
    ]).slice(0, 20_000);

    return {
      atsAdapter: 'workday',
      sourceUrl: url.href,
      applyUrl: url.href,
      title,
      companyName,
      ...(locationRaw ? { locationRaw } : {}),
      ...(descriptionClean ? { descriptionClean } : {})
    };
  },

  classifyOverride: (raw: RawFormControl): FieldClassificationHint | null => {
    const aid = raw.automationId.toLowerCase();
    const id = raw.id.toLowerCase();
    const combined = `${aid} ${id}`;

    if (combined.includes('firstname') || combined.includes('legalnamesection_first')) {
      return { canonicalKey: 'first_name', confidence: 0.98, reason: 'Workday firstName' };
    }
    if (combined.includes('lastname') || combined.includes('legalnamesection_last')) {
      return { canonicalKey: 'last_name', confidence: 0.98, reason: 'Workday lastName' };
    }
    if (combined === 'email' || combined.includes('email')) {
      return { canonicalKey: 'email', confidence: 0.97, reason: 'Workday email' };
    }
    if (combined.includes('phone-number') || combined.includes('phonenumber')) {
      return { canonicalKey: 'phone', confidence: 0.97, reason: 'Workday phone' };
    }
    if (combined.includes('addresssection_city') || combined.includes('city')) {
      return { canonicalKey: 'location_city', confidence: 0.94, reason: 'Workday city' };
    }
    if (raw.controlType === 'file' || combined.includes('file-upload-input-ref')) {
      return { canonicalKey: 'resume_file', confidence: 0.98, reason: 'Workday resume upload' };
    }
    if (combined.includes('school') || combined.includes('university')) {
      return { canonicalKey: 'school', confidence: 0.95, reason: 'Workday education school' };
    }
    if (combined.includes('fieldofstudy') || combined.includes('major')) {
      return { canonicalKey: 'major', confidence: 0.95, reason: 'Workday fieldOfStudy' };
    }
    if (combined.includes('degree')) {
      return { canonicalKey: 'degree', confidence: 0.95, reason: 'Workday degree' };
    }
    if (combined.includes('gpa')) {
      return { canonicalKey: 'cgpa', confidence: 0.94, reason: 'Workday GPA/CGPA' };
    }
    return null;
  }
};
