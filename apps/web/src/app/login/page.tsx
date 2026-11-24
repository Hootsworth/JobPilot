'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase';
import { ThemeQuickToggle } from '@/components/theme-toggle';
import {
  AlertBanner,
  AsciiWordmark,
  Button,
  Field,
  Input,
  SectionBlock
} from '@/components/ui/primitives';

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabaseReady = isSupabaseConfigured();

  const initialModeParam = searchParams.get('mode');
  const initialMode: 'signin' | 'signup' | 'magic' | 'forgot' =
    initialModeParam === 'signup'
      ? 'signup'
      : initialModeParam === 'magic'
        ? 'magic'
        : initialModeParam === 'forgot'
          ? 'forgot'
          : 'signin';

  const [mode, setMode] = useState<'signin' | 'signup' | 'magic' | 'forgot'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  useEffect(() => {
    if (
      initialModeParam === 'signup' ||
      initialModeParam === 'signin' ||
      initialModeParam === 'magic' ||
      initialModeParam === 'forgot'
    ) {
      setMode(initialModeParam);
    }
  }, [initialModeParam]);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        router.replace('/');
      }
    });
  }, [router]);

  const handleGoogleSignIn = async () => {
    setErrorMsg(null);
    setInfoMsg(null);

    const supabase = getSupabaseClient();
    if (!supabase) {
      setErrorMsg(
        'Supabase env vars are missing. Configure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY first.'
      );
      return;
    }

    setOauthLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`
        }
      });
      if (error) throw error;
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Google sign-in failed.');
      setOauthLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);

    const supabase = getSupabaseClient();
    if (!supabase) {
      setErrorMsg(
        'Supabase env vars are missing. Configure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY first.'
      );
      return;
    }

    setLoading(true);
    try {
      if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset-password`
        });
        if (error) throw error;
        setInfoMsg('Password reset link sent. Check your inbox and spam folder.');
      } else if (mode === 'magic') {
        const { error } = await supabase.auth.signInWithOtp({
          email: email.trim(),
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`
          }
        });
        if (error) throw error;
        setInfoMsg('Magic sign-in link sent. Check your inbox and spam folder.');
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
            data: { full_name: fullName.trim() }
          }
        });
        if (error) throw error;
        if (data.session) {
          router.replace('/profile');
        } else {
          setInfoMsg('Account created. Verify your email, then sign in.');
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password
        });
        if (error) throw error;
        router.replace('/');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--canvas)] text-[var(--ink)] flex flex-col">
      <header className="h-14 border-b border-[var(--hairline)] px-4 sm:px-8 flex items-center justify-between max-w-[1200px] w-full mx-auto">
        <Link href="/" className="no-underline">
          <AsciiWordmark />
        </Link>
        <div className="flex items-center gap-3">
          <Link href="/" className="text-xs text-[var(--mute)] hover:text-[var(--ink)] no-underline">
            ← Home
          </Link>
          <ThemeQuickToggle />
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-md space-y-6">
          {!supabaseReady ? (
            <AlertBanner
              tone="warning"
              title="Supabase env vars required"
              message="Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (sb_publishable_...) to apps/web/.env.local."
            />
          ) : null}

          <SectionBlock
            title={
              mode === 'signin'
                ? 'Log in to JobPilot'
                : mode === 'signup'
                  ? 'Create JobPilot account'
                  : mode === 'forgot'
                    ? 'Reset your password'
                    : 'Passwordless Magic Link'
            }
            description={
              mode === 'forgot'
                ? 'Enter your account email and we will send you a password reset link.'
                : 'Your profile, resumes, and encrypted BYOK keys are protected by Postgres RLS.'
            }
          >
            {mode !== 'forgot' ? (
              <>
                <div className="space-y-4 mb-5">
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full justify-center font-bold border-[var(--hairline-strong)]"
                    disabled={oauthLoading || loading}
                    onClick={() => void handleGoogleSignIn()}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden="true"
                    >
                      <path d="M21 12.2c0-.7-.1-1.4-.2-2H12v3.8h5a4.3 4.3 0 0 1-1.9 2.8v2.3h3c1.8-1.6 2.9-4 2.9-6.9z" />
                      <path d="M12 21.4c2.6 0 4.8-.9 6.4-2.3l-3-2.3c-.9.6-2 .9-3.4.9-2.6 0-4.8-1.8-5.6-4.1H3.3v2.4A9.4 9.4 0 0 0 12 21.4z" />
                      <path d="M6.4 13.6a5.6 5.6 0 0 1 0-3.2V8H3.3a9.4 9.4 0 0 0 0 8l3.1-2.4z" />
                      <path d="M12 6.3c1.4 0 2.7.5 3.7 1.4l2.8-2.8A9.4 9.4 0 0 0 3.3 8l3.1 2.4c.8-2.3 3-4.1 5.6-4.1z" />
                    </svg>
                    <span>{oauthLoading ? 'Redirecting to Google...' : 'Continue with Google'}</span>
                  </Button>

                  <div className="flex items-center gap-3 text-[11px] uppercase tracking-wider text-[var(--mute)]">
                    <span className="flex-1 border-t border-[var(--hairline)]" />
                    <span>or continue with email</span>
                    <span className="flex-1 border-t border-[var(--hairline)]" />
                  </div>
                </div>

                <div className="flex border-b border-[var(--hairline)] mb-5 -mt-1">
                  {(
                    [
                      { id: 'signin', label: 'Log in' },
                      { id: 'signup', label: 'Sign up' },
                      { id: 'magic', label: 'Magic link' }
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => {
                        setMode(tab.id);
                        setErrorMsg(null);
                        setInfoMsg(null);
                      }}
                      className={`px-3 py-2 text-xs font-medium border-b-2 cursor-pointer ${
                        mode === tab.id
                          ? 'border-[var(--ink)] text-[var(--ink)]'
                          : 'border-transparent text-[var(--mute)] hover:text-[var(--ink)]'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            <form onSubmit={handleSubmit} className="space-y-4">
              {errorMsg ? <AlertBanner tone="error" message={errorMsg} /> : null}
              {infoMsg ? <AlertBanner tone="success" message={infoMsg} /> : null}

              {mode === 'signup' ? (
                <Field label="Full name" htmlFor="auth-fullname" required>
                  {(props) => (
                    <Input
                      {...props}
                      type="text"
                      name="fullName"
                      autoComplete="name"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Ananya Sharma"
                    />
                  )}
                </Field>
              ) : null}

              <Field
                label="Email address"
                htmlFor="auth-email"
                hint="Format: you@example.com"
                required
              >
                {(props) => (
                  <Input
                    {...props}
                    type="email"
                    name="email"
                    autoComplete="username"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@college.ac.in"
                  />
                )}
              </Field>

              {mode === 'signin' || mode === 'signup' ? (
                <div className="space-y-1.5">
                  <Field
                    label="Password"
                    htmlFor="auth-password"
                    hint={mode === 'signup' ? 'Minimum 8 characters' : undefined}
                    required
                  >
                    {(props) => (
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <Input
                            {...props}
                            type={showPassword ? 'text' : 'password'}
                            name="password"
                            autoComplete={
                              mode === 'signup' ? 'new-password' : 'current-password'
                            }
                            minLength={8}
                            required
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                          />
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            aria-pressed={showPassword}
                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                            onClick={() => setShowPassword((v) => !v)}
                          >
                            {showPassword ? 'Hide' : 'Show'}
                          </Button>
                        </div>
                        <span className="visually-hidden">
                          Toggling Show reveals your password on screen.
                        </span>
                      </div>
                    )}
                  </Field>
                  {mode === 'signin' ? (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          setMode('forgot');
                          setErrorMsg(null);
                          setInfoMsg(null);
                        }}
                        className="text-xs text-[var(--mute)] hover:text-[var(--ink)] cursor-pointer"
                      >
                        Forgot password?
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <Button
                type="submit"
                variant="primary"
                className="w-full"
                disabled={loading || oauthLoading}
              >
                {loading
                  ? 'Working...'
                  : mode === 'signin'
                    ? 'Log in'
                    : mode === 'signup'
                      ? 'Create account'
                      : mode === 'forgot'
                        ? 'Send reset link'
                        : 'Send magic link'}
              </Button>

              {mode === 'forgot' ? (
                <div className="text-center pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('signin');
                      setErrorMsg(null);
                      setInfoMsg(null);
                    }}
                    className="text-xs text-[var(--mute)] hover:text-[var(--ink)] cursor-pointer"
                  >
                    Back to log in
                  </button>
                </div>
              ) : null}
            </form>
          </SectionBlock>

          <p className="text-center text-xs text-[var(--mute)]">
            By continuing, you agree to our{' '}
            <Link href="/terms" className="text-[var(--ink)] underline">
              Terms
            </Link>{' '}
            and{' '}
            <Link href="/privacy" className="text-[var(--ink)] underline">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </main>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[var(--canvas)] text-[var(--ink)] flex items-center justify-center p-8 text-xs text-[var(--mute)]">
          Loading authentication...
        </div>
      }
    >
      <LoginInner />
    </Suspense>
  );
}
