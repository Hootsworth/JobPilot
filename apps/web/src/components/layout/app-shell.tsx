'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { checkApiHealth } from '@/lib/api';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase';
import { ThemeQuickToggle } from '../theme-toggle';
import { AlertBanner, AsciiWordmark, Badge, Button, cn } from '../ui/primitives';

interface NavItem {
  href: string;
  label: string;
  marker: string;
  ready: boolean;
  phaseNote?: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/onboarding', label: 'Onboarding', marker: '[1]', ready: true },
  { href: '/profile', label: 'Master Profile', marker: '[2]', ready: true },
  { href: '/stories', label: 'Story Bank', marker: '[3]', ready: true },
  { href: '/answers', label: 'Saved Answers', marker: '[4]', ready: true },
  { href: '/settings', label: 'AI & Privacy', marker: '[5]', ready: true },
  { href: '/usage', label: 'LLM Usage', marker: '[6]', ready: true },
  { href: '/jobs', label: 'Job Feed', marker: '[7]', ready: true },
  { href: '/tailor', label: 'Tailor & PDF', marker: '[8]', ready: true },
  { href: '/tracker', label: 'Tracker', marker: '[9]', ready: true }
];

export function AppShell({
  title,
  subtitle,
  actions,
  children
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [apiStatus, setApiStatus] = useState<'checking' | 'online' | 'waking'>('checking');
  const [authChecked, setAuthChecked] = useState(false);

  const supabaseReady = isSupabaseConfigured();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === '?') {
        e.preventDefault();
        setShortcutsOpen((prev) => !prev);
      } else if (e.key === 'Escape' && shortcutsOpen) {
        setShortcutsOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shortcutsOpen]);

  useEffect(() => {
    let mounted = true;
    const supabase = getSupabaseClient();
    if (!supabase) {
      setAuthChecked(true);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (!data.session) {
        router.replace('/login');
      } else {
        setUserEmail(data.session.user.email ?? null);
      }
      setAuthChecked(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      if (!session) {
        router.replace('/login');
      } else {
        setUserEmail(session.user.email ?? null);
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [router]);

  useEffect(() => {
    let active = true;
    checkApiHealth().then((res) => {
      if (active) setApiStatus(res.ok ? 'online' : 'waking');
    });
    return () => {
      active = false;
    };
  }, []);

  const handleSignOut = async () => {
    const supabase = getSupabaseClient();
    await supabase?.auth.signOut();
    router.replace('/login');
  };

  return (
    <div className="min-h-screen flex flex-col bg-[var(--canvas)] text-[var(--ink)]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2 focus:bg-[var(--ink)] focus:text-[var(--on-primary)] focus:text-xs focus:font-bold focus:rounded-[4px]"
      >
        Skip to main content
      </a>
      {/* Top Primary Nav adhering to DESIGN.md */}
      <header className="sticky top-0 z-20 h-14 border-b border-[var(--hairline)] bg-[var(--canvas)] px-4 sm:px-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="lg:hidden min-h-[36px] px-2.5 border border-[var(--hairline)] rounded-[4px] text-xs font-medium cursor-pointer"
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-expanded={mobileMenuOpen}
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? '[x]' : '[=]'}
          </button>
          <Link href="/profile" className="no-underline">
            <AsciiWordmark />
          </Link>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <Badge
            tone={apiStatus === 'online' ? 'success' : apiStatus === 'waking' ? 'warning' : 'neutral'}
            className="hidden sm:inline-flex"
          >
            {apiStatus === 'online'
              ? 'API: ONLINE'
              : apiStatus === 'waking'
                ? 'API: OFFLINE/WAKING'
                : 'API: CHECKING'}
          </Badge>
          <button
            type="button"
            onClick={() => setShortcutsOpen((v) => !v)}
            aria-label="Open keyboard shortcuts guide"
            title="Keyboard shortcuts (?)"
            className="min-h-[32px] px-2.5 text-xs border border-[var(--hairline)] rounded-[4px] bg-[var(--surface-soft)] hover:border-[var(--hairline-strong)] cursor-pointer"
          >
            [?]
          </button>
          <ThemeQuickToggle />
          {userEmail ? (
            <span className="hidden md:inline text-xs text-[var(--mute)] truncate max-w-[200px]">
              {userEmail}
            </span>
          ) : null}
          {supabaseReady && userEmail ? (
            <Button variant="secondary" size="sm" onClick={handleSignOut}>
              Sign out
            </Button>
          ) : null}
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row max-w-[1360px] w-full mx-auto">
        {/* Sidebar Navigation */}
        <aside
          className={cn(
            'lg:w-64 lg:shrink-0 border-b lg:border-b-0 lg:border-r border-[var(--hairline)] bg-[var(--canvas)]',
            mobileMenuOpen ? 'block' : 'hidden lg:block'
          )}
        >
          <nav aria-label="Workspace navigation" className="p-3 space-y-1">
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.href;
              if (!item.ready) {
                return (
                  <div
                    key={item.label}
                    aria-disabled="true"
                    className="flex items-center justify-between px-3 py-2 text-sm text-[var(--ash)] select-none"
                  >
                    <span>
                      <span className="mr-2">{item.marker}</span>
                      {item.label}
                    </span>
                    <span className="text-[11px]">{item.phaseNote}</span>
                  </div>
                );
              }
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    'flex items-center justify-between px-3 py-2.5 text-sm rounded-[4px] border transition-colors no-underline min-h-[42px]',
                    active
                      ? 'bg-[var(--surface-card)] text-[var(--ink)] border-[var(--hairline-strong)] font-medium'
                      : 'bg-transparent text-[var(--body)] border-transparent hover:bg-[var(--surface-soft)] hover:text-[var(--ink)]'
                  )}
                >
                  <span>
                    <span className="text-[var(--mute)] mr-2">{item.marker}</span>
                    {item.label}
                  </span>
                  {active ? <span className="text-xs text-[var(--ink)]">&gt;</span> : null}
                </Link>
              );
            })}
          </nav>

          <div className="px-4 py-3 border-t border-[var(--hairline)] text-xs text-[var(--mute)] space-y-1">
            <p className="font-bold text-[var(--ink)]">[+] Privacy-first</p>
            <p>BYOK keys encrypted AES-256-GCM. Telemetry off by default.</p>
          </div>
        </aside>

        {/* Main Content */}
        <main id="main-content" tabIndex={-1} className="flex-1 p-4 sm:p-8 space-y-6 min-w-0">
          {!supabaseReady ? (
            <AlertBanner
              tone="warning"
              title="Supabase client env vars missing"
              message="Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (sb_publishable_...), and NEXT_PUBLIC_API_URL in apps/web/.env.local to authenticate and persist data."
            />
          ) : null}

          {apiStatus === 'waking' ? (
            <AlertBanner
              tone="warning"
              title="API server unreachable"
              message="Start apps/api (`npm run dev:api`) locally or wait ~30s if waking up Render Free tier."
            />
          ) : null}

          <div className="flex flex-wrap items-start justify-between gap-4 pb-5 border-b border-[var(--hairline)]">
            <div className="space-y-1">
              <h1 className="text-2xl sm:text-[28px] font-bold tracking-tight text-[var(--ink)]">
                {title}
              </h1>
              {subtitle ? <p className="text-sm text-[var(--body)] max-w-2xl">{subtitle}</p> : null}
            </div>
            {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
          </div>

          {!authChecked ? (
            <div className="py-12 text-sm text-[var(--mute)]">Checking session...</div>
          ) : (
            children
          )}
        </main>
      </div>

      {shortcutsOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="shortcuts-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => setShortcutsOpen(false)}
        >
          <div
            className="w-full max-w-lg border border-[var(--hairline-strong)] bg-[var(--surface-card)] p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--hairline)] pb-3">
              <h2 id="shortcuts-dialog-title" className="text-sm font-bold uppercase tracking-wider">
                [?] Keyboard Shortcuts
              </h2>
              <Button variant="secondary" size="sm" onClick={() => setShortcutsOpen(false)}>
                Close [Esc]
              </Button>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between py-1.5 border-b border-[var(--hairline)]">
                <span className="text-[var(--body)]">Toggle this shortcuts cheat-sheet</span>
                <kbd className="px-2 py-0.5 border border-[var(--hairline-strong)] bg-[var(--surface-soft)] font-bold">
                  ?
                </kbd>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-[var(--hairline)]">
                <span className="text-[var(--body)]">Move selection down / up (Job Feed &amp; Tracker)</span>
                <kbd className="px-2 py-0.5 border border-[var(--hairline-strong)] bg-[var(--surface-soft)] font-bold">
                  j / k
                </kbd>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-[var(--hairline)]">
                <span className="text-[var(--body)]">Focus search bar (Job Feed)</span>
                <kbd className="px-2 py-0.5 border border-[var(--hairline-strong)] bg-[var(--surface-soft)] font-bold">
                  /
                </kbd>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-[var(--hairline)]">
                <span className="text-[var(--body)]">Save selected job to Tracker (Job Feed)</span>
                <kbd className="px-2 py-0.5 border border-[var(--hairline-strong)] bg-[var(--surface-soft)] font-bold">
                  s
                </kbd>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-[var(--hairline)]">
                <span className="text-[var(--body)]">Dismiss selected job (Job Feed)</span>
                <kbd className="px-2 py-0.5 border border-[var(--hairline-strong)] bg-[var(--surface-soft)] font-bold">
                  x
                </kbd>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-[var(--hairline)]">
                <span className="text-[var(--body)]">Tailor resume for selected job (Job Feed)</span>
                <kbd className="px-2 py-0.5 border border-[var(--hairline-strong)] bg-[var(--surface-soft)] font-bold">
                  t
                </kbd>
              </div>
              <div className="flex items-center justify-between py-1.5">
                <span className="text-[var(--body)]">Log new external application (Tracker)</span>
                <kbd className="px-2 py-0.5 border border-[var(--hairline-strong)] bg-[var(--surface-soft)] font-bold">
                  n
                </kbd>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
