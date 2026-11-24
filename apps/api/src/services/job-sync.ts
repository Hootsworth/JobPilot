import type { JobSyncStatus, MasterProfile } from '@jobpilot/shared';
import { runDiscoverySync } from '@jobpilot/ingestion';
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

  async getStatus(userId?: string): Promise<JobSyncStatus> {
    const [{ sources, recentRuns }, activeCounts] = await Promise.all([
      this.store.listJobSourcesAndRuns(),
      userId ? this.store.countActiveJobs(userId) : Promise.resolve({ total: 0, bySource: {} })
    ]);

    const lastOkRun =
      recentRuns.find((r) => r.status === 'ok' && r.finishedAt != null) ?? null;
    const lastSyncedAt = lastOkRun?.finishedAt ?? null;

    let isStale = false;
    if (userId && activeCounts.total === 0) {
      isStale = true;
    } else if (!lastSyncedAt) {
      isStale = true;
    } else {
      const ms = Date.parse(lastSyncedAt);
      const ageHours = Number.isFinite(ms) ? (Date.now() - ms) / (1000 * 60 * 60) : 999;
      isStale = ageHours >= this.config.jobSyncStaleHours;
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
  }): Promise<JobSyncRunResult> {
    if (this.inFlightPromise) {
      const joined = await this.inFlightPromise;
      const freshStatus = params.userId ? await this.getStatus(params.userId) : joined.status;
      return {
        ...joined,
        alreadyRunning: true,
        status: freshStatus
      };
    }

    const currentStatus = await this.getStatus(params.userId);
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
      const sourceCache = await this.store.listJobSourceCache().catch(() => new Map());

      const discovery = await this.syncRunner({
        mode: params.mode,
        existingSourceCache: sourceCache,
        profile: params.profile,
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

      const stats = {
        ...discovery.stats,
        insertedCount,
        updatedCount
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
