'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  formatSalaryRange,
  type DismissReason,
  type JobFeedItem,
  type JobSyncStatus,
  type RecommendationsResponse
} from '@jobpilot/shared';
import { AppShell } from '@/components/layout/app-shell';
import { MoSpinner } from '@/components/ui/mo';
import {
  AlertBanner,
  Badge,
  Button,
  EmptyState,
  SectionBlock,
  SkeletonBlock
} from '@/components/ui/primitives';
import { api } from '@/lib/api';

type BucketKey = 'for_you' | 'fresh' | 'india' | 'remote' | 'near_matches';

const TAB_CONFIG: Array<{ key: BucketKey; label: string }> = [
  { key: 'for_you', label: 'For You' },
  { key: 'fresh', label: 'Fresh 48h' },
  { key: 'india', label: 'India' },
  { key: 'remote', label: 'Remote' },
  { key: 'near_matches', label: 'Near Matches' }
];

function scoreTone(score: number | null | undefined): 'success' | 'warning' | 'neutral' {
  if (score == null) return 'neutral';
  if (score >= 80) return 'success';
  if (score >= 60) return 'warning';
  return 'neutral';
}

function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return 'Not synced yet';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return 'Recently';
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function getBucketItems(data: RecommendationsResponse | null, key: BucketKey): JobFeedItem[] {
  if (!data) return [];
  switch (key) {
    case 'for_you':
      return data.buckets.forYou;
    case 'fresh':
      return data.buckets.fresh;
    case 'india':
      return data.buckets.india;
    case 'remote':
      return data.buckets.remote;
    case 'near_matches':
      return data.buckets.nearMatches;
  }
}

function getBucketCount(data: RecommendationsResponse | null, key: BucketKey): number {
  if (!data) return 0;
  switch (key) {
    case 'for_you':
      return data.counts.forYou;
    case 'fresh':
      return data.counts.fresh;
    case 'india':
      return data.counts.india;
    case 'remote':
      return data.counts.remote;
    case 'near_matches':
      return data.counts.nearMatches;
  }
}

export function RecommendationsHome() {
  const router = useRouter();
  const [data, setData] = useState<RecommendationsResponse | null>(null);
  const [activeTab, setActiveTab] = useState<BucketKey>('for_you');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [ranking, setRanking] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const autoSyncTriggeredRef = useRef(false);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const applySelectedDefault = useCallback(
    (nextData: RecommendationsResponse, tabKey: BucketKey) => {
      const bucket = getBucketItems(nextData, tabKey);
      const fallbackPool =
        bucket.length > 0
          ? bucket
          : tabKey === 'for_you'
            ? nextData.buckets.nearMatches
            : [];
      setSelectedId((prev) =>
        prev && fallbackPool.some((i) => i.job.id === prev)
          ? prev
          : (fallbackPool[0]?.job.id ?? null)
      );
    },
    []
  );

  const loadRecommendations = useCallback(async (): Promise<RecommendationsResponse | null> => {
    setErrorMsg(null);
    try {
      const res = await api.getRecommendations();
      setData(res);
      applySelectedDefault(res, activeTab);
      return res;
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to load personalized recommendations.'
      );
      return null;
    } finally {
      setLoading(false);
    }
  }, [activeTab, applySelectedDefault]);

  const runSync = useCallback(
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
        await loadRecommendations();
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Live job sync encountered an error.');
      } finally {
        setSyncing(false);
      }
    },
    [loadRecommendations]
  );

  useEffect(() => {
    let active = true;
    async function boot() {
      const res = await loadRecommendations();
      if (!active || !res) return;
      if (
        !autoSyncTriggeredRef.current &&
        (res.syncStatus.isStale || res.syncStatus.totalActiveJobs === 0)
      ) {
        autoSyncTriggeredRef.current = true;
        await runSync(false);
      }
    }
    void boot();
    return () => {
      active = false;
    };
    // Run once on initial mount so tab switches do not re-trigger auto-sync
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelectTab = (key: BucketKey) => {
    setActiveTab(key);
    if (data) applySelectedDefault(data, key);
  };

  const handleTabKeyDown = (e: React.KeyboardEvent, idx: number) => {
    let nextIdx: number | null = null;
    if (e.key === 'ArrowRight') nextIdx = (idx + 1) % TAB_CONFIG.length;
    else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + TAB_CONFIG.length) % TAB_CONFIG.length;
    else if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = TAB_CONFIG.length - 1;

    if (nextIdx !== null) {
      e.preventDefault();
      const targetTab = TAB_CONFIG[nextIdx]!;
      handleSelectTab(targetTab.key);
      tabRefs.current[nextIdx]?.focus();
    }
  };

  const handleAiDeepRank = async () => {
    setRanking(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await api.refreshMatches({ topKVector: 60, topKLlm: 15 });
      setStatusMsg(
        `Ranked ${res.stats.totalEvaluated} jobs (v${res.profileVersion}): ${res.stats.llmScored} AI scored, ${res.stats.heuristicScored} rule+vector scored, ${res.stats.reusedFromCache} cached.`
      );
      await loadRecommendations();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to run AI ranking.');
    } finally {
      setRanking(false);
    }
  };

  const handleSaveJob = useCallback(async (jobId: string) => {
    setErrorMsg(null);
    try {
      const res = await api.saveJob(jobId);
      setData((prev) => {
        if (!prev) return prev;
        const patchList = (list: JobFeedItem[]) =>
          list.map((i) => (i.job.id === jobId ? { ...i, applicationStatus: res.status } : i));
        return {
          ...prev,
          buckets: {
            forYou: patchList(prev.buckets.forYou),
            fresh: patchList(prev.buckets.fresh),
            india: patchList(prev.buckets.india),
            remote: patchList(prev.buckets.remote),
            nearMatches: patchList(prev.buckets.nearMatches)
          }
        };
      });
      setStatusMsg('Saved role to Tracker.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save job.');
    }
  }, []);

  const handleDismissJob = useCallback(
    async (jobId: string, reason?: DismissReason) => {
      setErrorMsg(null);
      try {
        await api.dismissJob(jobId, true, reason);
        setData((prev) => {
          if (!prev) return prev;
          const drop = (list: JobFeedItem[]) => list.filter((i) => i.job.id !== jobId);
          const nextBuckets = {
            forYou: drop(prev.buckets.forYou),
            fresh: drop(prev.buckets.fresh),
            india: drop(prev.buckets.india),
            remote: drop(prev.buckets.remote),
            nearMatches: drop(prev.buckets.nearMatches)
          };
          return {
            ...prev,
            buckets: nextBuckets,
            counts: {
              ...prev.counts,
              forYou: nextBuckets.forYou.length,
              fresh: nextBuckets.fresh.length,
              india: nextBuckets.india.length,
              remote: nextBuckets.remote.length,
              nearMatches: nextBuckets.nearMatches.length
            }
          };
        });
        setStatusMsg(
          reason === 'company'
            ? 'Dismissed & down-ranked similar roles from this company.'
            : reason
              ? `Dismissed (${reason}) for this profile version.`
              : 'Dismissed role for this profile version.'
        );
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to dismiss job.');
      }
    },
    []
  );

  const primaryItems = getBucketItems(data, activeTab);
  const supplementNear =
    activeTab === 'for_you' && primaryItems.length < 6 ? data?.buckets.nearMatches ?? [] : [];
  const visibleItems =
    supplementNear.length > 0 ? [...primaryItems, ...supplementNear] : primaryItems;
  const selectedItem = visibleItems.find((i) => i.job.id === selectedId) ?? visibleItems[0] ?? null;

  // Keyboard shortcuts: j/k navigate, s save, x dismiss, t tailor
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
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'j' || e.key === 'J') {
        if (visibleItems.length === 0) return;
        const idx = visibleItems.findIndex((i) => i.job.id === selectedId);
        const next = visibleItems[Math.min(visibleItems.length - 1, Math.max(0, idx + 1))];
        if (next) setSelectedId(next.job.id);
      } else if (e.key === 'k' || e.key === 'K') {
        if (visibleItems.length === 0) return;
        const idx = visibleItems.findIndex((i) => i.job.id === selectedId);
        const prev = visibleItems[Math.max(0, idx - 1)];
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
  }, [visibleItems, selectedId, selectedItem, handleSaveJob, handleDismissJob, router]);

  const syncStatus: JobSyncStatus | null = data?.syncStatus ?? null;
  const topPicks =
    activeTab === 'for_you'
      ? (data?.buckets.forYou.length
          ? data.buckets.forYou.slice(0, 3)
          : data?.buckets.nearMatches.slice(0, 3) ?? [])
      : [];

  return (
    <AppShell
      title="Home // Recommended Roles"
      subtitle="Auto-synced openings from official ATS boards and public feeds, continuously scored against your Master Profile."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {syncStatus ? (
            <Badge tone={syncing ? 'accent' : 'neutral'}>
              {syncStatus.totalActiveJobs} jobs · {formatRelativeTime(syncStatus.lastSyncedAt)}
            </Badge>
          ) : null}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void runSync(true)}
            disabled={syncing}
          >
            {syncing ? 'Syncing...' : 'Sync Sources'}
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => void handleAiDeepRank()}
            disabled={ranking}
          >
            {ranking ? 'AI Ranking...' : 'AI Deep Rank'}
          </Button>
          <Link href="/jobs">
            <Button size="sm" variant="ghost">
              All Filters -&gt;
            </Button>
          </Link>
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
            Syncing live roles across Greenhouse, Lever, Ashby, Workable, SmartRecruiters,
            Himalayas, Remotive, Jobicy, The Muse, HN &amp; RemoteOK...
          </span>
        </div>
      ) : null}

      {errorMsg ? <AlertBanner tone="error" message={errorMsg} /> : null}
      {statusMsg ? <AlertBanner tone="success" message={statusMsg} /> : null}

      {/* Profile Signals Strip */}
      {data ? (
        <div className="border border-[var(--hairline)] bg-[var(--surface-soft)] px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[var(--body)]">
            <span>
              <strong className="text-[var(--ink)]">Roles:</strong>{' '}
              {data.profileSignals.targetRoles.join(', ') || 'Software / General'}
            </span>
            <span>
              <strong className="text-[var(--ink)]">Skills:</strong>{' '}
              {data.profileSignals.topSkills.slice(0, 5).join(', ') || 'Add skills in Profile'}
            </span>
            <span>
              <strong className="text-[var(--ink)]">Markets:</strong>{' '}
              {data.profileSignals.countries.join(', ') || 'Any'}
              {data.profileSignals.preferredCities.length > 0
                ? ` (${data.profileSignals.preferredCities.slice(0, 3).join(', ')})`
                : ''}
            </span>
            <Badge tone="neutral">
              {data.profileSignals.isFresher ? 'Fresher / Entry' : 'Experienced'}
            </Badge>
          </div>
          <Link href="/profile" className="text-[var(--ink)] font-medium no-underline hover:underline">
            Tune preferences -&gt;
          </Link>
        </div>
      ) : null}

      {data && !data.profileSignals.hasProfileData ? (
        <AlertBanner
          tone="info"
          title="Sharpen your matches"
          message="Your Master Profile has minimal skills or role preferences so far. Upload your resume in Onboarding or Profile to boost match precision."
        />
      ) : null}

      {/* Accessible Category Tabs */}
      <div
        role="tablist"
        aria-label="Job recommendation buckets"
        className="flex flex-wrap items-center gap-2 border-b border-[var(--hairline)] pb-3"
      >
        {TAB_CONFIG.map((tab, idx) => {
          const active = activeTab === tab.key;
          const count = getBucketCount(data, tab.key);
          return (
            <button
              key={tab.key}
              ref={(el) => {
                tabRefs.current[idx] = el;
              }}
              id={`rec-tab-${tab.key}`}
              role="tab"
              type="button"
              aria-selected={active}
              aria-controls="rec-tabpanel"
              tabIndex={active ? 0 : -1}
              onClick={() => handleSelectTab(tab.key)}
              onKeyDown={(e) => handleTabKeyDown(e, idx)}
              className={`px-3 py-1.5 text-xs rounded-[4px] border cursor-pointer transition-colors ${
                active
                  ? 'bg-[var(--ink)] text-[var(--on-primary)] border-[var(--ink)] font-bold'
                  : 'bg-[var(--canvas)] text-[var(--body)] border-[var(--hairline)] hover:bg-[var(--surface-soft)] hover:text-[var(--ink)]'
              }`}
            >
              {tab.label} ({count})
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <SkeletonBlock className="h-36" />
            <SkeletonBlock className="h-36" />
            <SkeletonBlock className="h-36" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5 space-y-3">
              <SkeletonBlock className="h-24" />
              <SkeletonBlock className="h-24" />
            </div>
            <div className="lg:col-span-7">
              <SkeletonBlock className="h-80" />
            </div>
          </div>
        </div>
      ) : (
        <div
          id="rec-tabpanel"
          role="tabpanel"
          aria-labelledby={`rec-tab-${activeTab}`}
          className="space-y-6"
        >
          {/* Top Picks Highlight Cards */}
          {topPicks.length > 0 ? (
            <section aria-label="Top picks for you" className="space-y-2.5">
              <div className="flex items-center justify-between text-xs text-[var(--mute)]">
                <span className="font-bold text-[var(--ink)]">
                  TOP PICKS FOR YOU {data?.buckets.forYou.length === 0 ? '(NEAR MATCHES)' : ''}
                </span>
                <span>Click a card to inspect full description</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {topPicks.map((item) => {
                  const isNear = item.match && !item.match.hardFilterPassed;
                  const active = selectedItem?.job.id === item.job.id;
                  const salaryText = formatSalaryRange(
                    item.job.salaryMin,
                    item.job.salaryMax,
                    item.job.salaryCurrency ?? 'INR',
                    item.job.salaryMinLpa,
                    item.job.salaryMaxLpa
                  );
                  return (
                    <div
                      key={item.job.id}
                      onClick={() => setSelectedId(item.job.id)}
                      className={`border p-4 space-y-3 cursor-pointer transition-colors flex flex-col justify-between ${
                        active
                          ? 'border-[var(--ink)] bg-[var(--surface-card)]'
                          : 'border-[var(--hairline)] bg-[var(--canvas)] hover:bg-[var(--surface-soft)]'
                      }`}
                    >
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs text-[var(--mute)] truncate">
                              {item.job.companyName} · {item.job.sourceType}
                            </p>
                            <h3 className="text-sm font-bold text-[var(--ink)] line-clamp-2">
                              {item.job.title}
                            </h3>
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            {item.match?.llmScore != null ? (
                              <Badge tone={scoreTone(item.match.llmScore)}>
                                {item.match.llmScore}% fit
                              </Badge>
                            ) : null}
                            {isNear ? <Badge tone="warning">near</Badge> : null}
                          </div>
                        </div>

                        <p className="text-xs text-[var(--body)] truncate">
                          {item.job.city ?? item.job.locationRaw ?? 'Unspecified'} ·{' '}
                          {item.job.workMode} · <span className="tabular-nums">{salaryText}</span>
                        </p>

                        {item.match?.matchReason ? (
                          <p className="text-xs text-[var(--mute)] line-clamp-2">
                            {item.match.matchReason}
                          </p>
                        ) : null}

                        <div className="flex flex-wrap gap-1">
                          {(item.match?.matchedSkills ?? []).slice(0, 3).map((s) => (
                            <Badge key={s} tone="success">
                              {s}
                            </Badge>
                          ))}
                          {(item.match?.skillGaps ?? []).slice(0, 2).map((s) => (
                            <Badge key={s} tone="warning">
                              gap: {s}
                            </Badge>
                          ))}
                        </div>
                      </div>

                      <div
                        className="flex flex-wrap items-center gap-2 pt-2 border-t border-[var(--hairline)]"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void handleSaveJob(item.job.id)}
                        >
                          {item.applicationStatus ? 'Saved' : 'Save'}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            router.push(`/tailor?jobId=${encodeURIComponent(item.job.id)}`)
                          }
                        >
                          Tailor
                        </Button>
                        <a
                          href={item.job.applyUrl ?? item.job.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-auto"
                        >
                          <Button size="sm" variant="primary">
                            Apply -&gt;
                          </Button>
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          {visibleItems.length === 0 ? (
            <EmptyState
              title={
                syncing
                  ? 'Fetching live jobs across all sources...'
                  : 'No roles in this bucket yet'
              }
              description={
                syncing
                  ? 'Pulling open roles from company boards and public tech feeds now.'
                  : 'Sync live sources now or switch to Near Matches / All Filters to explore the full catalog.'
              }
              action={
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" onClick={() => void runSync(true)} disabled={syncing}>
                    {syncing ? 'Syncing...' : 'Sync Live Sources Now'}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => handleSelectTab('near_matches')}
                  >
                    View Near Matches
                  </Button>
                </div>
              }
            />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Feed List Pane */}
              <div className="lg:col-span-5 border border-[var(--hairline)] divide-y divide-[var(--hairline)] bg-[var(--canvas)]">
                {primaryItems.map((item) => renderListRow(item, selectedItem?.job.id === item.job.id, setSelectedId))}

                {supplementNear.length > 0 ? (
                  <>
                    <div className="px-4 py-2 bg-[var(--surface-soft)] text-[11px] font-bold text-[var(--mute)] uppercase tracking-wide">
                      Near Matches (Outside Strict Filters)
                    </div>
                    {supplementNear.map((item) =>
                      renderListRow(item, selectedItem?.job.id === item.job.id, setSelectedId, true)
                    )}
                  </>
                ) : null}
              </div>

              {/* Detail Inspector Pane */}
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
                          variant="secondary"
                          onClick={() =>
                            router.push(
                              `/tailor?jobId=${encodeURIComponent(selectedItem.job.id)}`
                            )
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
                      {/* Match Breakdown */}
                      <div className="border border-[var(--hairline)] bg-[var(--surface-soft)] p-4 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-bold text-[var(--ink)]">
                            MATCH BREAKDOWN
                          </span>
                          <div className="flex flex-wrap gap-2">
                            <Badge
                              tone={
                                selectedItem.match == null
                                  ? 'neutral'
                                  : selectedItem.match.hardFilterPassed
                                    ? 'success'
                                    : 'warning'
                              }
                            >
                              {selectedItem.match == null
                                ? 'UNSCORED'
                                : selectedItem.match.hardFilterPassed
                                  ? 'FILTERS: PASS'
                                  : 'NEAR MATCH'}
                            </Badge>
                            {selectedItem.match?.vectorSimilarity != null ? (
                              <Badge tone="neutral">
                                VEC: {Math.round(selectedItem.match.vectorSimilarity * 100)}%
                              </Badge>
                            ) : null}
                            {selectedItem.match?.llmScore != null ? (
                              <Badge tone={scoreTone(selectedItem.match.llmScore)}>
                                FIT: {selectedItem.match.llmScore}/100
                              </Badge>
                            ) : null}
                          </div>
                        </div>

                        {selectedItem.match?.matchReason ? (
                          <p className="text-sm text-[var(--ink)]">
                            {selectedItem.match.matchReason}
                          </p>
                        ) : null}

                        {selectedItem.match &&
                        !selectedItem.match.hardFilterPassed &&
                        selectedItem.match.hardFilterReasons.length > 0 ? (
                          <ul className="text-xs text-[var(--warning-text)] list-disc pl-5 space-y-0.5">
                            {selectedItem.match.hardFilterReasons
                              .filter((r) => !r.startsWith('dismiss_reason:'))
                              .map((r, i) => (
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
                                  <span className="text-[var(--mute)]">
                                    No explicit gaps flagged
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>

                      {/* Dismiss & Steer Future Recommendations */}
                      <div className="flex flex-wrap items-center justify-between gap-2 border border-[var(--hairline)] px-3 py-2 text-xs">
                        <span className="text-[var(--mute)]">Not right? Steer recommendations:</span>
                        <div className="flex flex-wrap gap-1.5">
                          {(
                            [
                              ['seniority', 'Too senior'],
                              ['stack', 'Wrong stack'],
                              ['company', 'Skip company'],
                              ['location', 'Location']
                            ] as Array<[DismissReason, string]>
                          ).map(([reason, label]) => (
                            <Button
                              key={reason}
                              size="sm"
                              variant="ghost"
                              onClick={() => void handleDismissJob(selectedItem.job.id, reason)}
                            >
                              {label}
                            </Button>
                          ))}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void handleDismissJob(selectedItem.job.id)}
                          >
                            Dismiss (X)
                          </Button>
                        </div>
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
                          <span className="text-[var(--mute)] block">Source / Posted</span>
                          <strong>
                            {selectedItem.job.sourceType} ·{' '}
                            {formatRelativeTime(
                              selectedItem.job.postedAt ?? selectedItem.job.lastSeenAt
                            )}
                          </strong>
                        </div>
                      </div>

                      {/* Clean JD */}
                      <div className="space-y-2">
                        <h3 className="text-xs font-bold text-[var(--mute)]">JOB DESCRIPTION</h3>
                        <div className="text-sm text-[var(--body)] whitespace-pre-wrap leading-relaxed max-h-[380px] overflow-y-auto pr-2">
                          {selectedItem.job.descriptionClean || 'No description text provided.'}
                        </div>
                      </div>
                    </div>
                  </SectionBlock>
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}

      {/* Footer Hint Bar */}
      <div className="border-t border-[var(--hairline)] pt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--mute)]">
        <span>j/k navigate · s save · x dismiss · t tailor · ←/→ switch tabs</span>
        <div className="flex flex-wrap items-center gap-4">
          <Link href="/jobs" className="text-[var(--ink)] no-underline hover:underline">
            Full Search &amp; All Filters -&gt;
          </Link>
          <Link href="/tracker" className="text-[var(--ink)] no-underline hover:underline">
            Application Tracker -&gt;
          </Link>
        </div>
      </div>
    </AppShell>
  );
}

function renderListRow(
  item: JobFeedItem,
  active: boolean,
  onSelect: (id: string) => void,
  markNear: boolean = false
) {
  const salaryText = formatSalaryRange(
    item.job.salaryMin,
    item.job.salaryMax,
    item.job.salaryCurrency ?? 'INR',
    item.job.salaryMinLpa,
    item.job.salaryMaxLpa
  );
  const isNear = markNear || Boolean(item.match && !item.match.hardFilterPassed);
  return (
    <button
      key={item.job.id}
      type="button"
      onClick={() => onSelect(item.job.id)}
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
          <h3 className="text-sm font-bold text-[var(--ink)] truncate">{item.job.title}</h3>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {isNear ? <Badge tone="warning">near</Badge> : null}
          {item.match?.llmScore != null ? (
            <Badge tone={scoreTone(item.match.llmScore)}>{item.match.llmScore}%</Badge>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--body)]">
        <span>{item.job.city ?? item.job.locationRaw ?? 'Unspecified'}</span>
        <span>·</span>
        <span>{item.job.workMode}</span>
        <span>·</span>
        <span className="tabular-nums">{salaryText}</span>
        {item.applicationStatus ? <Badge tone="accent">{item.applicationStatus}</Badge> : null}
      </div>

      {item.match?.matchReason ? (
        <p className="text-xs text-[var(--mute)] line-clamp-2">{item.match.matchReason}</p>
      ) : null}
    </button>
  );
}
