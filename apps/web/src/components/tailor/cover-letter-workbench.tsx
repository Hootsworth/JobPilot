'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type {
  CoverLetterRecord,
  CoverLetterTone,
  JobFeedItem,
  ProfileVariantRecord
} from '@jobpilot/shared';
import { moToast } from '@/components/ui/mo';
import {
  AlertBanner,
  Badge,
  Button,
  ConfirmDialog,
  Field,
  Input,
  SectionBlock,
  Select,
  SkeletonBlock,
  TabStrip,
  Textarea
} from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { GeneratingStage } from './generating-stage';
import { PdfPreviewFrame } from './pdf-preview-frame';

interface CoverLetterWorkbenchProps {
  catalogJobs: JobFeedItem[];
  variants: ProfileVariantRecord[];
  defaultJobId?: string;
  onGeneratingChange?: (busy: boolean) => void;
}

type CoverLetterStage = 'compose' | 'generating' | 'viewer';
type CoverLetterViewTab = 'pdf' | 'edit' | 'verifier' | 'typst';

const COVER_LETTER_GENERATING_STEPS = [
  'Reading target role and company context',
  'Selecting verified metrics from your profile and story bank',
  'Drafting grounded cover letter',
  'Auditing claims and tone',
  'Compiling downloadable PDF'
];

export function CoverLetterWorkbench({
  catalogJobs,
  variants,
  defaultJobId,
  onGeneratingChange
}: CoverLetterWorkbenchProps) {
  const [letters, setLetters] = useState<CoverLetterRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stage, setStage] = useState<CoverLetterStage>('compose');
  const [generatingTarget, setGeneratingTarget] = useState('');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const [sourceMode, setSourceMode] = useState<'catalog' | 'custom'>(
    defaultJobId || catalogJobs.length > 0 ? 'catalog' : 'custom'
  );
  const [selectedJobId, setSelectedJobId] = useState<string>(
    defaultJobId ?? catalogJobs[0]?.job.id ?? ''
  );
  const [selectedVariantId, setSelectedVariantId] = useState<string>('');
  const [tone, setTone] = useState<CoverLetterTone>('concise-technical');
  const [customCompany, setCustomCompany] = useState('');
  const [customTitle, setCustomTitle] = useState('');
  const [customJd, setCustomJd] = useState('');
  const [customInstructions, setCustomInstructions] = useState('');
  const [labelOverride, setLabelOverride] = useState('');

  const [viewTab, setViewTab] = useState<CoverLetterViewTab>('pdf');
  const [draftLabel, setDraftLabel] = useState('');
  const [draftText, setDraftText] = useState('');
  const [pdfRefreshKey, setPdfRefreshKey] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => () => onGeneratingChange?.(false), [onGeneratingChange]);

  const loadLetters = useCallback(async () => {
    setLoading(true);
    try {
      const items = await api.listCoverLetters();
      setLetters(items);
      if (defaultJobId || items.length === 0) {
        setSelectedId((prev) => prev ?? items[0]?.id ?? null);
        setStage('compose');
      } else {
        setSelectedId((prev) => prev ?? items[0]?.id ?? null);
        setStage('viewer');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load cover letters.');
    } finally {
      setLoading(false);
    }
  }, [defaultJobId]);

  useEffect(() => {
    void loadLetters();
  }, [loadLetters]);

  const selected = letters.find((c) => c.id === selectedId) ?? null;

  useEffect(() => {
    if (!selected) return;
    setDraftLabel(selected.label);
    setDraftText(selected.plainText);
  }, [selected]);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);

    if (sourceMode === 'catalog' && !selectedJobId) {
      setErrorMsg('Select a saved/feed job or switch to Custom JD.');
      return;
    }
    if (
      sourceMode === 'custom' &&
      (!customCompany.trim() || customTitle.trim().length < 2 || customJd.trim().length < 20)
    ) {
      setErrorMsg('Enter company name, role title, and at least 20 characters of JD context.');
      return;
    }

    const catalogMatch =
      sourceMode === 'catalog' ? catalogJobs.find((j) => j.job.id === selectedJobId)?.job : null;
    const targetLabel =
      sourceMode === 'catalog'
        ? catalogMatch
          ? `${catalogMatch.companyName} — ${catalogMatch.title}`
          : 'Target role'
        : `${customCompany.trim()} — ${customTitle.trim()}`;

    setGeneratingTarget(targetLabel);
    setGenerating(true);
    onGeneratingChange?.(true);
    setStage('generating');

    try {
      const created = await api.generateCoverLetter({
        ...(sourceMode === 'catalog'
          ? { jobId: selectedJobId }
          : {
              customJob: {
                companyName: customCompany.trim(),
                title: customTitle.trim(),
                description: customJd.trim()
              }
            }),
        ...(selectedVariantId ? { profileVariantId: selectedVariantId } : {}),
        tone,
        ...(labelOverride.trim() ? { label: labelOverride.trim() } : {}),
        ...(customInstructions.trim()
          ? { customInstructions: customInstructions.trim() }
          : {}),
        autoRepairFlagged: true
      });
      setLetters((prev) => [created, ...prev]);
      setSelectedId(created.id);
      setLabelOverride('');
      setViewTab('pdf');
      setStage('viewer');
      moToast(`Generated cover letter v${created.versionNumber}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Cover letter generation failed.');
      setStage('compose');
    } finally {
      setGenerating(false);
      onGeneratingChange?.(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!selected || !draftText.trim()) return;
    setSavingEdit(true);
    setErrorMsg(null);
    try {
      const updated = await api.updateCoverLetter(selected.id, {
        label: draftLabel.trim() || selected.label,
        plainText: draftText
      });
      setLetters((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setPdfRefreshKey((k) => k + 1);
      moToast('Saved edits & updated PDF');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save edits.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    setDeleting(true);
    setConfirmDeleteOpen(false);
    try {
      await api.deleteCoverLetter(selected.id);
      const next = letters.filter((c) => c.id !== selected.id);
      setLetters(next);
      setSelectedId(next[0]?.id ?? null);
      if (next.length === 0) {
        setStage('compose');
      }
      moToast('Cover letter deleted');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to delete cover letter.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-5">
      {errorMsg ? <AlertBanner tone="error" message={errorMsg} /> : null}
      {statusMsg ? <AlertBanner tone="success" message={statusMsg} /> : null}

      <ConfirmDialog
        open={confirmDeleteOpen}
        title="Delete Cover Letter?"
        description={
          selected ? `Permanently delete v${selected.versionNumber} (${selected.label})?` : ''
        }
        confirmLabel="Delete Cover Letter"
        cancelLabel="Cancel"
        destructive
        onConfirm={() => void handleDelete()}
        onCancel={() => setConfirmDeleteOpen(false)}
      />

      {loading ? (
        <SkeletonBlock className="h-[520px] w-full" />
      ) : stage === 'generating' ? (
        <GeneratingStage
          heading="Drafting your cover letter..."
          targetLabel={generatingTarget || 'Target role'}
          subtitle="Pulling verified highlights from your profile and story bank."
          steps={COVER_LETTER_GENERATING_STEPS}
        />
      ) : stage === 'compose' || !selected ? (
        <div className="max-w-3xl mx-auto space-y-6">
          <SectionBlock
            title="New cover letter"
            description="Pick a target job and tone. Your letter opens full-screen once generated."
            action={
              letters.length > 0 ? (
                <Button size="sm" variant="secondary" onClick={() => setStage('viewer')}>
                  Back to viewer ({letters.length})
                </Button>
              ) : undefined
            }
          >
            <form onSubmit={(e) => void handleGenerate(e)} className="space-y-4">
              <div className="flex border border-[var(--hairline)] rounded-[4px] overflow-hidden">
                <button
                  type="button"
                  onClick={() => setSourceMode('catalog')}
                  className={`flex-1 py-2 px-3 text-xs font-medium cursor-pointer min-h-[40px] ${
                    sourceMode === 'catalog'
                      ? 'bg-[var(--surface-dark)] text-[var(--on-dark)]'
                      : 'bg-[var(--surface-soft)] text-[var(--ink)]'
                  }`}
                >
                  Saved / Feed Job
                </button>
                <button
                  type="button"
                  onClick={() => setSourceMode('custom')}
                  className={`flex-1 py-2 px-3 text-xs font-medium cursor-pointer min-h-[40px] border-l border-[var(--hairline)] ${
                    sourceMode === 'custom'
                      ? 'bg-[var(--surface-dark)] text-[var(--on-dark)]'
                      : 'bg-[var(--surface-soft)] text-[var(--ink)]'
                  }`}
                >
                  Custom JD
                </button>
              </div>

              {sourceMode === 'catalog' ? (
                <Field label="Target Job" htmlFor="cl-job">
                  {(props) => (
                    <Select
                      {...props}
                      value={selectedJobId}
                      onChange={(e) => setSelectedJobId(e.target.value)}
                    >
                      {catalogJobs.length === 0 ? (
                        <option value="">No jobs yet — switch to Custom JD</option>
                      ) : (
                        catalogJobs.map((j) => (
                          <option key={j.job.id} value={j.job.id}>
                            {j.job.companyName} — {j.job.title}
                          </option>
                        ))
                      )}
                    </Select>
                  )}
                </Field>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Company Name" htmlFor="cl-company" required>
                      {(props) => (
                        <Input
                          {...props}
                          value={customCompany}
                          onChange={(e) => setCustomCompany(e.target.value)}
                          placeholder="e.g. Razorpay"
                        />
                      )}
                    </Field>
                    <Field label="Role Title" htmlFor="cl-title" required>
                      {(props) => (
                        <Input
                          {...props}
                          value={customTitle}
                          onChange={(e) => setCustomTitle(e.target.value)}
                          placeholder="e.g. Backend Engineer"
                        />
                      )}
                    </Field>
                  </div>
                  <Field label="Job Description" htmlFor="cl-jd" required>
                    {(props) => (
                      <Textarea
                        {...props}
                        rows={5}
                        value={customJd}
                        onChange={(e) => setCustomJd(e.target.value)}
                        placeholder="Paste core requirements..."
                      />
                    )}
                  </Field>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Source Profile Variant" htmlFor="cl-variant">
                  {(props) => (
                    <Select
                      {...props}
                      value={selectedVariantId}
                      onChange={(e) => setSelectedVariantId(e.target.value)}
                    >
                      <option value="">Active Default Profile</option>
                      {variants.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name} {v.isDefault ? '(Default)' : ''}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>

                <Field label="Voice & Tone" htmlFor="cl-tone">
                  {(props) => (
                    <Select
                      {...props}
                      value={tone}
                      onChange={(e) => setTone(e.target.value as CoverLetterTone)}
                    >
                      <option value="concise-technical">Concise Technical (3 crisp paragraphs)</option>
                      <option value="executive">Executive / Architectural Focus</option>
                      <option value="founder-note">Direct Founder Note (zero fluff)</option>
                    </Select>
                  )}
                </Field>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Focus Hint (optional)" htmlFor="cl-instr">
                  {(props) => (
                    <Input
                      {...props}
                      value={customInstructions}
                      onChange={(e) => setCustomInstructions(e.target.value)}
                      placeholder="e.g. Emphasize PostgreSQL queue & latency story"
                    />
                  )}
                </Field>

                <Field label="Label (optional)" htmlFor="cl-label">
                  {(props) => (
                    <Input
                      {...props}
                      value={labelOverride}
                      onChange={(e) => setLabelOverride(e.target.value)}
                      placeholder="Defaults to Company — Role Cover Letter"
                    />
                  )}
                </Field>
              </div>

              <div className="pt-1">
                <Button type="submit" variant="primary" className="w-full sm:w-auto" disabled={generating}>
                  Generate cover letter
                </Button>
              </div>
            </form>
          </SectionBlock>

          {letters.length > 0 ? (
            <SectionBlock
              title="Saved cover letters"
              description="Open any saved cover letter full-screen."
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-stretch">
                {letters.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(c.id);
                      setViewTab('pdf');
                      setStage('viewer');
                    }}
                    className="h-full flex flex-col justify-between text-left p-3.5 border border-[var(--hairline)] bg-[var(--canvas)] hover:bg-[var(--surface-soft)] transition-colors cursor-pointer"
                  >
                    <div className="space-y-2 w-full">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold tabular-nums text-[var(--ink)]">
                          v{c.versionNumber}
                        </span>
                        <Badge tone={c.verifierPassed ? 'success' : 'danger'}>
                          {c.verifierPassed ? 'Grounded' : 'Needs review'}
                        </Badge>
                      </div>
                      <p className="text-xs font-medium text-[var(--ink)] line-clamp-2">{c.label}</p>
                    </div>
                    <span className="text-[11px] text-[var(--mute)] mt-3 block">{c.tone}</span>
                  </button>
                ))}
              </div>
            </SectionBlock>
          ) : null}
        </div>
      ) : (
        <div className="w-full space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border border-[var(--hairline)] bg-[var(--surface-card)] p-3 sm:px-4">
            <div className="flex flex-wrap items-center gap-2.5 min-w-0 flex-1">
              <Select
                aria-label="Select cover letter version"
                className="max-w-md"
                value={selected.id}
                onChange={(e) => {
                  setSelectedId(e.target.value);
                  setViewTab('pdf');
                }}
              >
                {letters.map((c) => (
                  <option key={c.id} value={c.id}>
                    v{c.versionNumber} · {c.label}
                  </option>
                ))}
              </Select>
              <Badge tone={selected.verifierPassed ? 'success' : 'danger'}>
                {selected.verifierPassed ? 'Grounded' : 'Needs review'}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="primary"
                onClick={() => setStage('compose')}
              >
                New cover letter
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() =>
                  void api.downloadCoverLetterPdf(
                    selected.id,
                    `jobpilot-cl-v${selected.versionNumber}.pdf`
                  )
                }
              >
                Download PDF
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard?.writeText(selected.plainText);
                  moToast('Copied plain text to clipboard');
                }}
              >
                Copy text
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={deleting}
                onClick={() => setConfirmDeleteOpen(true)}
              >
                Delete
              </Button>
            </div>
          </div>

          <SectionBlock
            title={`v${selected.versionNumber} · ${selected.label}`}
            description={`${selected.companyName} — ${selected.roleTitle} · ${selected.tone} · ${selected.pdfEngine}`}
          >
            <div className="space-y-5">
              <TabStrip<CoverLetterViewTab>
                label="Cover letter inspection views"
                activeTab={viewTab}
                onChange={setViewTab}
                tabs={[
                  { id: 'pdf', label: 'PDF Preview' },
                  { id: 'edit', label: 'Edit & Re-Render' },
                  {
                    id: 'verifier',
                    label: 'Grounding Audit',
                    badge: selected.verifierReport.unsupportedClaimCount
                  },
                  { id: 'typst', label: 'Typst Source' }
                ]}
              />

              {viewTab === 'pdf' ? (
                <PdfPreviewFrame
                  id={selected.id}
                  kind="cover-letter"
                  refreshKey={pdfRefreshKey}
                  title={`Cover letter v${selected.versionNumber} preview`}
                  onDownload={() =>
                    void api.downloadCoverLetterPdf(
                      selected.id,
                      `jobpilot-cl-v${selected.versionNumber}.pdf`
                    )
                  }
                />
              ) : viewTab === 'edit' ? (
                <div className="space-y-4">
                  <Field label="Version Label" htmlFor="cl-edit-label">
                    {(props) => (
                      <Input
                        {...props}
                        value={draftLabel}
                        onChange={(e) => setDraftLabel(e.target.value)}
                      />
                    )}
                  </Field>
                  <Field
                    label="Cover Letter Text"
                    htmlFor="cl-edit-text"
                    hint="Saving re-compiles Typst & updates the downloadable PDF."
                  >
                    {(props) => (
                      <Textarea
                        {...props}
                        rows={14}
                        value={draftText}
                        onChange={(e) => setDraftText(e.target.value)}
                      />
                    )}
                  </Field>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="primary"
                      disabled={savingEdit}
                      onClick={() => void handleSaveEdit()}
                    >
                      {savingEdit ? 'Re-rendering PDF...' : 'Save & Re-Render PDF'}
                    </Button>
                  </div>
                </div>
              ) : viewTab === 'verifier' ? (
                <div className="space-y-3 text-xs">
                  <div className="p-3 border border-[var(--hairline)] bg-[var(--surface-soft)]">
                    {selected.verifierReport.overallNotes}
                  </div>
                  {selected.verifierReport.claims.map((c, idx) => (
                    <div
                      key={`cl-claim-${idx}`}
                      className="p-3 border border-[var(--hairline)] bg-[var(--canvas)] space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <Badge tone="neutral">{c.section}</Badge>
                        <Badge
                          tone={
                            c.status === 'flagged'
                              ? 'danger'
                              : c.status === 'verified'
                                ? 'success'
                                : 'warning'
                          }
                        >
                          {c.status.toUpperCase()}
                        </Badge>
                      </div>
                      <p className="text-[var(--ink)]">{c.claim}</p>
                      {c.issue ? <p className="text-[var(--danger-text)]">{c.issue}</p> : null}
                    </div>
                  ))}
                </div>
              ) : (
                <pre className="p-4 border border-[var(--hairline)] bg-[var(--surface-soft)] text-xs overflow-x-auto leading-relaxed">
                  {selected.typstSource ?? '// Typst source unavailable'}
                </pre>
              )}
            </div>
          </SectionBlock>
        </div>
      )}
    </div>
  );
}
