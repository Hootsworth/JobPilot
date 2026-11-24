'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { BillingSnapshot } from '@jobpilot/shared';
import { api } from '@/lib/api';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase';
import { ThemeQuickToggle } from '../theme-toggle';
import { AlertBanner, AsciiWordmark, Button, SkeletonBlock, cn } from '../ui/primitives';

type NavIconName =
  | 'home'
  | 'jobs'
  | 'tracker'
  | 'tailor'
  | 'resume'
  | 'stories'
  | 'answers'
  | 'billing'
  | 'usage'
  | 'settings';

interface NavItem {
  href: string;
  label: string;
  icon: NavIconName;
}

const NAV_GROUPS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: 'Discover',
    items: [
      { href: '/', label: 'Home', icon: 'home' },
      { href: '/jobs', label: 'Jobs', icon: 'jobs' }
    ]
  },
  {
    title: 'Applications',
    items: [
      { href: '/tracker', label: 'Tracker', icon: 'tracker' },
      { href: '/tailor', label: 'Tailor', icon: 'tailor' }
    ]
  },
  {
    title: 'Profile',
    items: [
      { href: '/profile', label: 'Resume', icon: 'resume' },
      { href: '/stories', label: 'Stories', icon: 'stories' },
      { href: '/answers', label: 'Answers', icon: 'answers' }
    ]
  }
];

const UTILITY_ITEMS: NavItem[] = [
  { href: '/billing', label: 'Plans', icon: 'billing' },
  { href: '/usage', label: 'Usage', icon: 'usage' },
  { href: '/settings', label: 'Settings', icon: 'settings' }
];

function NavIcon({ name }: { name: NavIconName }) {
  const props = {
    width: 14,
    height: 14,
    viewBox: '0 0 16 16',
    fill: 'none',
    'aria-hidden': true as const,
    className: 'shrink-0 opacity-85'
  };
  switch (name) {
    case 'home':
      return (
        <svg {...props}>
          <path
            d="M2.5 7 8 2.5 13.5 7v6.5h-4v-4h-3v4h-4V7Z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'jobs':
      return (
        <svg {...props}>
          <rect x="2" y="4.5" width="12" height="9" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
          <path d="M5.5 4.5V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      );
    case 'tracker':
      return (
        <svg {...props}>
          <path
            d="M3 4h10M3 8h7M3 12h5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <circle cx="12" cy="11.5" r="2" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      );
    case 'tailor':
      return (
        <svg {...props}>
          <path
            d="M3.5 2.5h6l3 3v8h-9v-11Z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <path d="M5.5 8h5M5.5 10.5h3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
    case 'resume':
      return (
        <svg {...props}>
          <circle cx="8" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.4" />
          <path
            d="M3 13.5c.8-2.3 2.7-3.5 5-3.5s4.2 1.2 5 3.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'stories':
      return (
        <svg {...props}>
          <path
            d="M3 3.5h10v8H6.5L3 14V3.5Z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'answers':
      return (
        <svg {...props}>
          <path
            d="M3 4.5h10M3 8h10M3 11.5h6.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'billing':
      return (
        <svg {...props}>
          <rect x="2" y="3.5" width="12" height="9" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
          <path d="M2 6.5h12" stroke="currentColor" strokeWidth="1.4" />
          <path d="M4.5 9.5h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
    case 'usage':
      return (
        <svg {...props}>
          <path
            d="M3 13V9M8 13V5M13 13V3"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'settings':
      return (
        <svg {...props}>
          <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.4" />
          <path
            d="M8 2v1.6M8 12.4V14M2 8h1.6M12.4 8H14M3.8 3.8l1.1 1.1M11.1 11.1l1.1 1.1M12.2 3.8l-1.1 1.1M4.9 11.1l-1.1 1.1"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      );
  }
}

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
  const [authChecked, setAuthChecked] = useState(false);
  const [billing, setBilling] = useState<BillingSnapshot | null>(null);

  const shortcutsDialogRef = useRef<HTMLDialogElement>(null);
  const pressedOutsideRef = useRef(false);

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
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const dialog = shortcutsDialogRef.current;
    if (!dialog) return;
    if (shortcutsOpen && !dialog.open) {
      dialog.showModal();
    } else if (!shortcutsOpen && dialog.open) {
      dialog.close();
    }
  }, [shortcutsOpen]);

  useEffect(() => {
    const dialog = shortcutsDialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      dialog.returnValue = '';
      setShortcutsOpen(false);
    };

    const isOutside = (e: PointerEvent) => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };

    const handlePointerDown = (e: PointerEvent) => {
      if ('closedBy' in HTMLDialogElement.prototype) return;
      pressedOutsideRef.current = isOutside(e);
    };
    const handlePointerUp = (e: PointerEvent) => {
      if ('closedBy' in HTMLDialogElement.prototype) return;
      if (pressedOutsideRef.current && isOutside(e)) {
        dialog.close();
      }
    };

    dialog.addEventListener('close', handleClose);
    dialog.addEventListener('pointerdown', handlePointerDown);
    dialog.addEventListener('pointerup', handlePointerUp);
    return () => {
      dialog.removeEventListener('close', handleClose);
      dialog.removeEventListener('pointerdown', handlePointerDown);
      dialog.removeEventListener('pointerup', handlePointerUp);
    };
  }, []);

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
        void api
          .getBillingStatus()
          .then((snap) => {
            if (mounted) setBilling(snap);
          })
          .catch(() => {});
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

  const handleSignOut = async () => {
    const supabase = getSupabaseClient();
    await supabase?.auth.signOut();
    router.replace('/');
  };

  const renderNavLink = (item: NavItem, onClick?: () => void) => {
    const active = pathname === item.href;
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onClick}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'h-9 px-2.5 flex items-center gap-2.5 text-xs rounded-[4px] border whitespace-nowrap transition-colors no-underline',
          active
            ? 'bg-[var(--ink)] text-[var(--on-primary)] border-[var(--ink)] font-semibold'
            : 'bg-transparent text-[var(--body)] border-transparent hover:bg-[var(--surface-card)] hover:text-[var(--ink)]'
        )}
      >
        <NavIcon name={item.icon} />
        <span>{item.label}</span>
      </Link>
    );
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[var(--canvas)] text-[var(--ink)]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2 focus:bg-[var(--ink)] focus:text-[var(--on-primary)] focus:text-xs focus:font-bold focus:rounded-[4px]"
      >
        Skip to main content
      </a>

      {/* Desktop Left Sidebar */}
      <aside
        aria-label="Primary sidebar"
        className="hidden md:flex md:flex-col md:w-[228px] md:shrink-0 md:sticky md:top-0 md:h-screen border-r border-[var(--hairline)] bg-[var(--surface-soft)]"
      >
        <div className="h-14 px-4 flex items-center border-b border-[var(--hairline)] shrink-0">
          <Link href="/" className="no-underline">
            <AsciiWordmark />
          </Link>
        </div>

        <nav aria-label="Workspace navigation" className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          {NAV_GROUPS.map((group) => (
            <div key={group.title} className="space-y-1">
              <p className="px-2.5 text-[10px] font-bold uppercase tracking-wider text-[var(--mute)]">
                {group.title}
              </p>
              <div className="space-y-0.5">{group.items.map((item) => renderNavLink(item))}</div>
            </div>
          ))}
        </nav>

        <div className="border-t border-[var(--hairline)] p-3 space-y-2.5 shrink-0">
          {billing ? (
            <Link
              href="/billing"
              className="block border border-[var(--hairline)] bg-[var(--canvas)] hover:border-[var(--hairline-strong)] px-2.5 py-2 rounded-[4px] no-underline transition-colors"
            >
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-bold uppercase tracking-wider text-[var(--ink)]">
                  {billing.plan.name}
                </span>
                <span className="tabular-nums font-semibold text-[var(--ink)]">
                  {billing.executionMode === 'byok'
                    ? 'BYOK'
                    : `${billing.totalCreditsRemaining} cr`}
                </span>
              </div>
              <p className="text-[10px] text-[var(--mute)] mt-0.5 truncate">
                {billing.executionMode === 'byok'
                  ? 'Developer key active'
                  : 'Managed AI credits →'}
              </p>
            </Link>
          ) : null}

          <div className="space-y-0.5">{UTILITY_ITEMS.map((item) => renderNavLink(item))}</div>

          <div className="flex items-center gap-2 pt-1">
            <div className="flex-1">
              <ThemeQuickToggle />
            </div>
            <button
              type="button"
              onClick={() => setShortcutsOpen(true)}
              aria-label="Open keyboard shortcuts"
              title="Keyboard shortcuts (?)"
              className="h-9 w-9 shrink-0 inline-flex items-center justify-center text-xs font-medium border border-[var(--hairline)] rounded-[4px] bg-[var(--canvas)] text-[var(--ink)] hover:bg-[var(--surface-card)] hover:border-[var(--hairline-strong)] cursor-pointer"
            >
              ?
            </button>
          </div>

          {supabaseReady && userEmail ? (
            <div className="pt-2 border-t border-[var(--hairline)] space-y-2">
              <p className="text-[11px] text-[var(--mute)] truncate px-1" title={userEmail}>
                {userEmail}
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleSignOut}
                className="w-full"
              >
                Sign out
              </Button>
            </div>
          ) : null}
        </div>
      </aside>

      {/* Mobile Top Bar + Drawer */}
      <header className="md:hidden sticky top-0 z-20 border-b border-[var(--hairline)] bg-[var(--surface-soft)]">
        <div className="h-14 px-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              className="h-9 w-9 inline-flex items-center justify-center border border-[var(--hairline)] rounded-[4px] bg-[var(--canvas)] text-[var(--ink)] cursor-pointer shrink-0"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-expanded={mobileMenuOpen}
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? (
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              )}
            </button>
            <Link href="/" className="no-underline shrink-0">
              <AsciiWordmark />
            </Link>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <ThemeQuickToggle />
            <button
              type="button"
              onClick={() => setShortcutsOpen(true)}
              aria-label="Open keyboard shortcuts"
              className="h-9 w-9 inline-flex items-center justify-center text-xs font-medium border border-[var(--hairline)] rounded-[4px] bg-[var(--canvas)] cursor-pointer"
            >
              ?
            </button>
          </div>
        </div>

        {mobileMenuOpen ? (
          <nav
            aria-label="Mobile workspace navigation"
            className="border-t border-[var(--hairline)] bg-[var(--canvas)] px-4 py-4 space-y-4"
          >
            {NAV_GROUPS.map((group) => (
              <div key={group.title} className="space-y-1.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--mute)] px-1">
                  {group.title}
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {group.items.map((item) => renderNavLink(item, () => setMobileMenuOpen(false)))}
                </div>
              </div>
            ))}
            <div className="grid grid-cols-2 gap-1.5 pt-2 border-t border-[var(--hairline)]">
              {UTILITY_ITEMS.map((item) => renderNavLink(item, () => setMobileMenuOpen(false)))}
            </div>
            {supabaseReady && userEmail ? (
              <div className="pt-2 border-t border-[var(--hairline)] flex items-center justify-between gap-2">
                <span className="text-xs text-[var(--mute)] truncate">{userEmail}</span>
                <Button variant="secondary" size="sm" onClick={handleSignOut}>
                  Sign out
                </Button>
              </div>
            ) : null}
          </nav>
        ) : null}
      </header>

      {/* Main Content */}
      <main
        id="main-content"
        tabIndex={-1}
        className="flex-1 min-w-0 w-full max-w-[1240px] mx-auto px-4 sm:px-8 py-6 sm:py-8 space-y-6"
      >
        {!supabaseReady ? (
          <AlertBanner
            tone="warning"
            title="Supabase client env vars missing"
            message="Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (sb_publishable_...), and NEXT_PUBLIC_API_URL in apps/web/.env.local to authenticate and persist data."
          />
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[var(--hairline)]">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--ink)]">
              {title}
            </h1>
            {subtitle ? <p className="text-xs text-[var(--mute)] mt-1 max-w-2xl">{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2.5 shrink-0">{actions}</div> : null}
        </div>

        {!authChecked ? (
          <div className="space-y-4">
            <SkeletonBlock className="h-24 w-full" />
            <SkeletonBlock className="h-72 w-full" />
          </div>
        ) : (
          children
        )}
      </main>

      {/* Accessible Native <dialog> Keyboard Shortcuts Sheet */}
      <dialog
        ref={shortcutsDialogRef}
        aria-labelledby="shortcuts-dialog-title"
        {...({ closedby: 'any' } as Record<string, string>)}
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-[var(--hairline)] pb-3">
            <h2 id="shortcuts-dialog-title" className="text-sm font-bold text-[var(--ink)]">
              Keyboard Shortcuts
            </h2>
            <Button variant="secondary" size="sm" onClick={() => setShortcutsOpen(false)} autoFocus>
              Close
            </Button>
          </div>
          <div className="divide-y divide-[var(--hairline)] text-xs">
            {[
              ['Toggle shortcuts', '?'],
              ['Next / previous item', 'j / k'],
              ['Focus search input', '/'],
              ['Save selected job', 's'],
              ['Dismiss selected job', 'x'],
              ['Tailor resume for job', 't'],
              ['Log application (Tracker)', 'n']
            ].map(([label, keyText]) => (
              <div key={label} className="flex items-center justify-between py-2 gap-4">
                <span className="text-[var(--body)]">{label}</span>
                <kbd className="px-2 py-0.5 border border-[var(--hairline-strong)] bg-[var(--surface-soft)] font-bold shrink-0">
                  {keyText}
                </kbd>
              </div>
            ))}
          </div>
        </div>
      </dialog>
    </div>
  );
}
