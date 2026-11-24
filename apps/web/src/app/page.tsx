'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { RecommendationsHome } from '@/components/home/recommendations-home';
import { ThemeQuickToggle } from '@/components/theme-toggle';
import { MoBar, MoDecode, MoSpinner } from '@/components/ui/mo';
import {
  AsciiWordmark,
  Button,
  JobPilotLogo
} from '@/components/ui/primitives';
import { getSupabaseClient } from '@/lib/supabase';

type TuiStageId = 'parse' | 'match' | 'tailor' | 'autofill';

const TUI_STAGES: Array<{
  id: TuiStageId;
  tabLabel: string;
  command: string;
  status: string;
  lines: Array<{ prefix: string; text: string; tone?: 'ok' | 'accent' | 'warn' | 'mute' }>;
  progress: number;
}> = [
  {
    id: 'parse',
    tabLabel: '01.parse',
    command: 'jobpilot parse resume.pdf --apply',
    status: 'schema: json_resume + india_profile',
    progress: 100,
    lines: [
      { prefix: '[ok]', text: 'extracted 48 lines across 1 page (layout-aware PDF.js Y-sort)', tone: 'ok' },
      { prefix: ' ├─', text: 'education : B.Tech CSE · CGPA 8.92/10 · Class XII 95.4%', tone: 'mute' },
      { prefix: ' ├─', text: 'work      : 2 entries (Backend Intern, Research Fellow)', tone: 'mute' },
      { prefix: ' ├─', text: 'projects  : 3 entries with stack keywords & quantified bullets', tone: 'mute' },
      { prefix: ' └─', text: 'skills    : 18 keywords across Languages, Backend, Databases', tone: 'mute' }
    ]
  },
  {
    id: 'match',
    tabLabel: '02.match',
    command: 'jobpilot match --city=Bengaluru --min-lpa=16',
    status: 'model: BAAI/bge-small-en-v1.5 (384d)',
    progress: 94,
    lines: [
      { prefix: '[01]', text: 'hard-filter : passed (Bengaluru / Hybrid · 0-2 YoE · 18-26 LPA)', tone: 'ok' },
      { prefix: '[02]', text: 'pgvector    : cosine similarity 0.89 against active profile v3', tone: 'accent' },
      { prefix: '[03]', text: 'llm-rerank  : 94/100 — Strong TypeScript, Fastify & Postgres fit', tone: 'ok' },
      { prefix: '[!]', text: 'skill-gaps  : Kafka (optional nice-to-have in JD)', tone: 'warn' }
    ]
  },
  {
    id: 'tailor',
    tabLabel: '03.tailor',
    command: 'jobpilot tailor --job=razorpay-sde1 --template=ats-classic',
    status: 'verifier: deterministic + llm (0 unsupported)',
    progress: 100,
    lines: [
      { prefix: '[ok]', text: 'retained 2/2 work entries and 3/3 project entries from master profile', tone: 'ok' },
      { prefix: '[~]', text: 'reordered project bullets to foreground PostgreSQL & REST APIs', tone: 'accent' },
      { prefix: '[ok]', text: 'immutable check : employers, dates, institutions & CGPA locked', tone: 'ok' },
      { prefix: '[ok]', text: 'compiled single-column A4 PDF (jobpilot-v4.pdf · 0% hallucinated)', tone: 'ok' }
    ]
  },
  {
    id: 'autofill',
    tabLabel: '04.autofill',
    command: 'jobpilot extension fill --adapter=greenhouse --review',
    status: 'auto-submit: disabled (human review required)',
    progress: 88,
    lines: [
      { prefix: '[ok]', text: 'mapped 14 fields (Name, Email, Phone, LinkedIn, GitHub, Resume PDF)', tone: 'ok' },
      { prefix: '[ok]', text: 'india fields : Current CTC 0 LPA (Fresher) · Expected 18 LPA · Notice 0d', tone: 'ok' },
      { prefix: '[~]', text: 'drafted "Why Razorpay?" from Story Bank #2 (confidence: 0.91)', tone: 'accent' },
      { prefix: '[||]', text: 'PAUSED — awaiting your click in Side Panel before filling DOM', tone: 'warn' }
    ]
  }
];

const FEATURE_ROWS = [
  {
    marker: '[+]',
    title: 'Grounded resume tailoring',
    body: 'Selects, reorders, and rephrases bullets strictly from your Master Profile and Story Bank. A second deterministic + LLM verifier checks every employer, date, skill, and numeric metric before compiling a single-column ATS PDF.'
  },
  {
    marker: '[+]',
    title: 'Built for India & global applications',
    body: 'First-class fields for Current & Expected CTC (in LPA or foreign currency), notice period, serving-notice status, preferred cities, relocation, fresher status, CGPA (10 or 4 scale), and 10th/12th board marks.'
  },
  {
    marker: '[+]',
    title: 'Official board ingestion + 3-stage matching',
    body: 'Server crawlers hit only legal public JSON feeds (Greenhouse, Lever, Ashby, Workable, Adzuna India, Jooble, Remotive, Arbeitnow, RemoteOK). Jobs are deduplicated, embedded locally with bge-small, filtered, and re-ranked.'
  },
  {
    marker: '[+]',
    title: 'Chrome MV3 extension with review gate',
    body: 'Handles controlled React/Angular inputs, custom comboboxes, shadow DOM, and PDF uploads on Greenhouse, Lever, Ashby, and Workday—plus isolated opt-in adapters for Naukri, Internshala, LinkedIn, Foundit, Instahyre, and Wellfound.'
  },
  {
    marker: '[+]',
    title: 'OpenAI, Gemini & Meta Llama BYOK',
    body: 'Switch providers with zero code changes. Paste your own key in Settings (encrypted server-side with AES-256-GCM), fetch live model lists from the provider API, and track token latency and cost per call.'
  },
  {
    marker: '[+]',
    title: 'Application tracker & version history',
    body: 'Track every role across Saved, Applied, Interview, Offer, and Rejected with the exact tailored resume PDF version used and follow-up date reminders.'
  }
];

const FAQ_ITEMS = [
  {
    q: 'Does JobPilot ever invent skills or metrics to match a job description?',
    a: 'No. The tailoring pipeline is restricted to your Master Profile and Story Bank. Immutable fields (company names, dates, college, CGPA) are locked to your profile, and the dual verifier flags any ungrounded number or skill before PDF export.'
  },
  {
    q: 'How are Naukri, LinkedIn, and Internshala supported without violating ToS?',
    a: 'JobPilot never scrapes non-API job portals on the server. Those sites are supported exclusively through isolated, disabled-by-default adapters in the Chrome extension that operate only on pages you are actively viewing in your own browser session.'
  },
  {
    q: 'Will the Chrome extension ever submit an application automatically?',
    a: 'Never. The extension scans the form, proposes values with per-field confidence scores, and pauses in the Side Panel. It never overwrites fields you already typed into and never clicks submit.'
  },
  {
    q: 'How are my BYOK API keys stored?',
    a: 'Your API keys are encrypted server-side using AES-256-GCM with a unique 12-byte IV and 16-byte auth tag per key. Plaintext keys are never logged or returned to the browser.'
  }
];

export default function LandingPage() {
  const [authChecked, setAuthChecked] = useState(false);
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
  const [forceLanding, setForceLanding] = useState(false);
  const [activeStageId, setActiveStageId] = useState<TuiStageId>('parse');
  const [openFaqIdx, setOpenFaqIdx] = useState<number | null>(0);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      setForceLanding(params.get('view') === 'landing');
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      setAuthChecked(true);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSignedInEmail(data.session?.user?.email ?? null);
      setAuthChecked(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setSignedInEmail(session?.user?.email ?? null);
      setAuthChecked(true);
    });
    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[var(--canvas)] text-[var(--ink)] flex items-center justify-center gap-2.5 text-xs text-[var(--mute)]">
        <MoSpinner name="braille" />
        <JobPilotLogo size={20} />
      </div>
    );
  }

  if (signedInEmail && !forceLanding) {
    return <RecommendationsHome />;
  }

  const activeStage = TUI_STAGES.find((s) => s.id === activeStageId) ?? TUI_STAGES[0]!;

  return (
    <div className="min-h-screen bg-[var(--canvas)] text-[var(--ink)] flex flex-col">
      {/* Primary Nav — flat 56px bar per DESIGN.md */}
      <header className="sticky top-0 z-20 h-14 border-b border-[var(--hairline)] bg-[var(--canvas)]">
        <div className="max-w-[1040px] w-full mx-auto h-full px-4 sm:px-8 flex items-center justify-between gap-4">
          <Link href="/" className="no-underline">
            <AsciiWordmark />
          </Link>

          <div className="flex items-center gap-4 sm:gap-6">
            <a
              href="#what-is-jobpilot"
              className="hidden sm:inline text-sm text-[var(--mute)] hover:text-[var(--ink)] no-underline"
            >
              Overview
            </a>
            <a
              href="#faq"
              className="hidden sm:inline text-sm text-[var(--mute)] hover:text-[var(--ink)] no-underline"
            >
              FAQ
            </a>
            <ThemeQuickToggle />
            {signedInEmail ? (
              <Link href="/" onClick={() => setForceLanding(false)}>
                <Button variant="primary" size="sm">
                  Open Home
                </Button>
              </Link>
            ) : (
              <div className="flex items-center gap-2">
                <Link href="/login?mode=signin">
                  <Button variant="secondary" size="sm">
                    Log in
                  </Button>
                </Link>
                <Link href="/login?mode=signup">
                  <Button variant="primary" size="sm">
                    Sign up
                  </Button>
                </Link>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Single-column reading rhythm with 96px section gaps per DESIGN.md */}
      <main className="flex-1 max-w-[1040px] w-full mx-auto px-4 sm:px-8 py-14 sm:py-20 space-y-20 sm:space-y-24">
        {/* 1. Editorial Hero Block */}
        <section className="max-w-[780px] space-y-6">
          <h1 className="text-3xl sm:text-[38px] font-bold leading-[1.45] tracking-normal text-[var(--ink)]">
            The open-source AI job search and application assistant.
          </h1>

          <p className="text-base text-[var(--body)] leading-[1.6]">
            Upload your PDF resume once into a structured JSON Resume and India eligibility
            profile. Discover and rank roles with local embeddings, compile verified single-column
            ATS PDFs without hallucinated claims, and autofill applications with mandatory review.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            {signedInEmail ? (
              <>
                <Link href="/jobs">
                  <Button variant="primary" className="mo-arrow">
                    Open Job Feed
                  </Button>
                </Link>
                <Link href="/tailor">
                  <Button variant="secondary">Tailor Resume</Button>
                </Link>
                <Link href="/profile">
                  <Button variant="secondary">Master Profile</Button>
                </Link>
              </>
            ) : (
              <>
                <Link href="/login?mode=signup">
                  <Button variant="primary" className="mo-arrow">
                    Sign up
                  </Button>
                </Link>
                <Link href="/login?mode=signin">
                  <Button variant="secondary">Log in</Button>
                </Link>
              </>
            )}
          </div>
        </section>

        {/* 2. Single Full-Bleed Dark Hero TUI Mockup per DESIGN.md */}
        <section
          aria-label="JobPilot terminal workflow"
          className="bg-[var(--surface-dark)] text-[var(--on-dark)] p-6 sm:p-10 rounded-none border border-[var(--hairline)] space-y-6"
        >
          {/* Top TUI Stage Switcher */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/15 pb-4">
            <div className="flex items-center gap-3">
              <JobPilotLogo size={28} />
              <span className="text-sm font-bold tracking-wide text-[#fdfcfc]">
                jobpilot // interactive session
              </span>
            </div>

            <div
              role="tablist"
              aria-label="Workflow stages"
              className="flex flex-wrap items-center gap-1.5"
            >
              {TUI_STAGES.map((stage) => {
                const active = stage.id === activeStage.id;
                return (
                  <button
                    key={stage.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setActiveStageId(stage.id)}
                    className={`px-2.5 py-1 text-xs rounded-[4px] border cursor-pointer transition-colors ${
                      active
                        ? 'bg-[#fdfcfc] text-[#201d1d] border-[#fdfcfc] font-bold'
                        : 'bg-transparent text-[#9a9898] border-white/15 hover:text-[#fdfcfc]'
                    }`}
                  >
                    {stage.tabLabel}
                  </button>
                );
              })}
            </div>
          </div>

          {/* TUI Prompt Row (#302c2c surface-dark-elevated) */}
          <div className="bg-[var(--surface-dark-elevated)] text-[var(--on-dark)] px-4 py-3 rounded-[4px] flex flex-wrap items-center justify-between gap-3 text-sm">
            <div className="min-w-0">
              <span className="text-[#007aff] font-bold mr-2">&gt;</span>
              <MoDecode
                key={activeStage.command}
                text={activeStage.command}
                frames={8}
                className="font-bold text-[#fdfcfc]"
              />
            </div>
            <span className="text-xs text-[#9a9898]">{activeStage.status}</span>
          </div>

          {/* TUI Output Lines */}
          <div key={activeStage.id} className="space-y-2 text-xs sm:text-sm leading-relaxed">
            {activeStage.lines.map((line, i) => {
              const color =
                line.tone === 'ok'
                  ? 'text-[#30d158]'
                  : line.tone === 'accent'
                    ? 'text-[#60a5fa]'
                    : line.tone === 'warn'
                      ? 'text-[#ff9f0a]'
                      : 'text-[#9a9898]';
              return (
                <div
                  key={i}
                  style={{ animationDelay: `${i * 55}ms` }}
                  className="mo-pop flex items-start gap-3"
                >
                  <span className={`shrink-0 font-bold ${color}`}>{line.prefix}</span>
                  <span className="text-[#fdfcfc]/90">{line.text}</span>
                </div>
              );
            })}
          </div>

          {/* TUI Footer status & keybindings */}
          <div className="pt-4 border-t border-white/15 flex flex-wrap items-center justify-between gap-4 text-xs text-[#9a9898]">
            <div className="flex items-center gap-3">
              <span>confidence</span>
              <span className="text-[#30d158]">
                <MoBar value={activeStage.progress} width={16} />
              </span>
            </div>
            <span>providers: openai | gemini | meta-llama · byok: aes-256-gcm</span>
          </div>
        </section>

        {/* 3. Three Flat ASCII Architecture / Metric Tiles per DESIGN.md chart-tile */}
        <section
          aria-label="System guarantees"
          className="grid grid-cols-1 md:grid-cols-3 border-y border-[var(--hairline)] divide-y md:divide-y-0 md:divide-x divide-[var(--hairline)]"
        >
          <div className="py-6 md:pr-6 space-y-2">
            <pre className="text-xs text-[var(--mute)] leading-snug m-0 select-none">{`[Filter] ──> [BGE-384d] ──> [LLM]
  LPA/YoE      pgvector     Score`}</pre>
            <p className="text-sm font-bold text-[var(--ink)] pt-1">
              Fig 1. Three-Stage Job Matching
            </p>
            <p className="text-sm text-[var(--body)]">
              Hard India/global eligibility filters first, local 384-d vector retrieval second, and
              explainable LLM re-ranking third.
            </p>
          </div>

          <div className="py-6 md:px-6 space-y-2">
            <pre className="text-xs text-[var(--mute)] leading-snug m-0 select-none">{`[Master] ──> [Tailor] ──> [Verify]
  100%         Diff        0% Fake`}</pre>
            <p className="text-sm font-bold text-[var(--ink)] pt-1">
              Fig 2. Dual Faithfulness Verifier
            </p>
            <p className="text-sm text-[var(--body)]">
              Every tailored bullet is cross-checked against your profile. Invented metrics,
              altered dates, or ungrounded skills are rejected.
            </p>
          </div>

          <div className="py-6 md:pl-6 space-y-2">
            <pre className="text-xs text-[var(--mute)] leading-snug m-0 select-none">{`[Scan DOM] ──> [Draft] ──> [Pause]
  ATS/India     Confidence   Human`}</pre>
            <p className="text-sm font-bold text-[var(--ink)] pt-1">
              Fig 3. Human-Reviewed Autofill
            </p>
            <p className="text-sm text-[var(--body)]">
              Maps fields across Greenhouse, Lever, Ashby, Workday, and opt-in Indian portals,
              always pausing for your review before submit.
            </p>
          </div>
        </section>

        {/* 4. Flat List Rows ("What is JobPilot?") — left-flush per DESIGN.md */}
        <section id="what-is-jobpilot" className="max-w-[880px] space-y-4">
          <h2 className="text-base font-bold text-[var(--ink)]">What is JobPilot?</h2>
          <ul className="divide-y divide-[var(--hairline)] border-t border-b border-[var(--hairline)] list-none p-0 m-0">
            {FEATURE_ROWS.map((row) => (
              <li
                key={row.title}
                className="py-4 flex flex-col sm:flex-row sm:items-baseline gap-2 sm:gap-8"
              >
                <span className="text-base font-bold text-[var(--ink)] sm:w-72 shrink-0">
                  <span className="text-[var(--mute)] mr-2">{row.marker}</span>
                  {row.title}
                </span>
                <span className="text-base text-[var(--body)] leading-[1.55]">{row.body}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* 5. FAQ Accordion using mo-gallery stepped bracket toggle */}
        <section id="faq" className="max-w-[880px] space-y-4">
          <h2 className="text-base font-bold text-[var(--ink)]">FAQ</h2>
          <div className="divide-y divide-[var(--hairline)] border-t border-b border-[var(--hairline)]">
            {FAQ_ITEMS.map((item, idx) => {
              const isOpen = openFaqIdx === idx;
              return (
                <div key={item.q} className="py-3">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpenFaqIdx(isOpen ? null : idx)}
                    className="w-full flex items-baseline gap-3 text-left text-base font-medium text-[var(--ink)] cursor-pointer py-1"
                  >
                    <span className="text-[var(--mute)] shrink-0 w-8">
                      <MoDecode text={isOpen ? '[-]' : '[+]'} frames={4} />
                    </span>
                    <span>{item.q}</span>
                  </button>
                  {isOpen ? (
                    <p className="mo-pop pl-11 pt-2 pb-1 text-base text-[var(--body)] leading-[1.55]">
                      {item.a}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      </main>

      {/* Minimal Footer per DESIGN.md */}
      <footer className="border-t border-[var(--hairline)] py-8">
        <div className="max-w-[1040px] w-full mx-auto px-4 sm:px-8 flex flex-wrap items-center justify-between gap-4 text-sm text-[var(--mute)]">
          <div className="flex items-center gap-2.5">
            <JobPilotLogo size={20} />
            <span className="text-[var(--ink)] font-bold">JOBPILOT</span>
            <span>· Free &amp; Open-Source</span>
          </div>

          <div className="flex flex-wrap items-center gap-6">
            {signedInEmail ? (
              <Link
                href="/"
                onClick={() => setForceLanding(false)}
                className="text-[var(--ink)] no-underline hover:underline"
              >
                Open Home Feed -&gt;
              </Link>
            ) : (
              <>
                <Link
                  href="/login?mode=signin"
                  className="text-[var(--ink)] no-underline hover:underline"
                >
                  Log in
                </Link>
                <Link
                  href="/login?mode=signup"
                  className="text-[var(--ink)] no-underline hover:underline"
                >
                  Sign up
                </Link>
              </>
            )}
            <a
              href="https://github.com/Hootsworth/JobPilot"
              target="_blank"
              rel="noreferrer"
              className="text-[var(--mute)] hover:text-[var(--ink)] no-underline"
            >
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
