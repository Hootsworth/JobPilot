# Chrome Web Store Submission & Privacy Disclosures

This document contains the ready-to-paste Chrome Web Store listing copy, permission justifications, and privacy disclosures for the **JobPilot Autofill & Job Capture** Manifest V3 extension (`apps/extension`).

---

## 1. Store Listing Copy

- **Extension Name**: JobPilot — AI Job Application Autofill & India CTC/CGPA Assistant
- **Short Description (<= 132 chars)**:
  Autofill job applications on any website with "Autofill via JobPilot", AI field matching, and required-only prompts.
- **Category**: Productivity

### Detailed Description
JobPilot helps software engineers, students, and job seekers complete job applications across any company career site or job board in seconds without sacrificing accuracy or control.

**Key Capabilities**
- **Autofill via JobPilot on Any Website**: Trigger Autofill directly from the Chrome Side Panel or right-click menu on any company career portal or job board, plus an **opt-in** inline **"Autofill via JobPilot"** button beside Apply CTAs (off by default, with zero unprompted floating badges or field counters).
- **AI Field Identification & Grounded Filling**: Scans forms across any site, maps fields to your Master Profile and tailored resume, and fills answers grounded in your Story Bank and Saved Answer Bank.
- **Asks Only What Is Required**: Automatically fills everything known from your profile and asks quick follow-up questions **only** for genuinely required fields that cannot be filled automatically—skipping optional guesswork.
- **Built for India & Global Applications**: Native support for Current/Expected CTC (in LPA), notice period, preferred cities, willingness to relocate, fresher/internship status, CGPA, college, and 10th/12th board marks.
- **Review & Control Before Submit**: JobPilot **never** clicks Submit and **never** overwrites fields you have already typed into. You stay in control of every field and can save new answers for future applications.

---

## 2. Permission Justifications (Chrome Web Store Review)

| Permission / Host Pattern | Plain-English Justification for Reviewers |
| :--- | :--- |
| `storage` | Stores the user's JobPilot connection settings, selected tailored resume version preference, saved preferences locally in extension storage, and short-lived session trigger state when opening the side panel from an Apply button. |
| `tabs` | Reads the active tab's URL and title when the user triggers "Autofill via JobPilot" or saves a job so the right application context and job metadata are loaded. |
| `activeTab` | Grants temporary user-gesture access to the active tab when saving a job or inspecting a page via context menu or keyboard shortcut (`Alt+Shift+S`). |
| `sidePanel` | Displays the JobPilot side panel alongside any application page so users can run "Autofill via JobPilot", answer required missing questions, and review filled values before submitting. |
| `contextMenus` | Provides right-click **"Autofill via JobPilot"** and **"Save this job to JobPilot Tracker"** actions initiated by the user. |
| `scripting` | Injects the form-scanning/autofill script or job metadata extractor on demand when triggered by the user on the active tab. |
| `host_permissions` (`https://*/*`, `http://*/*`) | Enables **"Autofill via JobPilot"** beside Apply buttons and in the Side Panel on any custom company career portal or job board, syncs your signed-in JobPilot web session, and communicates with the JobPilot backend. |

---

## 3. Privacy Disclosures

- **Privacy Policy URL**: `https://jobpilot.singulr.tech/privacy`

- **Single Purpose**: Helping users capture job postings and autofill job application forms across any website with AI assistance and mandatory user review before submission.
- **Data Collection & Transmission**:
  - Form field labels, option lists, and user-initiated job capture metadata are sent **only** when the user triggers JobPilot on that page and **only** to the JobPilot API.
  - No browsing history, background tab activity, or analytics telemetry is collected.
  - No third-party advertising, tracking pixels, or remote code execution is used.
- **Automated Submission Policy**: The extension is hard-coded never to submit forms or click final submit buttons. Users review the filled form and submit each application themselves.
