import React from 'react';
import Link from 'next/link';
import { Button, JobPilotLogo } from '@/components/ui/primitives';

export default function NotFoundPage() {
  return (
    <div className="min-h-screen bg-[var(--canvas)] text-[var(--ink)] flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md border border-[var(--hairline)] bg-[var(--surface-soft)] p-6 space-y-4">
        <div className="flex items-center gap-2.5">
          <JobPilotLogo size={24} />
          <span className="text-sm font-bold tracking-wide">JOBPILOT</span>
        </div>
        <div className="space-y-1.5">
          <h1 className="text-lg font-bold text-[var(--ink)]">Page not found</h1>
          <p className="text-xs text-[var(--body)] leading-relaxed">
            The page you requested does not exist or has moved.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <Link href="/">
            <Button variant="primary" size="sm">
              Back to Home
            </Button>
          </Link>
          <Link href="/jobs">
            <Button variant="secondary" size="sm">
              Browse Jobs
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
