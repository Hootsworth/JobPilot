'use client';

import React, { useRef, useState } from 'react';
import type {
  ImportPreviewCandidate,
  ProfileVariantRecord
} from '@jobpilot/shared';
import { MoSpinner, moToast } from '@/components/ui/mo';
import {
  AlertBanner,
  Badge,
  Button,
  Field,
  Input,
  SectionBlock
} from '@/components/ui/primitives';
import { api } from '@/lib/api';

export interface ImportSelectionState {
  includeBasics: boolean;
  selectedWorkIds: Set<string>;
  selectedProjectIds: Set<string>;
  selectedEduIds: Set<string>;
  selectedSkillNames: Set<string>;
  selectedCertNames: Set<string>;
  selectedLangNames: Set<string>;
}

interface ProfileVariantBarProps {
  variants: ProfileVariantRecord[];
  activeVariantId: string | null;
  busy: boolean;
  onSelectVariant: (variant: ProfileVariantRecord) => void;
  onCreateVariant: (input: {
    name: string;
    targetRole: string;
    cloneFromVariantId?: string;
  }) => Promise<void>;
  onSetDefault: (variantId: string) => Promise<void>;
  onDeleteVariant: (variantId: string) => Promise<void>;
}

export function ProfileVariantBar({
  variants,
  activeVariantId,
  busy,
  onSelectVariant,
  onCreateVariant,
  onSetDefault,
  onDeleteVariant
}: ProfileVariantBarProps) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTargetRole, setNewTargetRole] = useState('');
  const [cloneCurrent, setCloneCurrent] = useState(true);

  const activeVariant = variants.find((v) => v.id === activeVariantId) ?? variants[0] ?? null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    await onCreateVariant({
      name: newName.trim(),
      targetRole: newTargetRole.trim(),
      cloneFromVariantId: cloneCurrent ? activeVariant?.id : undefined
    });
    setNewName('');
    setNewTargetRole('');
    setCreating(false);
  };

  return (
    <div className="border border-[var(--hairline)] bg-[var(--surface-soft)] px-4 py-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--mute)] mr-1">
            Profile Variants ({variants.length})
          </span>
          {variants.map((v) => {
            const isSelected = v.id === activeVariant?.id;
            return (
              <button
                key={v.id}
                type="button"
                disabled={busy}
                onClick={() => onSelectVariant(v)}
                className={`px-3 py-1.5 text-xs rounded-[4px] border cursor-pointer transition-colors inline-flex items-center gap-1.5 min-h-[34px] ${
                  isSelected
                    ? 'bg-[var(--surface-dark)] text-[var(--on-dark)] border-[var(--surface-dark)] font-semibold'
                    : 'bg-[var(--canvas)] text-[var(--ink)] border-[var(--hairline-strong)] hover:bg-[var(--surface-soft)]'
                }`}
              >
                <span>{v.name}</span>
                {v.isDefault ? (
                  <span
                    className={`text-[10px] uppercase tracking-wider px-1 rounded-[2px] ${
                      isSelected
                        ? 'bg-[var(--on-dark)]/15 text-[var(--on-dark)]'
                        : 'bg-[var(--surface-soft)] text-[var(--mute)]'
                    }`}
                  >
                    DEFAULT
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {activeVariant && !activeVariant.isDefault ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => void onSetDefault(activeVariant.id)}
            >
              Set Active Default
            </Button>
          ) : null}
          {activeVariant && variants.length > 1 ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => void onDeleteVariant(activeVariant.id)}
            >
              Delete Variant
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant={creating ? 'primary' : 'secondary'}
            disabled={busy}
            onClick={() => setCreating((v) => !v)}
          >
            {creating ? 'Close' : '+ New Variant'}
          </Button>
        </div>
      </div>

      {activeVariant?.targetRole ? (
        <p className="text-[11px] text-[var(--mute)]">
          Active Variant Target: <strong className="text-[var(--ink)]">{activeVariant.targetRole}</strong>{' '}
          (v{activeVariant.version}) — Active Default automatically syncs to Job Matching &amp; Extension Autofill.
        </p>
      ) : null}

      {creating ? (
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="pt-3 border-t border-[var(--hairline)] grid grid-cols-1 md:grid-cols-12 gap-3 items-end"
        >
          <div className="md:col-span-4">
            <Field label="Variant Name" htmlFor="new-variant-name" required>
              {(props) => (
                <Input
                  {...props}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Backend Go/Postgres or ML Systems"
                />
              )}
            </Field>
          </div>
          <div className="md:col-span-4">
            <Field label="Target Role Label" htmlFor="new-variant-role">
              {(props) => (
                <Input
                  {...props}
                  value={newTargetRole}
                  onChange={(e) => setNewTargetRole(e.target.value)}
                  placeholder="e.g. Backend Software Engineer"
                />
              )}
            </Field>
          </div>
          <div className="md:col-span-4 flex flex-wrap items-center justify-between gap-2 pb-1">
            <label className="inline-flex items-center gap-2 text-xs text-[var(--body)] cursor-pointer">
              <input
                type="checkbox"
                checked={cloneCurrent}
                onChange={(e) => setCloneCurrent(e.target.checked)}
                className="h-4 w-4 accent-[var(--ink)]"
              />
              <span>Clone current variant</span>
            </label>
            <Button type="submit" size="sm" variant="primary" disabled={busy || !newName.trim()}>
              Create Variant
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

interface ProfileImportPanelProps {
  onClose: () => void;
  onMergeCandidate: (
    candidate: ImportPreviewCandidate,
    selection: ImportSelectionState
  ) => Promise<void>;
}

export function ProfileImportPanel({ onClose, onMergeCandidate }: ProfileImportPanelProps) {
  const [sourceTab, setSourceTab] = useState<'github' | 'linkedin'>('github');
  const [ghUsername, setGhUsername] = useState('');
  const [ghLoading, setGhLoading] = useState(false);
  const [liLoading, setLiLoading] = useState(false);
  const [merging, setMerging] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<ImportPreviewCandidate | null>(null);
  const [selection, setSelection] = useState<ImportSelectionState>({
    includeBasics: false,
    selectedWorkIds: new Set(),
    selectedProjectIds: new Set(),
    selectedEduIds: new Set(),
    selectedSkillNames: new Set(),
    selectedCertNames: new Set(),
    selectedLangNames: new Set()
  });
  const liInputRef = useRef<HTMLInputElement | null>(null);

  const hydrateCandidateSelection = (next: ImportPreviewCandidate) => {
    setCandidate(next);
    setSelection({
      includeBasics: Boolean(next.headline || next.summary || next.githubUrl || next.linkedinUrl),
      selectedWorkIds: new Set(next.work.map((w) => w.id)),
      selectedProjectIds: new Set(next.projects.map((p) => p.id)),
      selectedEduIds: new Set(next.education.map((e) => e.id)),
      selectedSkillNames: new Set(next.skills.map((s) => s.name)),
      selectedCertNames: new Set(next.certificates.map((c) => c.name)),
      selectedLangNames: new Set(next.languages.map((l) => l.language))
    });
  };

  const handleFetchGithub = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ghUsername.trim()) return;
    setGhLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.importGithubProfile({
        username: ghUsername.trim(),
        maxRepos: 8,
        includeForks: false
      });
      hydrateCandidateSelection(res);
      moToast(`Fetched ${res.projects.length} GitHub repos`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'GitHub import failed.');
    } finally {
      setGhLoading(false);
    }
  };

  const handleLinkedinUpload = async (file: File | null) => {
    if (!file) return;
    setLiLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.importLinkedinPdf(file);
      hydrateCandidateSelection(res);
      moToast(`Parsed LinkedIn PDF (${res.stats.pagesParsed} pages)`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'LinkedIn PDF import failed.');
    } finally {
      setLiLoading(false);
      if (liInputRef.current) liInputRef.current.value = '';
    }
  };

  const toggleSet = (
    key: Exclude<keyof ImportSelectionState, 'includeBasics'>,
    value: string
  ) => {
    setSelection((prev) => {
      const next = new Set(prev[key]);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return { ...prev, [key]: next };
    });
  };

  const handleMerge = async () => {
    if (!candidate) return;
    setMerging(true);
    try {
      await onMergeCandidate(candidate, selection);
      setCandidate(null);
    } finally {
      setMerging(false);
    }
  };

  return (
    <SectionBlock
      title="Import from GitHub or LinkedIn"
      description="Inspect parsed items before merging into the selected profile variant."
      action={
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-4">
        {errorMsg ? <AlertBanner tone="error" message={errorMsg} /> : null}

        <div className="flex border border-[var(--hairline)] rounded-[4px] overflow-hidden max-w-md">
          <button
            type="button"
            onClick={() => {
              setSourceTab('github');
              setErrorMsg(null);
            }}
            className={`flex-1 py-2 px-3 text-xs font-medium cursor-pointer min-h-[40px] ${
              sourceTab === 'github'
                ? 'bg-[var(--surface-dark)] text-[var(--on-dark)]'
                : 'bg-[var(--surface-soft)] text-[var(--ink)]'
            }`}
          >
            GitHub Public Repos
          </button>
          <button
            type="button"
            onClick={() => {
              setSourceTab('linkedin');
              setErrorMsg(null);
            }}
            className={`flex-1 py-2 px-3 text-xs font-medium cursor-pointer min-h-[40px] border-l border-[var(--hairline)] ${
              sourceTab === 'linkedin'
                ? 'bg-[var(--surface-dark)] text-[var(--on-dark)]'
                : 'bg-[var(--surface-soft)] text-[var(--ink)]'
            }`}
          >
            LinkedIn Save-to-PDF
          </button>
        </div>

        {sourceTab === 'github' ? (
          <form
            onSubmit={(e) => void handleFetchGithub(e)}
            className="flex flex-col sm:flex-row gap-3 items-end"
          >
            <div className="flex-1 w-full">
              <Field
                label="GitHub Username or Profile URL"
                htmlFor="gh-import-username"
                hint="Uses public GitHub REST API (no token required)."
              >
                {(props) => (
                  <Input
                    {...props}
                    value={ghUsername}
                    onChange={(e) => setGhUsername(e.target.value)}
                    placeholder="e.g. torvalds or https://github.com/octocat"
                  />
                )}
              </Field>
            </div>
            <Button
              type="submit"
              variant="primary"
              disabled={ghLoading || !ghUsername.trim()}
            >
              {ghLoading ? (
                <span className="inline-flex items-center gap-2">
                  <MoSpinner name="braille" />
                  <span>Fetching...</span>
                </span>
              ) : (
                'Fetch GitHub Repos'
              )}
            </Button>
          </form>
        ) : (
          <div className="border border-dashed border-[var(--hairline-strong)] bg-[var(--surface-soft)] p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1 text-xs">
              <p className="font-bold text-[var(--ink)]">
                Upload LinkedIn 2-Column PDF (&quot;More -&gt; Save to PDF&quot;)
              </p>
              <p className="text-[var(--mute)]">
                Separates sidebar skills/certifications from experience/education deterministically via PDF coordinates.
              </p>
            </div>
            <input
              ref={liInputRef}
              type="file"
              accept="application/pdf,.pdf"
              aria-label="Upload LinkedIn PDF export"
              className="hidden"
              onChange={(e) => void handleLinkedinUpload(e.target.files?.[0] ?? null)}
            />
            <Button
              type="button"
              variant="primary"
              disabled={liLoading}
              onClick={() => liInputRef.current?.click()}
            >
              {liLoading ? (
                <span className="inline-flex items-center gap-2">
                  <MoSpinner name="braille" />
                  <span>Parsing 2-Col PDF...</span>
                </span>
              ) : (
                'Choose LinkedIn PDF...'
              )}
            </Button>
          </div>
        )}

        {candidate ? (
          <div className="border border-[var(--hairline-strong)] bg-[var(--canvas)] p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--hairline)] pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="dark">{candidate.source.toUpperCase()} PREVIEW</Badge>
                <span className="text-xs font-bold text-[var(--ink)]">
                  {candidate.sourceLabel}
                </span>
                {candidate.stats.starsTotal > 0 ? (
                  <Badge tone="neutral">{candidate.stats.starsTotal} total stars</Badge>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setCandidate(null)}
                >
                  Discard
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  disabled={merging}
                  onClick={() => void handleMerge()}
                >
                  {merging ? 'Merging...' : 'Merge selected'}
                </Button>
              </div>
            </div>

            {candidate.warnings.length > 0 ? (
              <AlertBanner tone="warning" message={candidate.warnings.join(' ')} />
            ) : null}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              {(candidate.headline || candidate.summary || candidate.githubUrl || candidate.linkedinUrl) ? (
                <label className="border border-[var(--hairline)] p-3 flex items-start gap-2.5 cursor-pointer bg-[var(--surface-soft)]">
                  <input
                    type="checkbox"
                    checked={selection.includeBasics}
                    onChange={(e) =>
                      setSelection((prev) => ({ ...prev, includeBasics: e.target.checked }))
                    }
                    className="mt-0.5 h-4 w-4 accent-[var(--ink)]"
                  />
                  <div className="space-y-1 min-w-0">
                    <strong className="text-[var(--ink)] block">
                      Profile Headline / Links / Summary
                    </strong>
                    {candidate.headline ? (
                      <p className="text-[var(--body)]">{candidate.headline}</p>
                    ) : null}
                    {candidate.summary ? (
                      <p className="text-[var(--mute)] line-clamp-2">{candidate.summary}</p>
                    ) : null}
                    {candidate.githubUrl || candidate.linkedinUrl ? (
                      <p className="text-[11px] text-[var(--mute)] truncate">
                        {candidate.githubUrl ?? candidate.linkedinUrl}
                      </p>
                    ) : null}
                  </div>
                </label>
              ) : null}

              {candidate.skills.map((grp) => (
                <label
                  key={grp.name}
                  className="border border-[var(--hairline)] p-3 flex items-start gap-2.5 cursor-pointer bg-[var(--surface-soft)]"
                >
                  <input
                    type="checkbox"
                    checked={selection.selectedSkillNames.has(grp.name)}
                    onChange={() => toggleSet('selectedSkillNames', grp.name)}
                    className="mt-0.5 h-4 w-4 accent-[var(--ink)]"
                  />
                  <div className="space-y-1 min-w-0">
                    <strong className="text-[var(--ink)] block">{grp.name}</strong>
                    <p className="text-[var(--body)]">{grp.keywords.join(', ')}</p>
                  </div>
                </label>
              ))}

              {candidate.projects.map((p) => (
                <label
                  key={p.id}
                  className="border border-[var(--hairline)] p-3 flex items-start gap-2.5 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selection.selectedProjectIds.has(p.id)}
                    onChange={() => toggleSet('selectedProjectIds', p.id)}
                    className="mt-0.5 h-4 w-4 accent-[var(--ink)]"
                  />
                  <div className="space-y-1 min-w-0">
                    <strong className="text-[var(--ink)] block">
                      Project: {p.name}
                    </strong>
                    {p.description ? (
                      <p className="text-[var(--body)] line-clamp-2">{p.description}</p>
                    ) : null}
                    {p.keywords && p.keywords.length > 0 ? (
                      <p className="text-[11px] text-[var(--mute)]">{p.keywords.join(' · ')}</p>
                    ) : null}
                  </div>
                </label>
              ))}

              {candidate.work.map((w) => (
                <label
                  key={w.id}
                  className="border border-[var(--hairline)] p-3 flex items-start gap-2.5 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selection.selectedWorkIds.has(w.id)}
                    onChange={() => toggleSet('selectedWorkIds', w.id)}
                    className="mt-0.5 h-4 w-4 accent-[var(--ink)]"
                  />
                  <div className="space-y-1 min-w-0">
                    <strong className="text-[var(--ink)] block">
                      Work: {w.position} — {w.name}
                    </strong>
                    <p className="text-[11px] text-[var(--mute)]">
                      {w.startDate} – {w.endDate || 'Present'} · {w.highlights.length} bullets
                    </p>
                  </div>
                </label>
              ))}

              {candidate.education.map((edu) => (
                <label
                  key={edu.id}
                  className="border border-[var(--hairline)] p-3 flex items-start gap-2.5 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selection.selectedEduIds.has(edu.id)}
                    onChange={() => toggleSet('selectedEduIds', edu.id)}
                    className="mt-0.5 h-4 w-4 accent-[var(--ink)]"
                  />
                  <div className="space-y-1 min-w-0">
                    <strong className="text-[var(--ink)] block">
                      Edu: {edu.institution}
                    </strong>
                    <p className="text-[11px] text-[var(--mute)]">
                      {[edu.studyType, edu.area].filter(Boolean).join(' in ')}
                    </p>
                  </div>
                </label>
              ))}

              {candidate.certificates.map((cert) => (
                <label
                  key={cert.name}
                  className="border border-[var(--hairline)] p-3 flex items-start gap-2.5 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selection.selectedCertNames.has(cert.name)}
                    onChange={() => toggleSet('selectedCertNames', cert.name)}
                    className="mt-0.5 h-4 w-4 accent-[var(--ink)]"
                  />
                  <div className="space-y-1 min-w-0">
                    <strong className="text-[var(--ink)] block">Cert: {cert.name}</strong>
                  </div>
                </label>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </SectionBlock>
  );
}
