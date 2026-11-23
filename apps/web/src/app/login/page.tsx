'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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

export default function LoginPage() {
  const router = useRouter();
  const supabaseReady = isSupabaseConfigured();

  const [mode, setMode] = useState<'signin' | 'signup' | 'magic'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        router.replace('/profile');
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
      if (mode === 'magic') {
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
          router.replace('/onboarding');
        } else {
          setInfoMsg('Account created. Verify your email, then sign in.');
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password
        });
        if (error) throw error;
        router.replace('/profile');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--canvas)] text-[var(--ink)] flex flex-col">
      <header className="h-14 border-b border-[var(--hairline)] px-4 sm:px-8 flex items-center justify-between">
        <Link href="/" className="no-underline">
          <AsciiWordmark />
        </Link>
        <ThemeQuickToggle />
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
                ? 'Sign in to JobPilot'
                : mode === 'signup'
                  ? 'Create JobPilot account'
                  : 'Passwordless Magic Link'
            }
            description="Your profile, resumes, and encrypted BYOK keys are protected by Postgres RLS."
          >
            <div className="space-y-4 mb-5">
              <Button
                type="button"
                variant="secondary"
                className="w-full justify-center font-bold border-[var(--hairline-strong)]"
                disabled={oauthLoading || loading}
                onClick={() => void handleGoogleSignIn()}
              >
                {oauthLoading ? '[G] Redirecting to Google...' : '[G] Continue with Google'}
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
                  { id: 'signin', label: 'Sign in' },
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

              {mode !== 'magic' ? (
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
                    ? 'Sign in'
                    : mode === 'signup'
                      ? 'Create account'
                      : 'Send magic link'}
              </Button>
            </form>
          </SectionBlock>
        </div>
      </main>
    </div>
  );
}
