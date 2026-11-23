'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import type {
  ApplicationRecord,
  MasterProfile,
  ResumeVersionRecord
} from '@jobpilot/shared';
import { AppShell } from '@/components/layout/app-shell';
import { ThemeQuickToggle } from '@/components/theme-toggle';
import {
  AsciiWordmark,
  Badge,
  Button,
  SectionBlock,
  SkeletonBlock
} from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { getSupabaseClient } from '@/lib/supabase';

export default function HomePage() {
  const [authState, setAuthState] = useState<'checking' | 'signed_in' | 'signed_out'>('checking');
  const [profile, setProfile] = useState<MasterProfile | null>(null);
  const [applications, setApplications] = useState<ApplicationRecord[]>([]);
  const [resumeVersions, setResumeVersions] = useState<ResumeVersionRecord[]>([]);
  const [jobsTotal, setJobsTotal] = useState<number>(0);
  const [loadingData, setLoadingData] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setAuthState('signed_out');
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setAuthState('signed_in');
      } else {
        setAuthState('signed_out');
      }
    });
  }, []);

  useEffect(() => {
    if (authState !== 'signed_in') return;
    let active = true;
    setLoadingData(true);
    Promise.allSettled([
      api.getProfile(),
      api.listApplications(),
      api.listResumeVersions(),
      api.listJobs({ limit: 5 })
    ])
      .then(([profRes, appsRes, verRes, jobsRes]) => {
        if (!active) return;
        if (profRes.status === 'fulfilled') setProfile(profRes.value);
        if (appsRes.status === 'fulfilled') setApplications(appsRes.value.items);
        if (verRes.status === 'fulfilled') setResumeVersions(verRes.value);
        if (jobsRes.status === 'fulfilled') setJobsTotal(jobsRes.value.total);
      })
      .finally(() => {
        if (active) setLoadingData(false);
      });
    return () => {
      active = false;
    };
  }, [authState]);

  if (authState === 'checking') {
    return (
      <div className="min-h-screen bg-[var(--canvas)] text-[var(--ink)] flex items-center justify-center p-8 text-xs text-[var(--mute)]">
        Loading JobPilot...
      </div>
    );
  }

  // Signed-in workspace command center (no Onboarding clutter)
  if (authState === 'signed_in') {
    const workCount = profile?.jsonResume.work.length ?? 0;
    const eduCount = profile?.jsonResume.education.length ?? 0;
    const projCount = profile?.jsonResume.projects.length ?? 0;
    const skillCount =
      profile?.jsonResume.skills.reduce((sum, g) => sum + g.keywords.length, 0) ?? 0;

    const appliedCount = applications.filter((a) => a.status === 'applied').length;
    const interviewCount = applications.filter((a) => a.status === 'interview').length;
    const offerCount = applications.filter((a) => a.status === 'offer').length;

    return (
      <AppShell
        title={
          profile?.fullName
            ? `Workspace // ${profile.fullName}`
            : 'Workspace Overview'
        }
        subtitle="Search matched jobs, generate grounded ATS-safe PDF resumes, and track applications."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/jobs">
              <Button variant="primary">Open Job Feed -&gt;</Button>
            </Link>
            <Link href="/tailor">
              <Button variant="secondary">Tailor Resume</Button>
            </Link>
            <Link href="/tracker">
              <Button variant="secondary">Tracker</Button>
            </Link>
          </div>
        }
      >
        {loadingData ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <SkeletonBlock className="h-28 w-full" />
            <SkeletonBlock className="h-28 w-full" />
            <SkeletonBlock className="h-28 w-full" />
            <SkeletonBlock className="h-28 w-full" />
          </div>
        ) : (
          <>
            {/* Top KPI Strip */}
            <div className="grid grid-cols-2 lg:grid-cols-4 border border-[var(--hairline)] bg-[var(--surface-card)]">
              <Link
                href="/jobs"
                className="p-4 border-b lg:border-b-0 border-r border-[var(--hairline)] no-underline hover:bg-[var(--surface-soft)] transition-colors"
              >
                <div className="text-xs text-[var(--mute)] uppercase tracking-wider">
                  [1] Matched Job Feed
                </div>
                <div className="text-2xl font-bold text-[var(--ink)] tabular-nums mt-1">
                  {jobsTotal}
                </div>
                <div className="text-xs text-[var(--body)] mt-1">
                  Active roles indexed -&gt;
                </div>
              </Link>

              <Link
                href="/tracker"
                className="p-4 border-b lg:border-b-0 lg:border-r border-[var(--hairline)] no-underline hover:bg-[var(--surface-soft)] transition-colors"
              >
                <div className="text-xs text-[var(--mute)] uppercase tracking-wider">
                  [2] Application Pipeline
                </div>
                <div className="text-2xl font-bold text-[var(--ink)] tabular-nums mt-1">
                  {applications.length}
                </div>
                <div className="text-xs text-[var(--body)] mt-1">
                  {appliedCount} applied · {interviewCount} interview · {offerCount} offer
                </div>
              </Link>

              <Link
                href="/tailor"
                className="p-4 border-r border-[var(--hairline)] no-underline hover:bg-[var(--surface-soft)] transition-colors"
              >
                <div className="text-xs text-[var(--mute)] uppercase tracking-wider">
                  [3] Tailored PDFs
                </div>
                <div className="text-2xl font-bold text-[var(--ink)] tabular-nums mt-1">
                  {resumeVersions.length}
                </div>
                <div className="text-xs text-[var(--body)] mt-1">
                  Verified ATS versions -&gt;
                </div>
              </Link>

              <Link
                href="/profile"
                className="p-4 no-underline hover:bg-[var(--surface-soft)] transition-colors"
              >
                <div className="text-xs text-[var(--mute)] uppercase tracking-wider">
                  [4] Master Profile (v{profile?.activeProfileVersion ?? 1})
                </div>
                <div className="text-2xl font-bold text-[var(--ink)] tabular-nums mt-1">
                  {workCount + projCount + eduCount}
                </div>
                <div className="text-xs text-[var(--body)] mt-1">
                  {workCount} work · {projCount} proj · {eduCount} edu · {skillCount} skills
                </div>
              </Link>
            </div>

            {/* Two-column workspace summary */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <SectionBlock
                title="Recent Tracked Applications"
                description="Roles saved from the Job Feed, captured via the Chrome extension, or logged manually."
                action={
                  <Link href="/tracker">
                    <Button variant="secondary" size="sm">
                      Open Tracker -&gt;
                    </Button>
                  </Link>
                }
              >
                {applications.length === 0 ? (
                  <div className="text-xs text-[var(--mute)] space-y-3">
                    <p>No applications tracked yet.</p>
                    <div className="flex flex-wrap gap-2">
                      <Link href="/jobs">
                        <Button variant="secondary" size="sm">
                          Browse Jobs
                        </Button>
                      </Link>
                      <Link href="/tracker">
                        <Button variant="secondary" size="sm">
                          Log Application
                        </Button>
                      </Link>
                    </div>
                  </div>
                ) : (
                  <ul className="divide-y divide-[var(--hairline)] text-xs">
                    {applications.slice(0, 5).map((app) => (
                      <li
                        key={app.id}
                        className="py-2.5 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <p className="font-bold text-[var(--ink)] truncate">
                            {app.job.companyName} — {app.job.title}
                          </p>
                          <p className="text-[var(--mute)] truncate">
                            {app.resumeVersion
                              ? `Resume v${app.resumeVersion.versionNumber} · ${app.resumeVersion.label}`
                              : 'No tailored resume linked'}
                          </p>
                        </div>
                        <Badge tone="neutral">{app.status.toUpperCase()}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionBlock>

              <SectionBlock
                title="Recent Tailored Resumes"
                description="Grounded strictly in your Master Profile with dual faithfulness verification."
                action={
                  <Link href="/tailor">
                    <Button variant="secondary" size="sm">
                      Tailor New Resume -&gt;
                    </Button>
                  </Link>
                }
              >
                {resumeVersions.length === 0 ? (
                  <div className="text-xs text-[var(--mute)] space-y-3">
                    <p>No tailored resume versions generated yet.</p>
                    <Link href="/tailor">
                      <Button variant="secondary" size="sm">
                        Create First Tailored PDF
                      </Button>
                    </Link>
                  </div>
                ) : (
                  <ul className="divide-y divide-[var(--hairline)] text-xs">
                    {resumeVersions.slice(0, 5).map((ver) => (
                      <li
                        key={ver.id}
                        className="py-2.5 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <p className="font-bold text-[var(--ink)] truncate">
                            v{ver.versionNumber} · {ver.label}
                          </p>
                          <p className="text-[var(--mute)]">
                            Template: {ver.templateId} ·{' '}
                            {new Date(ver.createdAt).toLocaleDateString('en-IN')}
                          </p>
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void api.downloadResumePdf(ver.id)}
                        >
                          Download PDF
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionBlock>
            </div>
          </>
        )}
      </AppShell>
    );
  }

  // Signed-out minimal landing view
  return (
    <div className="min-h-screen bg-[var(--canvas)] text-[var(--ink)] flex flex-col">
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

      <main className="flex-1 max-w-[1100px] w-full mx-auto px-4 sm:px-8 py-12 sm:py-20 space-y-14">
        <section className="space-y-5 max-w-3xl">
          <div className="flex items-center gap-2">
            <Badge tone="dark">v0.1.0</Badge>
            <span className="text-xs text-[var(--mute)]">
              AI job search, grounded resume tailoring &amp; autofill for India + global roles
            </span>
          </div>
          <h1 className="text-3xl sm:text-[36px] font-bold leading-[1.4] text-[var(--ink)]">
            Grounded resume tailoring, India CTC/CGPA autofill, and zero-lock-in AI.
          </h1>
          <p className="text-sm sm:text-base text-[var(--body)] leading-[1.6] max-w-2xl">
            Parse your PDF resume into a structured JSON Resume + India profile, rank jobs with
            local bge-small embeddings, generate verified single-column ATS PDFs, and autofill
            Greenhouse, Lever, Ashby, Workday &amp; Indian portals.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Link href="/login">
              <Button variant="primary">Sign in to Workspace -&gt;</Button>
            </Link>
          </div>
        </section>

        <section className="grid grid-cols-1 sm:grid-cols-3 border border-[var(--hairline)] bg-[var(--surface-card)]">
          <div className="p-5 border-b sm:border-b-0 sm:border-r border-[var(--hairline)] space-y-1.5">
            <p className="text-xs font-bold uppercase tracking-wider text-[var(--ink)]">
              [1] Grounded Profile &amp; PDF Tailor
            </p>
            <p className="text-xs text-[var(--body)]">
              Extracts Education, Projects, Work, Skills &amp; India CTC/CGPA signals. Dual
              verifier blocks unsupported claims before compiling ATS PDFs.
            </p>
          </div>
          <div className="p-5 border-b sm:border-b-0 sm:border-r border-[var(--hairline)] space-y-1.5">
            <p className="text-xs font-bold uppercase tracking-wider text-[var(--ink)]">
              [2] 3-Stage Job Matching
            </p>
            <p className="text-xs text-[var(--body)]">
              Hard India/global filters, local 384-d BGE vector similarity, and provider-agnostic
              LLM re-ranking across OpenAI, Gemini, and Meta Llama.
            </p>
          </div>
          <div className="p-5 space-y-1.5">
            <p className="text-xs font-bold uppercase tracking-wider text-[var(--ink)]">
              [3] MV3 Autofill &amp; Tracker
            </p>
            <p className="text-xs text-[var(--body)]">
              Per-field confidence review gate in Chrome with zero auto-submit, plus pipeline
              stage tracking and follow-up reminders.
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--hairline)] py-5 px-4 sm:px-8 max-w-[1100px] w-full mx-auto flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--mute)]">
        <span>JobPilot // Free &amp; Open-Source</span>
        <span>OpenAI · Gemini · Meta Llama API</span>
      </footer>
    </div>
  );
}
