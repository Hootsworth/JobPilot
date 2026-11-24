import { HostRateLimiter, parseRetryAfterMs } from './rate-limiter.js';
import { RobotsGuard, type RobotsFetchFn } from './robots.js';

export const BLOCKED_SCRAPE_HOSTS = [
  'naukri.com',
  'foundit.in',
  'monsterindia.com',
  'internshala.com',
  'instahyre.com',
  'wellfound.com',
  'angel.co',
  'linkedin.com'
] as const;

export class BlockedSitePolicyError extends Error {
  readonly host: string;

  constructor(host: string) {
    super(
      `Server-side scraping of "${host}" is strictly prohibited by JobPilot ToS policy. Use the Chrome Extension user-initiated capture instead.`
    );
    this.name = 'BlockedSitePolicyError';
    this.host = host;
  }
}

export class RobotsDisallowedError extends Error {
  readonly url: string;

  constructor(url: string) {
    super(`Blocked by robots.txt policy for ${url}`);
    this.name = 'RobotsDisallowedError';
    this.url = url;
  }
}

export function assertHostAllowedForServerCrawl(url: string): URL {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  const isBlocked = BLOCKED_SCRAPE_HOSTS.some(
    (blocked) => host === blocked || host.endsWith(`.${blocked}`)
  );
  if (isBlocked) {
    throw new BlockedSitePolicyError(host);
  }
  return parsed;
}

export interface HttpConditionalHeaders {
  etag?: string | null;
  lastModified?: string | null;
}

export interface HttpResponseEnvelope<T> {
  status: number;
  notModified: boolean;
  data: T | null;
  etag: string | null;
  lastModified: string | null;
  fromCache: boolean;
}

export interface PoliteHttpClientOptions {
  userAgent?: string;
  fetchFn?: RobotsFetchFn;
  robotsGuard?: RobotsGuard;
  rateLimiter?: HostRateLimiter;
  maxRetries?: number;
  baseBackoffMs?: number;
  respectRobots?: boolean;
  timeoutMs?: number;
}

export class PoliteHttpClient {
  readonly userAgent: string;
  private readonly fetchFn: RobotsFetchFn;
  private readonly robotsGuard: RobotsGuard;
  private readonly rateLimiter: HostRateLimiter;
  private readonly maxRetries: number;
  private readonly baseBackoffMs: number;
  private readonly respectRobots: boolean;
  private readonly timeoutMs: number;
  private readonly responseCache = new Map<string, HttpResponseEnvelope<unknown>>();

  constructor(options: PoliteHttpClientOptions = {}) {
    this.userAgent = options.userAgent ?? 'JobPilotBot/1.0 (+https://github.com/jobpilot)';
    this.fetchFn = options.fetchFn ?? fetch;
    this.robotsGuard =
      options.robotsGuard ??
      new RobotsGuard({ userAgent: this.userAgent, fetchFn: this.fetchFn });
    this.rateLimiter = options.rateLimiter ?? new HostRateLimiter();
    this.maxRetries = options.maxRetries ?? 2;
    this.baseBackoffMs = options.baseBackoffMs ?? 500;
    this.respectRobots = options.respectRobots ?? true;
    this.timeoutMs = options.timeoutMs ?? 8000;
  }

  async getJson<T>(
    url: string,
    options: {
      headers?: Record<string, string>;
      conditional?: HttpConditionalHeaders;
      skipCache?: boolean;
      timeoutMs?: number;
    } = {}
  ): Promise<HttpResponseEnvelope<T>> {
    return this.requestJson<T>('GET', url, undefined, options);
  }

  async postJson<T>(
    url: string,
    body: unknown,
    options: {
      headers?: Record<string, string>;
      skipCache?: boolean;
      timeoutMs?: number;
    } = {}
  ): Promise<HttpResponseEnvelope<T>> {
    return this.requestJson<T>('POST', url, body, options);
  }

  private async requestJson<T>(
    method: 'GET' | 'POST',
    url: string,
    body: unknown,
    options: {
      headers?: Record<string, string>;
      conditional?: HttpConditionalHeaders;
      skipCache?: boolean;
      timeoutMs?: number;
    }
  ): Promise<HttpResponseEnvelope<T>> {
    const parsedUrl = assertHostAllowedForServerCrawl(url);
    const cacheKey = `${method}:${url}:${body ? JSON.stringify(body) : ''}`;

    if (!options.skipCache && this.responseCache.has(cacheKey)) {
      const cached = this.responseCache.get(cacheKey) as HttpResponseEnvelope<T>;
      return { ...cached, fromCache: true };
    }

    let crawlDelayMs: number | null = null;
    if (this.respectRobots) {
      const robots = await this.robotsGuard.check(url);
      if (!robots.allowed) {
        throw new RobotsDisallowedError(url);
      }
      crawlDelayMs = robots.crawlDelayMs;
    }

    const headers = new Headers(options.headers);
    headers.set('User-Agent', this.userAgent);
    headers.set('Accept', 'application/json');
    if (body !== undefined && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    if (method === 'GET' && options.conditional?.etag) {
      headers.set('If-None-Match', options.conditional.etag);
    }
    if (method === 'GET' && options.conditional?.lastModified) {
      headers.set('If-Modified-Since', options.conditional.lastModified);
    }

    const effectiveTimeout = options.timeoutMs ?? this.timeoutMs;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      await this.rateLimiter.waitForSlot(parsedUrl.hostname, crawlDelayMs);
      const signal =
        effectiveTimeout > 0 &&
        typeof AbortSignal !== 'undefined' &&
        typeof AbortSignal.timeout === 'function'
          ? AbortSignal.timeout(effectiveTimeout)
          : undefined;

      let res: Response;
      try {
        res = await this.fetchFn(url, {
          method,
          headers,
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          ...(signal ? { signal } : {})
        });
      } catch (err) {
        if (attempt < this.maxRetries) {
          const delayMs = this.baseBackoffMs * Math.pow(2, attempt);
          await this.rateLimiter.sleep(delayMs);
          continue;
        }
        throw err instanceof Error ? err : new Error(String(err));
      }

      const etag = res.headers.get('etag');
      const lastModified = res.headers.get('last-modified');

      if (res.status === 304) {
        const envelope: HttpResponseEnvelope<T> = {
          status: 304,
          notModified: true,
          data: null,
          etag: etag ?? options.conditional?.etag ?? null,
          lastModified: lastModified ?? options.conditional?.lastModified ?? null,
          fromCache: false
        };
        this.responseCache.set(cacheKey, envelope);
        return envelope;
      }

      if ((res.status === 429 || res.status >= 500) && attempt < this.maxRetries) {
        const retryAfter = parseRetryAfterMs(res.headers.get('retry-after'));
        const delayMs = retryAfter ?? this.baseBackoffMs * Math.pow(2, attempt);
        await this.rateLimiter.sleep(delayMs);
        continue;
      }

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} from ${parsedUrl.hostname}: ${errBody.slice(0, 200)}`);
      }

      const data = (await res.json()) as T;
      const envelope: HttpResponseEnvelope<T> = {
        status: res.status,
        notModified: false,
        data,
        etag,
        lastModified,
        fromCache: false
      };
      this.responseCache.set(cacheKey, envelope);
      return envelope;
    }

    throw new Error(`Exhausted HTTP retries for ${url}`);
  }
}
