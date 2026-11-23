// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildFillPlan,
  executeFillPlan,
  scanDocumentWithAdapter
} from '@jobpilot/form-engine';
import {
  createEmptyIndiaProfile,
  createEmptyJsonResume,
  type AtsAdapterId,
  type CanonicalFieldKey,
  type MasterProfile,
  type ResumeVersionRecord,
  type SavedAnswer
} from '@jobpilot/shared';

function loadFixture(filename: string): string {
  return readFileSync(resolve(__dirname, '../../fixtures/forms', filename), 'utf8');
}

function makeEvalProfile(): {
  profile: MasterProfile;
  savedAnswers: SavedAnswer[];
  resumeVersion: ResumeVersionRecord;
} {
  const jsonResume = createEmptyJsonResume();
  jsonResume.basics.name = 'Diya Sharma';
  jsonResume.basics.email = 'diya@iitd.ac.in';
  jsonResume.basics.phone = '+91-9811122233';
  jsonResume.basics.url = 'https://diyasharma.dev';
  jsonResume.basics.location.city = 'Bengaluru';
  jsonResume.basics.location.countryCode = 'IN';
  jsonResume.basics.summary = 'CS final-year student building resilient TypeScript and PostgreSQL systems.';
  jsonResume.basics.profiles = [
    { network: 'LinkedIn', username: 'diyasharma', url: 'https://linkedin.com/in/diyasharma' },
    { network: 'GitHub', username: 'diya-dev', url: 'https://github.com/diya-dev' }
  ];
  jsonResume.work = [
    {
      id: 'w-1',
      name: 'FinGrid',
      position: 'Backend Intern',
      url: '',
      location: 'Bengaluru',
      employmentType: 'Internship',
      startDate: '2025-05',
      endDate: '2025-07',
      summary: '',
      highlights: ['Reduced webhook retry failures by 38% with PostgreSQL advisory locks.']
    }
  ];

  const india = createEmptyIndiaProfile();
  india.expectedCtcLpa = 20;
  india.currentCtcLpa = 0;
  india.noticePeriodDays = 0;
  india.preferredCities = ['Bengaluru', 'Hyderabad'];
  india.willingToRelocate = true;
  india.collegeName = 'IIT Delhi';
  india.degree = 'B.Tech';
  india.branch = 'Computer Science';
  india.graduationYear = 2026;
  india.cgpa = 9.15;
  india.tenthPercentage = 96.4;
  india.twelfthPercentage = 97.0;
  india.isFresher = true;

  const profile: MasterProfile = {
    id: '11111111-1111-4111-8111-111111111111',
    fullName: 'Diya Sharma',
    email: 'diya@iitd.ac.in',
    phone: '+91-9811122233',
    activeProfileVersion: 1,
    jsonResume,
    indiaProfile: india,
    searchPreferences: {
      targetRoles: ['Backend Engineer'],
      workModes: ['remote', 'hybrid'],
      seniorityLevels: ['fresher', 'junior'],
      countries: ['IN'],
      minSalaryLpa: 15,
      minExperienceYears: 0,
      maxExperienceYears: 2
    },
    sourceResumeStoragePath: null,
    embeddingModel: null,
    embeddingModelVersion: null,
    embeddedAt: null,
    telemetryOptIn: false,
    onboardingCompletedAt: null,
    updatedAt: new Date().toISOString()
  };

  const savedAnswers: SavedAnswer[] = [
    {
      id: '22222222-2222-4222-8222-222222222222',
      userId: profile.id,
      questionKey: 'backend_scaling_project',
      questionPattern: 'high-impact backend bug or scaling project you led',
      answer: 'Built idempotent webhook retry queues in FinGrid cutting failures by 38%.',
      tags: ['backend', 'project', 'scaling'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ];

  const resumeVersion: ResumeVersionRecord = {
    id: '33333333-3333-4333-8333-333333333333',
    userId: profile.id,
    jobId: null,
    parentProfileVersion: 1,
    versionNumber: 2,
    label: 'Backend Focused',
    jdRequirements: {
      roleTitle: 'Backend Engineer',
      companyName: 'Razorpay',
      mustHaveSkills: ['TypeScript'],
      niceToHaveSkills: [],
      keyResponsibilities: [],
      keywords: ['TypeScript'],
      senioritySignals: [],
      domainTerms: []
    },
    tailoredJsonResume: jsonResume,
    diffSummary: {
      summaryChanged: false,
      summaryBefore: jsonResume.basics.summary ?? '',
      summaryAfter: jsonResume.basics.summary ?? '',
      workDiffs: [],
      projectDiffs: [],
      skillsBefore: [],
      skillsAfter: [],
      skillsReordered: false,
      skillsDropped: [],
      skillsAdded: []
    },
    verifierReport: {
      passed: true,
      deterministicPassed: true,
      llmVerifierPassed: true,
      totalClaimsChecked: 1,
      unsupportedClaimCount: 0,
      immutableFieldViolations: 0,
      unsupportedClaimRate: 0,
      claims: [],
      overallNotes: 'Verified'
    },
    verifierPassed: true,
    templateId: 'ats-classic',
    typstSource: '',
    pdfStoragePath: 'u/v2.pdf',
    pdfEngine: 'builtin-ats-pdf',
    provider: null,
    model: null,
    createdAt: new Date().toISOString()
  };

  return { profile, savedAnswers, resumeVersion };
}

interface FixtureEvalSpec {
  fixture: string;
  url: string;
  expectedAdapter: AtsAdapterId;
  expectedMappings: Record<string, CanonicalFieldKey>;
  prefilledControlIds: string[];
  setupShadowDom?: () => void;
}

describe('@jobpilot/evals form-fill CI gate (Greenhouse, Lever, Ashby, Workday, Naukri, Internshala, LinkedIn + LLM Fallback)', () => {
  it('achieves >= 95% field-mapping accuracy, >= 95% fill success, 0% prefilled overwrites, 0 auto-submits, and 100% undo across 7 ATS & India portal snapshots', () => {
    const { profile, savedAnswers, resumeVersion } = makeEvalProfile();
    const specs: FixtureEvalSpec[] = [
      {
        fixture: 'greenhouse-application.html',
        url: 'https://boards.greenhouse.io/razorpay/jobs/444',
        expectedAdapter: 'greenhouse',
        prefilledControlIds: ['email'],
        expectedMappings: {
          first_name: 'first_name',
          last_name: 'last_name',
          email: 'email',
          phone: 'phone',
          resume: 'resume_file',
          gh_hub: 'preferred_cities',
          gh_ectc: 'expected_ctc_lpa',
          gh_notice: 'notice_period_days',
          gh_cgpa: 'cgpa',
          gh_reloc: 'willing_to_relocate',
          gh_why: 'custom_question'
        }
      },
      {
        fixture: 'lever-application.html',
        url: 'https://jobs.lever.co/browserstack/abc-123',
        expectedAdapter: 'lever',
        prefilledControlIds: ['lv_phone'],
        expectedMappings: {
          lv_name: 'full_name',
          lv_email: 'email',
          lv_phone: 'phone',
          lv_org: 'current_company',
          lv_loc: 'location_city',
          lv_li: 'linkedin_url',
          lv_gh: 'github_url',
          lv_port: 'portfolio_url',
          lv_resume: 'resume_file',
          lv_10th: 'tenth_percentage',
          lv_12th: 'twelfth_percentage',
          lv_grad: 'graduation_year',
          lv_comments: 'cover_letter'
        }
      },
      {
        fixture: 'ashby-application.html',
        url: 'https://jobs.ashbyhq.com/linear/def-456',
        expectedAdapter: 'ashby',
        prefilledControlIds: ['ashby_shadow_company'],
        setupShadowDom: () => {
          const slot = document.getElementById('ashby-shadow-slot')!;
          const sr = slot.attachShadow({ mode: 'open' });
          sr.innerHTML = `
            <div>
              <label for="ashby_shadow_school">College / University</label>
              <input id="ashby_shadow_school" type="text" />
              <label for="ashby_shadow_company">Current company</label>
              <input id="ashby_shadow_company" type="text" value="KeepMyCompany" />
            </div>
          `;
        },
        expectedMappings: {
          _systemfield_name: 'full_name',
          _systemfield_email: 'email',
          _systemfield_phone: 'phone',
          _systemfield_location: 'location_city',
          _systemfield_resume: 'resume_file',
          ashby_deg: 'degree',
          ashby_shadow_school: 'school',
          ashby_shadow_company: 'current_company'
        }
      },
      {
        fixture: 'workday-application.html',
        url: 'https://atlassian.myworkdayjobs.com/en-US/Careers/job/Bengaluru/SDE_1',
        expectedAdapter: 'workday',
        prefilledControlIds: ['wd_email'],
        expectedMappings: {
          wd_fn: 'first_name',
          wd_ln: 'last_name',
          wd_email: 'email',
          wd_phone: 'phone',
          wd_city: 'location_city',
          wd_school: 'school',
          wd_degree: 'degree',
          wd_major: 'major',
          wd_gpa: 'cgpa',
          wd_resume: 'resume_file'
        }
      },
      {
        fixture: 'naukri-apply-flow.html',
        url: 'https://www.naukri.com/job-listings-sde-1-swiggy-12345',
        expectedAdapter: 'naukri',
        prefilledControlIds: ['nk_phone'],
        expectedMappings: {
          nk_phone: 'phone',
          nk_cctc: 'current_ctc_lpa',
          nk_ectc: 'expected_ctc_lpa',
          nk_notice: 'notice_period_days',
          nk_city: 'preferred_cities',
          nk_resume: 'resume_file'
        }
      },
      {
        fixture: 'internshala-apply.html',
        url: 'https://internshala.com/internship/detail/backend-intern-cred',
        expectedAdapter: 'internshala',
        prefilledControlIds: ['is_portfolio'],
        expectedMappings: {
          cover_letter: 'cover_letter',
          is_github: 'github_url',
          is_portfolio: 'portfolio_url',
          is_cgpa: 'cgpa',
          is_college: 'school'
        }
      },
      {
        fixture: 'linkedin-easy-apply.html',
        url: 'https://www.linkedin.com/jobs/view/3999999999/',
        expectedAdapter: 'linkedin',
        prefilledControlIds: ['li_email'],
        expectedMappings: {
          li_email: 'email',
          li_phone: 'phone',
          li_yoe: 'years_of_experience',
          li_notice: 'notice_period_days',
          li_resume: 'resume_file'
        }
      }
    ];

    let totalExpectedMappings = 0;
    let correctMappings = 0;
    let totalEligibleFillTargets = 0;
    let successfulFills = 0;
    let prefilledOverwrites = 0;
    let submitTriggers = 0;

    for (const spec of specs) {
      document.documentElement.innerHTML = loadFixture(spec.fixture);
      spec.setupShadowDom?.();

      document.querySelectorAll('form').forEach((form) => {
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          submitTriggers++;
        });
      });
      document.querySelectorAll('button[type="submit"], input[type="submit"]').forEach((btn) => {
        btn.addEventListener('click', () => {
          submitTriggers++;
        });
      });

      const scan = scanDocumentWithAdapter({
        doc: document,
        url: spec.url,
        enabledAdapters: {
          naukri: true,
          foundit: true,
          internshala: true,
          instahyre: true,
          wellfound: true,
          linkedin: true
        }
      });
      expect(scan.adapterId).toBe(spec.expectedAdapter);

      for (const [id, expectedKey] of Object.entries(spec.expectedMappings)) {
        totalExpectedMappings++;
        const detected = scan.fields.find((f) => f.id === id);
        if (detected?.canonicalKey === expectedKey) {
          correctMappings++;
        }
      }

      const plan = buildFillPlan({
        fields: scan.fields,
        profile,
        savedAnswers,
        resumeVersion
      });

      const exec = executeFillPlan(scan.controlsById, plan, {
        resumeFile: {
          bytes: new TextEncoder().encode('%PDF-1.4\n'),
          filename: 'jobpilot-v2.pdf'
        }
      });

      for (const item of plan) {
        const res = exec.results.find((r) => r.fieldId === item.fieldId);
        if (item.alreadyFilled) {
          if (res?.status !== 'skipped_already_filled') {
            prefilledOverwrites++;
          }
          continue;
        }
        if (item.included) {
          totalEligibleFillTargets++;
          if (res?.status === 'filled') {
            successfulFills++;
          }
        }
      }

      // Check prefilled inputs retained exact user text (keyed by HTML id on RawFormControl)
      for (const id of spec.prefilledControlIds) {
        const ctrl = Array.from(scan.controlsById.values()).find((c) => c.id === id);
        expect(ctrl).toBeTruthy();
        expect(ctrl!.alreadyFilled).toBe(true);
        expect((ctrl!.element as HTMLInputElement).value).toBe(ctrl!.currentValue);
      }

      // Undo restores all modified controls on this fixture
      const restored = exec.undo();
      expect(restored).toBe(exec.filledCount);
    }

    const mappingAccuracy = correctMappings / Math.max(1, totalExpectedMappings);
    const fillSuccessRate = successfulFills / Math.max(1, totalEligibleFillTargets);

    expect(mappingAccuracy).toBeGreaterThanOrEqual(0.95);
    expect(fillSuccessRate).toBeGreaterThanOrEqual(0.95);
    expect(prefilledOverwrites).toBe(0);
    expect(submitTriggers).toBe(0);
  });

  it('captures metadata cleanly on Foundit, Instahyre & Wellfound and fills ambiguous controls via grounded LLM fallback', () => {
    const { profile, savedAnswers, resumeVersion } = makeEvalProfile();

    // Foundit (opt-in required -> off by default)
    document.body.innerHTML = `
      <div class="jobTitle">Platform Engineer</div>
      <div class="companyName">Paytm</div>
      <div class="jobLocation">Noida</div>
      <div class="salaryRange">16-22 LPA</div>
      <form><input id="fd_ectc" aria-label="Expected CTC" /></form>
    `;
    expect(
      scanDocumentWithAdapter({ doc: document, url: 'https://www.foundit.in/job/1' }).disabledByUser
    ).toBe(true);
    const fdScan = scanDocumentWithAdapter({
      doc: document,
      url: 'https://www.foundit.in/job/1',
      enabledAdapters: { foundit: true }
    });
    expect(fdScan.jobMetadata).toMatchObject({
      atsAdapter: 'foundit',
      companyName: 'Paytm',
      salaryText: '16-22 LPA'
    });
    expect(fdScan.fields[0]?.canonicalKey).toBe('expected_ctc_lpa');

    // Instahyre
    document.body.innerHTML = `
      <div class="job-title">Backend SDE</div>
      <div class="company-name">Juspay</div>
      <div class="job-locations">Bengaluru</div>
      <div class="salary-info">20 LPA</div>
      <form><input id="ih_notice" aria-label="Notice period (days)" /></form>
    `;
    const ihScan = scanDocumentWithAdapter({
      doc: document,
      url: 'https://www.instahyre.com/job-42',
      enabledAdapters: { instahyre: true }
    });
    expect(ihScan.jobMetadata).toMatchObject({
      atsAdapter: 'instahyre',
      companyName: 'Juspay',
      salaryText: '20 LPA'
    });
    expect(ihScan.fields[0]?.canonicalKey).toBe('notice_period_days');

    // Wellfound + ambiguous custom prompt filled via LLM fallback
    document.body.innerHTML = `
      <div data-test="JobDetailTitle">Founding Backend Engineer</div>
      <div data-test="StartupResultTitle">StealthAI</div>
      <div data-test="JobDetailCompensation">$70k - $90k</div>
      <form>
        <textarea id="wf_note" name="userNote" aria-label="Note to hiring manager"></textarea>
        <select id="wf_ref" aria-label="How did you discover this opening?">
          <option value="">Choose...</option>
          <option value="Wellfound">Wellfound</option>
          <option value="Referral">Referral</option>
        </select>
        <button type="submit">Apply</button>
      </form>
    `;
    const wfScan = scanDocumentWithAdapter({
      doc: document,
      url: 'https://wellfound.com/jobs/555',
      enabledAdapters: { wellfound: true }
    });
    expect(wfScan.jobMetadata).toMatchObject({
      atsAdapter: 'wellfound',
      companyName: 'StealthAI',
      salaryText: '$70k - $90k'
    });

    const refField = wfScan.fields.find((f) => f.id === 'wf_ref')!;
    const plan = buildFillPlan({
      fields: wfScan.fields,
      profile,
      savedAnswers,
      resumeVersion,
      fallbackSuggestions: [
        {
          fieldId: refField.fieldId,
          canonicalKey: 'unknown',
          proposedValue: 'Wellfound',
          confidence: 0.78,
          rationale: 'Matches active portal',
          groundedIn: 'Page context'
        }
      ]
    });
    const exec = executeFillPlan(wfScan.controlsById, plan);
    expect(exec.filledCount).toBe(2);
    expect((document.getElementById('wf_ref') as HTMLSelectElement).value).toBe('Wellfound');
  });
});
