import type { JobSourceStatus, JobSyncStatus, MasterProfile, SeedBoard } from '@jobpilot/shared';
import { loadCompanyRegistry, runDiscoverySync } from '@jobpilot/ingestion';
import type { ApiConfig } from '../config.js';
import type { DataStore } from '../store/types.js';

export interface JobSyncRunResult {
  alreadyRunning: boolean;
  skipped: boolean;
  reason?: string;
  insertedCount: number;
  updatedCount: number;
  rawJobsCount: number;
  dedupedCount: number;
  boardSuccess: number;
  boardFailures: number;
  aggregatorCount: number;
  status: JobSyncStatus;
}

export class JobSyncService {
  private readonly store: DataStore;
  private readonly config: ApiConfig;
  private readonly syncRunner: typeof runDiscoverySync;
  private inFlightPromise: Promise<JobSyncRunResult> | null = null;
  private runningState: { status: 'idle' | 'running'; startedAt: string | null } = {
    status: 'idle',
    startedAt: null
  };

  constructor(params: {
    store: DataStore;
    config: ApiConfig;
    syncRunner?: typeof runDiscoverySync;
  }) {
    this.store = params.store;
    this.config = params.config;
    this.syncRunner = params.syncRunner ?? runDiscoverySync;
  }

  async getStatus(userId?: string, staleHoursOverride?: number): Promise<JobSyncStatus> {
    const [{ sources, recentRuns }, activeCounts] = await Promise.all([
      this.store.listJobSourcesAndRuns(),
      userId ? this.store.countActiveJobs(userId) : Promise.resolve({ total: 0, bySource: {} })
    ]);

    const lastOkRun =
      recentRuns.find((r) => r.status === 'ok' && r.finishedAt != null) ?? null;
    const lastSyncedAt = lastOkRun?.finishedAt ?? null;
    const effectiveStaleHours = Math.max(1, staleHoursOverride ?? this.config.jobSyncStaleHours);

    let isStale = false;
    if (userId && activeCounts.total === 0) {
      isStale = true;
    } else if (!lastSyncedAt) {
      isStale = true;
    } else {
      const ms = Date.parse(lastSyncedAt);
      const ageHours = Number.isFinite(ms) ? (Date.now() - ms) / (1000 * 60 * 60) : 999;
      isStale = ageHours >= effectiveStaleHours;
    }

    return {
      status: this.runningState.status,
      isStale,
      totalActiveJobs: activeCounts.total,
      activeSourcesCount: sources.filter((s) => s.enabled).length,
      lastSyncedAt,
      lastRun: recentRuns[0] ?? null,
      sourceBreakdown: activeCounts.bySource
    };
  }

  async syncNow(params: {
    userId?: string;
    profile?: MasterProfile | null;
    mode: 'quick' | 'full';
    force: boolean;
    staleHoursOverride?: number;
  }): Promise<JobSyncRunResult> {
    if (this.inFlightPromise) {
      const joined = await this.inFlightPromise;
      const freshStatus = params.userId
        ? await this.getStatus(params.userId, params.staleHoursOverride)
        : joined.status;
      return {
        ...joined,
        alreadyRunning: true,
        status: freshStatus
      };
    }

    const currentStatus = await this.getStatus(params.userId, params.staleHoursOverride);
    if (!params.force && !currentStatus.isStale) {
      return {
        alreadyRunning: false,
        skipped: true,
        reason: 'catalog_fresh',
        insertedCount: 0,
        updatedCount: 0,
        rawJobsCount: 0,
        dedupedCount: 0,
        boardSuccess: 0,
        boardFailures: 0,
        aggregatorCount: 0,
        status: currentStatus
      };
    }

    const work = this.executeSync(params);
    this.inFlightPromise = work;
    return work;
  }

  private async buildMergedBoards(): Promise<SeedBoard[]> {
    const byKey = new Map<string, SeedBoard>();
    for (const board of loadCompanyRegistry()) {
      byKey.set(`${board.sourceType}:${board.slug}`, board);
    }
    const { sources } = await this.store.listJobSourcesAndRuns().catch(() => ({
      sources: [] as JobSourceStatus[],
      recentRuns: []
    }));
    for (const src of sources) {
      if (!src.enabled) continue;
      if (
        src.sourceType !== 'greenhouse' &&
        src.sourceType !== 'lever' &&
        src.sourceType !== 'ashby' &&
        src.sourceType !== 'workable' &&
        src.sourceType !== 'smartrecruiters'
      ) {
        continue;
      }
      const key = `${src.sourceType}:${src.slug}`;
      if (byKey.has(key)) continue;
      byKey.set(key, {
        sourceType: src.sourceType,
        slug: src.slug,
        displayName: src.displayName,
        regionFocus:
          src.regionFocus === 'india' || src.regionFocus === 'global' || src.regionFocus === 'hybrid'
            ? src.regionFocus
            : 'india',
        refreshTier: 'high_volume',
        enabled: true
      });
    }
    return Array.from(byKey.values());
  }

  async syncSingleBoard(board: SeedBoard): Promise<{
    source: JobSourceStatus;
    syncedJobsCount: number;
    insertedCount: number;
    updatedCount: number;
  }> {
    const discovery = await this.syncRunner({
      mode: 'full',
      boards: [board],
      existingSourceCache: new Map(),
      respectRefreshTiers: false,
      skipAggregators: true
    });

    const update = discovery.sourceUpdates.find(
      (s) => s.sourceType === board.sourceType && s.slug === board.slug
    );
    if (!update || update.failed) {
      throw new Error(
        `Could not fetch jobs from ${board.sourceType} board "${board.slug}". Check that the URL points to a public careers board.`
      );
    }

    await this.store.upsertJobSourceStatus(update);
    const { insertedCount, updatedCount } = await this.store.upsertPublicJobsBatch(discovery.bundles);
    const { sources } = await this.store.listJobSourcesAndRuns().catch(() => ({
      sources: [] as JobSourceStatus[],
      recentRuns: []
    }));
    const storedSource: JobSourceStatus =
      sources.find((s) => s.sourceType === board.sourceType && s.slug === board.slug) ?? {
        id: `${board.sourceType}:${board.slug}`,
        sourceType: board.sourceType,
        slug: board.slug,
        displayName: board.displayName,
        regionFocus: board.regionFocus,
        enabled: true,
        lastCrawledAt: update.lastCrawledAt,
        lastStatus: update.lastStatus,
        consecutiveFailures: update.consecutiveFailures
      };

    return {
      source: storedSource,
      syncedJobsCount: discovery.stats.rawJobsCount,
      insertedCount,
      updatedCount
    };
  }

  private async executeSync(params: {
    userId?: string;
    profile?: MasterProfile | null;
    mode: 'quick' | 'full';
    force: boolean;
  }): Promise<JobSyncRunResult> {
    this.runningState = { status: 'running', startedAt: new Date().toISOString() };
    let runId: string | null = null;

    try {
      runId = await this.store.startCrawlRun(`api-sync-${params.mode}`).catch(() => null);
      const [sourceCache, boards] = await Promise.all([
        this.store.listJobSourceCache().catch(() => new Map()),
        this.buildMergedBoards()
      ]);

      const discovery = await this.syncRunner({
        mode: params.mode,
        boards,
        existingSourceCache: sourceCache,
        profile: params.profile,
        respectRefreshTiers: !params.force,
        envKeys: {
          adzunaAppId: this.config.adzunaAppId,
          adzunaAppKey: this.config.adzunaAppKey,
          joobleApiKey: this.config.joobleApiKey,
          jsearchRapidApiKey: this.config.jsearchRapidApiKey
        }
      });

      const CHUNK = 10;
      for (let i = 0; i < discovery.sourceUpdates.length; i += CHUNK) {
        const chunk = discovery.sourceUpdates.slice(i, i + CHUNK);
        await Promise.all(
          chunk.map((src) => this.store.upsertJobSourceStatus(src).catch(() => {}))
        );
      }

      const { insertedCount, updatedCount } = await this.store.upsertPublicJobsBatch(
        discovery.bundles
      );
      const expiredCount = await this.store
        .reconcileExpiredPublicJobs(discovery.reconcilableBoards ?? [], 14)
        .catch(() => 0);

      const stats = {
        ...discovery.stats,
        insertedCount,
        updatedCount,
        expiredCount
      };

      if (runId) {
        await this.store.finishCrawlRun(runId, 'ok', stats).catch(() => {});
      }

      const status = await this.getStatus(params.userId);
      return {
        alreadyRunning: false,
        skipped: false,
        insertedCount,
        updatedCount,
        rawJobsCount: discovery.stats.rawJobsCount,
        dedupedCount: discovery.stats.dedupedCount,
        boardSuccess: discovery.stats.boardSuccess,
        boardFailures: discovery.stats.boardFailures,
        aggregatorCount: discovery.stats.aggregatorCount,
        status
      };
    } catch (err) {
      if (runId) {
        await this.store
          .finishCrawlRun(runId, 'error', {
            error: err instanceof Error ? err.message : String(err)
          })
          .catch(() => {});
      }
      throw err;
    } finally {
      this.runningState = { status: 'idle', startedAt: null };
      this.inFlightPromise = null;
    }
  }
}
