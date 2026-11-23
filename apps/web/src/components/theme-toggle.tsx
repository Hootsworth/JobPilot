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
      className="min-h-[36px] px-2.5 py-1 text-xs font-medium border border-[var(--hairline)] rounded-[4px] bg-[var(--surface-soft)] text-[var(--ink)] hover:border-[var(--hairline-strong)] cursor-pointer"
      title={`Theme: ${preference} (rendered ${renderedScheme})`}
    >
      [{renderedScheme === 'dark' ? 'DARK' : 'LIGHT'}]
    </button>
  );
}

export function ThemeSettingsControl() {
  const { preference, systemDark, updatePreference } = useThemePreference();
  const options: Array<{ id: ThemePreference; label: string }> = [
    { id: 'system', label: `System (${systemDark ? 'dark' : 'light'})` },
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
            className={`min-h-[38px] px-3 py-1.5 text-sm rounded-[4px] border cursor-pointer ${
              active
                ? 'bg-[var(--ink)] text-[var(--on-primary)] border-[var(--ink)] font-medium'
                : 'bg-[var(--surface-soft)] text-[var(--ink)] border-[var(--hairline)] hover:border-[var(--hairline-strong)]'
            }`}
          >
            {active ? '[x] ' : '[ ] '}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
