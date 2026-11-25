import type { MasterProfile, NormalizedJobInput, SeedBoard } from '@jobpilot/shared';
import {
  fetchAdzunaIndia,
  fetchArbeitnowFeed,
  fetchAshbyBoard,
  fetchGreenhouseBoard,
  fetchHackerNewsHiringFeed,
  fetchHimalayasFeed,
  fetchJobicyFeed,
  fetchJoobleIndia,
  fetchJSearchOptional,
  fetchLeverBoard,
  fetchRemoteOkFeed,
  fetchRemotiveFeed,
  fetchSmartRecruitersBoard,
  fetchTheMuseFeed,
  fetchWorkableBoard,
  fetchWorkdayBoard,
  type ConnectorFetchResult
} from '../connectors/index.js';
import { PoliteHttpClient } from '../http/polite-fetch.js';
import { dedupeNormalizedJobs, type DedupedJobBundle } from '../normalize/dedupe.js';
import { buildDiscoveryQueriesFromProfile } from './profile-queries.js';
import { loadCompanyRegistry } from './seed-boards.js';

export interface SourceCacheEntry {
  etag: string | null;
  lastModified: string | null;
  lastCrawledAt?: string | null;
  consecutiveFailures: number;
}

export interface DiscoverySourceUpdate {
  sourceType: string;
  slug: string;
  displayName: string;
  regionFocus: string;
  enabled: boolean;
  etag: string | null;
  lastModified: string | null;
  lastCrawledAt: string;
  lastStatus: string;
  consecutiveFailures: number;
  jobsCount: number;
  failed: boolean;
}

export interface ReconcilableBoardSnapshot {
  boardKey: string;
  activeExternalIds: string[];
}

export interface RunDiscoverySyncParams {
  mode: 'quick' | 'full';
  boards?: SeedBoard[];
  existingSourceCache?: Map<string, SourceCacheEntry>;
  profile?: MasterProfile | null;
  respectRefreshTiers?: boolean;
  envKeys?: {
    adzunaAppId?: string;
    adzunaAppKey?: string;
    joobleApiKey?: string;
    jsearchRapidApiKey?: string;
    jsearchMaxPagesPerRun?: number;
  };
  http?: PoliteHttpClient;
  maxQuickBoards?: number;
  concurrency?: number;
}

export interface RunDiscoverySyncResult {
  bundles: DedupedJobBundle[];
  sourceUpdates: DiscoverySourceUpdate[];
  reconcilableBoards: ReconcilableBoardSnapshot[];
  stats: {
    mode: 'quick' | 'full';
    boardsSelected: number;
    boardsTotal: number;
    boardsSkippedCooldown: number;
    boardSuccess: number;
    boardFailures: number;
    aggregatorCount: number;
    rawJobsCount: number;
    dedupedCount: number;
  };
}

function regionRank(regionFocus: SeedBoard['regionFocus'], priority: 'india' | 'global'): number {
  if (priority === 'india') {
    if (regionFocus === 'india') return 0;
    if (regionFocus === 'hybrid') return 1;
    return 2;
  }
  if (regionFocus === 'global') return 0;
  if (regionFocus === 'hybrid') return 1;
  return 2;
}

const HIGH_VOLUME_COOLDOWN_MS = 3 * 60 * 60 * 1000;
const STANDARD_COOLDOWN_MS = 12 * 60 * 60 * 1000;

function isBoardDue(
  board: SeedBoard,
  cacheEntry: SourceCacheEntry | undefined,
  nowMs: number
): boolean {
  if (!cacheEntry?.lastCrawledAt) return true;
  const crawledMs = Date.parse(cacheEntry.lastCrawledAt);
  if (!Number.isFinite(crawledMs)) return true;
  const cooldownMs =
    board.refreshTier === 'standard' ? STANDARD_COOLDOWN_MS : HIGH_VOLUME_COOLDOWN_MS;
  return nowMs - crawledMs >= cooldownMs;
}

function prioritizeBoards(
  boards: SeedBoard[],
  cache: Map<string, SourceCacheEntry>,
  regionPriority: 'india' | 'global',
  mode: 'quick' | 'full',
  maxQuickBoards: number,
  respectRefreshTiers: boolean
): { selected: SeedBoard[]; skippedCooldown: number } {
  const enabled = boards.filter((b) => b.enabled);
  const nowMs = Date.now();
  const dueBoards = respectRefreshTiers
    ? enabled.filter((b) => isBoardDue(b, cache.get(`${b.sourceType}:${b.slug}`), nowMs))
    : enabled;
  const skippedCooldown = enabled.length - dueBoards.length;

  const sorted = [...dueBoards].sort((a, b) => {
    const ca = cache.get(`${a.sourceType}:${a.slug}`);
    const cb = cache.get(`${b.sourceType}:${b.slug}`);

    const aBroken = (ca?.consecutiveFailures ?? 0) >= 3 ? 1 : 0;
    const bBroken = (cb?.consecutiveFailures ?? 0) >= 3 ? 1 : 0;
    if (aBroken !== bBroken) return aBroken - bBroken;

    const aTime = ca?.lastCrawledAt ? Date.parse(ca.lastCrawledAt) : 0;
    const bTime = cb?.lastCrawledAt ? Date.parse(cb.lastCrawledAt) : 0;
    const aUnseen = aTime === 0 ? 0 : 1;
    const bUnseen = bTime === 0 ? 0 : 1;
    if (aUnseen !== bUnseen) return aUnseen - bUnseen;

    const rDiff =
      regionRank(a.regionFocus, regionPriority) - regionRank(b.regionFocus, regionPriority);
    if (rDiff !== 0) return rDiff;

    const aTier = a.refreshTier === 'standard' ? 1 : 0;
    const bTier = b.refreshTier === 'standard' ? 1 : 0;
    if (aTier !== bTier) return aTier - bTier;

    return aTime - bTime;
  });

  if (mode === 'full') return { selected: sorted, skippedCooldown };
  return { selected: sorted.slice(0, maxQuickBoards), skippedCooldown };
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  const safeConcurrency = Math.max(1, Math.min(concurrency, items.length || 1));
  let cursor = 0;
  const runners = Array.from({ length: safeConcurrency }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      const item = items[idx];
      if (item !== undefined) {
        await worker(item);
      }
    }
  });
  await Promise.all(runners);
}

async function fetchAtsBoard(
  board: SeedBoard,
  http: PoliteHttpClient,
  conditional: { etag?: string | null; lastModified?: string | null }
): Promise<ConnectorFetchResult> {
  switch (board.sourceType) {
    case 'greenhouse':
      return fetchGreenhouseBoard({ slug: board.slug, companyName: board.displayName, http, conditional });
    case 'lever':
      return fetchLeverBoard({ slug: board.slug, companyName: board.displayName, http, conditional });
    case 'ashby':
      return fetchAshbyBoard({ slug: board.slug, companyName: board.displayName, http, conditional });
    case 'workable':
      return fetchWorkableBoard({ slug: board.slug, companyName: board.displayName, http, conditional });
    case 'smartrecruiters':
      return fetchSmartRecruitersBoard({ slug: board.slug, companyName: board.displayName, http, conditional });
    case 'workday': {
      if (!board.workday) {
        throw new Error(`Workday board ${board.slug} is missing host/tenant/site config`);
      }
      return fetchWorkdayBoard({
        slug: board.slug,
        host: board.workday.host,
        tenant: board.workday.tenant,
        site: board.workday.site,
        companyName: board.displayName,
        http
      });
    }
  }
}

export async function runDiscoverySync(
  params: RunDiscoverySyncParams
): Promise<RunDiscoverySyncResult> {
  const mode = params.mode;
  const allBoards = params.boards ?? loadCompanyRegistry();
  const cache = params.existingSourceCache ?? new Map<string, SourceCacheEntry>();
  const http =
    params.http ??
    new PoliteHttpClient({
      timeoutMs: mode === 'quick' ? 6000 : 10000
    });
  const queries = buildDiscoveryQueriesFromProfile(params.profile);
  const maxQuickBoards = params.maxQuickBoards ?? 24;
  const concurrency = params.concurrency ?? 6;
  const respectRefreshTiers = params.respectRefreshTiers ?? false;

  const { selected: selectedBoards, skippedCooldown: boardsSkippedCooldown } = prioritizeBoards(
    allBoards,
    cache,
    queries.regionPriority,
    mode,
    maxQuickBoards,
    respectRefreshTiers
  );

  const rawJobs: NormalizedJobInput[] = [];
  const sourceUpdates: DiscoverySourceUpdate[] = [];
  const reconcilableBoards: ReconcilableBoardSnapshot[] = [];
  let boardSuccess = 0;
  let boardFailures = 0;
  let aggregatorCount = 0;

  interface AggregatorTask {
    sourceType: string;
    slug: string;
    displayName: string;
    regionFocus: string;
    run: () => Promise<ConnectorFetchResult>;
  }

  const aggregatorTasks: AggregatorTask[] = [
    ...queries.remotiveCategories.map((category) => ({
      sourceType: 'remotive',
      slug: category,
      displayName: `Remotive (${category})`,
      regionFocus: 'global',
      run: () => {
        const prev = cache.get(`remotive:${category}`);
        return fetchRemotiveFeed({
          category,
          limit: mode === 'quick' ? 60 : 100,
          http,
          conditional: { etag: prev?.etag, lastModified: prev?.lastModified }
        });
      }
    })),
    {
      sourceType: 'arbeitnow',
      slug: 'global',
      displayName: 'Arbeitnow',
      regionFocus: 'global',
      run: () => {
        const prev = cache.get('arbeitnow:global');
        return fetchArbeitnowFeed({
          http,
          conditional: { etag: prev?.etag, lastModified: prev?.lastModified }
        });
      }
    },
    {
      sourceType: 'remoteok',
      slug: 'global',
      displayName: 'RemoteOK',
      regionFocus: 'global',
      run: () => {
        const prev = cache.get('remoteok:global');
        return fetchRemoteOkFeed({
          http,
          conditional: { etag: prev?.etag, lastModified: prev?.lastModified }
        });
      }
    },
    {
      sourceType: 'himalayas',
      slug: 'global',
      displayName: 'Himalayas',
      regionFocus: 'global',
      run: () => {
        const prev = cache.get('himalayas:global');
        return fetchHimalayasFeed({
          limit: 50,
          http,
          conditional: { etag: prev?.etag, lastModified: prev?.lastModified }
        });
      }
    },
    {
      sourceType: 'jobicy',
      slug: queries.jobicyTag || 'global',
      displayName: `Jobicy (${queries.jobicyTag || 'remote'})`,
      regionFocus: 'global',
      run: () => {
        const prev = cache.get(`jobicy:${queries.jobicyTag || 'global'}`);
        return fetchJobicyFeed({
          count: 50,
          tag: queries.jobicyTag,
          http,
          conditional: { etag: prev?.etag, lastModified: prev?.lastModified }
        });
      }
    },
    ...(mode === 'quick' ? queries.theMuseCategories.slice(0, 1) : queries.theMuseCategories).map(
      (category) => ({
        sourceType: 'themuse',
        slug: category.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        displayName: `The Muse (${category})`,
        regionFocus: 'global',
        run: () => {
          const slug = category.toLowerCase().replace(/[^a-z0-9]+/g, '-');
          const prev = cache.get(`themuse:${slug}`);
          return fetchTheMuseFeed({
            category,
            page: 1,
            http,
            conditional: { etag: prev?.etag, lastModified: prev?.lastModified }
          });
        }
      })
    ),
    {
      sourceType: 'hackernews',
      slug: 'whoishiring',
      displayName: 'HN Who is Hiring',
      regionFocus: 'global',
      run: () =>
        fetchHackerNewsHiringFeed({
          hitsPerPage: mode === 'quick' ? 60 : 80,
          http
        })
    },
    {
      sourceType: 'adzuna',
      slug: 'india',
      displayName: 'Adzuna India',
      regionFocus: 'india',
      run: () =>
        fetchAdzunaIndia({
          appId: params.envKeys?.adzunaAppId,
          appKey: params.envKeys?.adzunaAppKey,
          query: queries.searchQuery,
          http
        })
    },
    {
      sourceType: 'jooble',
      slug: 'india',
      displayName: 'Jooble India',
      regionFocus: 'india',
      run: () =>
        fetchJoobleIndia({
          apiKey: params.envKeys?.joobleApiKey,
          keywords: queries.searchQuery,
          location: 'India',
          http
        })
    },
    {
      sourceType: 'jsearch',
      slug: 'global',
      displayName: 'JSearch',
      regionFocus: 'india',
      run: () =>
        fetchJSearchOptional({
          rapidApiKey: params.envKeys?.jsearchRapidApiKey,
          query: `${queries.searchQuery} in India`,
          maxPagesPerRun: params.envKeys?.jsearchMaxPagesPerRun ?? 1,
          http
        })
    }
  ];

  const boardsPromise = runWithConcurrency(selectedBoards, concurrency, async (board) => {
    const key = `${board.sourceType}:${board.slug}`;
    const prev = cache.get(key);
    const nowIso = new Date().toISOString();
    try {
      const res = await fetchAtsBoard(board, http, {
        etag: prev?.etag,
        lastModified: prev?.lastModified
      });
      rawJobs.push(...res.jobs);
      if (!res.notModified && res.jobs.length > 0) {
        reconcilableBoards.push({
          boardKey: key,
          activeExternalIds: Array.from(
            new Set(res.jobs.map((j) => j.externalId).filter((id): id is string => Boolean(id)))
          )
        });
      }
      boardSuccess++;
      sourceUpdates.push({
        sourceType: board.sourceType,
        slug: board.slug,
        displayName: board.displayName,
        regionFocus: board.regionFocus,
        enabled: board.enabled,
        etag: res.etag,
        lastModified: res.lastModified,
        lastCrawledAt: nowIso,
        lastStatus: res.notModified ? '304_not_modified' : `ok:${res.jobs.length}`,
        consecutiveFailures: 0,
        jobsCount: res.jobs.length,
        failed: false
      });
    } catch (err) {
      boardFailures++;
      const msg = err instanceof Error ? err.message : String(err);
      sourceUpdates.push({
        sourceType: board.sourceType,
        slug: board.slug,
        displayName: board.displayName,
        regionFocus: board.regionFocus,
        enabled: board.enabled,
        etag: prev?.etag ?? null,
        lastModified: prev?.lastModified ?? null,
        lastCrawledAt: nowIso,
        lastStatus: `error:${msg.slice(0, 120)}`,
        consecutiveFailures: (prev?.consecutiveFailures ?? 0) + 1,
        jobsCount: 0,
        failed: true
      });
    }
  });

  const aggregatorsPromise = Promise.all(
    aggregatorTasks.map(async (task) => {
      const key = `${task.sourceType}:${task.slug}`;
      const prev = cache.get(key);
      const nowIso = new Date().toISOString();
      try {
        const res = await task.run();
        if (res.skippedReason) return;
        rawJobs.push(...res.jobs);
        aggregatorCount++;
        sourceUpdates.push({
          sourceType: task.sourceType,
          slug: task.slug,
          displayName: task.displayName,
          regionFocus: task.regionFocus,
          enabled: true,
          etag: res.etag,
          lastModified: res.lastModified,
          lastCrawledAt: nowIso,
          lastStatus: res.notModified ? '304_not_modified' : `ok:${res.jobs.length}`,
          consecutiveFailures: 0,
          jobsCount: res.jobs.length,
          failed: false
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        sourceUpdates.push({
          sourceType: task.sourceType,
          slug: task.slug,
          displayName: task.displayName,
          regionFocus: task.regionFocus,
          enabled: true,
          etag: prev?.etag ?? null,
          lastModified: prev?.lastModified ?? null,
          lastCrawledAt: nowIso,
          lastStatus: `error:${msg.slice(0, 120)}`,
          consecutiveFailures: (prev?.consecutiveFailures ?? 0) + 1,
          jobsCount: 0,
          failed: true
        });
      }
    })
  );

  await Promise.all([boardsPromise, aggregatorsPromise]);

  const bundles = dedupeNormalizedJobs(rawJobs);

  return {
    bundles,
    sourceUpdates,
    reconcilableBoards,
    stats: {
      mode,
      boardsSelected: selectedBoards.length,
      boardsTotal: allBoards.filter((b) => b.enabled).length,
      boardsSkippedCooldown,
      boardSuccess,
      boardFailures,
      aggregatorCount,
      rawJobsCount: rawJobs.length,
      dedupedCount: bundles.length
    }
  };
}
