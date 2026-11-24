'use client';

import React from 'react';
import type { AtsScoreReport } from '@jobpilot/shared';
import { MoBar, MoCount } from '@/components/ui/mo';
import { Badge } from '@/components/ui/primitives';

export function AtsScorePanel({ report }: { report: AtsScoreReport }) {
  const scoreTone =
    report.overallScore >= 75
      ? 'text-[var(--success-text)]'
      : report.overallScore >= 50
        ? 'text-[var(--warning-text)]'
        : 'text-[var(--danger-text)]';

  return (
    <div className="space-y-5">
      {/* Top 4-cell KPI readout */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="border border-[var(--hairline-strong)] bg-[var(--surface-soft)] p-3 space-y-1">
          <span className="text-[11px] text-[var(--mute)] block">Overall ATS</span>
          <strong className={`text-xl font-bold tabular-nums ${scoreTone}`}>
            <MoCount to={report.overallScore} />%
          </strong>
          <div className="text-[11px] text-[var(--ink)]">
            <MoBar value={report.overallScore} width={12} />
          </div>
        </div>
        <div className="border border-[var(--hairline)] bg-[var(--surface-soft)] p-3 space-y-1">
          <span className="text-[11px] text-[var(--mute)] block">Must-Have Match</span>
          <strong className="text-xl font-bold tabular-nums text-[var(--ink)]">
            <MoCount to={report.mustHaveCoverage} />%
          </strong>
          <div className="text-[11px] text-[var(--mute)]">
            {report.matchedMustHave.length}/
            {report.matchedMustHave.length + report.missingMustHave.length} core skills
          </div>
        </div>
        <div className="border border-[var(--hairline)] bg-[var(--surface-soft)] p-3 space-y-1">
          <span className="text-[11px] text-[var(--mute)] block">Keywords Match</span>
          <strong className="text-xl font-bold tabular-nums text-[var(--ink)]">
            <MoCount to={report.keywordScore} />%
          </strong>
          <div className="text-[11px] text-[var(--mute)]">
            {report.matchedKeywords.length + report.matchedNiceToHave.length} matched
          </div>
        </div>
        <div className="border border-[var(--hairline)] bg-[var(--surface-soft)] p-3 space-y-1">
          <span className="text-[11px] text-[var(--mute)] block">Impact &amp; Metrics</span>
          <strong className="text-xl font-bold tabular-nums text-[var(--ink)]">
            <MoCount to={report.impactScore} />%
          </strong>
          <div className="text-[11px] text-[var(--mute)]">
            {report.sectionQuality.quantifiedBullets}/{report.sectionQuality.totalBullets} quantified
          </div>
        </div>
      </div>

      {/* Matched & Missing Skills */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
        <div className="border border-[var(--hairline)] p-3.5 space-y-2.5 bg-[var(--canvas)]">
          <div className="flex items-center justify-between">
            <strong className="uppercase tracking-wider text-[var(--ink)]">
              Matched Must-Have &amp; Keywords
            </strong>
            <Badge tone="success">
              {report.matchedMustHave.length + report.matchedKeywords.length}
            </Badge>
          </div>
          {report.matchedMustHave.length === 0 && report.matchedKeywords.length === 0 ? (
            <p className="text-[var(--mute)]">No matching skills flagged from JD.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {report.matchedMustHave.map((s) => (
                <Badge key={`mm-${s}`} tone="success">
                  [x] {s}
                </Badge>
              ))}
              {report.matchedKeywords.map((k) => (
                <Badge key={`mk-${k}`} tone="neutral">
                  {k}
                </Badge>
              ))}
            </div>
          )}
        </div>

        <div className="border border-[var(--hairline)] p-3.5 space-y-2.5 bg-[var(--canvas)]">
          <div className="flex items-center justify-between">
            <strong className="uppercase tracking-wider text-[var(--ink)]">
              Missing From Resume
            </strong>
            <Badge tone={report.missingMustHave.length > 0 ? 'warning' : 'neutral'}>
              {report.missingMustHave.length + report.missingNiceToHave.length}
            </Badge>
          </div>
          {report.missingMustHave.length === 0 && report.missingNiceToHave.length === 0 ? (
            <p className="text-[var(--success-text)]">All extracted required skills covered.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {report.missingMustHave.map((s) => (
                <Badge key={`miss-${s}`} tone="danger">
                  [!] {s}
                </Badge>
              ))}
              {report.missingNiceToHave.map((s) => (
                <Badge key={`nice-${s}`} tone="warning">
                  {s}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Parseability Checks */}
      <div className="border border-[var(--hairline)] bg-[var(--canvas)]">
        <div className="px-4 py-2.5 border-b border-[var(--hairline)] bg-[var(--surface-soft)] flex items-center justify-between text-xs">
          <strong className="uppercase tracking-wider text-[var(--ink)]">
            ATS Parseability Audit ({report.parseabilityScore}%)
          </strong>
          <span className="text-[var(--mute)]">
            {report.sectionQuality.strongVerbBullets}/{report.sectionQuality.totalBullets} strong verb bullets · avg {report.sectionQuality.avgBulletLength} chars
          </span>
        </div>
        <ul className="divide-y divide-[var(--hairline)] text-xs">
          {report.parseabilityChecks.map((chk) => (
            <li
              key={chk.id}
              className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2"
            >
              <div>
                <span className="font-bold text-[var(--ink)]">{chk.label}</span>
                <span className="text-[var(--mute)] ml-2">— {chk.detail}</span>
              </div>
              <Badge
                tone={
                  chk.status === 'pass'
                    ? 'success'
                    : chk.status === 'warn'
                      ? 'warning'
                      : 'danger'
                }
              >
                {chk.status.toUpperCase()}
              </Badge>
            </li>
          ))}
        </ul>
      </div>

      {report.recommendations.length > 0 ? (
        <div className="border border-[var(--hairline)] bg-[var(--surface-soft)] p-4 space-y-2 text-xs">
          <strong className="uppercase tracking-wider text-[var(--ink)] block">
            Actionable Fixes (Master-Grounded Only)
          </strong>
          <ul className="list-disc pl-5 space-y-1 text-[var(--body)]">
            {report.recommendations.map((rec, i) => (
              <li key={`rec-${i}`}>{rec}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
