'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ThemeQuickToggle } from '@/components/theme-toggle';
import {
  MoBar,
  MoCount,
  MoDecode,
  MoSpinner,
  MoTicker,
  MoTypeLoop,
  moBurst
} from '@/components/ui/mo';
import {
  AsciiWordmark,
  Badge,
  Button,
  JobPilotLogo
} from '@/components/ui/primitives';
import { getSupabaseClient } from '@/lib/supabase';

const CAPABILITIES = [
  {
    code: '[01]',
    title: 'Master Profile & India Signals',
    description:
      'Upload your PDF resume once. Extracts Education, Projects, Work, Technical Skills, and India-specific fields: Current/Expected CTC (LPA), notice period, CGPA, 10th/12th marks, and preferred hubs.'
  },
  {
    code: '[02]',
    title: 'Official ATS & India Job Discovery',
    description:
      'Ingests Greenhouse, Lever, Ashby, Workable, Adzuna India, Jooble, Remotive, Arbeitnow, and RemoteOK with cross-source deduplication and local 384-d BAAI/bge-small embeddings.'
  },
  {
    code: '[03]',
    title: '3-Stage Explainable Matching',
    description:
      'Stage 1 hard filters (LPA, experience years, work mode, city), Stage 2 pgvector cosine retrieval, and Stage 3 LLM re-ranking with match score, one-line rationale, and skill gaps.'
  },
  {
    code: '[04]',
    title: 'Grounded Tailoring & Dual Verifier',
    description:
      'Retains your Work Experience and Projects, reorders and rephrases bullets strictly from your Master Profile, and runs a dual deterministic + LLM verifier before compiling ATS PDFs.'
  },
  {
    code: '[05]',
    title: 'Chrome MV3 Autofill with Review Gate',
    description:
      'Fills Greenhouse, Lever, Ashby, Workday, and opt-in Indian portals (Naukri, Internshala, LinkedIn, Foundit, Instahyre, Wellfound) with per-field confidence badges. Never auto-submits.'
  },
  {
    code: '[06]',
    title: 'Zero-Lock-In BYOK & Pipeline Tracker',
    description:
      'First-class OpenAI, Gemini, and Meta Llama compat (/compat/v1/) adapters with AES-256-GCM encrypted BYOK keys, plus an application tracker linking the exact PDF version used.'
  }
];

const TICKER_ITEMS = [
  '[+] 0% HALLUCINATED CLAIMS',
  '[+] LOCAL BGE-SMALL 384D VECTORS',
  '[+] AES-256-GCM ENCRYPTED BYOK',
  '[+] GREENHOUSE · LEVER · ASHBY · WORKDAY',
  '[+] NAUKRI · INTERNSHALA · LINKEDIN · FOUNDIT · INSTAHYRE · WELLFOUND',
  '[+] OPENAI · GOOGLE GEMINI · META LLAMA API',
  '[+] TYPST & ATS-SAFE SINGLE-COLUMN PDF'
];

export default function LandingPage() {
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
  const [replayKey, setReplayKey] = useState(0);
  const [pipelineStep, setPipelineStep] = useState(4);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSignedInEmail(data.session?.user?.email ?? null);
    });
  }, []);

  useEffect(() => {
    setPipelineStep(1);
    const t1 = setTimeout(() => setPipelineStep(2), 420);
    const t2 = setTimeout(() => setPipelineStep(3), 860);
    const t3 = setTimeout(() => setPipelineStep(4), 1300);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [replayKey]);

  return (
    <div className="min-h-screen bg-[var(--canvas)] text-[var(--ink)] flex flex-col">
      {/* Top Landing Header */}
      <header className="sticky top-0 z-20 border-b border-[var(--hairline)] bg-[var(--canvas)]">
        <div className="max-w-[1200px] w-full mx-auto h-16 px-4 sm:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <Link href="/" className="no-underline">
              <AsciiWordmark />
            </Link>
            <nav
              aria-label="Landing sections"
              className="hidden md:flex items-center gap-5 text-xs text-[var(--mute)]"
            >
              <a href="#workflow" className="no-underline hover:text-[var(--ink)]">
                Workflow
              </a>
              <a href="#features" className="no-underline hover:text-[var(--ink)]">
                Features
              </a>
              <a href="#platforms" className="no-underline hover:text-[var(--ink)]">
                Supported Platforms
              </a>
            </nav>
          </div>

          <div className="flex items-center gap-2.5">
            <ThemeQuickToggle />
            {signedInEmail ? (
              <Link href="/jobs">
                <Button variant="primary" size="sm">
                  Open Workspace -&gt;
                </Button>
              </Link>
            ) : (
              <>
                <Link href="/login?mode=signin">
                  <Button variant="secondary" size="sm">
                    Log in
                  </Button>
                </Link>
                <Link href="/login?mode=signup">
                  <Button variant="primary" size="sm">
                    Sign up -&gt;
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Stepped Terminal Ticker from mo-gallery.html */}
      <MoTicker items={TICKER_ITEMS} />

      <main className="flex-1 max-w-[1200px] w-full mx-auto px-4 sm:px-8 py-12 sm:py-16 space-y-20">
        {/* Hero Section */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-7 space-y-6">
            <div className="inline-flex items-center gap-2.5 px-3 py-1.5 border border-[var(--hairline)] bg-[var(--surface-soft)]">
              <span className="mo-ping" aria-hidden="true" />
              <JobPilotLogo size={18} />
              <MoDecode
                key={`badge-${replayKey}`}
                text="JOBPILOT // INDIA & GLOBAL AI JOB ASSISTANT"
                className="text-xs font-bold tracking-wider uppercase text-[var(--ink)]"
              />
            </div>

            <h1 className="text-3xl sm:text-[40px] font-bold leading-[1.3] tracking-tight text-[var(--ink)]">
              Ship applications with{' '}
              <span className="underline decoration-[var(--hairline-strong)] underline-offset-8">
                <MoTypeLoop
                  words={[
                    'grounded ATS resumes.',
                    'India CTC & CGPA autofill.',
                    'zero hallucinated metrics.',
                    'confidence-gated MV3 fill.'
                  ]}
                />
              </span>
            </h1>

            <p className="text-sm sm:text-base text-[var(--body)] leading-[1.65] max-w-2xl">
              Built for CS students and software engineers applying across India and globally.
              Parse your PDF resume into an editable JSON Resume + India CTC/CGPA profile, rank
              jobs with local embeddings, verify every tailored bullet against your profile, and
              autofill forms with mandatory human review.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              {signedInEmail ? (
                <>
                  <Link href="/jobs">
                    <Button variant="primary" className="mo-arrow">
                      Go to Job Feed
                    </Button>
                  </Link>
                  <Link href="/tailor">
                    <Button variant="secondary">Tailor Resume &amp; PDF</Button>
                  </Link>
                  <Link href="/tracker">
                    <Button variant="secondary">Application Tracker</Button>
                  </Link>
                  <Link href="/profile">
                    <Button variant="secondary">Master Profile</Button>
                  </Link>
                </>
              ) : (
                <>
                  <Link href="/login?mode=signup">
                    <Button variant="primary" className="mo-arrow">
                      Create Free Account
                    </Button>
                  </Link>
                  <Link href="/login?mode=signin">
                    <Button variant="secondary">Log in to Workspace</Button>
                  </Link>
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-2 text-xs text-[var(--mute)]">
              <span>[+] OpenAI · Gemini · Meta Llama API</span>
              <span>[+] AES-256-GCM Encrypted BYOK</span>
              <span>[+] 100% Free-Tier Stack</span>
            </div>
          </div>

          {/* Interactive Terminal Pipeline Card with mo-gallery replay + MoBar + MoDecode */}
          <div
            id="workflow"
            className="lg:col-span-5 bg-[var(--surface-dark)] text-[var(--on-dark)] border border-[var(--hairline-strong)] p-6 space-y-5"
          >
            <div className="flex items-center justify-between border-b border-white/15 pb-4">
              <div className="flex items-center gap-3">
                <JobPilotLogo size={34} />
                <div>
                  <p className="text-xs font-bold tracking-wider uppercase text-white">
                    jobpilot-cli // pipeline
                  </p>
                  <p className="text-[11px] text-[var(--on-dark-mute)]">
                    strict-grounding: enabled · auto-submit: false
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={(e) => {
                    setReplayKey((k) => k + 1);
                    moBurst(e.currentTarget, 12);
                  }}
                  className="px-2 py-1 text-[11px] border border-white/25 text-white hover:bg-white/10 rounded-[4px] cursor-pointer"
                >
                  [replay]
                </button>
                <Badge tone="dark">v0.1.0</Badge>
              </div>
            </div>

            <div key={replayKey} className="space-y-3 text-xs font-mono">
              <div className="mo-pop p-3 bg-[var(--surface-dark-elevated)] border border-white/10 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[#60a5fa] font-bold">&gt; 01. parse resume.pdf</span>
                  <span className="text-[#30d158]">
                    {pipelineStep >= 1 ? <MoDecode text="[OK]" frames={6} /> : <MoSpinner />}
                  </span>
                </div>
                <p className="text-[var(--on-dark-mute)]">
                  Extracted Education, Projects, Work, Skills + CGPA &amp; LPA expectations
                </p>
              </div>

              <div
                className="mo-pop p-3 bg-[var(--surface-dark-elevated)] border border-white/10 space-y-1.5"
                style={{ animationDelay: '90ms' }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[#60a5fa] font-bold">&gt; 02. match --stages=3</span>
                  <span className="text-[#30d158]">
                    [<MoCount to={pipelineStep >= 2 ? 94 : 0} ms={700} />
                    /100]
                  </span>
                </div>
                <div className="text-[11px] text-[#30d158]">
                  <MoBar value={pipelineStep >= 2 ? 94 : 15} width={18} />
                </div>
              </div>

              <div
                className="mo-pop p-3 bg-[var(--surface-dark-elevated)] border border-white/10 space-y-1"
                style={{ animationDelay: '180ms' }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[#60a5fa] font-bold">&gt; 03. tailor --verify</span>
                  <span className="text-[#30d158]">
                    {pipelineStep >= 3 ? (
                      <MoDecode text="[0 UNSUPPORTED]" frames={8} />
                    ) : (
                      <MoSpinner name="braille" />
                    )}
                  </span>
                </div>
                <p className="text-[var(--on-dark-mute)]">
                  Retained all Work &amp; Projects -&gt; compiled single-column ATS PDF
                </p>
              </div>

              <div
                className="mo-pop p-3 bg-[var(--surface-dark-elevated)] border border-white/10 space-y-1"
                style={{ animationDelay: '270ms' }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[#60a5fa] font-bold">&gt; 04. autofill --review</span>
                  <span className="text-[#ff9f0a]">
                    {pipelineStep >= 4 ? (
                      <MoDecode text="[PAUSED FOR USER]" frames={8} />
                    ) : (
                      <MoSpinner name="bounce" />
                    )}
                  </span>
                </div>
                <p className="text-[var(--on-dark-mute)]">
                  Greenhouse / Lever / Ashby / Workday / Naukri — awaiting your click
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Core Capabilities Grid with mo-pop stagger */}
        <section id="features" className="space-y-6 border-t border-[var(--hairline)] pt-14">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="space-y-1">
              <p className="text-xs font-bold uppercase tracking-wider text-[var(--mute)]">
                // ARCHITECTURE &amp; CAPABILITIES
              </p>
              <h2 className="text-2xl font-bold text-[var(--ink)]">
                Everything you need from discovery to offer letter
              </h2>
            </div>
            {!signedInEmail ? (
              <Link href="/login?mode=signup">
                <Button variant="secondary" size="sm" className="mo-arrow">
                  Get Started Free
                </Button>
              </Link>
            ) : null}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 border border-[var(--hairline)] bg-[var(--surface-card)]">
            {CAPABILITIES.map((item, idx) => (
              <div
                key={item.code}
                style={{ animationDelay: `${idx * 65}ms` }}
                className="mo-pop p-6 border-b border-r border-[var(--hairline)] space-y-2.5 bg-[var(--canvas)] hover:bg-[var(--surface-soft)] transition-colors"
              >
                <div className="text-xs font-bold text-[var(--accent-text)]">{item.code}</div>
                <h3 className="text-base font-bold text-[var(--ink)]">{item.title}</h3>
                <p className="text-xs text-[var(--body)] leading-relaxed">{item.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Supported Platforms & Providers Strip */}
        <section
          id="platforms"
          className="grid grid-cols-1 lg:grid-cols-2 gap-6 border-t border-[var(--hairline)] pt-14"
        >
          <div className="border border-[var(--hairline)] bg-[var(--surface-soft)] p-6 space-y-3">
            <p className="text-xs font-bold uppercase tracking-wider text-[var(--ink)]">
              [+] Official Feeds &amp; ATS Form Autofill
            </p>
            <p className="text-xs text-[var(--body)] leading-relaxed">
              Server-side discovery crawls official public JSON endpoints only (
              <strong>
                Greenhouse, Lever, Ashby, Workable, Adzuna India, Jooble, Remotive, Arbeitnow,
                RemoteOK
              </strong>
              ). Non-API portals (
              <strong>Naukri, Internshala, LinkedIn, Foundit, Instahyre, Wellfound</strong>) are
              never scraped server-side—they run strictly opt-in inside your logged-in Chrome
              extension session.
            </p>
          </div>

          <div className="border border-[var(--hairline)] bg-[var(--surface-soft)] p-6 space-y-3">
            <p className="text-xs font-bold uppercase tracking-wider text-[var(--ink)]">
              [+] Provider-Agnostic AI (OpenAI · Gemini · Meta Llama)
            </p>
            <p className="text-xs text-[var(--body)] leading-relaxed">
              Switch between <strong>OpenAI</strong>, <strong>Google Gemini</strong>, and{' '}
              <strong>Meta Llama API</strong> (<code>https://api.llama.com/compat/v1/</code>) with
              zero code changes. Bring your own API key in Settings, test live model lists with one
              click, and inspect token/latency/cost telemetry for every call.
            </p>
          </div>
        </section>

        {/* Bottom CTA Banner */}
        <section className="border border-[var(--hairline-strong)] bg-[var(--surface-card)] p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <JobPilotLogo size={42} />
            <div className="space-y-1">
              <h2 className="text-lg font-bold text-[var(--ink)]">
                Ready to launch your JobPilot workspace?
              </h2>
              <p className="text-xs text-[var(--body)]">
                Sign in with Google, email/password, or passwordless magic link.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {signedInEmail ? (
              <Link href="/jobs">
                <Button variant="primary" className="mo-arrow">
                  Open Job Feed
                </Button>
              </Link>
            ) : (
              <>
                <Link href="/login?mode=signin">
                  <Button variant="secondary">Log in</Button>
                </Link>
                <Link href="/login?mode=signup">
                  <Button variant="primary" className="mo-arrow">
                    Sign up
                  </Button>
                </Link>
              </>
            )}
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--hairline)] py-6 px-4 sm:px-8 max-w-[1200px] w-full mx-auto flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--mute)]">
        <div className="flex items-center gap-2">
          <JobPilotLogo size={18} />
          <span>JobPilot // Open-Source AI Job Search &amp; Application Assistant</span>
        </div>
        <span>Built with Next.js · Fastify · Supabase pgvector · WXT MV3</span>
      </footer>
    </div>
  );
}
