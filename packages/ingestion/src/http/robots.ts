export interface RobotsRule {
  allow: boolean;
  pattern: string;
}

export interface ParsedRobotsPolicy {
  rules: RobotsRule[];
  crawlDelayMs: number | null;
}

function escapeRegex(text: string): string {
  return text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

function matchesRobotsPattern(pathAndQuery: string, pattern: string): boolean {
  if (!pattern) return false;
  const anchoredEnd = pattern.endsWith('$');
  const core = anchoredEnd ? pattern.slice(0, -1) : pattern;
  const regexStr = `^${core.split('*').map(escapeRegex).join('.*')}${anchoredEnd ? '$' : ''}`;
  return new RegExp(regexStr).test(pathAndQuery);
}

export function parseRobotsTxt(rawText: string, botName: string = 'jobpilotbot'): ParsedRobotsPolicy {
  const lines = rawText.split(/\r?\n/);
  const targetBot = botName.toLowerCase();

  type Group = { agents: string[]; rules: RobotsRule[]; crawlDelaySec: number | null };
  const groups: Group[] = [];
  let current: Group = { agents: [], rules: [], crawlDelaySec: null };
  let seenDirectiveInGroup = false;

  for (const rawLine of lines) {
    const commentIdx = rawLine.indexOf('#');
    const clean = (commentIdx >= 0 ? rawLine.slice(0, commentIdx) : rawLine).trim();
    if (!clean) continue;

    const colonIdx = clean.indexOf(':');
    if (colonIdx === -1) continue;
    const key = clean.slice(0, colonIdx).trim().toLowerCase();
    const val = clean.slice(colonIdx + 1).trim();

    if (key === 'user-agent') {
      if (seenDirectiveInGroup) {
        groups.push(current);
        current = { agents: [], rules: [], crawlDelaySec: null };
        seenDirectiveInGroup = false;
      }
      current.agents.push(val.toLowerCase());
    } else if (key === 'disallow') {
      seenDirectiveInGroup = true;
      if (val) current.rules.push({ allow: false, pattern: val });
    } else if (key === 'allow') {
      seenDirectiveInGroup = true;
      if (val) current.rules.push({ allow: true, pattern: val });
    } else if (key === 'crawl-delay') {
      seenDirectiveInGroup = true;
      const num = Number.parseFloat(val);
      if (Number.isFinite(num) && num >= 0) {
        current.crawlDelaySec = num;
      }
    }
  }
  if (current.agents.length > 0 || current.rules.length > 0) {
    groups.push(current);
  }

  const specific = groups.filter((g) => g.agents.some((a) => a === targetBot));
  const wildcard = groups.filter((g) => g.agents.includes('*'));
  const selected = specific.length > 0 ? specific : wildcard;

  const rules: RobotsRule[] = [];
  let crawlDelayMs: number | null = null;
  for (const g of selected) {
    rules.push(...g.rules);
    if (g.crawlDelaySec !== null) {
      const ms = Math.round(g.crawlDelaySec * 1000);
      crawlDelayMs = crawlDelayMs === null ? ms : Math.max(crawlDelayMs, ms);
    }
  }

  return { rules, crawlDelayMs };
}

export function isPathAllowedByRobots(policy: ParsedRobotsPolicy, pathAndQuery: string): boolean {
  let bestMatch: RobotsRule | null = null;
  for (const rule of policy.rules) {
    if (!matchesRobotsPattern(pathAndQuery, rule.pattern)) continue;
    if (!bestMatch || rule.pattern.length > bestMatch.pattern.length) {
      bestMatch = rule;
    } else if (rule.pattern.length === bestMatch.pattern.length && rule.allow) {
      bestMatch = rule;
    }
  }
  return bestMatch ? bestMatch.allow : true;
}

export type RobotsFetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export class RobotsGuard {
  private readonly cache = new Map<string, ParsedRobotsPolicy>();
  private readonly botName: string;
  private readonly userAgent: string;
  private readonly fetchFn: RobotsFetchFn;
  private readonly timeoutMs: number;

  constructor(options: {
    botName?: string;
    userAgent?: string;
    fetchFn?: RobotsFetchFn;
    timeoutMs?: number;
  } = {}) {
    this.botName = options.botName ?? 'jobpilotbot';
    this.userAgent = options.userAgent ?? 'JobPilotBot/1.0 (+https://github.com/jobpilot)';
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 3000;
  }

  async check(targetUrl: string): Promise<{ allowed: boolean; crawlDelayMs: number | null }> {
    const parsed = new URL(targetUrl);
    const origin = parsed.origin;
    let policy = this.cache.get(origin);

    if (!policy) {
      try {
        const signal =
          this.timeoutMs > 0 && typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
            ? AbortSignal.timeout(this.timeoutMs)
            : undefined;
        const res = await this.fetchFn(`${origin}/robots.txt`, {
          headers: { 'User-Agent': this.userAgent },
          ...(signal ? { signal } : {})
        });
        if (res.ok) {
          const text = await res.text();
          policy = parseRobotsTxt(text, this.botName);
        } else if (res.status === 401 || res.status === 403) {
          policy = { rules: [{ allow: false, pattern: '/' }], crawlDelayMs: null };
        } else {
          policy = { rules: [], crawlDelayMs: null };
        }
      } catch {
        policy = { rules: [], crawlDelayMs: null };
      }
      this.cache.set(origin, policy);
    }

    const pathAndQuery = `${parsed.pathname}${parsed.search}`;
    return {
      allowed: isPathAllowedByRobots(policy, pathAndQuery),
      crawlDelayMs: policy.crawlDelayMs
    };
  }
}
