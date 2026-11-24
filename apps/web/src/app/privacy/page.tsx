import type { Metadata } from 'next';
import Link from 'next/link';
import { ThemeQuickToggle } from '@/components/theme-toggle';
import { AsciiWordmark } from '@/components/ui/primitives';

export const metadata: Metadata = {
  title: 'Privacy Policy'
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[var(--canvas)] text-[var(--ink)] flex flex-col">
      <header className="h-14 border-b border-[var(--hairline)] px-4 sm:px-8 flex items-center justify-between max-w-[1200px] w-full mx-auto">
        <Link href="/" className="no-underline">
          <AsciiWordmark />
        </Link>
        <div className="flex items-center gap-3">
          <Link href="/" className="text-xs text-[var(--mute)] hover:text-[var(--ink)] no-underline">
            ← Back to home
          </Link>
          <ThemeQuickToggle />
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-8 py-10 space-y-8">
        <div className="border-b border-[var(--hairline)] pb-5 space-y-2">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--ink)]">Privacy Policy</h1>
          <p className="text-xs text-[var(--mute)]">
            Effective date: November 24, 2026 · JobPilot Open-Source Application
          </p>
        </div>

        <section className="space-y-2.5 text-sm text-[var(--body)] leading-relaxed">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--ink)]">
            1. Data We Store
          </h2>
          <p>
            When you create a JobPilot account, we store only the information needed to provide job
            discovery, grounded resume tailoring, form autofill, and application tracking:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Account email address and authentication identifiers managed via Supabase Auth.</li>
            <li>
              Your Master Profile (JSON Resume), profile variants, preferences (CTC, notice period,
              preferred locations, education details), STAR Story Bank, and Saved Answers.
            </li>
            <li>
              Tailored resume versions, cover letters, ATS audit reports, tracked applications, and
              token/cost usage ledger entries.
            </li>
          </ul>
        </section>

        <section className="space-y-2.5 text-sm text-[var(--body)] leading-relaxed">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--ink)]">
            2. Encrypted BYOK API Keys
          </h2>
          <p>
            If you provide your own OpenAI, Gemini, or Meta API keys, they are encrypted on the
            server using AES-256-GCM before storage. Decryption occurs only server-side to execute
            user-requested LLM tasks, and raw keys are redacted from logs and never returned to the
            browser after saving.
          </p>
        </section>

        <section className="space-y-2.5 text-sm text-[var(--body)] leading-relaxed">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--ink)]">
            3. Grounded AI &amp; Human Review
          </h2>
          <p>
            Resume tailoring and cover letter generation are verified against your Master Profile and
            Story Bank. Anonymous product telemetry is off by default and can be toggled in Settings.
            JobPilot never submits job applications automatically on your behalf.
          </p>
        </section>

        <section className="space-y-2.5 text-sm text-[var(--body)] leading-relaxed">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--ink)]">
            4. Chrome Extension Data Handling
          </h2>
          <p>
            The JobPilot Chrome Extension accesses only the active tab when you explicitly open the
            side panel, scan a supported application form, or save a job posting to your tracker.
            Optional job-portal adapters (Workday, LinkedIn, Naukri, Internshala, Foundit,
            Instahyre, Wellfound) remain disabled until you opt in and grant runtime host
            permission.
          </p>
          <p>
            The extension collects no browsing history, background tab telemetry, advertising
            identifiers, or third-party tracking cookies, and never executes remote scripts.
          </p>
        </section>

        <section className="space-y-2.5 text-sm text-[var(--body)] leading-relaxed">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--ink)]">
            5. Data Portability &amp; Deletion
          </h2>
          <p>
            You can export your complete account data as JSON or permanently delete your account,
            uploaded resumes, encrypted keys, and tracked applications at any time from{' '}
            <Link href="/settings" className="text-[var(--ink)] underline">
              Settings
            </Link>
            .
          </p>
        </section>

        <section className="space-y-2.5 text-sm text-[var(--body)] leading-relaxed">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--ink)]">
            6. Contact &amp; Source Code
          </h2>
          <p>
            Questions or privacy requests can be opened via the public repository at{' '}
            <a
              href="https://github.com/Hootsworth/JobPilot/issues"
              target="_blank"
              rel="noreferrer"
              className="text-[var(--ink)] underline"
            >
              github.com/Hootsworth/JobPilot
            </a>
            .
          </p>
        </section>
      </main>

      <footer className="border-t border-[var(--hairline)] py-6 px-4 sm:px-8">
        <div className="max-w-3xl w-full mx-auto flex flex-wrap items-center justify-between gap-4 text-xs text-[var(--mute)]">
          <span>JobPilot</span>
          <div className="flex items-center gap-5">
            <Link href="/" className="hover:text-[var(--ink)] no-underline">
              Home
            </Link>
            <Link href="/terms" className="hover:text-[var(--ink)] no-underline">
              Terms of Service
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
