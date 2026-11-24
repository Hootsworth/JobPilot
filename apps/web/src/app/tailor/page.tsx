'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type {
  AtsScoreReport,
  JobFeedItem,
  ProfileVariantRecord,
  ResumeSectionDiffSchema,
  ResumeTemplateId,
  ResumeVersionRecord,
  VerifierClaim
} from '@jobpilot/shared';
import type { z } from 'zod';
import { AppShell } from '@/components/layout/app-shell';
import { AtsScorePanel } from '@/components/tailor/ats-score-panel';
import { CoverLetterWorkbench } from '@/components/tailor/cover-letter-workbench';
import { GeneratingStage } from '@/components/tailor/generating-stage';
import { PdfPreviewFrame } from '@/components/tailor/pdf-preview-frame';
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
import { pluralize } from '@/lib/format';

type StudioMode = 'resume' | 'cover-letter';
type ResumeStage = 'compose' | 'generating' | 'viewer';
type TailorTab = 'pdf' | 'ats' | 'diff' | 'verifier' | 'jd' | 'preview';
type AtsCheckMode = 'target' | 'custom';
type SourceMode = 'catalog' | 'custom';
type SectionDiff = z.infer<typeof ResumeSectionDiffSchema>;

const RESUME_GENERATING_STEPS = [
  'Extracting job requirements and core skills',
  'Matching relevant experience from your profile',
  'Rephrasing and ordering bullets for the role',
  'Verifying every claim against your profile',
  'Compiling ATS-ready single-column PDF'
];

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
  if (status === 'verified') return 'Verified';
  if (status === 'rephrased_ok') return 'Rephrased';
  return 'Needs review';
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
                    ? 'Kept'
                    : sec.status === 'reordered'
                      ? `Moved #${sec.masterIndex + 1} to #${(sec.tailoredIndex ?? 0) + 1}`
                      : 'Omitted'}
                </Badge>
              </div>
            </div>

            {sec.bulletDiffs.length > 0 ? (
              <div className="space-y-1.5 border-t border-[var(--hairline)] pt-2">
                {sec.bulletDiffs.map((b, idx) => (
                  <div key={`${sec.id}-b-${idx}`} className="text-xs space-y-1">
                    {b.changeType === 'unchanged' ? (
                      <p className="text-[var(--body)] break-words">{b.after ?? b.before}</p>
                    ) : null}
                    {b.changeType === 'rephrased' ? (
                      <div className="space-y-1 bg-[var(--canvas)] border border-[var(--hairline)] p-2">
                        {b.before ? (
                          <p className="text-[var(--danger-text)] break-words">
                            <span className="font-bold mr-2">Before:</span>
                            {b.before}
                          </p>
                        ) : null}
                        {b.after ? (
                          <p className="text-[var(--success-text)] break-words">
                            <span className="font-bold mr-2">After:</span>
                            {b.after}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    {b.changeType === 'removed' && b.before ? (
                      <p className="text-[var(--mute)] line-through break-words">{b.before}</p>
                    ) : null}
                    {b.changeType === 'added' && b.after ? (
                      <p className="text-[var(--warning-text)] break-words">
                        <span className="font-bold mr-2">Added:</span>
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
  const [studioMode, setStudioMode] = useState<StudioMode>('resume');
  const [resumeStage, setResumeStage] = useState<ResumeStage>('compose');
  const [generatingTarget, setGeneratingTarget] = useState('');
  const [coverLetterGenerating, setCoverLetterGenerating] = useState(false);
  const [variants, setVariants] = useState<ProfileVariantRecord[]>([]);
  const [profileVariantId, setProfileVariantId] = useState<string>('');
  const [versions, setVersions] = useState<ResumeVersionRecord[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);

  const [atsByVersionId, setAtsByVersionId] = useState<Record<string, AtsScoreReport>>({});
  const [atsLoading, setAtsLoading] = useState(false);
  const [atsMode, setAtsMode] = useState<AtsCheckMode>('target');

  // In-viewer custom JD ATS checker state
  const [chkTargetKind, setChkTargetKind] = useState<'variant' | 'version'>('version');
  const [chkVariantId, setChkVariantId] = useState<string>('');
  const [chkJdSource, setChkJdSource] = useState<'catalog' | 'custom'>('custom');
  const [chkJobId, setChkJobId] = useState<string>('');
  const [chkTitle, setChkTitle] = useState('');
  const [chkCompany, setChkCompany] = useState('');
  const [chkJdText, setChkJdText] = useState('');
  const [chkLoading, setChkLoading] = useState(false);
  const [chkReport, setChkReport] = useState<AtsScoreReport | null>(null);

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

  const [activeTab, setActiveTab] = useState<TailorTab>('pdf');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [typstCopied, setTypstCopied] = useState(false);

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmFlaggedPdfOpen, setConfirmFlaggedPdfOpen] = useState(false);

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [jobsRes, versionsRes, variantsRes] = await Promise.all([
        api.listJobs({ limit: 50 }),
        api.listResumeVersions(),
        api.listProfileVariants()
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
      setVariants(variantsRes);
      setChkJobId((prev) => prev || mergedJobs[0]?.job.id || '');

      if (jobIdParam) {
        setSourceMode('catalog');
        setSelectedJobId(jobIdParam);
        const matchingVersion = versionsRes.find((v) => v.jobId === jobIdParam);
        setSelectedVersionId(matchingVersion?.id ?? versionsRes[0]?.id ?? null);
        setResumeStage('compose');
      } else if (versionsRes.length > 0) {
        setSelectedJobId((prev) => prev || mergedJobs[0]?.job.id || '');
        setSelectedVersionId((prev) => prev || versionsRes[0]?.id || null);
        setResumeStage('viewer');
      } else {
        setSelectedJobId((prev) => prev || mergedJobs[0]?.job.id || '');
        setSelectedVersionId(null);
        setResumeStage('compose');
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

  useEffect(() => {
    if (activeTab !== 'ats' || atsMode !== 'target' || !selectedVersion) return;
    if (atsByVersionId[selectedVersion.id]) return;

    let active = true;
    setAtsLoading(true);
    void api
      .scoreResumeAts({ resumeVersionId: selectedVersion.id })
      .then((report) => {
        if (active) {
          setAtsByVersionId((prev) => ({ ...prev, [selectedVersion.id]: report }));
        }
      })
      .catch(() => {
        // Keep panel silent if ATS compute errors
      })
      .finally(() => {
        if (active) setAtsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeTab, atsMode, selectedVersion, atsByVersionId]);

  const handleRunStandaloneAts = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (chkTargetKind === 'version' && !selectedVersion) {
      setErrorMsg('Select a tailored resume version or switch to Master Profile Variant.');
      return;
    }
    if (chkJdSource === 'catalog' && !chkJobId) {
      setErrorMsg('Select a saved/feed job or paste a custom JD.');
      return;
    }
    if (chkJdSource === 'custom' && chkJdText.trim().length < 20) {
      setErrorMsg('Paste at least 20 characters of job description text.');
      return;
    }

    setChkLoading(true);
    try {
      const report = await api.scoreResumeAts({
        ...(chkTargetKind === 'version' && selectedVersion
          ? { resumeVersionId: selectedVersion.id }
          : chkVariantId
            ? { profileVariantId: chkVariantId }
            : {}),
        ...(chkJdSource === 'catalog'
          ? { jobId: chkJobId }
          : {
              customJob: {
                title: chkTitle.trim() || 'Target Role',
                companyName: chkCompany.trim(),
                description: chkJdText.trim()
              }
            })
      });
      setChkReport(report);
      moToast(`ATS score: ${report.overallScore}%`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to calculate ATS score.');
    } finally {
      setChkLoading(false);
    }
  };

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

    const catalogJob =
      sourceMode === 'catalog'
        ? catalogJobs.find((item) => item.job.id === selectedJobId)?.job
        : null;
    const targetLabel =
      sourceMode === 'catalog'
        ? catalogJob
          ? `${catalogJob.companyName} — ${catalogJob.title}`
          : 'Target role'
        : `${customCompany.trim()} — ${customTitle.trim()}`;

    setGeneratingTarget(targetLabel);
    setTailoring(true);
    setResumeStage('generating');

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
        ...(profileVariantId ? { profileVariantId } : {}),
        templateId,
        autoRepairFlagged,
        ...(labelOverride.trim() ? { label: labelOverride.trim() } : {})
      });

      setVersions((prev) => [created, ...prev]);
      setSelectedVersionId(created.id);
      setLabelOverride('');
      setActiveTab(created.verifierPassed ? 'pdf' : 'verifier');
      setAtsMode('target');
      setChkReport(null);
      setResumeStage('viewer');
      if (!created.verifierPassed) {
        setStatusMsg(
          `Created v${created.versionNumber} with ${created.verifierReport.unsupportedClaimCount} flagged claim(s) — check Verification.`
        );
      }
      moToast(`Created resume v${created.versionNumber}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Resume tailoring failed.');
      setResumeStage('compose');
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
      if (remaining.length === 0) {
        setResumeStage('compose');
      }
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

  const hideStudioTabs =
    (studioMode === 'resume' && resumeStage === 'generating') ||
    (studioMode === 'cover-letter' && coverLetterGenerating);

  return (
    <AppShell
      title="Tailor"
      actions={
        <div className="flex items-center gap-2 text-xs text-[var(--mute)] tabular-nums">
          <span>{pluralize(versions.length, 'version')}</span>
        </div>
      }
    >
      {errorMsg ? <AlertBanner tone="error" message={errorMsg} /> : null}
      {statusMsg ? <AlertBanner tone="success" message={statusMsg} /> : null}

      {!hideStudioTabs ? (
        <div className="mb-5">
          <TabStrip<StudioMode>
            label="Tailor studio workflows"
            activeTab={studioMode}
            onChange={setStudioMode}
            tabs={[
              { id: 'resume', label: 'Resume', badge: versions.length },
              { id: 'cover-letter', label: 'Cover Letter' }
            ]}
          />
        </div>
      ) : null}

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
        <SkeletonBlock className="h-[540px] w-full" />
      ) : studioMode === 'cover-letter' ? (
        <CoverLetterWorkbench
          catalogJobs={catalogJobs}
          variants={variants}
          defaultJobId={jobIdParam || undefined}
          onGeneratingChange={setCoverLetterGenerating}
        />
      ) : resumeStage === 'generating' ? (
        <GeneratingStage
          heading="Making your tailored resume..."
          targetLabel={generatingTarget || 'Target role'}
          subtitle="Grounded strictly in your Master Profile and Story Bank."
          steps={RESUME_GENERATING_STEPS}
        />
      ) : resumeStage === 'compose' || !selectedVersion ? (
        <div className="max-w-3xl mx-auto space-y-6">
          <SectionBlock
            title="Tailor a resume"
            description="Choose a target job and layout. Once generated, your resume opens full-screen with PDF preview, diff, verification, and ATS check."
            action={
              versions.length > 0 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setResumeStage('viewer')}
                >
                  Back to viewer ({versions.length})
                </Button>
              ) : undefined
            }
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
                  Custom JD
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
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                  </div>
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Source Profile Variant" htmlFor="tailor-variant">
                  {(inputProps) => (
                    <Select
                      {...inputProps}
                      value={profileVariantId}
                      onChange={(e) => setProfileVariantId(e.target.value)}
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

                <Field label="ATS PDF Layout" htmlFor="tailor-template">
                  {(inputProps) => (
                    <Select
                      {...inputProps}
                      value={templateId}
                      onChange={(e) => setTemplateId(e.target.value as ResumeTemplateId)}
                    >
                      <option value="ats-classic">ATS Classic (single-column, balanced 1-page)</option>
                      <option value="ats-compact">ATS Compact (tighter 1-page density)</option>
                      <option value="ats-detailed">ATS Detailed (2-page engineering + coursework/certs)</option>
                      <option value="ats-executive">ATS Executive (classic single-column serif)</option>
                    </Select>
                  )}
                </Field>
              </div>

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

              <div className="pt-1">
                <Button
                  type="submit"
                  variant="primary"
                  className="w-full sm:w-auto"
                  disabled={tailoring}
                >
                  Tailor resume
                </Button>
              </div>
            </form>
          </SectionBlock>

          {versions.length > 0 ? (
            <SectionBlock
              title="Saved versions"
              description="Open any previously tailored resume full-screen."
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-stretch">
                {versions.map((ver) => (
                  <button
                    key={ver.id}
                    type="button"
                    onClick={() => {
                      setSelectedVersionId(ver.id);
                      setAtsMode('target');
                      setChkReport(null);
                      setResumeStage('viewer');
                    }}
                    className="h-full flex flex-col justify-between text-left p-3.5 border border-[var(--hairline)] bg-[var(--canvas)] hover:bg-[var(--surface-soft)] transition-colors cursor-pointer"
                  >
                    <div className="space-y-2 w-full">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold tabular-nums text-[var(--ink)]">
                          v{ver.versionNumber}
                        </span>
                        <Badge tone={ver.verifierPassed ? 'success' : 'danger'}>
                          {ver.verifierPassed ? 'Passed' : 'Needs review'}
                        </Badge>
                      </div>
                      <p className="text-xs font-medium text-[var(--ink)] line-clamp-2">{ver.label}</p>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-[var(--mute)] mt-3 pt-2 border-t border-[var(--hairline)] w-full">
                      <span>{ver.templateId}</span>
                      <span className="tabular-nums">{formatDateTime(ver.createdAt)}</span>
                    </div>
                  </button>
                ))}
              </div>
            </SectionBlock>
          ) : null}
        </div>
      ) : (
        <div className="w-full space-y-5">
          {/* Full-screen Viewer Top Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border border-[var(--hairline)] bg-[var(--surface-card)] p-3 sm:px-4">
            <div className="flex flex-wrap items-center gap-2.5 min-w-0 flex-1">
              <Select
                aria-label="Select tailored resume version"
                className="max-w-md"
                value={selectedVersion.id}
                onChange={(e) => {
                  setSelectedVersionId(e.target.value);
                  setChkReport(null);
                  setAtsMode('target');
                }}
              >
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    v{v.versionNumber} · {v.label}
                  </option>
                ))}
              </Select>
              <Badge tone={selectedVersion.verifierPassed ? 'success' : 'danger'}>
                {selectedVersion.verifierPassed ? 'Passed' : 'Needs review'}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="primary"
                onClick={() => setResumeStage('compose')}
              >
                New resume
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={handleRequestPdfDownload}
                disabled={downloading === 'pdf'}
              >
                {downloading === 'pdf' ? 'Downloading...' : 'Download PDF'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void handleDownloadTypst()}
                disabled={downloading === 'typ' || !selectedVersion.typstSource}
              >
                {downloading === 'typ' ? 'Downloading...' : 'Download .typ'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void handleReverify()}
                disabled={verifying}
              >
                {verifying ? 'Verifying...' : 'Re-verify'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="danger"
                onClick={() => setConfirmDeleteOpen(true)}
                disabled={deleting}
              >
                Delete
              </Button>
            </div>
          </div>

          <SectionBlock
            title={`v${selectedVersion.versionNumber} · ${selectedVersion.label}`}
            description={`Profile v${selectedVersion.parentProfileVersion} · ${selectedVersion.templateId} · ${formatDateTime(selectedVersion.createdAt)}`}
          >
            <div className="space-y-5">
              {/* Verifier Status Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-[var(--hairline)] border border-[var(--hairline)]">
                <div className="bg-[var(--surface-soft)] p-3">
                  <span className="text-[11px] text-[var(--mute)] block">Verification</span>
                  <strong
                    className={`text-sm font-bold ${
                      selectedVersion.verifierPassed
                        ? 'text-[var(--success-text)]'
                        : 'text-[var(--danger-text)]'
                    }`}
                  >
                    {selectedVersion.verifierPassed ? 'Passed' : 'Needs review'}
                  </strong>
                </div>
                <div className="bg-[var(--surface-soft)] p-3">
                  <span className="text-[11px] text-[var(--mute)] block">Unsupported Rate</span>
                  <strong className="text-sm font-bold tabular-nums text-[var(--ink)]">
                    {formatPercentRate(selectedVersion.verifierReport.unsupportedClaimRate)}
                  </strong>
                </div>
                <div className="bg-[var(--surface-soft)] p-3">
                  <span className="text-[11px] text-[var(--mute)] block">Immutable Violations</span>
                  <strong className="text-sm font-bold tabular-nums text-[var(--ink)]">
                    {selectedVersion.verifierReport.immutableFieldViolations}
                  </strong>
                </div>
                <div className="bg-[var(--surface-soft)] p-3">
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
                  { id: 'pdf', label: 'PDF Preview' },
                  {
                    id: 'ats',
                    label: 'ATS Check',
                    badge: atsByVersionId[selectedVersion.id]?.overallScore
                  },
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
                  { id: 'preview', label: 'HTML & Typst' }
                ]}
              />

              {activeTab === 'pdf' ? (
                <PdfPreviewFrame
                  id={selectedVersion.id}
                  kind="resume"
                  title={`Resume v${selectedVersion.versionNumber} preview`}
                  onDownload={handleRequestPdfDownload}
                />
              ) : null}

              {activeTab === 'ats' ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[var(--hairline)]">
                    <div className="inline-flex border border-[var(--hairline)] rounded-[4px] overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setAtsMode('target')}
                        className={`px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors ${
                          atsMode === 'target'
                            ? 'bg-[var(--surface-dark)] text-[var(--on-dark)]'
                            : 'bg-[var(--surface-soft)] text-[var(--ink)] hover:bg-[var(--surface-card)]'
                        }`}
                      >
                        This role&apos;s JD
                      </button>
                      <button
                        type="button"
                        onClick={() => setAtsMode('custom')}
                        className={`px-3 py-1.5 text-xs font-medium cursor-pointer border-l border-[var(--hairline)] transition-colors ${
                          atsMode === 'custom'
                            ? 'bg-[var(--surface-dark)] text-[var(--on-dark)]'
                            : 'bg-[var(--surface-soft)] text-[var(--ink)] hover:bg-[var(--surface-card)]'
                        }`}
                      >
                        Check another JD
                      </button>
                    </div>
                    <span className="text-xs text-[var(--mute)]">
                      Deterministic skill, synonym, and impact audit.
                    </span>
                  </div>

                  {atsMode === 'target' ? (
                    atsLoading && !atsByVersionId[selectedVersion.id] ? (
                      <SkeletonBlock className="h-72 w-full" />
                    ) : atsByVersionId[selectedVersion.id] ? (
                      <AtsScorePanel report={atsByVersionId[selectedVersion.id]!} />
                    ) : (
                      <p className="text-xs text-[var(--mute)]">Unable to compute ATS score.</p>
                    )
                  ) : (
                    <div className="space-y-5">
                      <form
                        onSubmit={(e) => void handleRunStandaloneAts(e)}
                        className="border border-[var(--hairline)] bg-[var(--surface-soft)] p-4 space-y-4"
                      >
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <Field label="Resume to audit" htmlFor="chk-kind">
                            {(props) => (
                              <Select
                                {...props}
                                value={chkTargetKind}
                                onChange={(e) =>
                                  setChkTargetKind(e.target.value as 'variant' | 'version')
                                }
                              >
                                <option value="version">
                                  Current version (v{selectedVersion.versionNumber})
                                </option>
                                <option value="variant">Master profile variant</option>
                              </Select>
                            )}
                          </Field>

                          <Field label="Target JD source" htmlFor="chk-jd-src">
                            {(props) => (
                              <Select
                                {...props}
                                value={chkJdSource}
                                onChange={(e) =>
                                  setChkJdSource(e.target.value as 'catalog' | 'custom')
                                }
                              >
                                <option value="custom">Paste custom JD</option>
                                <option value="catalog">Saved / Feed Job</option>
                              </Select>
                            )}
                          </Field>
                        </div>

                        {chkTargetKind === 'variant' ? (
                          <Field label="Profile Variant" htmlFor="chk-variant">
                            {(props) => (
                              <Select
                                {...props}
                                value={chkVariantId}
                                onChange={(e) => setChkVariantId(e.target.value)}
                              >
                                <option value="">Active Default Variant</option>
                                {variants.map((v) => (
                                  <option key={v.id} value={v.id}>
                                    {v.name} {v.isDefault ? '(Default)' : ''}
                                  </option>
                                ))}
                              </Select>
                            )}
                          </Field>
                        ) : null}

                        {chkJdSource === 'catalog' ? (
                          <Field label="Job" htmlFor="chk-job">
                            {(props) => (
                              <Select
                                {...props}
                                value={chkJobId}
                                onChange={(e) => setChkJobId(e.target.value)}
                              >
                                {catalogJobs.map((j) => (
                                  <option key={j.job.id} value={j.job.id}>
                                    {j.job.companyName} — {j.job.title}
                                  </option>
                                ))}
                              </Select>
                            )}
                          </Field>
                        ) : (
                          <div className="space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <Field label="Role Title" htmlFor="chk-title">
                                {(props) => (
                                  <Input
                                    {...props}
                                    value={chkTitle}
                                    onChange={(e) => setChkTitle(e.target.value)}
                                    placeholder="e.g. Backend Software Engineer"
                                  />
                                )}
                              </Field>
                              <Field label="Company (optional)" htmlFor="chk-company">
                                {(props) => (
                                  <Input
                                    {...props}
                                    value={chkCompany}
                                    onChange={(e) => setChkCompany(e.target.value)}
                                    placeholder="e.g. Razorpay"
                                  />
                                )}
                              </Field>
                            </div>
                            <Field label="Job Description" htmlFor="chk-jd" required>
                              {(props) => (
                                <Textarea
                                  {...props}
                                  rows={5}
                                  value={chkJdText}
                                  onChange={(e) => setChkJdText(e.target.value)}
                                  placeholder="Paste full JD requirements & nice-to-haves..."
                                />
                              )}
                            </Field>
                          </div>
                        )}

                        <Button type="submit" variant="primary" disabled={chkLoading}>
                          {chkLoading ? 'Scoring...' : 'Run ATS Check'}
                        </Button>
                      </form>

                      {chkReport ? <AtsScorePanel report={chkReport} /> : null}
                    </div>
                  )}
                </div>
              ) : null}

              {activeTab === 'diff' ? (
                <div className="space-y-5">
                  {/* Summary Diff */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--mute)]">
                        Summary Diff
                      </h3>
                      <Badge tone={selectedVersion.diffSummary.summaryChanged ? 'warning' : 'neutral'}>
                        {selectedVersion.diffSummary.summaryChanged ? 'Rephrased' : 'Unchanged'}
                      </Badge>
                    </div>
                    {selectedVersion.diffSummary.summaryChanged ? (
                      <div className="border border-[var(--hairline)] bg-[var(--surface-soft)] p-3 space-y-2 text-xs">
                        {selectedVersion.diffSummary.summaryBefore ? (
                          <p className="text-[var(--danger-text)] break-words">
                            <span className="font-bold mr-2">Before:</span>
                            {selectedVersion.diffSummary.summaryBefore}
                          </p>
                        ) : null}
                        <p className="text-[var(--success-text)] break-words">
                          <span className="font-bold mr-2">After:</span>
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
                          <Badge tone="warning">Reordered</Badge>
                        ) : (
                          <Badge tone="neutral">Original order</Badge>
                        )}
                        {selectedVersion.diffSummary.skillsAdded.length > 0 ? (
                          <Badge tone="danger">
                            Added ({selectedVersion.diffSummary.skillsAdded.length})
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
                          <span className="font-bold mr-2">Omitted:</span>
                          {selectedVersion.diffSummary.skillsDropped.join(', ')}
                        </p>
                      ) : null}
                      {selectedVersion.diffSummary.skillsAdded.length > 0 ? (
                        <p className="text-[var(--danger-text)] break-words">
                          <span className="font-bold mr-2">Unsupported skills:</span>
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
                              {claim.issue}
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
                      <span className="text-[var(--mute)] block mb-1">Role &amp; Company</span>
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
                          {typstCopied ? 'Copied' : 'Copy Typst'}
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
        </div>
      )}
    </AppShell>
  );
}

export default function TailorPage() {
  return (
    <Suspense
      fallback={
        <AppShell title="Tailor">
          <SkeletonBlock className="h-[520px] w-full" />
        </AppShell>
      }
    >
      <TailorStudioInner />
    </Suspense>
  );
}
