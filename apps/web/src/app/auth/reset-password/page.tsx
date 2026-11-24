'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ThemeQuickToggle } from '@/components/theme-toggle';
import {
  AlertBanner,
  AsciiWordmark,
  Button,
  Field,
  Input,
  SectionBlock
} from '@/components/ui/primitives';
import { getSupabaseClient } from '@/lib/supabase';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setChecking(false);
      return;
    }

    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setHasSession(Boolean(data.session));
      setChecking(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        setHasSession(Boolean(session));
        setChecking(false);
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setDoneMsg(null);

    if (password.length < 8) {
      setErrorMsg('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      setErrorMsg('Authentication is not configured.');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setDoneMsg('Password updated. Redirecting to your workspace...');
      setTimeout(() => {
        router.replace('/');
      }, 900);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to update password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--canvas)] text-[var(--ink)] flex flex-col">
      <header className="h-14 border-b border-[var(--hairline)] px-4 sm:px-8 flex items-center justify-between max-w-[1200px] w-full mx-auto">
        <Link href="/" className="no-underline">
          <AsciiWordmark />
        </Link>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="text-xs text-[var(--mute)] hover:text-[var(--ink)] no-underline"
          >
            ← Log in
          </Link>
          <ThemeQuickToggle />
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-md space-y-6">
          <SectionBlock
            title="Set a new password"
            description="Choose a strong password of at least 8 characters for your JobPilot account."
          >
            {checking ? (
              <p className="text-xs text-[var(--mute)]">Verifying recovery session...</p>
            ) : !hasSession ? (
              <div className="space-y-4">
                <AlertBanner
                  tone="warning"
                  title="Recovery session expired"
                  message="Open the reset link from your email again or request a new password reset link."
                />
                <Link href="/login?mode=forgot">
                  <Button variant="primary" className="w-full">
                    Request new reset link
                  </Button>
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {errorMsg ? <AlertBanner tone="error" message={errorMsg} /> : null}
                {doneMsg ? <AlertBanner tone="success" message={doneMsg} /> : null}

                <Field label="New password" htmlFor="reset-password" hint="Minimum 8 characters" required>
                  {(props) => (
                    <div className="flex gap-2">
                      <Input
                        {...props}
                        type={showPassword ? 'text' : 'password'}
                        name="new-password"
                        autoComplete="new-password"
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
                        onClick={() => setShowPassword((v) => !v)}
                      >
                        {showPassword ? 'Hide' : 'Show'}
                      </Button>
                    </div>
                  )}
                </Field>

                <Field label="Confirm new password" htmlFor="reset-confirm-password" required>
                  {(props) => (
                    <Input
                      {...props}
                      type={showPassword ? 'text' : 'password'}
                      name="confirm-password"
                      autoComplete="new-password"
                      minLength={8}
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                  )}
                </Field>

                <Button type="submit" variant="primary" className="w-full" disabled={saving}>
                  {saving ? 'Updating...' : 'Update password'}
                </Button>
              </form>
            )}
          </SectionBlock>
        </div>
      </main>
    </div>
  );
}
