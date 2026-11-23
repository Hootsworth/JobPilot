export class HostRateLimiter {
  private readonly nextAllowedAt = new Map<string, number>();
  private readonly defaultMinIntervalMs: number;
  private readonly sleepFn: (ms: number) => Promise<void>;

  constructor(options: {
    defaultMinIntervalMs?: number;
    sleepFn?: (ms: number) => Promise<void>;
  } = {}) {
    this.defaultMinIntervalMs = options.defaultMinIntervalMs ?? 350;
    this.sleepFn =
      options.sleepFn ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async waitForSlot(host: string, minIntervalOverrideMs?: number | null): Promise<void> {
    const interval = Math.max(this.defaultMinIntervalMs, minIntervalOverrideMs ?? 0);
    const now = Date.now();
    const earliest = this.nextAllowedAt.get(host) ?? now;
    const waitMs = Math.max(0, earliest - now);
    this.nextAllowedAt.set(host, Math.max(now, earliest) + interval);
    if (waitMs > 0) {
      await this.sleepFn(waitMs);
    }
  }

  async sleep(ms: number): Promise<void> {
    if (ms > 0) await this.sleepFn(ms);
  }
}

export function parseRetryAfterMs(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const seconds = Number.parseFloat(headerValue);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }
  const timestamp = Date.parse(headerValue);
  if (Number.isFinite(timestamp)) {
    return Math.max(0, timestamp - Date.now());
  }
  return null;
}
