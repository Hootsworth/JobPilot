'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type {
  ApplicationEventRecord,
  ApplicationRecord,
  ApplicationStatus,
  CoverLetterRecord,
  ResumeVersionRecord
} from '@jobpilot/shared';
import { AppShell } from '@/components/layout/app-shell';
import { MoCount, MoDecode, moToast } from '@/components/ui/mo';
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
  Textarea
} from '@/components/ui/primitives';
import { api } from '@/lib/api';

const STATUS_OPTIONS: Array<{ value: ApplicationStatus; label: string; marker: string }> = [
  { value: 'saved', label: 'SAVED', marker: '[·]' },
  { value: 'applied', label: 'APPLIED', marker: '[>]' },
  { value: 'interview', label: 'INTERVIEW', marker: '[*]' },
  { value: 'offer', label: 'OFFER', marker: '[+]' },
  { value: 'rejected', label: 'REJECTED', marker: '[x]' },
  { value: 'withdrawn', label: 'WITHDRAWN', marker: '[-]' }
];

function statusTone(
  status: ApplicationStatus
): 'neutral' | 'dark' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'offer':
      return 'success';
    case 'interview':
      return 'dark';
    case 'applied':
      return 'warning';
    case 'rejected':
      return 'danger';
    default:
      return 'neutral';
  }
}

function toDateInputValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function addDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

function isFollowUpDueOrUpcoming(iso: string | null): {
  state: 'overdue' | 'upcoming' | 'future' | 'none';
  label: string;
} {
  if (!iso) return { state: 'none', label: '' };
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return { state: 'none', label: '' };
  const now = Date.now();
  const diffHours = (target - now) / (1000 * 60 * 60);
  const dateStr = new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
  if (diffHours <= 0) {
    return { state: 'overdue', label: `[!] OVERDUE (${dateStr})` };
  }
  if (diffHours <= 48) {
    return { state: 'upcoming', label: `[!] DUE SOON (${dateStr})` };
  }
  return { state: 'future', label: `FOLLOW-UP: ${dateStr}` };
}

export default function TrackerPage() {
  const [applications, setApplications] = useState<ApplicationRecord[]>([]);
  const [resumeVersions, setResumeVersions] = useState<ResumeVersionRecord[]>([]);
  const [coverLetters, setCoverLetters] = useState<CoverLetterRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [events, setEvents] = useState<ApplicationEventRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | ApplicationStatus>('all');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Collapsible manual log form
  const [showNewForm, setShowNewForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newCompany, setNewCompany] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newLocation, setNewLocation] = useState('Bengaluru, India');
  const [newStatus, setNewStatus] = useState<ApplicationStatus>('applied');
  const [newResumeId, setNewResumeId] = useState<string>('');
  const [newCoverLetterId, setNewCoverLetterId] = useState<string>('');
  const [newFollowUpDate, setNewFollowUpDate] = useState<string>('');
  const [newFollowUpNote, setNewFollowUpNote] = useState<string>('');
  const [newSalaryOffered, setNewSalaryOffered] = useState<string>('');
  const [newNotes, setNewNotes] = useState<string>('');

  // Inspector edit state
  const [editStatus, setEditStatus] = useState<ApplicationStatus>('saved');
  const [editResumeId, setEditResumeId] = useState<string>('');
  const [editCoverLetterId, setEditCoverLetterId] = useState<string>('');
  const [editFollowUpDate, setEditFollowUpDate] = useState<string>('');
  const [editFollowUpNote, setEditFollowUpNote] = useState<string>('');
  const [editSalaryOffered, setEditSalaryOffered] = useState<string>('');
  const [editNotes, setEditNotes] = useState<string>('');
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [appsRes, versionsRes, lettersRes] = await Promise.all([
        api.listApplications(),
        api.listResumeVersions(),
        api.listCoverLetters()
      ]);
      setApplications(appsRes.items);
      setResumeVersions(versionsRes);
      setCoverLetters(lettersRes);
      if (appsRes.items.length > 0 && !selectedId) {
        setSelectedId(appsRes.items[0]!.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load application tracker.');
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const filteredApplications = useMemo(() => {
    if (statusFilter === 'all') return applications;
    return applications.filter((a) => a.status === statusFilter);
  }, [applications, statusFilter]);

  const selectedApplication = useMemo(
    () => applications.find((a) => a.id === selectedId) ?? null,
    [applications, selectedId]
  );

  // Sync inspector fields and load events when selectedApplication changes
  useEffect(() => {
    if (!selectedApplication) {
      setEvents([]);
      return;
    }
    setEditStatus(selectedApplication.status);
    setEditResumeId(selectedApplication.resumeVersionId ?? '');
    setEditCoverLetterId(selectedApplication.coverLetterId ?? '');
    setEditFollowUpDate(toDateInputValue(selectedApplication.nextFollowUpAt));
    setEditFollowUpNote(selectedApplication.followUpNote ?? '');
    setEditSalaryOffered(selectedApplication.salaryOffered ?? '');
    setEditNotes(selectedApplication.notes ?? '');

    let cancelled = false;
    void api
      .getApplicationDetail(selectedApplication.id)
      .then((detail) => {
        if (!cancelled) {
          setEvents(detail.events);
        }
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedApplication]);

  // Keyboard shortcuts: j / k to move selection, n to toggle new application form
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
      if (e.key === 'n') {
        e.preventDefault();
        setShowNewForm((prev) => !prev);
        return;
      }
      if (filteredApplications.length === 0) return;
      const idx = filteredApplications.findIndex((a) => a.id === selectedId);
      if (e.key === 'j') {
        e.preventDefault();
        const next = filteredApplications[Math.min(filteredApplications.length - 1, idx + 1)];
        if (next) setSelectedId(next.id);
      } else if (e.key === 'k') {
        e.preventDefault();
        const prev = filteredApplications[Math.max(0, idx - 1)];
        if (prev) setSelectedId(prev.id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [filteredApplications, selectedId]);

  const countsByStatus = useMemo(() => {
    const counts: Record<string, number> = {
      all: applications.length,
      saved: 0,
      applied: 0,
      interview: 0,
      offer: 0,
      rejected: 0,
      withdrawn: 0
    };
    for (const app of applications) {
      counts[app.status] = (counts[app.status] ?? 0) + 1;
    }
    return counts;
  }, [applications]);

  const dueReminders = useMemo(() => {
    return applications.filter((app) => {
      const info = isFollowUpDueOrUpcoming(app.nextFollowUpAt);
      return info.state === 'overdue' || info.state === 'upcoming';
    });
  }, [applications]);

  const handleCreateManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newCompany.trim()) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const created = await api.createManualApplication({
        title: newTitle.trim(),
        companyName: newCompany.trim(),
        ...(newUrl.trim() ? { sourceUrl: newUrl.trim() } : {}),
        ...(newLocation.trim() ? { locationRaw: newLocation.trim() } : {}),
        status: newStatus,
        resumeVersionId: newResumeId || null,
        coverLetterId: newCoverLetterId || null,
        nextFollowUpAt: newFollowUpDate ? new Date(`${newFollowUpDate}T09:00:00`).toISOString() : null,
        followUpNote: newFollowUpNote.trim(),
        salaryOffered: newSalaryOffered.trim(),
        notes: newNotes.trim()
      });
      setApplications((prev) => [created, ...prev]);
      setSelectedId(created.id);
      setShowNewForm(false);
      setNewTitle('');
      setNewCompany('');
      setNewUrl('');
      setNewCoverLetterId('');
      setNewFollowUpDate('');
      setNewFollowUpNote('');
      setNewSalaryOffered('');
      setNewNotes('');
      setNotice(`[+] Application logged: ${created.job.companyName} — ${created.job.title}`);
      moToast(`[ok] Logged ${created.job.companyName}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create application.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveInspector = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedApplication) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await api.updateApplication(selectedApplication.id, {
        status: editStatus,
        resumeVersionId: editResumeId || null,
        coverLetterId: editCoverLetterId || null,
        nextFollowUpAt: editFollowUpDate
          ? new Date(`${editFollowUpDate}T09:00:00`).toISOString()
          : null,
        followUpNote: editFollowUpNote,
        salaryOffered: editSalaryOffered,
        notes: editNotes
      });
      setApplications((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      const detail = await api.getApplicationDetail(updated.id);
      setEvents(detail.events);
      setNotice(`[+] Updated ${updated.job.companyName} (${updated.status.toUpperCase()})`);
      moToast(`[ok] Saved ${updated.job.companyName} (${updated.status.toUpperCase()})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update application.');
    } finally {
      setSaving(false);
    }
  };

  const handleQuickStatusChange = async (appId: string, nextStatus: ApplicationStatus) => {
    setError(null);
    try {
      const updated = await api.updateApplication(appId, { status: nextStatus });
      setApplications((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      if (selectedId === appId) {
        const detail = await api.getApplicationDetail(appId);
        setEvents(detail.events);
      }
      setNotice(`[+] Status updated to ${nextStatus.toUpperCase()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status.');
    }
  };

  const handleDeleteApplication = async () => {
    if (!selectedApplication) return;
    setSaving(true);
    setError(null);
    try {
      await api.deleteApplication(selectedApplication.id);
      const remaining = applications.filter((a) => a.id !== selectedApplication.id);
      setApplications(remaining);
      setSelectedId(remaining[0]?.id ?? null);
      setConfirmDeleteOpen(false);
      setNotice('[-] Application removed from tracker.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete application.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell
      title="Application Tracker"
      subtitle="Track every saved, applied, interview, offer, and rejected role with the exact tailored resume version used and follow-up reminders. Shortcuts: j/k navigate, n log application."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={showNewForm ? 'secondary' : 'primary'}
            onClick={() => setShowNewForm((prev) => !prev)}
          >
            {showNewForm ? '[-] Close Form' : '[+] Log Application (n)'}
          </Button>
          <Link href="/jobs">
            <Button variant="secondary">Browse Job Feed -&gt;</Button>
          </Link>
        </div>
      }
    >
      {error ? <AlertBanner tone="error" title="Tracker error" message={error} /> : null}
      {notice ? <AlertBanner tone="success" title="Updated" message={notice} /> : null}

      {/* Follow-up Reminders Banner */}
      {dueReminders.length > 0 ? (
        <div
          role="region"
          aria-label="Follow-up reminders"
          className="border border-[var(--warning)] bg-[var(--warning-soft)] p-4 space-y-2"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-bold uppercase tracking-wider text-[var(--ink)]">
              [!] {dueReminders.length} Follow-Up Reminder{dueReminders.length > 1 ? 's' : ''} Due or
              Upcoming (within 48h)
            </p>
            <span className="text-xs text-[var(--body)]">
              Click any role below to inspect notes or reschedule
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {dueReminders.map((rem) => {
              const info = isFollowUpDueOrUpcoming(rem.nextFollowUpAt);
              return (
                <button
                  key={rem.id}
                  type="button"
                  onClick={() => setSelectedId(rem.id)}
                  className="px-3 py-1.5 text-xs rounded-[4px] border border-[var(--hairline-strong)] bg-[var(--surface-card)] text-[var(--ink)] hover:bg-[var(--surface-soft)] cursor-pointer text-left"
                >
                  <span className="font-bold">{rem.job.companyName}</span> · {rem.job.title}{' '}
                  <span className="text-[var(--warning)] font-medium">{info.label}</span>
                  {rem.followUpNote ? ` — "${rem.followUpNote}"` : ''}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Status Pipeline Strip */}
      <div
        role="tablist"
        aria-label="Filter applications by status"
        className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 border border-[var(--hairline)] bg-[var(--surface-card)]"
      >
        <button
          type="button"
          role="tab"
          aria-selected={statusFilter === 'all'}
          onClick={() => setStatusFilter('all')}
          className={`p-3 text-left border-b sm:border-b-0 border-r border-[var(--hairline)] cursor-pointer transition-colors ${
            statusFilter === 'all'
              ? 'bg-[var(--ink)] text-[var(--on-primary)]'
              : 'hover:bg-[var(--surface-soft)]'
          }`}
        >
          <div className="text-[11px] uppercase tracking-wider opacity-80">[*] ALL</div>
          <div className="text-xl font-bold tabular-nums mt-0.5">
            <MoCount to={countsByStatus['all'] ?? 0} />
          </div>
        </button>
        {STATUS_OPTIONS.map((opt) => {
          const active = statusFilter === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setStatusFilter(opt.value)}
              className={`p-3 text-left border-b sm:border-b-0 border-r last:border-r-0 border-[var(--hairline)] cursor-pointer transition-colors ${
                active
                  ? 'bg-[var(--ink)] text-[var(--on-primary)]'
                  : 'hover:bg-[var(--surface-soft)]'
              }`}
            >
              <div className="text-[11px] uppercase tracking-wider opacity-80">
                {opt.marker} {opt.label}
              </div>
              <div className="text-xl font-bold tabular-nums mt-0.5">
                <MoCount to={countsByStatus[opt.value] ?? 0} />
              </div>
            </button>
          );
        })}
      </div>

      {/* Collapsible Manual Log Application Form */}
      {showNewForm ? (
        <SectionBlock
          title="Log External or Manual Application"
          description="Track an application submitted on a company portal, campus placement cell, or referral, and attach the exact tailored resume version used."
        >
          <form onSubmit={handleCreateManual} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Field label="Company Name *" htmlFor="new-app-company">
                {(props) => (
                  <Input
                    {...props}
                    required
                    placeholder="e.g. Razorpay, Zerodha, Atlassian"
                    value={newCompany}
                    onChange={(e) => setNewCompany(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Role Title *" htmlFor="new-app-title">
                {(props) => (
                  <Input
                    {...props}
                    required
                    placeholder="e.g. SDE 1 (Backend)"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Location" htmlFor="new-app-location">
                {(props) => (
                  <Input
                    {...props}
                    placeholder="e.g. Bengaluru, India"
                    value={newLocation}
                    onChange={(e) => setNewLocation(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Initial Status" htmlFor="new-app-status">
                {(props) => (
                  <Select
                    {...props}
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value as ApplicationStatus)}
                  >
                    {STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Field label="Exact Tailored Resume Version Used" htmlFor="new-app-resume">
                {(props) => (
                  <Select
                    {...props}
                    value={newResumeId}
                    onChange={(e) => setNewResumeId(e.target.value)}
                  >
                    <option value="">-- Master Profile / Unspecified --</option>
                    {resumeVersions.map((rv) => (
                      <option key={rv.id} value={rv.id}>
                        v{rv.versionNumber} · {rv.label} ({rv.templateId})
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Linked Cover Letter (optional)" htmlFor="new-app-cover-letter">
                {(props) => (
                  <Select
                    {...props}
                    value={newCoverLetterId}
                    onChange={(e) => setNewCoverLetterId(e.target.value)}
                  >
                    <option value="">-- No cover letter linked --</option>
                    {coverLetters.map((cl) => (
                      <option key={cl.id} value={cl.id}>
                        v{cl.versionNumber} · {cl.label} ({cl.tone})
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Job / Portal URL (optional)" htmlFor="new-app-url">
                {(props) => (
                  <Input
                    {...props}
                    type="url"
                    placeholder="https://boards.greenhouse.io/..."
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Follow-Up Reminder Date" htmlFor="new-app-followup">
                {(props) => (
                  <Input
                    {...props}
                    type="date"
                    value={newFollowUpDate}
                    onChange={(e) => setNewFollowUpDate(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Compensation / CTC (LPA)" htmlFor="new-app-salary">
                {(props) => (
                  <Input
                    {...props}
                    placeholder="e.g. 18–24 LPA"
                    value={newSalaryOffered}
                    onChange={(e) => setNewSalaryOffered(e.target.value)}
                  />
                )}
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Follow-Up Reminder Note" htmlFor="new-app-followup-note">
                {(props) => (
                  <Input
                    {...props}
                    placeholder="e.g. Ping recruiter on LinkedIn if no OA invite in 5 days"
                    value={newFollowUpNote}
                    onChange={(e) => setNewFollowUpNote(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Application Notes" htmlFor="new-app-notes">
                {(props) => (
                  <Input
                    {...props}
                    placeholder="e.g. Referred by Aditya, OA link expires Friday"
                    value={newNotes}
                    onChange={(e) => setNewNotes(e.target.value)}
                  />
                )}
              </Field>
            </div>

            <div className="flex flex-wrap gap-2 pt-2 border-t border-[var(--hairline)]">
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? 'Logging...' : '[+] Save Application'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setShowNewForm(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </SectionBlock>
      ) : null}

      {/* Main Split View: Application List + Detail Inspector */}
      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 space-y-3">
            <SkeletonBlock className="h-24 w-full" />
            <SkeletonBlock className="h-24 w-full" />
            <SkeletonBlock className="h-24 w-full" />
          </div>
          <div className="lg:col-span-7">
            <SkeletonBlock className="h-96 w-full" />
          </div>
        </div>
      ) : filteredApplications.length === 0 ? (
        <SectionBlock
          title="No Tracked Applications Yet"
          description="Save jobs from the Job Feed, capture roles from the Chrome Extension (Greenhouse, Lever, Ashby, Workday, Naukri, Internshala, LinkedIn), or log an application manually."
        >
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => setShowNewForm(true)}>
              [+] Log Your First Application
            </Button>
            <Link href="/jobs">
              <Button variant="secondary">Explore Matched Jobs -&gt;</Button>
            </Link>
            <Link href="/tailor">
              <Button variant="secondary">Tailor a Resume -&gt;</Button>
            </Link>
          </div>
        </SectionBlock>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Application List */}
          <div
            role="listbox"
            aria-label="Tracked applications"
            className="lg:col-span-5 border border-[var(--hairline)] bg-[var(--surface-card)] divide-y divide-[var(--hairline)]"
          >
            {filteredApplications.map((app) => {
              const selected = app.id === selectedId;
              const followInfo = isFollowUpDueOrUpcoming(app.nextFollowUpAt);
              return (
                <div
                  key={app.id}
                  role="option"
                  aria-selected={selected}
                  tabIndex={0}
                  onClick={() => setSelectedId(app.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedId(app.id);
                    }
                  }}
                  className={`p-4 cursor-pointer transition-colors ${
                    selected
                      ? 'bg-[var(--surface-soft)] border-l-4 border-l-[var(--ink)]'
                      : 'hover:bg-[var(--surface-soft)]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-bold uppercase tracking-wider text-[var(--mute)] truncate">
                        {app.job.companyName} · {app.job.sourceType}
                      </p>
                      <h2 className="text-sm font-bold text-[var(--ink)] truncate mt-0.5">
                        {app.job.title}
                      </h2>
                    </div>
                    <Badge tone={statusTone(app.status)}>
                      <MoDecode text={app.status.toUpperCase()} frames={5} />
                    </Badge>
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs">
                    {app.resumeVersion ? (
                      <Badge tone="success">
                        [PDF] v{app.resumeVersion.versionNumber} · {app.resumeVersion.label}
                      </Badge>
                    ) : (
                      <Badge tone="neutral">[·] No resume version linked</Badge>
                    )}

                    {followInfo.state !== 'none' ? (
                      <Badge
                        tone={
                          followInfo.state === 'overdue'
                            ? 'danger'
                            : followInfo.state === 'upcoming'
                              ? 'warning'
                              : 'neutral'
                        }
                      >
                        {followInfo.label}
                      </Badge>
                    ) : null}
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-[var(--mute)]">
                    <span>
                      {app.appliedAt
                        ? `Applied ${new Date(app.appliedAt).toLocaleDateString('en-IN')}`
                        : `Saved ${new Date(app.createdAt).toLocaleDateString('en-IN')}`}
                    </span>
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1"
                    >
                      <label htmlFor={`quick-status-${app.id}`} className="sr-only">
                        Quick status for {app.job.companyName}
                      </label>
                      <div className="relative inline-flex items-center">
                        <select
                          id={`quick-status-${app.id}`}
                          value={app.status}
                          onChange={(e) =>
                            void handleQuickStatusChange(app.id, e.target.value as ApplicationStatus)
                          }
                          className="appearance-none pl-2 pr-6 py-1 text-[11px] leading-tight bg-[var(--surface-card)] border border-[var(--hairline)] rounded-[4px] text-[var(--ink)] cursor-pointer"
                        >
                          {STATUS_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-y-0 right-1.5 flex items-center justify-center text-[var(--mute)]"
                        >
                          <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                            <path
                              d="M4 6L8 10L12 6"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="square"
                            />
                          </svg>
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right Column: Application Inspector */}
          <div className="lg:col-span-7 space-y-6">
            {selectedApplication ? (
              <>
                <SectionBlock
                  title={`${selectedApplication.job.companyName} — ${selectedApplication.job.title}`}
                  description={
                    selectedApplication.job.locationRaw
                      ? `${selectedApplication.job.locationRaw} · Source: ${selectedApplication.job.sourceType} (${selectedApplication.sourceChannel})`
                      : `Source: ${selectedApplication.job.sourceType} (${selectedApplication.sourceChannel})`
                  }
                  action={
                    <div className="flex flex-wrap items-center gap-2">
                      {selectedApplication.job.sourceUrl &&
                      !selectedApplication.job.sourceUrl.startsWith('https://jobpilot.local') ? (
                        <a
                          href={selectedApplication.job.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs underline text-[var(--ink)]"
                        >
                          Open Posting [&gt;]
                        </a>
                      ) : null}
                      <Link href={`/tailor?jobId=${encodeURIComponent(selectedApplication.jobId)}`}>
                        <Button variant="secondary" size="sm">
                          Tailor New Resume Version
                        </Button>
                      </Link>
                    </div>
                  }
                >
                  <form onSubmit={handleSaveInspector} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <Field label="Application Stage" htmlFor="insp-status">
                        {(props) => (
                          <Select
                            {...props}
                            value={editStatus}
                            onChange={(e) => setEditStatus(e.target.value as ApplicationStatus)}
                          >
                            {STATUS_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.marker} {opt.label}
                              </option>
                            ))}
                          </Select>
                        )}
                      </Field>

                      <Field label="Compensation / Offered CTC" htmlFor="insp-salary">
                        {(props) => (
                          <Input
                            {...props}
                            placeholder="e.g. 22 LPA base + 2 LPA bonus"
                            value={editSalaryOffered}
                            onChange={(e) => setEditSalaryOffered(e.target.value)}
                          />
                        )}
                      </Field>
                    </div>

                    {/* Exact Resume Version Used */}
                    <div className="p-3.5 border border-[var(--hairline)] bg-[var(--surface-soft)] space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <label
                          htmlFor="insp-resume-version"
                          className="text-xs font-bold uppercase tracking-wider text-[var(--ink)]"
                        >
                          [PDF] Exact Tailored Resume Version Used
                        </label>
                        {editResumeId ? (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => void api.downloadResumePdf(editResumeId)}
                          >
                            Download Linked PDF
                          </Button>
                        ) : null}
                      </div>
                      <Select
                        id="insp-resume-version"
                        value={editResumeId}
                        onChange={(e) => setEditResumeId(e.target.value)}
                      >
                        <option value="">-- No tailored version linked --</option>
                        {resumeVersions.map((rv) => (
                          <option key={rv.id} value={rv.id}>
                            v{rv.versionNumber} · {rv.label} ({rv.templateId} ·{' '}
                            {rv.verifierPassed ? 'VERIFIED' : 'FLAGGED'})
                          </option>
                        ))}
                      </Select>
                      <p className="text-xs text-[var(--mute)]">
                        Pinning the exact resume version ensures you have the exact single-column
                        PDF ready before interviews.
                      </p>

                      <div className="pt-2 border-t border-[var(--hairline)] space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <label
                            htmlFor="insp-cover-letter"
                            className="text-xs font-bold uppercase tracking-wider text-[var(--ink)]"
                          >
                            [CL] Linked Cover Letter
                          </label>
                          {editCoverLetterId ? (
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => void api.downloadCoverLetterPdf(editCoverLetterId)}
                            >
                              Download Cover Letter PDF
                            </Button>
                          ) : null}
                        </div>
                        <Select
                          id="insp-cover-letter"
                          value={editCoverLetterId}
                          onChange={(e) => setEditCoverLetterId(e.target.value)}
                        >
                          <option value="">-- No cover letter linked --</option>
                          {coverLetters.map((cl) => (
                            <option key={cl.id} value={cl.id}>
                              v{cl.versionNumber} · {cl.label} ({cl.tone} ·{' '}
                              {cl.verifierPassed ? 'GROUNDED' : 'FLAGGED'})
                            </option>
                          ))}
                        </Select>
                      </div>
                    </div>

                    {/* Follow-Up Reminder Scheduler */}
                    <div className="p-3.5 border border-[var(--hairline)] bg-[var(--surface-soft)] space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-bold uppercase tracking-wider text-[var(--ink)]">
                          [!] Follow-Up Reminder
                        </span>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => setEditFollowUpDate(toDateInputValue(addDaysIso(3)))}
                          >
                            +3 Days
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => setEditFollowUpDate(toDateInputValue(addDaysIso(7)))}
                          >
                            +7 Days
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              setEditFollowUpDate('');
                              setEditFollowUpNote('');
                            }}
                          >
                            Clear
                          </Button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Field label="Follow-Up Date" htmlFor="insp-followup-date">
                          {(props) => (
                            <Input
                              {...props}
                              type="date"
                              value={editFollowUpDate}
                              onChange={(e) => setEditFollowUpDate(e.target.value)}
                            />
                          )}
                        </Field>
                        <Field label="Reminder Action / Note" htmlFor="insp-followup-note">
                          {(props) => (
                            <Input
                              {...props}
                              placeholder="e.g. Email recruiter about Round 2 feedback"
                              value={editFollowUpNote}
                              onChange={(e) => setEditFollowUpNote(e.target.value)}
                            />
                          )}
                        </Field>
                      </div>
                    </div>

                    <Field label="Interview & Application Notes" htmlFor="insp-notes">
                      {(props) => (
                        <Textarea
                          {...props}
                          rows={4}
                          placeholder="Log referral details, online assessment links, interviewer names, or system design questions asked..."
                          value={editNotes}
                          onChange={(e) => setEditNotes(e.target.value)}
                        />
                      )}
                    </Field>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-[var(--hairline)]">
                      <Button type="submit" variant="primary" disabled={saving}>
                        {saving ? 'Saving...' : 'Save Application Changes'}
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        onClick={() => setConfirmDeleteOpen(true)}
                      >
                        Delete Application
                      </Button>
                    </div>
                  </form>
                </SectionBlock>

                {/* Audit Timeline */}
                <SectionBlock
                  title="Application Audit Timeline"
                  description="Immutable event log of status transitions, linked resume versions, and scheduled follow-ups."
                >
                  {events.length === 0 ? (
                    <p className="text-xs text-[var(--mute)]">No events recorded yet.</p>
                  ) : (
                    <ul className="space-y-2 text-xs">
                      {events.map((ev) => (
                        <li
                          key={ev.id}
                          className="flex flex-wrap items-center justify-between gap-2 p-2.5 border border-[var(--hairline)] bg-[var(--surface-soft)]"
                        >
                          <div>
                            <span className="font-bold text-[var(--ink)] uppercase">
                              [{ev.eventType.replace(/_/g, ' ')}]
                            </span>{' '}
                            <span className="text-[var(--body)]">
                              {Object.keys(ev.payload).length > 0
                                ? JSON.stringify(ev.payload)
                                : ''}
                            </span>
                          </div>
                          <span className="text-[var(--mute)] tabular-nums">
                            {new Date(ev.createdAt).toLocaleString('en-IN')}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </SectionBlock>
              </>
            ) : null}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDeleteOpen}
        title="Remove application from tracker?"
        description="This deletes the application tracking entry and its event timeline. Your tailored resume versions will remain intact."
        confirmLabel="Delete Application"
        destructive
        onConfirm={() => void handleDeleteApplication()}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </AppShell>
  );
}
