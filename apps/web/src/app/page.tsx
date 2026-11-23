'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabase';
import { ThemeQuickToggle } from '@/components/theme-toggle';
import { AsciiWordmark, Badge, Button } from '@/components/ui/primitives';

export default function HomePage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setChecking(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        router.replace('/profile');
      } else {
        setChecking(false);
      }
    });
  }, [router]);

  return (
    <div className="min-h-screen bg-[var(--canvas)] text-[var(--ink)] flex flex-col">
      {/* Primary Nav per DESIGN.md */}
      <header className="h-14 border-b border-[var(--hairline)] px-4 sm:px-8 flex items-center justify-between max-w-[1100px] w-full mx-auto">
        <AsciiWordmark />
        <div className="flex items-center gap-3">
          <ThemeQuickToggle />
          <Link href="/login">
            <Button variant="primary" size="sm">
              Sign in -&gt;
            </Button>
          </Link>
        </div>
      </header>

      <main className="flex-1 max-w-[1100px] w-full mx-auto px-4 sm:px-8 py-12 sm:py-20 space-y-16 sm:space-y-24">
        {/* Hero copy */}
        <section className="space-y-6 max-w-3xl">
          <div className="flex items-center gap-2">
            <Badge tone="dark">v0.1.0 — Full Stack &amp; MV3 Extension</Badge>
            <span className="text-xs text-[var(--mute)]">
              Open-source AI job search assistant for India &amp; global roles
            </span>
          </div>
          <h1 className="text-3xl sm:text-[38px] font-bold leading-[1.45] text-[var(--ink)]">
            Grounded resume tailoring, India CTC/CGPA autofill, and zero-lock-in AI.
          </h1>
          <p className="text-base text-[var(--body)] leading-[1.6] max-w-2xl">
            Upload your PDF resume once into a structured JSON Resume + India eligibility
            profile, discover &amp; score jobs with local bge-small embeddings, generate verified
            single-column ATS PDFs, autofill Greenhouse/Lever/Ashby/Workday &amp; Indian job
            portals with mandatory review, and track every application.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Link href="/login">
              <Button variant="primary" disabled={checking}>
                {checking ? 'Checking session...' : 'Get started'}
              </Button>
            </Link>
            <Link href="/onboarding">
              <Button variant="secondary">Jump to Onboarding -&gt;</Button>
            </Link>
            <Link href="/jobs">
              <Button variant="secondary">Job Feed -&gt;</Button>
            </Link>
            <Link href="/tracker">
              <Button variant="secondary">Application Tracker -&gt;</Button>
            </Link>
          </div>
        </section>

        {/* Single dark Hero TUI Mockup per DESIGN.md */}
        <section
          aria-label="JobPilot terminal workflow preview"
          className="bg-[var(--surface-dark)] text-[var(--on-dark)] px-6 py-12 sm:px-10 sm:py-16 rounded-none border border-[var(--hairline)]"
        >
          <div className="max-w-3xl mx-auto space-y-8">
            <pre
              aria-hidden="true"
              className="text-[10px] sm:text-xs leading-tight text-[var(--on-dark)] overflow-x-auto select-none"
            >{`     ██╗ ██████╗ ██████╗ ██████╗ ██╗██╗      ██████╗ ████████╗
     ██║██╔═══██╗██╔══██╗██╔══██╗██║██║     ██╔═══██╗╚══██╔══╝
     ██║██║   ██║██████╔╝██████╔╝██║██║     ██║   ██║   ██║   
██   ██║██║   ██║██╔══██╗██╔═══╝ ██║██║     ██║   ██║   ██║   
╚█████╔╝╚██████╔╝██████╔╝██║     ██║███████╗╚██████╔╝   ██║   
 ╚════╝  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚══════╝ ╚═════╝    ╚═╝   `}</pre>

            <div className="bg-[var(--surface-dark-elevated)] text-[var(--on-dark)] px-4 py-3 rounded-[4px] flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                <span className="text-[#007aff] mr-2">|</span>
                <span className="font-bold">Parse</span>{' '}
                <span className="text-[var(--on-dark-mute)]">resume.pdf -&gt; JSON Resume + India LPA/CGPA</span>
              </span>
              <span className="text-xs text-[#30d158]">[openai | gemini | meta]</span>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 text-xs text-[var(--on-dark-mute)]">
              <span>tab: switch provider · byok: AES-256-GCM · embeddings: local bge-small</span>
              <span>zero hallucinated claims</span>
            </div>
          </div>
        </section>

        {/* ASCII bracket list rows per DESIGN.md */}
        <section className="space-y-4 border-t border-[var(--hairline)] pt-8">
          <h2 className="text-base font-bold text-[var(--ink)]">What is JobPilot?</h2>
          <ul className="divide-y divide-[var(--hairline)] list-none p-0 m-0">
            <li className="py-3 text-sm text-[var(--body)] flex flex-col sm:flex-row sm:gap-6">
              <span className="font-bold text-[var(--ink)] sm:w-64 shrink-0">
                [+] Master Profile &amp; India Fields
              </span>
              <span>
                Current/Expected CTC (LPA), notice period, preferred hubs, relocation, fresher/internship status, college, CGPA, and 10th/12th marks.
              </span>
            </li>
            <li className="py-3 text-sm text-[var(--body)] flex flex-col sm:flex-row sm:gap-6">
              <span className="font-bold text-[var(--ink)] sm:w-64 shrink-0">
                [+] Three First-Class LLM Providers
              </span>
              <span>
                OpenAI, Gemini (responseSchema), and Meta Llama compat API (/compat/v1/) with live /models discovery and Zod retry + repair validation.
              </span>
            </li>
            <li className="py-3 text-sm text-[var(--body)] flex flex-col sm:flex-row sm:gap-6">
              <span className="font-bold text-[var(--ink)] sm:w-64 shrink-0">
                [+] Story Bank &amp; Saved Answers
              </span>
              <span>
                Reusable STAR impact stories with quantified metrics and curated answers for recurring India &amp; global application questions.
              </span>
            </li>
            <li className="py-3 text-sm text-[var(--body)] flex flex-col sm:flex-row sm:gap-6">
              <span className="font-bold text-[var(--ink)] sm:w-64 shrink-0">
                [+] 3-Stage Job Discovery &amp; Matching
              </span>
              <span>
                Greenhouse, Lever, Ashby, Workable, Adzuna India, Jooble, Remotive, Arbeitnow &amp; RemoteOK deduplicated with local bge-small vectors, hard India filters, and LLM re-rank.
              </span>
            </li>
            <li className="py-3 text-sm text-[var(--body)] flex flex-col sm:flex-row sm:gap-6">
              <span className="font-bold text-[var(--ink)] sm:w-64 shrink-0">
                [+] Grounded Tailoring &amp; Dual Verifier
              </span>
              <span>
                Strict master-profile-only selection with deterministic + LLM faithfulness audit and single-column ATS PDF output.
              </span>
            </li>
            <li className="py-3 text-sm text-[var(--body)] flex flex-col sm:flex-row sm:gap-6">
              <span className="font-bold text-[var(--ink)] sm:w-64 shrink-0">
                [+] Chrome MV3 Autofill &amp; Tracker
              </span>
              <span>
                Per-field confidence review gate on Greenhouse, Lever, Ashby, Workday &amp; opt-in Indian portals (Naukri, Internshala, LinkedIn, Foundit, Instahyre, Wellfound) plus full pipeline &amp; follow-up tracker.
              </span>
            </li>
            <li className="py-3 text-sm text-[var(--body)] flex flex-col sm:flex-row sm:gap-6">
              <span className="font-bold text-[var(--ink)] sm:w-64 shrink-0">
                [+] Privacy &amp; Portability
              </span>
              <span>
                Row-Level Security, zero telemetry without opt-in, one-click JSON export, and full account deletion.
              </span>
            </li>
          </ul>
        </section>
      </main>

      <footer className="border-t border-[var(--hairline)] py-6 px-4 sm:px-8 max-w-[1100px] w-full mx-auto flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--mute)]">
        <span>JobPilot // Free &amp; Open-Source Architecture</span>
        <span>v0.1.0: Profile · Discovery · Grounded Tailor · MV3 Autofill · India Portals · Tracker</span>
      </footer>
    </div>
  );
}
