# Chrome Web Store Submission & Privacy Disclosures

This document contains the ready-to-paste Chrome Web Store listing copy, permission justifications, and privacy disclosures for the **JobPilot Autofill & Job Capture** Manifest V3 extension (`apps/extension`).

---

## 1. Store Listing Copy

- **Extension Name**: JobPilot — AI Job Application Autofill & India CTC/CGPA Assistant
- **Short Description (<= 132 chars)**:
  Autofill job applications from your grounded profile & tailored resume with per-field confidence scores and mandatory review before submit.
- **Category**: Productivity

### Detailed Description
JobPilot helps software engineers, students, and job seekers complete repetitive job applications in seconds without sacrificing accuracy or control.

**Key Capabilities**
- **One-Click Application Form Scan & Autofill**: Automatically maps your Master Profile and tailored resume onto Greenhouse, Lever, Ashby, and Workday application forms.
- **Built for India & Global Applications**: Native support for Current/Expected CTC (in LPA), notice period (days / serving notice), preferred cities, willingness to relocate, fresher/internship status, CGPA (10-point or 4-point scale), college, and 10th/12th board marks.
- **Grounded Free-Text Answer Drafting**: Drafts role-specific answers to open-ended application questions using only your verified STAR Story Bank and Saved Answers.
- **Opt-In Indian Job Portal Assist**: Save job postings directly to your JobPilot tracker and assist with apply drawers on Naukri, Internshala, LinkedIn, Foundit, Instahyre, and Wellfound—isolated per site and disabled by default until you explicitly enable an adapter and grant host permission.
- **Mandatory Human Review Gate**: Every proposed field displays a confidence badge (`HIGH`, `MEDIUM`, `LOW`) and source attribution (`PROFILE`, `INDIA_PROFILE`, `SAVED_ANSWER`, `LLM_DRAFT`, `LLM_FALLBACK`). JobPilot **never** clicks submit and **never** overwrites fields you have already typed into.

---

## 2. Permission Justifications (Chrome Web Store Review)

| Permission / Host Pattern | Plain-English Justification for Reviewers |
| :--- | :--- |
| `storage` | Stores the user's JobPilot API connection settings, selected tailored resume version preference, and per-site opt-in adapter toggles locally in `chrome.storage.local`. |
| `tabs` | Reads the active tab's URL and title when the user clicks "Scan Form" or "Save Job to Tracker" in the side panel so the matching ATS adapter and job metadata can be loaded. |
| `sidePanel` | Displays the persistent JobPilot review checklist alongside the job application form so the user can inspect confidence scores, edit proposed values, and approve fields before filling. |
| `contextMenus` | Provides a right-click "Open JobPilot Review Side Panel" and "Save Current Job to JobPilot Tracker" menu action initiated by the user. |
| `scripting` | Injects the form-scanning and autofill content script into opt-in job portals only after the user explicitly enables that portal and grants runtime host permission. |
| `host_permissions` (`*://*.greenhouse.io/*`, `*://*.lever.co/*`, `*://*.ashbyhq.com/*`, `*://*.myworkdayjobs.com/*`, `http://localhost:4000/*`) | Enables automatic form detection and user-approved autofill on the four primary ATS platforms (Greenhouse, Lever, Ashby, Workday) and communicates with the user's configured JobPilot API server. |
| `optional_host_permissions` (`*://*.naukri.com/*`, `*://*.foundit.in/*`, `*://*.internshala.com/*`, `*://*.instahyre.com/*`, `*://*.wellfound.com/*`, `*://*.linkedin.com/*`) | Requested at runtime via `chrome.permissions.request()` **only** when the user explicitly toggles on an individual Indian or global job portal adapter in the Side Panel to capture a viewed job or assist with an apply drawer. |

---

## 3. Privacy Disclosures

- **Single Purpose**: Assisting the user in capturing job postings to their personal tracker and autofilling job application forms with mandatory human review before submission.
- **Data Collection & Transmission**:
  - Form labels, option lists, and user-initiated job capture metadata are sent **only** to the user's own configured JobPilot API endpoint.
  - No browsing history, background tab activity, or analytics telemetry is collected.
  - No third-party advertising, tracking pixels, or remote code execution is used.
- **Automated Submission Policy**: The extension is hard-coded never to submit forms (`form.submit()` or clicking submit buttons is prohibited in `packages/form-engine`). Every fill action requires the user to click **"Fill Approved Fields"** in the review UI and manually submit the application on the host page.
