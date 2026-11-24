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
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load job feed.');
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
        if (!res.skipped) {
          setStatusMsg(
            `Synced ${res.boardSuccess} company boards & ${res.aggregatorCount} job feeds (+${res.insertedCount} new, ${res.updatedCount} refreshed).`
          );
        }
        await loadJobs();
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to sync job sources.');
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
        // ignore initial status probe failure; user can click Sync Sources manually
      }
    }
    void checkAndAutoSync();
    return () => {
      active = false;
    };
  }, [handleSyncSources]);

  const selectedItem = items.find((i) => i.job.id === selectedId) ?? items[0] ?? null;

  const handleRefreshMatches = async () => {
    setMatching(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await api.refreshMatches({ topKVector: 40, topKLlm: 15 });
      setStatusMsg(
        `Matched v${res.profileVersion}: ${res.stats.hardFilterPassed} passed (${res.stats.hardFilterFailed} filtered), ${res.stats.llmScored} LLM scored, ${res.stats.reusedFromCache} cached.`
      );
      await loadJobs();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to run 3-stage matching.');
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
      setStatusMsg('Saved job to tracker.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save job.');
    }
  }, []);

  const handleDismissJob = useCallback(async (jobId: string) => {
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
      setStatusMsg('Dismissed job for this profile version.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to dismiss job.');
    }
  }, [selectedId]);

  // Keyboard shortcuts: j/k navigate, / search, s save, x dismiss
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
      title="Job Feed"
      subtitle="3-stage matching: hard filters (India LPA / location / YoE) -> local bge-small vectors -> cached LLM re-rank."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">{total} jobs</Badge>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleSyncSources(true)}
            disabled={syncing}
          >
            {syncing ? 'Syncing...' : 'Sync Sources'}
          </Button>
          <Button variant="primary" size="sm" onClick={handleRefreshMatches} disabled={matching}>
            {matching ? 'Scoring matches...' : 'AI Deep Rank'}
          </Button>
        </div>
      }
    >
      {syncing ? (
        <div
          role="status"
          aria-live="polite"
          className="border border-[var(--hairline-strong)] bg-[var(--surface-soft)] px-4 py-3 text-xs flex items-center gap-3"
        >
          <MoSpinner name="braille" className="text-[var(--accent)] font-bold" />
          <span>
            Syncing official ATS boards &amp; public job feeds into your catalog...
          </span>
        </div>
      ) : null}
      {errorMsg ? <AlertBanner tone="error" message={errorMsg} /> : null}
      {statusMsg ? <AlertBanner tone="success" message={statusMsg} /> : null}

      {/* Filter Bar inside <search> landmark per modern-web-guidance */}
      <SectionBlock title="Filters & Search" marker="[/]">
        <search>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void loadJobs();
            }}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3 items-end"
          >
            <div className="lg:col-span-2 flex flex-col gap-1">
              <label htmlFor="feed-search" className="text-xs text-[var(--mute)]">
                Keyword / Company / Skill (press /)
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

            <div className="flex flex-col gap-1">
              <label htmlFor="feed-country" className="text-xs text-[var(--mute)]">
                Country
              </label>
              <Select
                id="feed-country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
              >
                <option value="">All countries</option>
                <option value="IN">India (IN)</option>
                <option value="US">United States (US)</option>
                <option value="GB">United Kingdom (GB)</option>
                <option value="SG">Singapore (SG)</option>
                <option value="DE">Germany (DE)</option>
              </Select>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="feed-mode" className="text-xs text-[var(--mute)]">
                Work Mode
              </label>
              <Select
                id="feed-mode"
                value={workMode}
                onChange={(e) => setWorkMode(e.target.value)}
              >
                <option value="">Any mode</option>
                <option value="remote">Remote</option>
                <option value="hybrid">Hybrid</option>
                <option value="onsite">Onsite</option>
              </Select>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="feed-seniority" className="text-xs text-[var(--mute)]">
                Seniority
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

            <div className="flex flex-col gap-1">
              <label htmlFor="feed-lpa" className="text-xs text-[var(--mute)]">
                Min Salary (LPA)
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

            <div className="flex flex-col gap-1">
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

            <div className="lg:col-span-7 flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[var(--hairline)]">
              <div className="flex flex-wrap items-center gap-4 text-xs">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={onlyPassed}
                    onChange={(e) => setOnlyPassed(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <span>Hide hard-filter mismatches</span>
                </label>

                <div className="flex items-center gap-2">
                  <label htmlFor="feed-sort" className="text-[var(--mute)]">
                    Sort:
                  </label>
                  <Select
                    id="feed-sort"
                    value={sortBy}
                    onChange={(e) =>
                      setSortBy(e.target.value as 'match_score' | 'recent' | 'salary_lpa')
                    }
                    className="w-auto min-h-[36px] py-1 text-xs"
                  >
                    <option value="match_score">Best Match Score</option>
                    <option value="recent">Most Recent</option>
                    <option value="salary_lpa">Highest LPA</option>
                  </Select>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs text-[var(--mute)]">
                <span>
                  Sources: {activeSourcesCount} active
                  {lastRun?.finishedAt
                    ? ` · Last crawl ${new Date(lastRun.finishedAt).toLocaleDateString()}`
                    : ''}
                </span>
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
          title={syncing ? 'Syncing live job feeds...' : 'No matching jobs for current filters'}
          description="Sync live official ATS boards and public tech feeds now, or include near matches outside strict filters."
          action={
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                onClick={() => void handleSyncSources(true)}
                disabled={syncing}
              >
                {syncing ? 'Syncing...' : 'Sync Live Sources Now'}
              </Button>
              {onlyPassed ? (
                <Button variant="secondary" onClick={() => setOnlyPassed(false)}>
                  Show Near Matches
                </Button>
              ) : null}
            </div>
          }
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Job List Pane */}
          <div className="lg:col-span-5 border border-[var(--hairline)] divide-y divide-[var(--hairline)] bg-[var(--canvas)]">
            {items.map((item) => {
              const active = selectedItem?.job.id === item.job.id;
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
                        {item.job.companyName} · {item.job.sourceType}
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

                  <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--body)]">
                    <span>{item.job.city ?? item.job.locationRaw ?? 'Unspecified'}</span>
                    <span>·</span>
                    <span>{item.job.workMode}</span>
                    <span>·</span>
                    <span className="tabular-nums">{salaryText}</span>
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

          {/* Detail Pane */}
          {selectedItem ? (
            <div className="lg:col-span-7 space-y-4">
              <SectionBlock
                title={selectedItem.job.title}
                marker="[>]"
                description={`${selectedItem.job.companyName} · ${selectedItem.job.locationRaw || 'Location unspecified'} · ${selectedItem.job.workMode}`}
                action={
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void handleSaveJob(selectedItem.job.id)}
                    >
                      {selectedItem.applicationStatus ? '[x] Saved' : '[+] Save (S)'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void handleDismissJob(selectedItem.job.id)}
                    >
                      Dismiss (X)
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        router.push(`/tailor?jobId=${encodeURIComponent(selectedItem.job.id)}`)
                      }
                    >
                      Tailor (T)
                    </Button>
                    <a
                      href={selectedItem.job.applyUrl ?? selectedItem.job.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button size="sm" variant="primary">
                        Apply -&gt;
                      </Button>
                    </a>
                  </div>
                }
              >
                <div className="space-y-5">
                  {/* Explainable 3-Stage Breakdown */}
                  <div className="border border-[var(--hairline)] bg-[var(--surface-soft)] p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-bold text-[var(--ink)]">
                        3-STAGE MATCH EXPLANATION
                      </span>
                      <div className="flex flex-wrap gap-2">
                        <Badge
                          tone={
                            selectedItem.match == null
                              ? 'neutral'
                              : selectedItem.match.hardFilterPassed
                                ? 'success'
                                : 'danger'
                          }
                        >
                          {selectedItem.match == null
                            ? 'NOT SCORED'
                            : selectedItem.match.hardFilterPassed
                              ? 'HARD FILTERS: PASS'
                              : 'HARD FILTERS: FAIL'}
                        </Badge>
                        {selectedItem.match?.vectorSimilarity != null ? (
                          <Badge tone="neutral">
                            VEC: {Math.round(selectedItem.match.vectorSimilarity * 100)}%
                          </Badge>
                        ) : null}
                        {selectedItem.match?.llmScore != null ? (
                          <Badge tone={scoreTone(selectedItem.match.llmScore)}>
                            SCORE: {selectedItem.match.llmScore}/100
                          </Badge>
                        ) : null}
                      </div>
                    </div>

                    {selectedItem.match?.matchReason ? (
                      <p className="text-sm text-[var(--ink)]">{selectedItem.match.matchReason}</p>
                    ) : (
                      <p className="text-xs text-[var(--mute)]">
                        Click &ldquo;Run 3-Stage Match&rdquo; above to compute personalized scores and skill gaps against your Master Profile.
                      </p>
                    )}

                    {selectedItem.match &&
                    !selectedItem.match.hardFilterPassed &&
                    selectedItem.match.hardFilterReasons.length > 0 ? (
                      <ul className="text-xs text-[var(--danger-text)] list-disc pl-5 space-y-0.5">
                        {selectedItem.match.hardFilterReasons.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    ) : null}

                    {selectedItem.match ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-[var(--hairline)] text-xs">
                        <div>
                          <p className="font-bold text-[var(--success-text)] mb-1">
                            [+] Matched Skills
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
                          <p className="font-bold text-[var(--warning-text)] mb-1">
                            [!] Skill Gaps
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {selectedItem.match.skillGaps.length > 0 ? (
                              selectedItem.match.skillGaps.map((s) => (
                                <Badge key={s} tone="warning">
                                  {s}
                                </Badge>
                              ))
                            ) : (
                              <span className="text-[var(--mute)]">No explicit gaps flagged</span>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>

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
                      <span className="text-[var(--mute)] block">Seniority</span>
                      <strong>{selectedItem.job.seniority}</strong>
                    </div>
                    <div>
                      <span className="text-[var(--mute)] block">Min Experience</span>
                      <strong className="tabular-nums">
                        {selectedItem.job.experienceMinYears != null
                          ? `${selectedItem.job.experienceMinYears}+ yrs`
                          : 'Unspecified'}
                      </strong>
                    </div>
                    <div>
                      <span className="text-[var(--mute)] block">Source / Sightings</span>
                      <strong>
                        {selectedItem.job.sourceType} ({selectedItem.job.sightingsCount})
                      </strong>
                    </div>
                  </div>

                  {/* Clean JD */}
                  <div className="space-y-2">
                    <h3 className="text-xs font-bold text-[var(--mute)]">JOB DESCRIPTION</h3>
                    <div className="text-sm text-[var(--body)] whitespace-pre-wrap leading-relaxed max-h-[420px] overflow-y-auto pr-2">
                      {selectedItem.job.descriptionClean || 'No description text provided.'}
                    </div>
                  </div>
                </div>
              </SectionBlock>
            </div>
          ) : null}
        </div>
      )}

      {/* OpenCode TUI-style keybinding hint bar */}
      <div className="border-t border-[var(--hairline)] pt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--mute)]">
        <span>j/k navigate · / search · s save · x dismiss · t tailor</span>
        <span>Official APIs only · Zero non-API server scraping</span>
      </div>
    </AppShell>
  );
}
