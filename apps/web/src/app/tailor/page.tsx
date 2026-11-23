'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type {
  JobFeedItem,
  ResumeSectionDiffSchema,
  ResumeTemplateId,
  ResumeVersionRecord,
  VerifierClaim
} from '@jobpilot/shared';
import type { z } from 'zod';
import { AppShell } from '@/components/layout/app-shell';
import {
  AlertBanner,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  SectionBlock,
  Select,
  SkeletonBlock,
  TabStrip,
  Textarea
} from '@/components/ui/primitives';
import { api } from '@/lib/api';

type TailorTab = 'diff' | 'verifier' | 'jd' | 'preview';
type SourceMode = 'catalog' | 'custom';
type SectionDiff = z.infer<typeof ResumeSectionDiffSchema>;

function formatPercentRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return iso;
  }
}

function claimTone(status: VerifierClaim['status']): 'success' | 'warning' | 'danger' {
  if (status === 'verified') return 'success';
  if (status === 'rephrased_ok') return 'warning';
  return 'danger';
}

function claimMarker(status: VerifierClaim['status']): string {
  if (status === 'verified') return '[x] VERIFIED';
  if (status === 'rephrased_ok') return '[~] REPHRASED OK';
  return '[!] FLAGGED';
}

function SectionDiffGroup({
  heading,
  sections
}: {
  heading: string;
  sections: SectionDiff[];
}) {
  if (sections.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--mute)]">{heading}</h3>
      <div className="space-y-3">
        {sections.map((sec) => (
          <div key={sec.id} className="border border-[var(--hairline)] bg-[var(--surface-soft)] p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-bold text-[var(--ink)]">{sec.title}</span>
              <div className="flex items-center gap-2">
                <Badge
                  tone={
                    sec.status === 'kept'
                      ? 'success'
                      : sec.status === 'reordered'
                        ? 'warning'
                        : 'neutral'
                  }
                >
                  {sec.status === 'kept'
                    ? '[=] KEPT'
                    : sec.status === 'reordered'
                      ? `[~] REORDERED (#${sec.masterIndex + 1} -> #${(sec.tailoredIndex ?? 0) + 1})`
                      : '[-] OMITTED'}
                </Badge>
              </div>
            </div>

            {sec.bulletDiffs.length > 0 ? (
              <div className="space-y-1.5 border-t border-[var(--hairline)] pt-2">
                {sec.bulletDiffs.map((b, idx) => (
                  <div key={`${sec.id}-b-${idx}`} className="text-xs space-y-1">
                    {b.changeType === 'unchanged' ? (
                      <p className="text-[var(--body)] break-words">
                        <span className="text-[var(--mute)] mr-2">[=]</span>
                        {b.after ?? b.before}
                      </p>
                    ) : null}
                    {b.changeType === 'rephrased' ? (
                      <div className="space-y-1 bg-[var(--canvas)] border border-[var(--hairline)] p-2">
                        {b.before ? (
                          <p className="text-[var(--danger-text)] break-words">
                            <span className="font-bold mr-2">[-]</span>
                            {b.before}
                          </p>
                        ) : null}
                        {b.after ? (
                          <p className="text-[var(--success-text)] break-words">
                            <span className="font-bold mr-2">[+]</span>
                            {b.after}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    {b.changeType === 'removed' && b.before ? (
                      <p className="text-[var(--mute)] line-through break-words">
                        <span className="mr-2">[-]</span>
                        {b.before}
                      </p>
                    ) : null}
                    {b.changeType === 'added' && b.after ? (
                      <p className="text-[var(--warning-text)] break-words">
                        <span className="font-bold mr-2">[+]</span>
                        {b.after}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function TailorStudioInner() {
  const searchParams = useSearchParams();
  const jobIdParam = searchParams.get('jobId');

  const [loading, setLoading] = useState(true);
  const [tailoring, setTailoring] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [downloading, setDownloading] = useState<'pdf' | 'typ' | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [catalogJobs, setCatalogJobs] = useState<JobFeedItem[]>([]);
  const [versions, setVersions] = useState<ResumeVersionRecord[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);

  const [sourceMode, setSourceMode] = useState<SourceMode>('catalog');
  const [selectedJobId, setSelectedJobId] = useState<string>('');
  const [customTitle, setCustomTitle] = useState('');
  const [customCompany, setCustomCompany] = useState('');
  const [customDescription, setCustomDescription] = useState('');
  const [customErrors, setCustomErrors] = useState<{
    jobId?: string;
    title?: string;
    company?: string;
    description?: string;
  }>({});

  const [templateId, setTemplateId] = useState<ResumeTemplateId>('ats-classic');
  const [labelOverride, setLabelOverride] = useState('');
  const [autoRepairFlagged, setAutoRepairFlagged] = useState(true);

  const [activeTab, setActiveTab] = useState<TailorTab>('diff');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [typstCopied, setTypstCopied] = useState(false);

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmFlaggedPdfOpen, setConfirmFlaggedPdfOpen] = useState(false);

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [jobsRes, versionsRes] = await Promise.all([
        api.listJobs({ limit: 50 }),
        api.listResumeVersions()
      ]);

      let mergedJobs = jobsRes.items;
      if (jobIdParam && !mergedJobs.some((item) => item.job.id === jobIdParam)) {
        try {
          const detail = await api.getJobDetail(jobIdParam);
          mergedJobs = [detail.item, ...mergedJobs];
        } catch {
          // Leave list as-is if deep-linked jobId is missing
        }
      }

      setCatalogJobs(mergedJobs);
      setVersions(versionsRes);

      if (jobIdParam) {
        setSourceMode('catalog');
        setSelectedJobId(jobIdParam);
        const matchingVersion = versionsRes.find((v) => v.jobId === jobIdParam);
        setSelectedVersionId(matchingVersion?.id ?? versionsRes[0]?.id ?? null);
      } else {
        setSelectedJobId((prev) => prev || mergedJobs[0]?.job.id || '');
        setSelectedVersionId((prev) => prev || versionsRes[0]?.id || null);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load tailor workspace.');
    } finally {
      setLoading(false);
    }
  }, [jobIdParam]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const selectedVersion = versions.find((v) => v.id === selectedVersionId) ?? null;

  const handleTailorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);

    const nextErrors: typeof customErrors = {};
    if (sourceMode === 'catalog') {
      if (!selectedJobId) {
        nextErrors.jobId = 'Select a target job or switch to Custom JD.';
      }
    } else {
      if (customTitle.trim().length < 2) {
        nextErrors.title = 'Enter a role title (at least 2 characters).';
      }
      if (customCompany.trim().length < 1) {
        nextErrors.company = 'Enter the target company name.';
      }
      if (customDescription.trim().length < 30) {
        nextErrors.description = 'Paste at least 30 characters of the job description.';
      }
    }

    setCustomErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setTailoring(true);
    try {
      const created = await api.tailorResume({
        ...(sourceMode === 'catalog'
          ? { jobId: selectedJobId }
          : {
              customJob: {
                title: customTitle.trim(),
                companyName: customCompany.trim(),
                description: customDescription.trim()
              }
            }),
        templateId,
        autoRepairFlagged,
        ...(labelOverride.trim() ? { label: labelOverride.trim() } : {})
      });

      setVersions((prev) => [created, ...prev]);
      setSelectedVersionId(created.id);
      setLabelOverride('');
      setActiveTab(created.verifierPassed ? 'diff' : 'verifier');
      setStatusMsg(
        created.verifierPassed
          ? `Created verified resume v${created.versionNumber} (${created.label}) via ${created.pdfEngine}.`
          : `Created resume v${created.versionNumber} with ${created.verifierReport.unsupportedClaimCount} flagged claim(s) — inspect Verifier Audit.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Resume tailoring failed.');
    } finally {
      setTailoring(false);
    }
  };

  const executePdfDownload = async (version: ResumeVersionRecord) => {
    setDownloading('pdf');
    setErrorMsg(null);
    try {
      await api.downloadResumePdf(version.id, `jobpilot-v${version.versionNumber}.pdf`);
      setStatusMsg(`Downloaded v${version.versionNumber} ATS PDF (${version.pdfEngine}).`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to download PDF.');
    } finally {
      setDownloading(null);
    }
  };

  const handleRequestPdfDownload = () => {
    if (!selectedVersion) return;
    if (!selectedVersion.verifierPassed) {
      setConfirmFlaggedPdfOpen(true);
      return;
    }
    void executePdfDownload(selectedVersion);
  };

  const handleDownloadTypst = async () => {
    if (!selectedVersion) return;
    setDownloading('typ');
    setErrorMsg(null);
    try {
      await api.downloadResumeTypst(selectedVersion.id, `jobpilot-v${selectedVersion.versionNumber}.typ`);
      setStatusMsg(`Downloaded Typst source for v${selectedVersion.versionNumber}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to download Typst source.');
    } finally {
      setDownloading(null);
    }
  };

  const handleReverify = async () => {
    if (!selectedVersion) return;
    setVerifying(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const updated = await api.verifyResumeVersion(selectedVersion.id);
      setVersions((prev) => prev.map((v) => (v.id === updated.id ? updated : v)));
      setStatusMsg(
        updated.verifierPassed
          ? `Dual verifier passed on v${updated.versionNumber}.`
          : `Dual verifier flagged ${updated.verifierReport.unsupportedClaimCount} claim(s) on v${updated.versionNumber}.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Verification failed.');
    } finally {
      setVerifying(false);
    }
  };

  const handleConfirmDelete = async () => {
    setConfirmDeleteOpen(false);
    if (!selectedVersion) return;
    setDeleting(true);
    setErrorMsg(null);
    try {
      const deletedId = selectedVersion.id;
      await api.deleteResumeVersion(deletedId);
      const remaining = versions.filter((v) => v.id !== deletedId);
      setVersions(remaining);
      setSelectedVersionId(remaining[0]?.id ?? null);
      setStatusMsg(`Deleted resume v${selectedVersion.versionNumber}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Delete failed.');
    } finally {
      setDeleting(false);
    }
  };

  const handleCopyTypst = async () => {
    if (!selectedVersion?.typstSource) return;
    try {
      await navigator.clipboard.writeText(selectedVersion.typstSource);
      setTypstCopied(true);
      setTimeout(() => setTypstCopied(false), 1800);
    } catch {
      setErrorMsg('Clipboard permission denied.');
    }
  };

  return (
    <AppShell
      title="Tailor Studio & Dual Verifier"
      subtitle="Select, reorder, and rephrase from your Master Profile & Story Bank ONLY — audited by deterministic + LLM checks and exported as ATS PDF."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">{versions.length} versions</Badge>
          <Badge tone="dark">MASTER-ONLY GROUNDING</Badge>
        </div>
      }
    >
      {errorMsg ? <AlertBanner tone="error" message={errorMsg} /> : null}
      {statusMsg ? <AlertBanner tone="success" message={statusMsg} /> : null}

      <ConfirmDialog
        open={confirmFlaggedPdfOpen}
        title="Download Flagged Resume PDF?"
        description="The dual verifier flagged unsupported or mismatched claims in this version. Review the Verifier Audit tab before sending this resume to employers."
        confirmLabel="Download Anyway"
        cancelLabel="Review Audit"
        onConfirm={() => {
          setConfirmFlaggedPdfOpen(false);
          if (selectedVersion) void executePdfDownload(selectedVersion);
        }}
        onCancel={() => setConfirmFlaggedPdfOpen(false)}
      />

      <ConfirmDialog
        open={confirmDeleteOpen}
        title="Delete Resume Version?"
        description={
          selectedVersion
            ? `Permanently delete v${selectedVersion.versionNumber} (${selectedVersion.label}) and its rendered PDF? Other versions remain untouched.`
            : ''
        }
        confirmLabel="Delete Version"
        cancelLabel="Cancel"
        destructive
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setConfirmDeleteOpen(false)}
      />

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-4 space-y-4">
            <SkeletonBlock className="h-72 w-full" />
            <SkeletonBlock className="h-64 w-full" />
          </div>
          <div className="lg:col-span-8">
            <SkeletonBlock className="h-[540px] w-full" />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left Column: Tailor Form + Version History */}
          <div className="lg:col-span-4 space-y-5">
            <SectionBlock
              title="New Tailored Version"
              marker="[+]"
              description="Each run creates an immutable version."
            >
              <form onSubmit={handleTailorSubmit} noValidate className="space-y-4">
                <div className="flex border border-[var(--hairline)] rounded-[4px] overflow-hidden">
                  <button
                    type="button"
                    onClick={() => {
                      setSourceMode('catalog');
                      setCustomErrors({});
                    }}
                    className={`flex-1 py-2 px-3 text-xs font-medium cursor-pointer min-h-[44px] ${
                      sourceMode === 'catalog'
                        ? 'bg-[var(--surface-dark)] text-[var(--on-dark)]'
                        : 'bg-[var(--surface-soft)] text-[var(--ink)]'
                    }`}
                  >
                    Saved / Feed Job
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSourceMode('custom');
                      setCustomErrors({});
                    }}
                    className={`flex-1 py-2 px-3 text-xs font-medium cursor-pointer min-h-[44px] border-l border-[var(--hairline)] ${
                      sourceMode === 'custom'
                        ? 'bg-[var(--surface-dark)] text-[var(--on-dark)]'
                        : 'bg-[var(--surface-soft)] text-[var(--ink)]'
                    }`}
                  >
                    Custom JD Paste
                  </button>
                </div>

                {sourceMode === 'catalog' ? (
                  <Field
                    label="Target Job"
                    htmlFor="tailor-job"
                    hint="Reuses cached JD requirements after first extraction."
                    error={customErrors.jobId}
                    required
                  >
                    {(inputProps) => (
                      <Select
                        {...inputProps}
                        value={selectedJobId}
                        onChange={(e) => setSelectedJobId(e.target.value)}
                      >
                        {catalogJobs.length === 0 ? (
                          <option value="">No catalog jobs synced — use Custom JD</option>
                        ) : (
                          catalogJobs.map((item) => (
                            <option key={item.job.id} value={item.job.id}>
                              {item.job.companyName} — {item.job.title}
                              {item.match?.llmScore != null ? ` (${item.match.llmScore}/100)` : ''}
                            </option>
                          ))
                        )}
                      </Select>
                    )}
                  </Field>
                ) : (
                  <div className="space-y-3">
                    <Field label="Role Title" htmlFor="custom-role" error={customErrors.title} required>
                      {(inputProps) => (
                        <Input
                          {...inputProps}
                          value={customTitle}
                          onChange={(e) => setCustomTitle(e.target.value)}
                          placeholder="Backend Engineer"
                        />
                      )}
                    </Field>
                    <Field label="Company Name" htmlFor="custom-company" error={customErrors.company} required>
                      {(inputProps) => (
                        <Input
                          {...inputProps}
                          value={customCompany}
                          onChange={(e) => setCustomCompany(e.target.value)}
                          placeholder="Razorpay"
                        />
                      )}
                    </Field>
                    <Field
                      label="Job Description"
                      htmlFor="custom-jd"
                      hint="Paste raw requirements, stack, and responsibilities."
                      error={customErrors.description}
                      required
                    >
                      {(inputProps) => (
                        <Textarea
                          {...inputProps}
                          rows={6}
                          value={customDescription}
                          onChange={(e) => setCustomDescription(e.target.value)}
                          placeholder="Build high-throughput TypeScript and PostgreSQL services..."
                        />
                      )}
                    </Field>
                  </div>
                )}

                <Field label="ATS PDF Layout" htmlFor="tailor-template">
                  {(inputProps) => (
                    <Select
                      {...inputProps}
                      value={templateId}
                      onChange={(e) => setTemplateId(e.target.value as ResumeTemplateId)}
                    >
                      <option value="ats-classic">ATS Classic (single-column, generous spacing)</option>
                      <option value="ats-compact">ATS Compact (tighter 1-page density)</option>
                    </Select>
                  )}
                </Field>

                <Field
                  label="Version Label (optional)"
                  htmlFor="tailor-label"
                  hint="Defaults to Company — Role Title."
                >
                  {(inputProps) => (
                    <Input
                      {...inputProps}
                      value={labelOverride}
                      onChange={(e) => setLabelOverride(e.target.value)}
                      placeholder="e.g. Payments Backend Focus"
                    />
                  )}
                </Field>

                <label className="flex items-start gap-2.5 text-xs text-[var(--body)] cursor-pointer min-h-[44px] py-1">
                  <input
                    type="checkbox"
                    checked={autoRepairFlagged}
                    onChange={(e) => setAutoRepairFlagged(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-[var(--ink)] cursor-pointer"
                  />
                  <span>
                    <strong className="text-[var(--ink)] block">Auto-repair flagged claims</strong>
                    Runs one corrective pass if Layer 1 or Layer 2 catches an ungrounded claim.
                  </span>
                </label>

                <Button type="submit" variant="primary" className="w-full" disabled={tailoring}>
                  {tailoring ? 'Tailoring, Verifying & Rendering PDF...' : '[+] Tailor & Verify Resume'}
                </Button>
              </form>
            </SectionBlock>

            <SectionBlock
              title="Immutable Versions"
              marker="[v]"
              description="Every application keeps its exact snapshot."
            >
              {versions.length === 0 ? (
                <p className="text-xs text-[var(--mute)]">
                  No tailored versions yet. Pick a job above to generate v1.
                </p>
              ) : (
                <ul className="divide-y divide-[var(--hairline)] border border-[var(--hairline)]">
                  {versions.map((ver) => {
                    const active = ver.id === selectedVersionId;
                    return (
                      <li key={ver.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedVersionId(ver.id)}
                          aria-current={active ? 'true' : undefined}
                          className={`w-full text-left p-3 cursor-pointer transition-colors min-h-[44px] ${
                            active
                              ? 'bg-[var(--surface-dark)] text-[var(--on-dark)]'
                              : 'bg-[var(--canvas)] hover:bg-[var(--surface-soft)] text-[var(--ink)]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-bold tabular-nums">v{ver.versionNumber}</span>
                            <Badge tone={ver.verifierPassed ? 'success' : 'danger'}>
                              {ver.verifierPassed ? 'VERIFIED' : 'FLAGGED'}
                            </Badge>
                          </div>
                          <p className="text-xs font-medium mt-1 truncate">{ver.label}</p>
                          <div
                            className={`flex items-center justify-between text-[11px] mt-1 ${
                              active ? 'opacity-80' : 'text-[var(--mute)]'
                            }`}
                          >
                            <span>{ver.templateId}</span>
                            <span className="tabular-nums">{formatDateTime(ver.createdAt)}</span>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </SectionBlock>
          </div>

          {/* Right Column: Diff View + Dual Verifier Audit + JD + Typst/PDF */}
          <div className="lg:col-span-8">
            {selectedVersion ? (
              <SectionBlock
                title={`v${selectedVersion.versionNumber} · ${selectedVersion.label}`}
                marker={selectedVersion.verifierPassed ? '[x]' : '[!]'}
                description={`Profile v${selectedVersion.parentProfileVersion} · ${selectedVersion.provider ?? 'llm'} / ${selectedVersion.model ?? 'default'} · PDF engine: ${selectedVersion.pdfEngine}`}
                action={
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={handleRequestPdfDownload}
                      disabled={downloading === 'pdf'}
                    >
                      {downloading === 'pdf' ? 'Downloading...' : 'Download PDF'}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void handleDownloadTypst()}
                      disabled={downloading === 'typ' || !selectedVersion.typstSource}
                    >
                      {downloading === 'typ' ? 'Downloading...' : 'Download .typ'}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void handleReverify()}
                      disabled={verifying}
                    >
                      {verifying ? 'Verifying...' : 'Re-verify'}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => setConfirmDeleteOpen(true)}
                      disabled={deleting}
                    >
                      Delete
                    </Button>
                  </div>
                }
              >
                <div className="space-y-5">
                  {/* Verifier Status Strip */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="border border-[var(--hairline)] bg-[var(--surface-soft)] p-3">
                      <span className="text-[11px] text-[var(--mute)] block">Dual Verifier</span>
                      <strong
                        className={`text-sm font-bold ${
                          selectedVersion.verifierPassed
                            ? 'text-[var(--success-text)]'
                            : 'text-[var(--danger-text)]'
                        }`}
                      >
                        {selectedVersion.verifierPassed ? '[x] PASSED' : '[!] FLAGGED'}
                      </strong>
                    </div>
                    <div className="border border-[var(--hairline)] bg-[var(--surface-soft)] p-3">
                      <span className="text-[11px] text-[var(--mute)] block">Unsupported Rate</span>
                      <strong className="text-sm font-bold tabular-nums text-[var(--ink)]">
                        {formatPercentRate(selectedVersion.verifierReport.unsupportedClaimRate)}
                      </strong>
                    </div>
                    <div className="border border-[var(--hairline)] bg-[var(--surface-soft)] p-3">
                      <span className="text-[11px] text-[var(--mute)] block">Immutable Violations</span>
                      <strong className="text-sm font-bold tabular-nums text-[var(--ink)]">
                        {selectedVersion.verifierReport.immutableFieldViolations}
                      </strong>
                    </div>
                    <div className="border border-[var(--hairline)] bg-[var(--surface-soft)] p-3">
                      <span className="text-[11px] text-[var(--mute)] block">Claims Audited</span>
                      <strong className="text-sm font-bold tabular-nums text-[var(--ink)]">
                        {selectedVersion.verifierReport.totalClaimsChecked}
                      </strong>
                    </div>
                  </div>

                  <TabStrip<TailorTab>
                    label="Tailored resume inspection views"
                    activeTab={activeTab}
                    onChange={setActiveTab}
                    tabs={[
                      { id: 'diff', label: 'Diff View' },
                      {
                        id: 'verifier',
                        label: 'Verifier Audit',
                        badge: selectedVersion.verifierReport.unsupportedClaimCount
                      },
                      {
                        id: 'jd',
                        label: 'JD Requirements',
                        badge: selectedVersion.jdRequirements.mustHaveSkills.length
                      },
                      { id: 'preview', label: 'ATS Preview & Typst' }
                    ]}
                  />

                  {activeTab === 'diff' ? (
                    <div className="space-y-5">
                      {/* Summary Diff */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--mute)]">
                            Summary Diff
                          </h3>
                          <Badge tone={selectedVersion.diffSummary.summaryChanged ? 'warning' : 'neutral'}>
                            {selectedVersion.diffSummary.summaryChanged ? '[~] REPHRASED' : '[=] UNCHANGED'}
                          </Badge>
                        </div>
                        {selectedVersion.diffSummary.summaryChanged ? (
                          <div className="border border-[var(--hairline)] bg-[var(--surface-soft)] p-3 space-y-2 text-xs">
                            {selectedVersion.diffSummary.summaryBefore ? (
                              <p className="text-[var(--danger-text)] break-words">
                                <span className="font-bold mr-2">[-] MASTER:</span>
                                {selectedVersion.diffSummary.summaryBefore}
                              </p>
                            ) : null}
                            <p className="text-[var(--success-text)] break-words">
                              <span className="font-bold mr-2">[+] TAILORED:</span>
                              {selectedVersion.diffSummary.summaryAfter}
                            </p>
                          </div>
                        ) : (
                          <p className="text-xs text-[var(--body)] border border-[var(--hairline)] p-3">
                            {selectedVersion.diffSummary.summaryAfter || 'No summary present.'}
                          </p>
                        )}
                      </div>

                      {/* Skills Diff */}
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--mute)]">
                            Skills Reordering
                          </h3>
                          <div className="flex flex-wrap gap-2">
                            {selectedVersion.diffSummary.skillsReordered ? (
                              <Badge tone="warning">[~] REORDERED FOR JD</Badge>
                            ) : (
                              <Badge tone="neutral">[=] SAME ORDER</Badge>
                            )}
                            {selectedVersion.diffSummary.skillsAdded.length > 0 ? (
                              <Badge tone="danger">
                                [!] ADDED ({selectedVersion.diffSummary.skillsAdded.length})
                              </Badge>
                            ) : null}
                          </div>
                        </div>
                        <div className="border border-[var(--hairline)] bg-[var(--surface-soft)] p-3 space-y-2 text-xs">
                          <p className="text-[var(--ink)] break-words">
                            <span className="font-bold text-[var(--mute)] mr-2">ACTIVE ORDER:</span>
                            {selectedVersion.diffSummary.skillsAfter.join(', ') || 'None'}
                          </p>
                          {selectedVersion.diffSummary.skillsDropped.length > 0 ? (
                            <p className="text-[var(--mute)] break-words">
                              <span className="font-bold mr-2">[-] OMITTED FROM PRINT:</span>
                              {selectedVersion.diffSummary.skillsDropped.join(', ')}
                            </p>
                          ) : null}
                          {selectedVersion.diffSummary.skillsAdded.length > 0 ? (
                            <p className="text-[var(--danger-text)] break-words">
                              <span className="font-bold mr-2">[!] UNGROUNDED SKILLS:</span>
                              {selectedVersion.diffSummary.skillsAdded.join(', ')}
                            </p>
                          ) : null}
                        </div>
                      </div>

                      <SectionDiffGroup
                        heading="Work Experience Diff"
                        sections={selectedVersion.diffSummary.workDiffs}
                      />
                      <SectionDiffGroup
                        heading="Projects Diff"
                        sections={selectedVersion.diffSummary.projectDiffs}
                      />
                    </div>
                  ) : null}

                  {activeTab === 'verifier' ? (
                    <div className="space-y-4">
                      <AlertBanner
                        tone={selectedVersion.verifierPassed ? 'success' : 'warning'}
                        title={
                          selectedVersion.verifierPassed
                            ? 'All claims traced back to Master Profile & Story Bank'
                            : 'One or more claims failed dual verification'
                        }
                        message={
                          selectedVersion.verifierReport.overallNotes ||
                          `Deterministic checks: ${
                            selectedVersion.verifierReport.deterministicPassed ? 'PASS' : 'FAIL'
                          } · LLM audit: ${
                            selectedVersion.verifierReport.llmVerifierPassed ? 'PASS' : 'FAIL'
                          }`
                        }
                      />

                      {selectedVersion.verifierReport.claims.length === 0 ? (
                        <p className="text-xs text-[var(--mute)]">No individual claims recorded.</p>
                      ) : (
                        <div className="divide-y divide-[var(--hairline)] border border-[var(--hairline)]">
                          {selectedVersion.verifierReport.claims.map((claim, idx) => (
                            <div key={`claim-${idx}`} className="p-3 space-y-1.5 text-xs">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge tone={claimTone(claim.status)}>
                                    {claimMarker(claim.status)}
                                  </Badge>
                                  <span className="font-bold text-[var(--ink)]">{claim.section}</span>
                                  {claim.sourceId ? (
                                    <span className="text-[var(--mute)]">src:{claim.sourceId}</span>
                                  ) : null}
                                </div>
                                <Badge tone={claim.severity === 'critical' ? 'danger' : 'neutral'}>
                                  {claim.severity}
                                </Badge>
                              </div>
                              <p className="text-[var(--ink)] break-words">{claim.claim}</p>
                              {claim.evidence ? (
                                <p className="text-[var(--mute)] break-words">
                                  Evidence: {claim.evidence}
                                </p>
                              ) : null}
                              {claim.issue ? (
                                <p className="text-[var(--danger-text)] font-medium break-words">
                                  [!] {claim.issue}
                                </p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}

                  {activeTab === 'jd' ? (
                    <div className="space-y-4 text-xs">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="border border-[var(--hairline)] p-3">
                          <span className="text-[var(--mute)] block mb-1">Role & Company</span>
                          <strong className="text-sm text-[var(--ink)]">
                            {selectedVersion.jdRequirements.roleTitle} @{' '}
                            {selectedVersion.jdRequirements.companyName}
                          </strong>
                        </div>
                        <div className="border border-[var(--hairline)] p-3">
                          <span className="text-[var(--mute)] block mb-1">Seniority Signals</span>
                          <span className="text-[var(--ink)]">
                            {selectedVersion.jdRequirements.senioritySignals.join(', ') || 'Unspecified'}
                          </span>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <h3 className="font-bold uppercase tracking-wider text-[var(--mute)]">
                          Must-Have Skills
                        </h3>
                        <div className="flex flex-wrap gap-1.5">
                          {selectedVersion.jdRequirements.mustHaveSkills.map((skill) => (
                            <Badge key={skill} tone="dark">
                              {skill}
                            </Badge>
                          ))}
                        </div>
                      </div>

                      {selectedVersion.jdRequirements.niceToHaveSkills.length > 0 ? (
                        <div className="space-y-1.5">
                          <h3 className="font-bold uppercase tracking-wider text-[var(--mute)]">
                            Nice-To-Have Skills
                          </h3>
                          <div className="flex flex-wrap gap-1.5">
                            {selectedVersion.jdRequirements.niceToHaveSkills.map((skill) => (
                              <Badge key={skill} tone="neutral">
                                {skill}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {selectedVersion.jdRequirements.keyResponsibilities.length > 0 ? (
                        <div className="space-y-1.5">
                          <h3 className="font-bold uppercase tracking-wider text-[var(--mute)]">
                            Key Responsibilities
                          </h3>
                          <ul className="list-disc pl-5 space-y-1 text-[var(--body)]">
                            {selectedVersion.jdRequirements.keyResponsibilities.map((r, i) => (
                              <li key={`resp-${i}`}>{r}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {activeTab === 'preview' ? (
                    <div className="space-y-5">
                      {/* Single-column ATS HTML Preview */}
                      <div className="border border-[var(--hairline-strong)] bg-[var(--canvas)] p-5 space-y-4 text-xs">
                        <header className="border-b border-[var(--hairline)] pb-3 space-y-1">
                          <h3 className="text-lg font-bold text-[var(--ink)]">
                            {selectedVersion.tailoredJsonResume.basics.name || 'Candidate'}
                          </h3>
                          {selectedVersion.tailoredJsonResume.basics.label ? (
                            <p className="text-[var(--body)]">
                              {selectedVersion.tailoredJsonResume.basics.label}
                            </p>
                          ) : null}
                          <p className="text-[var(--mute)]">
                            {[
                              selectedVersion.tailoredJsonResume.basics.email,
                              selectedVersion.tailoredJsonResume.basics.phone,
                              selectedVersion.tailoredJsonResume.basics.location?.city
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        </header>

                        {selectedVersion.tailoredJsonResume.basics.summary ? (
                          <div>
                            <h4 className="font-bold text-[var(--mute)] uppercase mb-1">Summary</h4>
                            <p className="text-[var(--body)] leading-relaxed">
                              {selectedVersion.tailoredJsonResume.basics.summary}
                            </p>
                          </div>
                        ) : null}

                        {selectedVersion.tailoredJsonResume.skills.length > 0 ? (
                          <div>
                            <h4 className="font-bold text-[var(--mute)] uppercase mb-1">Skills</h4>
                            <div className="space-y-1">
                              {selectedVersion.tailoredJsonResume.skills.map((grp, i) => (
                                <p key={`sg-${i}`} className="text-[var(--body)]">
                                  <strong className="text-[var(--ink)]">{grp.name}:</strong>{' '}
                                  {grp.keywords.join(', ')}
                                </p>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {selectedVersion.tailoredJsonResume.work.length > 0 ? (
                          <div className="space-y-2.5">
                            <h4 className="font-bold text-[var(--mute)] uppercase">Experience</h4>
                            {selectedVersion.tailoredJsonResume.work.map((w, i) => (
                              <div key={`pw-${i}`} className="space-y-1">
                                <div className="flex flex-wrap justify-between gap-2">
                                  <strong className="text-[var(--ink)]">
                                    {w.position} — {w.name}
                                  </strong>
                                  <span className="text-[var(--mute)] tabular-nums">
                                    {w.startDate} – {w.endDate || 'Present'}
                                  </span>
                                </div>
                                <ul className="list-disc pl-5 space-y-0.5 text-[var(--body)]">
                                  {w.highlights.map((h, hi) => (
                                    <li key={`pwh-${hi}`}>{h}</li>
                                  ))}
                                </ul>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        {selectedVersion.tailoredJsonResume.projects.length > 0 ? (
                          <div className="space-y-2.5">
                            <h4 className="font-bold text-[var(--mute)] uppercase">Projects</h4>
                            {selectedVersion.tailoredJsonResume.projects.map((p, i) => (
                              <div key={`pp-${i}`} className="space-y-1">
                                <strong className="text-[var(--ink)]">{p.name}</strong>
                                {p.description ? (
                                  <p className="text-[var(--body)]">{p.description}</p>
                                ) : null}
                                <ul className="list-disc pl-5 space-y-0.5 text-[var(--body)]">
                                  {p.highlights.map((h, hi) => (
                                    <li key={`pph-${hi}`}>{h}</li>
                                  ))}
                                </ul>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        {selectedVersion.tailoredJsonResume.education.length > 0 ? (
                          <div className="space-y-1.5">
                            <h4 className="font-bold text-[var(--mute)] uppercase">Education</h4>
                            {selectedVersion.tailoredJsonResume.education.map((e, i) => (
                              <div key={`pe-${i}`} className="flex flex-wrap justify-between gap-2">
                                <span className="text-[var(--body)]">
                                  <strong className="text-[var(--ink)]">{e.institution}</strong>
                                  {e.studyType || e.area
                                    ? ` · ${[e.studyType, e.area].filter(Boolean).join(' ')}`
                                    : ''}
                                  {e.score ? ` · CGPA ${e.score}` : ''}
                                </span>
                                <span className="text-[var(--mute)] tabular-nums">
                                  {e.startDate} – {e.endDate}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>

                      {/* Raw Typst Source */}
                      {selectedVersion.typstSource ? (
                        <div className="border border-[var(--hairline)] bg-[var(--surface-soft)]">
                          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[var(--hairline)]">
                            <span className="text-xs font-bold text-[var(--ink)]">
                              Typst Source (.typ)
                            </span>
                            <Button size="sm" variant="ghost" onClick={() => void handleCopyTypst()}>
                              {typstCopied ? '[x] Copied' : 'Copy Typst'}
                            </Button>
                          </div>
                          <pre className="p-3 text-[11px] leading-relaxed text-[var(--body)] overflow-x-auto max-h-72">
                            {selectedVersion.typstSource}
                          </pre>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </SectionBlock>
            ) : (
              <EmptyState
                title="No tailored resume selected"
                description="Choose a target job (or paste a custom JD) on the left to extract requirements, rephrase and reorder strictly from your Master Profile, run the Dual Verifier, and render a downloadable single-column ATS PDF."
              />
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}

export default function TailorPage() {
  return (
    <Suspense
      fallback={
        <AppShell title="Tailor Studio & Dual Verifier" subtitle="Loading tailoring workspace...">
          <SkeletonBlock className="h-[520px] w-full" />
        </AppShell>
      }
    >
      <TailorStudioInner />
    </Suspense>
  );
}
