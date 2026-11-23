// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  createEmptyIndiaProfile,
  createEmptyJsonResume,
  type MasterProfile
} from '@jobpilot/shared';
import {
  buildFillPlan,
  getDefaultEnabledAdapterMap,
  NON_API_SESSION_ADAPTERS,
  resolveAdapterForUrl,
  scanDocumentWithAdapter
} from '../index.js';

describe('@jobpilot/form-engine official ATS adapters (Greenhouse, Lever, Ashby)', () => {
  it('detects Greenhouse forms, honors disabled toggle, and classifies core + India fields accurately', () => {
    document.title = 'Software Engineer - Razorpay';
    document.body.innerHTML = `
      <div class="header">
        <h1 class="app-title">Software Engineer I</h1>
        <span class="company-name">at Razorpay</span>
        <div class="location">Bengaluru, India</div>
      </div>
      <div id="content">Build Node.js and PostgreSQL services.</div>
      <form id="application_form">
        <label for="first_name">First Name</label>
        <input id="first_name" name="job_application[first_name]" type="text" />
        <label for="email">Email</label>
        <input id="email" name="job_application[email]" type="email" />
        <label for="resume">Resume</label>
        <input id="resume" name="job_application[resume]" type="file" />
        <label for="custom_1">Expected CTC (LPA)</label>
        <input id="custom_1" type="text" />
        <label for="custom_2">10th Percentage</label>
        <input id="custom_2" type="number" />
      </form>
    `;

    const scan = scanDocumentWithAdapter({
      doc: document,
      url: 'https://boards.greenhouse.io/razorpay/jobs/444'
    });

    expect(scan.adapterId).toBe('greenhouse');
    expect(scan.jobMetadata.companyName).toBe('Razorpay');
    expect(scan.jobMetadata.title).toBe('Software Engineer I');
    expect(scan.fields.find((f) => f.id === 'first_name')?.canonicalKey).toBe('first_name');
    expect(scan.fields.find((f) => f.id === 'first_name')?.confidence).toBe(0.98);
    expect(scan.fields.find((f) => f.id === 'custom_1')?.canonicalKey).toBe('expected_ctc_lpa');
    expect(scan.fields.find((f) => f.id === 'custom_2')?.canonicalKey).toBe('tenth_percentage');

    const disabledCheck = resolveAdapterForUrl(
      'https://boards.greenhouse.io/razorpay/jobs/444',
      { greenhouse: false }
    );
    expect(disabledCheck.disabledByUser).toBe(true);
    expect(disabledCheck.adapter).toBeNull();
  });

  it('detects Lever & Ashby boards and classifies system + social URL fields', () => {
    document.title = 'BrowserStack - Backend Engineer';
    document.body.innerHTML = `
      <div class="posting-headline"><h2>Backend Engineer</h2></div>
      <div class="posting-categories"><div class="location">Mumbai, India</div></div>
      <form>
        <input name="name" aria-label="Full Name" />
        <input name="email" aria-label="Email" />
        <input name="urls[LinkedIn]" aria-label="LinkedIn URL" />
        <input name="urls[GitHub]" aria-label="GitHub URL" />
        <input name="resume" type="file" aria-label="Resume" />
      </form>
    `;

    const leverScan = scanDocumentWithAdapter({
      doc: document,
      url: 'https://jobs.lever.co/browserstack/abc-123'
    });
    expect(leverScan.adapterId).toBe('lever');
    expect(leverScan.jobMetadata.companyName).toBe('BrowserStack');
    expect(leverScan.fields.find((f) => f.name === 'urls[LinkedIn]')?.canonicalKey).toBe(
      'linkedin_url'
    );

    document.title = 'Linear - Product Engineer';
    document.body.innerHTML = `
      <h1 class="ashby-job-posting-heading">Product Engineer</h1>
      <form>
        <input name="_systemfield_name" aria-label="Name" />
        <input name="_systemfield_email" aria-label="Email" />
        <input name="_systemfield_resume" type="file" aria-label="Resume" />
      </form>
    `;
    const ashbyScan = scanDocumentWithAdapter({
      doc: document,
      url: 'https://jobs.ashbyhq.com/linear/def-456'
    });
    expect(ashbyScan.adapterId).toBe('ashby');
    expect(ashbyScan.fields.find((f) => f.name === '_systemfield_name')?.canonicalKey).toBe(
      'full_name'
    );
  });

  it('supports Workday data-automation-id, keeps all 6 non-API portals off by default with ToS notices, and merges fallback suggestions safely', () => {
    // 1. All 6 non-API portals are OFF by default and expose explicit ToS warnings
    const defaults = getDefaultEnabledAdapterMap();
    expect(NON_API_SESSION_ADAPTERS).toHaveLength(6);
    for (const adapter of NON_API_SESSION_ADAPTERS) {
      expect(adapter.defaultEnabled).toBe(false);
      expect(defaults[adapter.id as keyof typeof defaults]).toBe(false);
      expect(adapter.tosWarning.length).toBeGreaterThan(20);
      expect(adapter.hostOriginPatterns.length).toBeGreaterThan(0);
    }

    // Default scan on LinkedIn must stay disabled until user opts in
    document.body.innerHTML = `<form><input id="li_mail" type="email" /></form>`;
    const blockedLi = scanDocumentWithAdapter({
      doc: document,
      url: 'https://www.linkedin.com/jobs/view/999/'
    });
    expect(blockedLi.disabledByUser).toBe(true);
    expect(blockedLi.fields).toHaveLength(0);
    expect(blockedLi.tosRiskLevel).toBe('high');

    // Explicit opt-in enables scanning + metadata capture on Naukri, Foundit, Internshala, Instahyre, Wellfound, LinkedIn
    document.body.innerHTML = `
      <h1 class="styles_jd-header-title__abc">SDE 1 Backend</h1>
      <div class="styles_jd-header-comp-name__abc"><a>Swiggy</a></div>
      <div class="styles_jhc__loc___abc"><a>Bengaluru</a></div>
      <div class="styles_jhc__salary__abc">18-24 LPA</div>
      <form><input id="nk_ectc" name="expectedCtc" placeholder="Expected CTC" /></form>
    `;
    const nkScan = scanDocumentWithAdapter({
      doc: document,
      url: 'https://www.naukri.com/job-listings-123',
      enabledAdapters: { naukri: true }
    });
    expect(nkScan.disabledByUser).toBe(false);
    expect(nkScan.adapterId).toBe('naukri');
    expect(nkScan.jobMetadata.companyName).toBe('Swiggy');
    expect(nkScan.jobMetadata.salaryText).toBe('18-24 LPA');
    expect(nkScan.fields[0]?.canonicalKey).toBe('expected_ctc_lpa');

    // Workday data-automation-id detection
    document.body.innerHTML = `
      <h2 data-automation-id="jobPostingHeader">Platform Engineer</h2>
      <div data-automation-id="locations"><dd>Hyderabad, India</dd></div>
      <form>
        <input id="wd_fn" data-automation-id="legalNameSection_firstName" type="text" aria-label="First Name" />
        <input id="wd_q" type="text" aria-label="How did you hear about us?" />
        <input id="wd_pre" type="email" value="keep@me.in" aria-label="Email" />
      </form>
    `;
    const wdScan = scanDocumentWithAdapter({
      doc: document,
      url: 'https://acme.myworkdayjobs.com/en-US/Careers/job/123'
    });
    expect(wdScan.adapterId).toBe('workday');
    expect(wdScan.fields.find((f) => f.id === 'wd_fn')?.canonicalKey).toBe('first_name');

    // Fallback suggestions fill only unmapped/empty fields and never override prefilled or deterministic hits
    const jsonResume = createEmptyJsonResume();
    jsonResume.basics.name = 'Asha Verma';
    jsonResume.basics.email = 'asha@iitb.ac.in';
    const profile: MasterProfile = {
      id: '11111111-1111-4111-8111-111111111111',
      fullName: 'Asha Verma',
      email: 'asha@iitb.ac.in',
      phone: null,
      activeProfileVersion: 1,
      jsonResume,
      indiaProfile: createEmptyIndiaProfile(),
      searchPreferences: {
        targetRoles: [],
        workModes: ['remote', 'hybrid', 'onsite'],
        seniorityLevels: ['fresher'],
        countries: ['IN'],
        minSalaryLpa: null,
        minExperienceYears: null,
        maxExperienceYears: null
      },
      sourceResumeStoragePath: null,
      embeddingModel: null,
      embeddingModelVersion: null,
      embeddedAt: null,
      telemetryOptIn: false,
      onboardingCompletedAt: null,
      updatedAt: new Date().toISOString()
    };

    const wdFn = wdScan.fields.find((f) => f.id === 'wd_fn')!;
    const wdQ = wdScan.fields.find((f) => f.id === 'wd_q')!;
    const wdPre = wdScan.fields.find((f) => f.id === 'wd_pre')!;

    const plan = buildFillPlan({
      fields: wdScan.fields,
      profile,
      fallbackSuggestions: [
        {
          fieldId: wdFn.fieldId,
          canonicalKey: 'first_name',
          proposedValue: 'WrongOverride',
          confidence: 0.8,
          rationale: 'Should be ignored since profile matched deterministically',
          groundedIn: 'test'
        },
        {
          fieldId: wdQ.fieldId,
          canonicalKey: 'unknown',
          proposedValue: 'Job Board',
          confidence: 0.82,
          rationale: 'Standard referral channel',
          groundedIn: 'profile'
        },
        {
          fieldId: wdPre.fieldId,
          canonicalKey: 'email',
          proposedValue: 'overwrite@bad.com',
          confidence: 0.85,
          rationale: 'Must be ignored because pre-filled',
          groundedIn: 'test'
        }
      ]
    });

    expect(plan.find((p) => p.fieldId === wdFn.fieldId)?.proposedValue).toBe('Asha');
    expect(plan.find((p) => p.fieldId === wdQ.fieldId)?.proposedValue).toBe('Job Board');
    expect(plan.find((p) => p.fieldId === wdQ.fieldId)?.source).toBe('llm_fallback');
    expect(plan.find((p) => p.fieldId === wdPre.fieldId)?.included).toBe(false);
  });
});
