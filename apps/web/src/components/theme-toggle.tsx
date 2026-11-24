'use client';

import React, { useEffect, useState } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';

function readSystemDark(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function readStoredPreference(): ThemePreference {
  try {
    const val = localStorage.getItem('color-scheme');
    if (val === 'light' || val === 'dark') return val;
  } catch {
    // ignore storage access errors
  }
  return 'system';
}

function applySchemeMeta(pref: ThemePreference) {
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (!meta) return;
  meta.setAttribute('content', pref === 'system' ? 'light dark' : pref);
}

export function useThemePreference() {
  const [preference, setPreference] = useState<ThemePreference>('system');
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    setPreference(readStoredPreference());
    setSystemDark(readSystemDark());

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onMqChange = (e: MediaQueryListEvent) => {
      setSystemDark(e.matches);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'color-scheme') {
        const next = readStoredPreference();
        setPreference(next);
        applySchemeMeta(next);
      }
    };

    mq.addEventListener('change', onMqChange);
    window.addEventListener('storage', onStorage);
    return () => {
      mq.removeEventListener('change', onMqChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const updatePreference = (next: ThemePreference) => {
    setPreference(next);
    try {
      if (next === 'system') localStorage.removeItem('color-scheme');
      else localStorage.setItem('color-scheme', next);
    } catch {
      // ignore storage failures
    }
    applySchemeMeta(next);
  };

  // Compact two-state toggle per modern-web-guidance:
  // target = opposite of currently rendered scheme; remove stored value if target === system
  const toggleTwoState = () => {
    const renderedDark = preference === 'dark' || (preference === 'system' && systemDark);
    const target: 'light' | 'dark' = renderedDark ? 'light' : 'dark';
    const systemPref: 'light' | 'dark' = systemDark ? 'dark' : 'light';
    updatePreference(target === systemPref ? 'system' : target);
  };

  const renderedScheme: 'light' | 'dark' =
    preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

  return {
    preference,
    systemDark,
    renderedScheme,
    updatePreference,
    toggleTwoState
  };
}

export function ThemeQuickToggle() {
  const { renderedScheme, preference, toggleTwoState } = useThemePreference();

  return (
    <button
      type="button"
      onClick={toggleTwoState}
      aria-label={
        renderedScheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
      }
      className="h-9 px-2.5 text-xs font-medium whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 border border-[var(--hairline)] rounded-[4px] bg-[var(--canvas)] text-[var(--ink)] hover:bg-[var(--surface-card)] hover:border-[var(--hairline-strong)] cursor-pointer"
      title={`Theme: ${preference} (${renderedScheme})`}
    >
      {renderedScheme === 'dark' ? (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M13.5 9.8A5.5 5.5 0 0 1 6.2 2.5a5.5 5.5 0 1 0 7.3 7.3Z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.4" />
          <path
            d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      )}
      <span>{renderedScheme === 'dark' ? 'Dark' : 'Light'}</span>
    </button>
  );
}

export function ThemeSettingsControl() {
  const { preference, systemDark, updatePreference } = useThemePreference();
  const options: Array<{ id: ThemePreference; label: string }> = [
    { id: 'system', label: `System (${systemDark ? 'Dark' : 'Light'})` },
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' }
  ];

  return (
    <div role="radiogroup" aria-label="Color theme preference" className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = preference === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => updatePreference(opt.id)}
            className={`h-9 px-3.5 text-xs whitespace-nowrap shrink-0 rounded-[4px] border cursor-pointer transition-colors ${
              active
                ? 'bg-[var(--ink)] text-[var(--on-primary)] border-[var(--ink)] font-semibold'
                : 'bg-[var(--surface-soft)] text-[var(--ink)] border-[var(--hairline)] hover:border-[var(--hairline-strong)]'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
