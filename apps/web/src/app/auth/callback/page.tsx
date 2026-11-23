'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertBanner, AsciiWordmark, Button, SectionBlock } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { getSupabaseClient } from '@/lib/supabase';

function AuthCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function completeAuth() {
      const errorDescription =
        searchParams.get('error_description') || searchParams.get('error');
      if (errorDescription) {
        if (active) setErrorMsg(errorDescription);
        return;
      }

      const supabase = getSupabaseClient();
      if (!supabase) {
        if (active) {
          setErrorMsg(
            'Supabase client is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.'
          );
        }
        return;
      }

      const code = searchParams.get('code');
      const { data: initialSessionData } = await supabase.auth.getSession();

      if (!initialSessionData.session && code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          // Check once more in case detectSessionInUrl already consumed the code
          const { data: retryData } = await supabase.auth.getSession();
          if (!retryData.session) {
            if (active) setErrorMsg(error.message);
            return;
          }
        }
      }

      const { data: finalSessionData } = await supabase.auth.getSession();
      if (!finalSessionData.session) {
        if (active) {
          setErrorMsg('No active session received from OAuth provider. Please try signing in again.');
        }
        return;
      }

      try {
        const profile = await api.getProfile();
        if (!active) return;
        if (!profile.onboardingCompletedAt) {
          router.replace('/onboarding');
        } else {
          router.replace('/profile');
        }
      } catch {
        if (active) {
          router.replace('/onboarding');
        }
      }
    }

    void completeAuth();
    return () => {
      active = false;
    };
  }, [router, searchParams]);

  return (
    <div className="min-h-screen bg-[var(--canvas)] text-[var(--ink)] flex flex-col">
      <header className="h-14 border-b border-[var(--hairline)] px-4 sm:px-8 flex items-center justify-between">
        <Link href="/" className="no-underline">
          <AsciiWordmark />
        </Link>
      </header>
      <main className="flex-1 flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-md">
          <SectionBlock
            title="Completing Authentication"
            description="Verifying your session with Supabase Auth and Postgres RLS..."
          >
            {errorMsg ? (
              <div className="space-y-4">
                <AlertBanner tone="error" title="Sign-in error" message={errorMsg} />
                <Link href="/login">
                  <Button variant="primary">Back to Sign In -&gt;</Button>
                </Link>
              </div>
            ) : (
              <p className="text-xs text-[var(--mute)]">
                [*] Finalizing sign-in and loading your JobPilot workspace...
              </p>
            )}
          </SectionBlock>
        </div>
      </main>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[var(--canvas)] text-[var(--ink)] flex items-center justify-center p-8 text-xs text-[var(--mute)]">
          [*] Verifying authentication callback...
        </div>
      }
    >
      <AuthCallbackInner />
    </Suspense>
  );
}
