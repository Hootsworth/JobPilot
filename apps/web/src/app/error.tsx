'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { Button, JobPilotLogo } from '@/components/ui/primitives';

export default function GlobalErrorPage({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Unhandled workspace error:', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-[var(--canvas)] text-[var(--ink)] flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md border border-[var(--hairline)] bg-[var(--surface-soft)] p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <JobPilotLogo size={24} />
          <span className="text-sm font-bold tracking-wide">JOBPILOT</span>
        </div>
        <div className="space-y-1.5">
          <h1 className="text-lg font-bold text-[var(--ink)]">Something went wrong</h1>
          <p className="text-xs text-[var(--body)] leading-relaxed">
            {error.message || 'An unexpected error interrupted this view.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <Button variant="primary" size="sm" onClick={() => reset()}>
            Try again
          </Button>
          <Link href="/">
            <Button variant="secondary" size="sm">
              Back to Home
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
