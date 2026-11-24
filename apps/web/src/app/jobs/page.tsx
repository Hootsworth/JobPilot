'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  formatSalaryRange,
  type CrawlRunSummary,
  type JobFeedItem,
  type JobSourceStatus
} from '@jobpilot/shared';
import { AppShell } from '@/components/layout/app-shell';
import { MoSpinner } from '@/components/ui/mo';
import {
  AlertBanner,
  Badge,
  Button,
  EmptyState,
  Input,
  SectionBlock,
  Select,
  SkeletonBlock
} from '@/components/ui/primitives';
import { api } from '@/lib/api';
import {
  formatRelativeTime,
  formatSeniority,
  formatSourceLabel,
  formatWorkMode,
  pluralize
} from '@/lib/format';

function scoreTone(score: number | null | undefined): 'success' | 'warning' | 'neutral' {
  if (score == null) return 'neutral';
  if (score >= 80) return 'success';
  if (score >= 60) return 'warning';
  return 'neutral';
}

export default function JobsFeedPage() {
  const router = useRouter();
  const [items, setItems] = useState<JobFeedItem[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [matching, setMatching] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [sources, setSources] = useState<JobSourceStatus[]>([]);
  const [recentRuns, setRecentRuns] = useState<CrawlRunSummary[]>([]);

  // Filters
  const [q, setQ] = useState('');
  const [country, setCountry] = useState('');
  const [workMode, setWorkMode] = useState('');
  const [seniority, setSeniority] = useState('');
  const [source, setSource] = useState('');
  const [minSalaryLpa, setMinSalaryLpa] = useState('');
  const [sortBy, setSortBy] = useState<'match_score' | 'recent' | 'salary_lpa'>('match_score');
  const [onlyPassed, setOnlyPassed] = useState(true);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const autoSyncTriggeredRef = useRef(false);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [feedRes, srcRes] = await Promise.all([
        api.listJobs({
          q: q.trim() || undefined,
          country: country || undefined,
          workMode: workMode || undefined,
          seniority: seniority || undefined,
          source: source || undefined,
          minSalaryLpa: minSalaryLpa ? Number(minSalaryLpa) : undefined,
          sortBy,
          onlyPassed,
          limit: 50
        }),
        api.listJobSources()
      ]);
      setItems(feedRes.items);
      setTotal(feedRes.total);
      setSources(srcRes.sources);
      setRecentRuns(srcRes.recentRuns);
      setSelectedId((prev) =>
        prev && feedRes.items.some((i) => i.job.id === prev)
          ? prev
          : (feedRes.items[0]?.job.id ?? null)
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load jobs.');
    } finally {
      setLoading(false);
    }
  }, [q, country, workMode, seniority, source, minSalaryLpa, sortBy, onlyPassed]);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  const handleSyncSources = useCallback(
    async (force: boolean) => {
      setSyncing(true);
      setErrorMsg(null);
      try {
        const res = await api.syncJobs({ mode: 'quick', force });
        if (!res.skipped && force) {
          setStatusMsg(
            res.insertedCount > 0
              ? `Added ${pluralize(res.insertedCount, 'new job')} to catalog.`
              : 'Job catalog is up to date.'
          );
        }
        await loadJobs();
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Could not refresh job feeds.');
      } finally {
        setSyncing(false);
      }
    },
    [loadJobs]
  );

  useEffect(() => {
    let active = true;
    async function checkAndAutoSync() {
      if (autoSyncTriggeredRef.current) return;
      try {
        const status = await api.getJobSyncStatus();
        if (!active || autoSyncTriggeredRef.current) return;
        if (status.isStale || status.totalActiveJobs === 0) {
          autoSyncTriggeredRef.current = true;
          await handleSyncSources(false);
        }
      } catch {
        // ignore initial probe error
      }
    }
    void checkAndAutoSync();
    return () => {
      active = false;
    };
  }, [handleSyncSources]);

  const selectedItem = items.find((i) => i.job.id === selectedId) ?? items[0] ?? null;

  const handleRescore = async () => {
    setMatching(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await api.refreshMatches({ topKVector: 40, topKLlm: 15 });
      setStatusMsg(`Updated match scores for ${pluralize(res.stats.totalEvaluated, 'job')}.`);
      await loadJobs();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to re-score matches.');
    } finally {
      setMatching(false);
    }
  };

  const handleSaveJob = useCallback(async (jobId: string) => {
    setErrorMsg(null);
    try {
      const res = await api.saveJob(jobId);
      setItems((prev) =>
        prev.map((item) =>
          item.job.id === jobId ? { ...item, applicationStatus: res.status } : item
        )
      );
      setStatusMsg('Saved to Tracker.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save job.');
    }
  }, []);

  const handleDismissJob = useCallback(
    async (jobId: string) => {
      setErrorMsg(null);
      try {
        await api.dismissJob(jobId, true);
        setItems((prev) => {
          const next = prev.filter((item) => item.job.id !== jobId);
          if (selectedId === jobId) {
            setSelectedId(next[0]?.job.id ?? null);
          }
          return next;
        });
        setStatusMsg('Hidden from feed.');
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to hide job.');
      }
    },
    [selectedId]
  );

  // Keyboard shortcuts: j/k navigate, / search, s save, x dismiss, t tailor
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === '/') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === 'j' || e.key === 'J') {
        if (items.length === 0) return;
        const idx = items.findIndex((i) => i.job.id === selectedId);
        const next = items[Math.min(items.length - 1, Math.max(0, idx + 1))];
        if (next) setSelectedId(next.job.id);
      } else if (e.key === 'k' || e.key === 'K') {
        if (items.length === 0) return;
        const idx = items.findIndex((i) => i.job.id === selectedId);
        const prev = items[Math.max(0, idx - 1)];
        if (prev) setSelectedId(prev.job.id);
      } else if ((e.key === 's' || e.key === 'S') && selectedItem) {
        void handleSaveJob(selectedItem.job.id);
      } else if ((e.key === 'x' || e.key === 'X') && selectedItem) {
        void handleDismissJob(selectedItem.job.id);
      } else if ((e.key === 't' || e.key === 'T') && selectedItem) {
        router.push(`/tailor?jobId=${encodeURIComponent(selectedItem.job.id)}`);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [items, selectedId, selectedItem, handleSaveJob, handleDismissJob, router]);

  const activeSourcesCount = sources.filter((s) => s.enabled).length;
  const lastRun = recentRuns[0];

  return (
    <AppShell
      title="Jobs"
      actions={
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-xs text-[var(--mute)] tabular-nums whitespace-nowrap">
            {pluralize(total, 'job')}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleSyncSources(true)}
            disabled={syncing}
          >
            {syncing ? 'Refreshing...' : 'Refresh'}
          </Button>
          <Button variant="primary" size="sm" onClick={handleRescore} disabled={matching}>
            {matching ? 'Re-scoring...' : 'Re-score'}
          </Button>
        </div>
      }
    >
      {syncing ? (
        <div
          role="status"
          aria-live="polite"
          className="border border-[var(--hairline)] bg-[var(--surface-soft)] px-3.5 py-2.5 text-xs text-[var(--body)] flex items-center gap-2.5"
        >
          <MoSpinner name="braille" className="text-[var(--accent-text)] font-bold" />
          <span>Checking for new openings...</span>
        </div>
      ) : null}
      {errorMsg ? <AlertBanner tone="error" message={errorMsg} /> : null}
      {statusMsg ? <AlertBanner tone="success" message={statusMsg} /> : null}

      {/* Clean 2-Row Balanced Filter Bar */}
      <SectionBlock title="Filters">
        <search>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void loadJobs();
            }}
            className="space-y-3"
          >
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
              <div className="md:col-span-5 flex flex-col gap-1">
                <label htmlFor="feed-search" className="text-xs text-[var(--mute)]">
                  Keyword, company, or skill
                </label>
                <Input
                  ref={searchInputRef}
                  id="feed-search"
                  type="search"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="TypeScript, Bengaluru, Razorpay..."
                />
              </div>

              <div className="md:col-span-2 flex flex-col gap-1">
                <label htmlFor="feed-country" className="text-xs text-[var(--mute)]">
                  Country
                </label>
                <Select
                  id="feed-country"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                >
                  <option value="">All</option>
                  <option value="IN">India</option>
                  <option value="US">United States</option>
                  <option value="GB">United Kingdom</option>
                  <option value="SG">Singapore</option>
                  <option value="DE">Germany</option>
                </Select>
              </div>

              <div className="md:col-span-2 flex flex-col gap-1">
                <label htmlFor="feed-mode" className="text-xs text-[var(--mute)]">
                  Work Mode
                </label>
                <Select
                  id="feed-mode"
                  value={workMode}
                  onChange={(e) => setWorkMode(e.target.value)}
                >
                  <option value="">Any</option>
                  <option value="remote">Remote</option>
                  <option value="hybrid">Hybrid</option>
                  <option value="onsite">On-site</option>
                </Select>
              </div>

              <div className="md:col-span-3 flex flex-col gap-1">
                <label htmlFor="feed-seniority" className="text-xs text-[var(--mute)]">
                  Level
                </label>
                <Select
                  id="feed-seniority"
                  value={seniority}
                  onChange={(e) => setSeniority(e.target.value)}
                >
                  <option value="">Any level</option>
                  <option value="intern">Intern</option>
                  <option value="fresher">Fresher</option>
                  <option value="junior">Junior / SDE-1</option>
                  <option value="mid">Mid / SDE-2</option>
                  <option value="senior">Senior</option>
                </Select>
              </div>
            </div>

            <div className="flex flex-wrap items-end justify-between gap-3 pt-3 border-t border-[var(--hairline)]">
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-44 flex flex-col gap-1">
                  <label htmlFor="feed-source" className="text-xs text-[var(--mute)]">
                    Source
                  </label>
                  <Select
                    id="feed-source"
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                  >
                    <option value="">All sources</option>
                    <option value="greenhouse">Greenhouse</option>
                    <option value="lever">Lever</option>
                    <option value="ashby">Ashby</option>
                    <option value="workable">Workable</option>
                    <option value="smartrecruiters">SmartRecruiters</option>
                    <option value="himalayas">Himalayas</option>
                    <option value="jobicy">Jobicy</option>
                    <option value="themuse">The Muse</option>
                    <option value="hackernews">Hacker News</option>
                    <option value="remotive">Remotive</option>
                    <option value="arbeitnow">Arbeitnow</option>
                    <option value="remoteok">RemoteOK</option>
                    <option value="adzuna">Adzuna</option>
                    <option value="jooble">Jooble</option>
                    <option value="jsearch">JSearch</option>
                  </Select>
                </div>

                <div className="w-28 flex flex-col gap-1">
                  <label htmlFor="feed-lpa" className="text-xs text-[var(--mute)]">
                    Min LPA
                  </label>
                  <Input
                    id="feed-lpa"
                    type="number"
                    min={0}
                    step="1"
                    value={minSalaryLpa}
                    onChange={(e) => setMinSalaryLpa(e.target.value)}
                    placeholder="e.g. 12"
                  />
                </div>

                <div className="w-44 flex flex-col gap-1">
                  <label htmlFor="feed-sort" className="text-xs text-[var(--mute)]">
                    Sort by
                  </label>
                  <Select
                    id="feed-sort"
                    value={sortBy}
                    onChange={(e) =>
                      setSortBy(e.target.value as 'match_score' | 'recent' | 'salary_lpa')
                    }
                  >
                    <option value="match_score">Best match</option>
                    <option value="recent">Most recent</option>
                    <option value="salary_lpa">Highest salary</option>
                  </Select>
                </div>

                <label className="h-11 inline-flex items-center gap-2 text-xs cursor-pointer px-1">
                  <input
                    type="checkbox"
                    checked={onlyPassed}
                    onChange={(e) => setOnlyPassed(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <span>Hide near mismatches</span>
                </label>
              </div>

              <div className="flex items-center gap-3 text-xs text-[var(--mute)]">
                {activeSourcesCount > 0 ? (
                  <span>
                    {pluralize(activeSourcesCount, 'source')}
                    {lastRun?.finishedAt
                      ? ` · Synced ${formatRelativeTime(lastRun.finishedAt)}`
                      : ''}
                  </span>
                ) : null}
                <Button type="submit" size="sm" variant="secondary">
                  Apply
                </Button>
              </div>
            </div>
          </form>
        </search>
      </SectionBlock>

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 space-y-3">
            <SkeletonBlock className="h-24" />
            <SkeletonBlock className="h-24" />
            <SkeletonBlock className="h-24" />
          </div>
          <div className="lg:col-span-7">
            <SkeletonBlock className="h-80" />
          </div>
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title={syncing ? 'Loading job openings...' : 'No jobs match these filters'}
          description="Refresh your job catalog or include near matches outside strict location or experience filters."
          action={
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => void handleSyncSources(true)}
                disabled={syncing}
              >
                {syncing ? 'Refreshing...' : 'Refresh'}
              </Button>
              {onlyPassed ? (
                <Button variant="secondary" size="sm" onClick={() => setOnlyPassed(false)}>
                  Show Near Matches
                </Button>
              ) : null}
            </div>
          }
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Scrollable Job List Pane */}
          <div className="lg:col-span-5 border border-[var(--hairline)] divide-y divide-[var(--hairline)] bg-[var(--canvas)] lg:max-h-[calc(100vh-240px)] lg:overflow-y-auto">
            {items.map((item) => {
              const active = selectedItem?.job.id === item.job.id;
              const mode = formatWorkMode(item.job.workMode);
              const salaryText = formatSalaryRange(
                item.job.salaryMin,
                item.job.salaryMax,
                item.job.salaryCurrency ?? 'INR',
                item.job.salaryMinLpa,
                item.job.salaryMaxLpa
              );
              return (
                <button
                  key={item.job.id}
                  type="button"
                  onClick={() => setSelectedId(item.job.id)}
                  className={`w-full text-left p-4 transition-colors cursor-pointer space-y-1.5 ${
                    active
                      ? 'bg-[var(--surface-card)] border-l-2 border-l-[var(--ink)]'
                      : 'bg-[var(--canvas)] hover:bg-[var(--surface-soft)]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs text-[var(--mute)] truncate">
                        {item.job.companyName} · {formatSourceLabel(item.job.sourceType)}
                      </p>
                      <h3 className="text-sm font-bold text-[var(--ink)] truncate">
                        {item.job.title}
                      </h3>
                    </div>
                    {item.match?.llmScore != null ? (
                      <Badge tone={scoreTone(item.match.llmScore)}>
                        {item.match.llmScore}%
                      </Badge>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--body)]">
                    <span>{item.job.city ?? item.job.locationRaw ?? 'Location flexible'}</span>
                    {mode ? (
                      <>
                        <span>·</span>
                        <span>{mode}</span>
                      </>
                    ) : null}
                    {salaryText !== 'Not disclosed' ? (
                      <>
                        <span>·</span>
                        <span className="tabular-nums">{salaryText}</span>
                      </>
                    ) : null}
                    {item.applicationStatus ? (
                      <Badge tone="accent">{item.applicationStatus}</Badge>
                    ) : null}
                  </div>

                  {item.match?.matchReason ? (
                    <p className="text-xs text-[var(--mute)] line-clamp-2">
                      {item.match.matchReason}
                    </p>
                  ) : null}
                </button>
              );
            })}
          </div>

          {/* Sticky Detail Pane */}
          {selectedItem ? (
            <div className="lg:col-span-7 lg:sticky lg:top-6">
              <SectionBlock
                title={selectedItem.job.title}
                description={`${selectedItem.job.companyName} · ${selectedItem.job.city ?? selectedItem.job.locationRaw ?? 'Location flexible'}${formatWorkMode(selectedItem.job.workMode) ? ` · ${formatWorkMode(selectedItem.job.workMode)}` : ''}`}
                action={
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void handleSaveJob(selectedItem.job.id)}
                    >
                      {selectedItem.applicationStatus ? 'Saved' : 'Save'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void handleDismissJob(selectedItem.job.id)}
                    >
                      Dismiss
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        router.push(`/tailor?jobId=${encodeURIComponent(selectedItem.job.id)}`)
                      }
                    >
                      Tailor
                    </Button>
                    <a
                      href={selectedItem.job.applyUrl ?? selectedItem.job.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button size="sm" variant="primary">
                        Apply
                      </Button>
                    </a>
                  </div>
                }
              >
                <div className="space-y-5">
                  {/* Match Summary */}
                  {selectedItem.match ? (
                    <div className="border border-[var(--hairline)] bg-[var(--surface-soft)] p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-bold text-[var(--ink)]">Match summary</span>
                        <div className="flex flex-wrap items-center gap-2">
                          {!selectedItem.match.hardFilterPassed ? (
                            <Badge tone="warning">Near match</Badge>
                          ) : null}
                          {selectedItem.match.llmScore != null ? (
                            <Badge tone={scoreTone(selectedItem.match.llmScore)}>
                              {selectedItem.match.llmScore}% match
                            </Badge>
                          ) : null}
                        </div>
                      </div>

                      {selectedItem.match.matchReason ? (
                        <p className="text-sm text-[var(--ink)]">{selectedItem.match.matchReason}</p>
                      ) : null}

                      {!selectedItem.match.hardFilterPassed &&
                      selectedItem.match.hardFilterReasons.some(
                        (r) => !r.startsWith('dismiss_reason:')
                      ) ? (
                        <ul className="text-xs text-[var(--warning-text)] list-disc pl-5 space-y-0.5">
                          {selectedItem.match.hardFilterReasons
                            .filter((r) => !r.startsWith('dismiss_reason:'))
                            .map((r, i) => (
                              <li key={i}>{r}</li>
                            ))}
                        </ul>
                      ) : null}

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-[var(--hairline)] text-xs">
                        <div>
                          <p className="font-bold text-[var(--success-text)] mb-1.5">
                            Matched skills
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {selectedItem.match.matchedSkills.length > 0 ? (
                              selectedItem.match.matchedSkills.map((s) => (
                                <Badge key={s} tone="success">
                                  {s}
                                </Badge>
                              ))
                            ) : (
                              <span className="text-[var(--mute)]">None detected</span>
                            )}
                          </div>
                        </div>
                        <div>
                          <p className="font-bold text-[var(--warning-text)] mb-1.5">
                            Missing skills
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {selectedItem.match.skillGaps.length > 0 ? (
                              selectedItem.match.skillGaps.map((s) => (
                                <Badge key={s} tone="warning">
                                  {s}
                                </Badge>
                              ))
                            ) : (
                              <span className="text-[var(--mute)]">No gaps flagged</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {/* Metadata */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs border-b border-[var(--hairline)] pb-4">
                    <div>
                      <span className="text-[var(--mute)] block">Compensation</span>
                      <strong className="tabular-nums">
                        {formatSalaryRange(
                          selectedItem.job.salaryMin,
                          selectedItem.job.salaryMax,
                          selectedItem.job.salaryCurrency ?? 'INR',
                          selectedItem.job.salaryMinLpa,
                          selectedItem.job.salaryMaxLpa
                        )}
                      </strong>
                    </div>
                    <div>
                      <span className="text-[var(--mute)] block">Level</span>
                      <strong>
                        {formatSeniority(selectedItem.job.seniority) ?? 'Unspecified'}
                      </strong>
                    </div>
                    <div>
                      <span className="text-[var(--mute)] block">Experience</span>
                      <strong className="tabular-nums">
                        {selectedItem.job.experienceMinYears != null
                          ? `${selectedItem.job.experienceMinYears}+ yrs`
                          : 'Unspecified'}
                      </strong>
                    </div>
                    <div>
                      <span className="text-[var(--mute)] block">Source</span>
                      <strong>
                        {formatSourceLabel(selectedItem.job.sourceType)} (
                        {selectedItem.job.sightingsCount})
                      </strong>
                    </div>
                  </div>

                  {/* Clean JD */}
                  <div className="space-y-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--mute)]">
                      Job description
                    </h3>
                    <div className="text-sm text-[var(--body)] whitespace-pre-wrap leading-relaxed max-h-[420px] overflow-y-auto pr-2">
                      {selectedItem.job.descriptionClean || 'No description provided.'}
                    </div>
                  </div>
                </div>
              </SectionBlock>
            </div>
          ) : null}
        </div>
      )}
    </AppShell>
  );
}
