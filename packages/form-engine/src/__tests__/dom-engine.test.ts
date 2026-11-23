// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
  attachResumePdfFile,
  buildFillPlan,
  collectRawFormControls,
  executeFillPlan,
  observeMultiStepForm,
  setNativeControlValue
} from '../index.js';
import { createEmptyIndiaProfile, createEmptyJsonResume, type MasterProfile } from '@jobpilot/shared';

function makeStudentProfile(): MasterProfile {
  const jsonResume = createEmptyJsonResume();
  jsonResume.basics.name = 'Rohan Kulkarni';
  jsonResume.basics.email = 'rohan@iitm.ac.in';
  jsonResume.basics.phone = '+91-9876543210';
  jsonResume.basics.location.city = 'Bengaluru';
  jsonResume.basics.location.countryCode = 'IN';
  jsonResume.basics.profiles = [
    { network: 'LinkedIn', username: 'rohank', url: 'https://linkedin.com/in/rohank' },
    { network: 'GitHub', username: 'rohank-dev', url: 'https://github.com/rohank-dev' }
  ];
  jsonResume.work = [
    {
      id: 'w1',
      name: 'Razorpay',
      position: 'SWE Intern',
      url: '',
      location: 'Bengaluru',
      employmentType: 'Internship',
      startDate: '2025-05',
      endDate: '2025-07',
      summary: '',
      highlights: ['Built webhook retry worker.']
    }
  ];

  const india = createEmptyIndiaProfile();
  india.expectedCtcLpa = 18;
  india.currentCtcLpa = 0;
  india.noticePeriodDays = 0;
  india.preferredCities = ['Bengaluru', 'Hyderabad'];
  india.willingToRelocate = true;
  india.collegeName = 'IIT Madras';
  india.degree = 'B.Tech';
  india.branch = 'Computer Science';
  india.graduationYear = 2026;
  india.cgpa = 8.95;
  india.tenthPercentage = 95.4;
  india.twelfthPercentage = 96.2;
  india.isFresher = true;

  return {
    id: '11111111-1111-4111-8111-111111111111',
    fullName: 'Rohan Kulkarni',
    email: 'rohan@iitm.ac.in',
    phone: '+91-9876543210',
    activeProfileVersion: 1,
    jsonResume,
    indiaProfile: india,
    searchPreferences: {
      targetRoles: ['Backend Engineer'],
      workModes: ['remote', 'hybrid'],
      seniorityLevels: ['fresher', 'junior'],
      countries: ['IN'],
      minSalaryLpa: 12,
      minExperienceYears: 0,
      maxExperienceYears: 2
    },
    sourceResumeStoragePath: 'u/master.pdf',
    embeddingModel: null,
    embeddingModelVersion: null,
    embeddedAt: null,
    telemetryOptIn: false,
    onboardingCompletedAt: null,
    updatedAt: new Date().toISOString()
  };
}

describe('@jobpilot/form-engine DOM mechanics & safety invariants', () => {
  it('triggers React _valueTracker + input/change events, handles select, combobox, radio, hidden file input, undo, and never overwrites or submits', () => {
    document.body.innerHTML = `
      <form id="app-form">
        <div class="field">
          <label for="first_name">First Name</label>
          <input id="first_name" type="text" />
        </div>
        <div class="field">
          <label for="prefilled_email">Email</label>
          <input id="prefilled_email" type="email" value="custom.user@example.com" />
        </div>
        <div class="field">
          <label for="relocate">Willing to relocate?</label>
          <select id="relocate">
            <option value="">Select...</option>
            <option value="yes_val">Yes - Happy to relocate</option>
            <option value="no_val">No</option>
          </select>
        </div>
        <div class="field">
          <label for="hub-combo">Preferred City</label>
          <div id="hub-combo" role="combobox" aria-label="Preferred City" class="select__control">
            <input type="text" aria-label="Preferred City" />
            <div role="listbox">
              <div role="option" data-option-value="Bengaluru">Bengaluru, India</div>
              <div role="option" data-option-value="Pune">Pune, India</div>
            </div>
          </div>
        </div>
        <fieldset>
          <legend>Will you now or in the future require visa sponsorship?</legend>
          <label><input type="radio" name="sponsor" value="yes" /> Yes</label>
          <label><input type="radio" name="sponsor" value="no" /> No</label>
        </fieldset>
        <div class="field">
          <label for="resume_file">Resume/CV</label>
          <input id="resume_file" type="file" style="display: none" />
        </div>
        <button id="submit-btn" type="submit">Submit Application</button>
      </form>
    `;

    const firstInput = document.getElementById('first_name') as HTMLInputElement;
    const trackerSpy = vi.fn();
    (firstInput as unknown as { _valueTracker: { setValue: (v: string) => void } })._valueTracker = {
      setValue: trackerSpy
    };
    const inputListener = vi.fn();
    const changeListener = vi.fn();
    firstInput.addEventListener('input', inputListener);
    firstInput.addEventListener('change', changeListener);

    const submitBtn = document.getElementById('submit-btn') as HTMLButtonElement;
    const submitClickSpy = vi.fn();
    const formSubmitSpy = vi.fn((e: Event) => e.preventDefault());
    submitBtn.addEventListener('click', submitClickSpy);
    document.getElementById('app-form')!.addEventListener('submit', formSubmitSpy);

    const controls = collectRawFormControls(document);
    // Submit button must not be listed; hidden file input MUST be collected
    expect(controls.some((c) => c.controlType === 'file')).toBe(true);
    expect(controls.some((c) => c.id === 'submit-btn')).toBe(false);

    const controlsById = new Map(controls.map((c) => [c.fieldId, c]));
    const firstCtrl = controls.find((c) => c.id === 'first_name')!;
    const emailCtrl = controls.find((c) => c.id === 'prefilled_email')!;
    const relocateCtrl = controls.find((c) => c.id === 'relocate')!;
    const comboCtrl = controls.find((c) => c.id === 'hub-combo')!;
    const sponsorCtrl = controls.find((c) => c.controlType === 'radio')!;
    const resumeCtrl = controls.find((c) => c.controlType === 'file')!;

    expect(emailCtrl.alreadyFilled).toBe(true);

    const exec = executeFillPlan(
      controlsById,
      [
        {
          fieldId: firstCtrl.fieldId,
          canonicalKey: 'first_name',
          label: 'First Name',
          controlType: 'text',
          proposedValue: 'Rohan',
          displayValue: 'Rohan',
          confidence: 0.98,
          source: 'profile',
          alreadyFilled: false,
          included: true
        },
        {
          // Even if caller mistakenly passes included: true, live pre-filled guard MUST skip!
          fieldId: emailCtrl.fieldId,
          canonicalKey: 'email',
          label: 'Email',
          controlType: 'email',
          proposedValue: 'rohan@iitm.ac.in',
          displayValue: 'rohan@iitm.ac.in',
          confidence: 0.98,
          source: 'profile',
          alreadyFilled: true,
          included: true
        },
        {
          fieldId: relocateCtrl.fieldId,
          canonicalKey: 'willing_to_relocate',
          label: 'Willing to relocate?',
          controlType: 'select',
          proposedValue: 'Yes',
          displayValue: 'Yes',
          confidence: 0.91,
          source: 'india_profile',
          alreadyFilled: false,
          included: true
        },
        {
          fieldId: comboCtrl.fieldId,
          canonicalKey: 'preferred_cities',
          label: 'Preferred City',
          controlType: 'combobox',
          proposedValue: 'Bengaluru',
          displayValue: 'Bengaluru',
          confidence: 0.9,
          source: 'india_profile',
          alreadyFilled: false,
          included: true
        },
        {
          fieldId: sponsorCtrl.fieldId,
          canonicalKey: 'requires_sponsorship',
          label: 'Visa Sponsorship',
          controlType: 'radio',
          proposedValue: 'No',
          displayValue: 'No',
          confidence: 0.92,
          source: 'india_profile',
          alreadyFilled: false,
          included: true
        },
        {
          fieldId: resumeCtrl.fieldId,
          canonicalKey: 'resume_file',
          label: 'Resume',
          controlType: 'file',
          proposedValue: 'jobpilot-v1.pdf',
          displayValue: 'jobpilot-v1.pdf',
          confidence: 0.98,
          source: 'tailored_resume',
          alreadyFilled: false,
          included: true
        }
      ],
      {
        resumeFile: {
          bytes: new TextEncoder().encode('%PDF-1.4\n'),
          filename: 'jobpilot-v1.pdf'
        }
      }
    );

    expect(exec.filledCount).toBe(5);
    expect(exec.skippedAlreadyFilledCount).toBe(1);
    expect(firstInput.value).toBe('Rohan');
    expect(trackerSpy).toHaveBeenCalledWith('');
    expect(inputListener).toHaveBeenCalled();
    expect(changeListener).toHaveBeenCalled();
    expect((document.getElementById('prefilled_email') as HTMLInputElement).value).toBe(
      'custom.user@example.com'
    );
    expect((document.getElementById('relocate') as HTMLSelectElement).value).toBe('yes_val');
    expect((document.querySelector('input[value="no"]') as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById('resume_file') as HTMLInputElement).files?.[0]?.name).toBe(
      'jobpilot-v1.pdf'
    );
    expect(submitClickSpy).not.toHaveBeenCalled();
    expect(formSubmitSpy).not.toHaveBeenCalled();

    // Undo restores all modified fields cleanly
    const restored = exec.undo();
    expect(restored).toBe(5);
    expect(firstInput.value).toBe('');
    expect((document.getElementById('relocate') as HTMLSelectElement).value).toBe('');
    expect((document.querySelector('input[value="no"]') as HTMLInputElement).checked).toBe(false);
  });

  it('traverses open Shadow DOM, same-origin iframes, refuses setNativeControlValue on submit, and observes multi-step mutations', async () => {
    document.body.innerHTML = `
      <div id="shadow-host"></div>
      <iframe id="same-origin-frame"></iframe>
      <div id="multi-step-root"></div>
      <button id="sub-btn" type="submit">Apply</button>
    `;

    const shadowHost = document.getElementById('shadow-host')!;
    const sr = shadowHost.attachShadow({ mode: 'open' });
    sr.innerHTML = `<label for="s-cgpa">CGPA</label><input id="s-cgpa" type="number" />`;

    const iframe = document.getElementById('same-origin-frame') as HTMLIFrameElement;
    if (iframe.contentDocument) {
      iframe.contentDocument.body.innerHTML = `<label for="f-city">Current City</label><input id="f-city" type="text" />`;
    }

    const controls = collectRawFormControls(document);
    const cgpaCtrl = controls.find((c) => c.id === 's-cgpa');
    expect(cgpaCtrl?.inShadowDom).toBe(true);

    if (iframe.contentDocument) {
      const cityCtrl = controls.find((c) => c.id === 'f-city');
      expect(cityCtrl?.framePath).toContain('iframe[0]');
    }

    expect(() => setNativeControlValue(document.getElementById('sub-btn') as never, 'x')).toThrow(
      /submit/i
    );

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    const attach = attachResumePdfFile(fileInput, new Uint8Array([37, 80, 68, 70]), 'cv.pdf');
    expect(attach.ok).toBe(true);
    expect(fileInput.files?.[0]?.name).toBe('cv.pdf');

    // Multi-step form observer triggers when dynamic inputs appear
    const changed = vi.fn();
    const stopObserving = observeMultiStepForm(document.getElementById('multi-step-root')!, changed, 20);
    const dynamicInput = document.createElement('input');
    document.getElementById('multi-step-root')!.appendChild(dynamicInput);
    await new Promise((r) => setTimeout(r, 60));
    stopObserving();
    expect(changed).toHaveBeenCalled();

    // Format India numbers appropriately for type=number vs text
    const plan = buildFillPlan({
      fields: [
        {
          fieldId: '1',
          atsAdapter: 'generic',
          controlType: 'number',
          canonicalKey: 'expected_ctc_lpa',
          label: 'Expected CTC (LPA)',
          name: 'ectc',
          id: 'ectc',
          placeholder: '',
          required: false,
          currentValue: '',
          alreadyFilled: false,
          options: [],
          selectorPath: '',
          framePath: 'top',
          inShadowDom: false,
          confidence: 0.92,
          matchReason: ''
        }
      ],
      profile: makeStudentProfile()
    });
    expect(plan[0]?.proposedValue).toBe('18');
  });
});
