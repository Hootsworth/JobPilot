import { describe, expect, it, vi } from 'vitest';
import {
  BlockedSitePolicyError,
  PoliteHttpClient,
  RobotsDisallowedError,
  isPathAllowedByRobots,
  parseRobotsTxt
} from '../index.js';
import { HostRateLimiter } from '../http/rate-limiter.js';

describe('@jobpilot/ingestion HTTP hygiene & compliance', () => {
  it('parses robots.txt rules with Allow precedence and Crawl-delay', () => {
    const policy = parseRobotsTxt(
      `
User-agent: *
Disallow: /private/
Allow: /private/public-feed
Crawl-delay: 2
      `,
      'jobpilotbot'
    );

    expect(policy.crawlDelayMs).toBe(2000);
    expect(isPathAllowedByRobots(policy, '/api/jobs')).toBe(true);
    expect(isPathAllowedByRobots(policy, '/private/secret')).toBe(false);
    expect(isPathAllowedByRobots(policy, '/private/public-feed')).toBe(true);
  });

  it('strictly blocks non-API sites from server-side crawling', async () => {
    const fetchSpy = vi.fn();
    const client = new PoliteHttpClient({ fetchFn: fetchSpy });

    for (const url of [
      'https://www.naukri.com/jobs',
      'https://www.linkedin.com/jobs/view/123',
      'https://internshala.com/internships',
      'https://www.instahyre.com/candidate/opportunities/',
      'https://wellfound.com/jobs',
      'https://www.foundit.in/srp/results'
    ]) {
      await expect(client.getJson(url)).rejects.toBeInstanceOf(BlockedSitePolicyError);
    }

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('respects robots.txt disallow rules before fetching target endpoint', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/robots.txt')) {
        return new Response('User-agent: *\nDisallow: /v1/private/\n', { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });

    const client = new PoliteHttpClient({
      fetchFn,
      rateLimiter: new HostRateLimiter({ defaultMinIntervalMs: 0, sleepFn: async () => {} })
    });

    await expect(client.getJson('https://example.com/v1/private/jobs')).rejects.toBeInstanceOf(
      RobotsDisallowedError
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('handles 304 Not Modified conditional caching and 429 retry backoff', async () => {
    let calls = 0;
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
      calls++;
      if (calls === 1) {
        return new Response('rate limited', {
          status: 429,
          headers: { 'retry-after': '0' }
        });
      }
      const headers = new Headers(init?.headers);
      if (headers.get('if-none-match') === '"etag-v1"') {
        return new Response(null, { status: 304, headers: { etag: '"etag-v1"' } });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { etag: '"etag-v1"' }
      });
    });

    const client = new PoliteHttpClient({
      fetchFn,
      rateLimiter: new HostRateLimiter({ defaultMinIntervalMs: 0, sleepFn: async () => {} }),
      baseBackoffMs: 1
    });

    const first = await client.getJson<{ ok: boolean }>('https://boards-api.greenhouse.io/v1/boards/demo/jobs');
    expect(first.data).toEqual({ ok: true });
    expect(first.etag).toBe('"etag-v1"');

    const second = await client.getJson<{ ok: boolean }>(
      'https://boards-api.greenhouse.io/v1/boards/demo/jobs',
      { conditional: { etag: '"etag-v1"' }, skipCache: true }
    );
    expect(second.status).toBe(304);
    expect(second.notModified).toBe(true);
  });
});
