import React, { useState } from 'react';
import type { MasterProfile } from '@jobpilot/shared';

function findSocialUrl(profile: MasterProfile, pattern: RegExp): string {
  for (const p of profile.jsonResume.basics.profiles ?? []) {
    if (pattern.test(p.network) || pattern.test(p.url ?? '')) {
      if (p.url?.trim()) return p.url.trim();
      if (p.username?.trim() && /linkedin/i.test(p.network)) {
        return `https://www.linkedin.com/in/${p.username.trim()}`;
      }
      if (p.username?.trim() && /github/i.test(p.network)) {
        return `https://github.com/${p.username.trim()}`;
      }
    }
  }
  return '';
}

export function QuickCopyBar({ profile }: { profile: MasterProfile }) {
  const [open, setOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const ind = profile.indiaProfile;
  const basics = profile.jsonResume.basics;

  const entries: Array<{ key: string; label: string; value: string }> = [
    { key: 'name', label: 'Name', value: profile.fullName || basics.name || '' },
    { key: 'email', label: 'Email', value: profile.email || basics.email || '' },
    { key: 'phone', label: 'Phone', value: profile.phone || basics.phone || '' },
    { key: 'linkedin', label: 'LinkedIn', value: findSocialUrl(profile, /linkedin/i) },
    { key: 'github', label: 'GitHub', value: findSocialUrl(profile, /github/i) },
    { key: 'portfolio', label: 'Portfolio', value: basics.url || '' },
    {
      key: 'ectc',
      label: 'Exp CTC',
      value: ind.expectedCtcLpa != null ? `${ind.expectedCtcLpa} LPA` : ''
    },
    {
      key: 'cctc',
      label: 'Cur CTC',
      value: ind.currentCtcLpa != null ? `${ind.currentCtcLpa} LPA` : ''
    },
    {
      key: 'notice',
      label: 'Notice',
      value:
        ind.noticePeriodDays != null
          ? ind.noticePeriodDays === 0
            ? 'Immediate'
            : `${ind.noticePeriodDays} days`
          : ''
    },
    { key: 'college', label: 'College', value: ind.collegeName || '' },
    { key: 'cgpa', label: 'CGPA', value: ind.cgpa != null ? String(ind.cgpa) : '' },
    {
      key: '10th',
      label: '10th %',
      value: ind.tenthPercentage != null ? `${ind.tenthPercentage}%` : ''
    },
    {
      key: '12th',
      label: '12th %',
      value: ind.twelfthPercentage != null ? `${ind.twelfthPercentage}%` : ''
    }
  ].filter((item) => item.value.trim().length > 0);

  if (entries.length === 0) return null;

  const handleCopy = (key: string, value: string) => {
    void navigator.clipboard?.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1400);
  };

  return (
    <section className="jp-panel" aria-label="Quick copy profile snippets">
      <button
        type="button"
        className="jp-collapse-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="jp-label">[CP] Quick Copy Palette ({entries.length})</span>
        <span className="jp-meta">{open ? 'Hide [-]' : 'Show [+]'}</span>
      </button>

      {open ? (
        <div className="jp-chip-grid">
          {entries.map((entry) => {
            const copied = copiedKey === entry.key;
            return (
              <button
                key={entry.key}
                type="button"
                className={`jp-copy-chip ${copied ? 'jp-copy-chip-ok' : ''}`}
                title={entry.value}
                onClick={() => handleCopy(entry.key, entry.value)}
              >
                <span>{copied ? `[x] ${entry.label}` : entry.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
