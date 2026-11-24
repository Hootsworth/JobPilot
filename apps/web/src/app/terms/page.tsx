import type { Metadata } from 'next';
import Link from 'next/link';
import { ThemeQuickToggle } from '@/components/theme-toggle';
import { AsciiWordmark } from '@/components/ui/primitives';

export const metadata: Metadata = {
  title: 'Terms of Service'
};

export default function TermsPage() {
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
          <h1 className="text-2xl font-bold tracking-tight text-[var(--ink)]">Terms of Service</h1>
          <p className="text-xs text-[var(--mute)]">
            Effective date: November 24, 2026 · JobPilot Open-Source Application
          </p>
        </div>

        <section className="space-y-2.5 text-sm text-[var(--body)] leading-relaxed">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--ink)]">
            1. Scope of Service
          </h2>
          <p>
            JobPilot provides open-source tools for job discovery, resume and cover letter
            tailoring, verification, application tracking, and user-assisted form autofill.
          </p>
        </section>

        <section className="space-y-2.5 text-sm text-[var(--body)] leading-relaxed">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--ink)]">
            2. User Review &amp; Portal Responsibility
          </h2>
          <p>
            You are solely responsible for reviewing the accuracy of every generated resume, cover
            letter, drafted answer, and autofilled field before submitting any job application. You
            remain responsible for complying with the terms of third-party employer portals and
            application systems you choose to use.
          </p>
        </section>

        <section className="space-y-2.5 text-sm text-[var(--body)] leading-relaxed">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--ink)]">
            3. BYOK LLM Provider Usage
          </h2>
          <p>
            When configuring your own OpenAI, Gemini, or Meta API keys, all model requests made on
            your behalf are subject to that provider&apos;s terms, rate limits, and billing
            policies. You are responsible for charges incurred under your own API keys.
          </p>
        </section>

        <section className="space-y-2.5 text-sm text-[var(--body)] leading-relaxed">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--ink)]">
            4. Availability &amp; Warranty Disclaimer
          </h2>
          <p>
            JobPilot is provided &ldquo;as is&rdquo; without warranties of any kind, express or
            implied, including fitness for a particular purpose, employment outcomes, or
            uninterrupted uptime of third-party job feeds and LLM APIs.
          </p>
        </section>

        <section className="space-y-2.5 text-sm text-[var(--body)] leading-relaxed">
          <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--ink)]">
            5. Account Termination &amp; Data Deletion
          </h2>
          <p>
            You may stop using JobPilot and permanently delete your account and stored data at any
            time in{' '}
            <Link href="/settings" className="text-[var(--ink)] underline">
              Settings
            </Link>
            . For additional details on stored data, see our{' '}
            <Link href="/privacy" className="text-[var(--ink)] underline">
              Privacy Policy
            </Link>
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
            <Link href="/privacy" className="hover:text-[var(--ink)] no-underline">
              Privacy Policy
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
