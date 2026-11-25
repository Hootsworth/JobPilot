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
import {
  formatRelativeTime,
  formatSeniority,
  formatSourceLabel,
  formatWorkMode,
  pluralize
} from '@/lib/format';

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
  const [refreshing, setRefreshing] = useState(false);
  const [ranking, setRanking] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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
        err instanceof Error ? err.message : 'Failed to load recommended jobs.'
      );
      return null;
    } finally {
      setLoading(false);
    }
  }, [activeTab, applySelectedDefault]);

  const handleRefreshFeed = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadRecommendations();
    } finally {
      setRefreshing(false);
    }
  }, [loadRecommendations]);

  useEffect(() => {
    void loadRecommendations();
    // Run once on initial mount; background scheduler refreshes job sources automatically
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

  const handleRescore = async () => {
    setRanking(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await api.refreshMatches({ topKVector: 60, topKLlm: 15 });
      setStatusMsg(`Updated match scores for ${pluralize(res.stats.totalEvaluated, 'job')}.`);
      await loadRecommendations();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to re-score jobs.');
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
      setStatusMsg('Saved to Tracker.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save job.');
    }
  }, []);

  const handleDismissJob = useCallback(async (jobId: string, reason?: DismissReason) => {
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
          ? 'Hidden and down-ranked future roles from this company.'
          : 'Hidden from recommendations.'
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to hide job.');
    }
  }, []);

  const primaryItems = getBucketItems(data, activeTab);
  const supplementNear =
    activeTab === 'for_you' && primaryItems.length < 6 ? data?.buckets.nearMatches ?? [] : [];
  const visibleItems =
    supplementNear.length > 0 ? [...primaryItems, ...supplementNear] : primaryItems;
  const selectedItem = visibleItems.find((i) => i.job.id === selectedId) ?? visibleItems[0] ?? null;

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
      title="Home"
      actions={
        <div className="flex flex-wrap items-center gap-2.5">
          {syncStatus ? (
            <span className="text-xs text-[var(--mute)] tabular-nums whitespace-nowrap">
              {pluralize(syncStatus.totalActiveJobs, 'job')} · Updated{' '}
              {formatRelativeTime(syncStatus.lastSyncedAt)}
            </span>
          ) : null}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void handleRefreshFeed()}
            disabled={refreshing}
          >
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => void handleRescore()}
            disabled={ranking}
            title="Re-evaluate matches against your profile"
          >
            {ranking ? 'Re-scoring...' : 'Re-score'}
          </Button>
        </div>
      }
    >
      {refreshing ? (
        <div
          role="status"
          aria-live="polite"
          className="border border-[var(--hairline)] bg-[var(--surface-soft)] px-3.5 py-2.5 text-xs text-[var(--body)] flex items-center gap-2.5"
        >
          <MoSpinner name="braille" className="text-[var(--accent-text)] font-bold" />
          <span>Refreshing recommendations...</span>
        </div>
      ) : null}

      {errorMsg ? <AlertBanner tone="error" message={errorMsg} /> : null}
      {statusMsg ? <AlertBanner tone="success" message={statusMsg} /> : null}

      {/* Quiet Profile Summary Line */}
      {data ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--mute)] border border-[var(--hairline)] bg-[var(--surface-soft)] px-3.5 py-2.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
            <span>
              Matching for{' '}
              <strong className="text-[var(--ink)]">
                {data.profileSignals.targetRoles.join(', ') || 'Software Engineering'}
              </strong>
            </span>
            {data.profileSignals.preferredCities.length > 0 ? (
              <span>· {data.profileSignals.preferredCities.slice(0, 3).join(', ')}</span>
            ) : data.profileSignals.countries.length > 0 ? (
              <span>· {data.profileSignals.countries.join(', ')}</span>
            ) : null}
            {data.profileSignals.topSkills.length > 0 ? (
              <span className="hidden sm:inline">
                · {data.profileSignals.topSkills.slice(0, 4).join(', ')}
              </span>
            ) : null}
          </div>
          <Link
            href="/profile"
            className="text-[var(--ink)] font-medium no-underline hover:underline whitespace-nowrap shrink-0"
          >
            Edit preferences
          </Link>
        </div>
      ) : null}

      {data && !data.profileSignals.hasProfileData ? (
        <AlertBanner
          tone="info"
          title="Complete your profile for sharper matches"
          message="Add your skills, experience, or target cities so recommendations rank around your background."
          action={
            <Link href="/profile">
              <Button size="sm" variant="secondary">
                Open Profile
              </Button>
            </Link>
          }
        />
      ) : null}

      {/* Accessible Category Tabs */}
      <div
        role="tablist"
        aria-label="Job recommendation views"
        className="flex items-center gap-1.5 overflow-x-auto border-b border-[var(--hairline)] pb-3"
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
              className={`h-9 px-3 text-xs whitespace-nowrap shrink-0 rounded-[4px] border cursor-pointer transition-colors inline-flex items-center gap-1.5 ${
                active
                  ? 'bg-[var(--ink)] text-[var(--on-primary)] border-[var(--ink)] font-semibold'
                  : 'bg-[var(--canvas)] text-[var(--body)] border-[var(--hairline)] hover:bg-[var(--surface-soft)] hover:text-[var(--ink)]'
              }`}
            >
              <span>{tab.label}</span>
              <span className={active ? 'opacity-80 tabular-nums' : 'text-[var(--mute)] tabular-nums'}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <SkeletonBlock className="h-44" />
            <SkeletonBlock className="h-44" />
            <SkeletonBlock className="h-44" />
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
          {/* Equal-Height Top Picks Grid */}
          {topPicks.length > 0 ? (
            <section aria-label="Top picks for you" className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--mute)]">
                  Top Picks {data?.buckets.forYou.length === 0 ? '· Near Matches' : ''}
                </h2>
                <Link
                  href="/jobs"
                  className="text-xs text-[var(--mute)] hover:text-[var(--ink)] no-underline hover:underline"
                >
                  Open full search
                </Link>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch">
                {topPicks.map((item) => {
                  const isNear = Boolean(item.match && !item.match.hardFilterPassed);
                  const active = selectedItem?.job.id === item.job.id;
                  const workMode = formatWorkMode(item.job.workMode);
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
                      className={`h-full flex flex-col justify-between p-4 border cursor-pointer transition-colors ${
                        active
                          ? 'border-[var(--ink)] bg-[var(--surface-card)]'
                          : 'border-[var(--hairline)] bg-[var(--canvas)] hover:bg-[var(--surface-soft)]'
                      }`}
                    >
                      <div className="space-y-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs text-[var(--mute)] truncate">
                              {item.job.companyName} · {formatSourceLabel(item.job.sourceType)}
                            </p>
                            <h3 className="text-sm font-bold text-[var(--ink)] line-clamp-2 min-h-[40px] mt-0.5">
                              {item.job.title}
                            </h3>
                          </div>
                          {item.match?.llmScore != null ? (
                            <Badge tone={isNear ? 'warning' : scoreTone(item.match.llmScore)}>
                              {item.match.llmScore}%
                            </Badge>
                          ) : null}
                        </div>

                        <p className="text-xs text-[var(--body)] truncate">
                          {item.job.city ?? item.job.locationRaw ?? 'Location flexible'}
                          {workMode ? ` · ${workMode}` : ''}
                          {salaryText !== 'Not disclosed'
                            ? ` · ${salaryText}`
                            : item.job.stipendMonthlyInr != null
                              ? ` · ₹${Math.round(item.job.stipendMonthlyInr / 1000)}k/mo`
                              : ''}
                        </p>

                        <p className="text-xs text-[var(--mute)] line-clamp-2 min-h-[32px]">
                          {item.match?.matchReason || 'Matches your profile and skills.'}
                        </p>

                        <div className="flex flex-wrap gap-1 min-h-[24px]">
                          {item.job.employmentType === 'internship' ? (
                            <Badge tone="accent">Internship</Badge>
                          ) : item.job.fresherEligible ? (
                            <Badge tone="success">Fresher</Badge>
                          ) : null}
                          {(item.match?.matchedSkills ?? []).slice(0, 3).map((s) => (
                            <Badge key={s} tone="success">
                              {s}
                            </Badge>
                          ))}
                        </div>
                      </div>

                      <div
                        className="flex items-center gap-2 pt-3 mt-3 border-t border-[var(--hairline)]"
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
                            Apply
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
              title={refreshing ? 'Loading job openings...' : 'No roles match this view'}
              description={
                refreshing
                  ? 'Reloading live roles from connected company boards and feeds.'
                  : 'Reload the feed or check Near Matches to see roles slightly outside your filters.'
              }
              action={
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void handleRefreshFeed()}
                    disabled={refreshing}
                  >
                    {refreshing ? 'Refreshing...' : 'Refresh'}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleSelectTab('near_matches')}
                  >
                    View Near Matches
                  </Button>
                </div>
              }
            />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Scrollable Feed List Pane */}
              <div className="lg:col-span-5 border border-[var(--hairline)] divide-y divide-[var(--hairline)] bg-[var(--canvas)] lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto">
                {primaryItems.map((item) =>
                  renderListRow(item, selectedItem?.job.id === item.job.id, setSelectedId)
                )}

                {supplementNear.length > 0 ? (
                  <>
                    <div className="px-4 py-2 bg-[var(--surface-soft)] text-[11px] font-bold text-[var(--mute)] uppercase tracking-wider">
                      Near Matches
                    </div>
                    {supplementNear.map((item) =>
                      renderListRow(item, selectedItem?.job.id === item.job.id, setSelectedId, true)
                    )}
                  </>
                ) : null}
              </div>

              {/* Sticky Detail Inspector Pane */}
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
                          variant="secondary"
                          onClick={() =>
                            router.push(
                              `/tailor?jobId=${encodeURIComponent(selectedItem.job.id)}`
                            )
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
                      {/* Match Breakdown */}
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
                            <p className="text-sm text-[var(--ink)]">
                              {selectedItem.match.matchReason}
                            </p>
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

                      {/* Steer Feedback Bar */}
                      <div className="flex flex-wrap items-center justify-between gap-2 border border-[var(--hairline)] px-3 py-2 text-xs">
                        <span className="text-[var(--mute)]">Hide role:</span>
                        <div className="flex flex-wrap gap-1">
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
                            Dismiss
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
                            {formatSourceLabel(selectedItem.job.sourceType)} ·{' '}
                            {formatRelativeTime(
                              selectedItem.job.postedAt ?? selectedItem.job.lastSeenAt
                            )}
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
        </div>
      )}
    </AppShell>
  );
}

function renderListRow(
  item: JobFeedItem,
  active: boolean,
  onSelect: (id: string) => void,
  markNear: boolean = false
) {
  const workMode = formatWorkMode(item.job.workMode);
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
            {item.job.companyName} · {formatSourceLabel(item.job.sourceType)}
          </p>
          <h3 className="text-sm font-bold text-[var(--ink)] truncate">{item.job.title}</h3>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {isNear ? <Badge tone="warning">Near</Badge> : null}
          {item.match?.llmScore != null ? (
            <Badge tone={scoreTone(item.match.llmScore)}>{item.match.llmScore}%</Badge>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--body)]">
        <span>{item.job.city ?? item.job.locationRaw ?? 'Location flexible'}</span>
        {workMode ? (
          <>
            <span>·</span>
            <span>{workMode}</span>
          </>
        ) : null}
        {salaryText !== 'Not disclosed' ? (
          <>
            <span>·</span>
            <span className="tabular-nums">{salaryText}</span>
          </>
        ) : item.job.stipendMonthlyInr != null ? (
          <>
            <span>·</span>
            <span className="tabular-nums">₹{Math.round(item.job.stipendMonthlyInr / 1000)}k/mo</span>
          </>
        ) : null}
        {item.job.employmentType === 'internship' ? (
          <Badge tone="accent">Internship</Badge>
        ) : item.job.fresherEligible ? (
          <Badge tone="success">Fresher</Badge>
        ) : null}
        {item.applicationStatus ? <Badge tone="accent">{item.applicationStatus}</Badge> : null}
      </div>

      {item.match?.matchReason ? (
        <p className="text-xs text-[var(--mute)] line-clamp-2">{item.match.matchReason}</p>
      ) : null}
    </button>
  );
}
