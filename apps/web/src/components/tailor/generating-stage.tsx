'use client';

import React, { useEffect, useState } from 'react';
import { MoSpinner } from '@/components/ui/mo';

interface GeneratingStageProps {
  heading: string;
  targetLabel: string;
  subtitle?: string;
  steps: string[];
}

export function GeneratingStage({
  heading,
  targetLabel,
  subtitle,
  steps
}: GeneratingStageProps) {
  const [activeStep, setActiveStep] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    setActiveStep(0);
    setElapsedSec(0);

    const stepTimer = setInterval(() => {
      setActiveStep((prev) => (prev < Math.max(steps.length - 1, 0) ? prev + 1 : prev));
    }, 2400);

    const clockTimer = setInterval(() => {
      setElapsedSec((prev) => prev + 1);
    }, 1000);

    return () => {
      clearInterval(stepTimer);
      clearInterval(clockTimer);
    };
  }, [steps.length, targetLabel]);

  const progressPct = Math.min(
    92,
    Math.round(((activeStep + 1) / Math.max(steps.length, 1)) * 90)
  );

  return (
    <section
      role="status"
      aria-live="polite"
      className="min-h-[62vh] border border-[var(--hairline)] bg-[var(--surface-card)] flex items-center justify-center p-6 sm:p-10"
    >
      <div className="w-full max-w-lg space-y-6">
        <div className="flex items-center justify-between gap-3 text-xs text-[var(--mute)]">
          <span className="inline-flex items-center gap-2 min-w-0">
            <MoSpinner name="braille" className="text-[var(--ink)] shrink-0" />
            <span className="truncate">{targetLabel}</span>
          </span>
          <span className="tabular-nums shrink-0">{elapsedSec}s</span>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[var(--ink)] tracking-tight">{heading}</h2>
          {subtitle ? <p className="text-xs text-[var(--mute)] mt-1">{subtitle}</p> : null}
        </div>

        <div className="h-1 w-full bg-[var(--surface-soft)] overflow-hidden">
          <div
            className="h-full bg-[var(--ink)] transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        <ul className="space-y-2.5 pt-1">
          {steps.map((step, idx) => {
            const completed = idx < activeStep;
            const current = idx === activeStep;
            return (
              <li key={step} className="flex items-center gap-2.5">
                <span className="w-3.5 h-3.5 inline-flex items-center justify-center shrink-0">
                  {completed ? (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      className="text-[var(--mute)]"
                      aria-hidden="true"
                    >
                      <path d="M3.5 8.5L6.5 11.5L12.5 4.5" />
                    </svg>
                  ) : current ? (
                    <MoSpinner name="braille" className="text-[var(--ink)] text-xs" />
                  ) : (
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-[var(--hairline-strong)]"
                      aria-hidden="true"
                    />
                  )}
                </span>
                <span
                  className={
                    current
                      ? 'text-xs font-medium text-[var(--ink)]'
                      : completed
                        ? 'text-xs text-[var(--mute)]'
                        : 'text-xs text-[var(--mute)] opacity-60'
                  }
                >
                  {step}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
