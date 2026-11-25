const APPLY_CTA_REGEX =
  /\b(apply(\s+(now|online|today|here|for\s+this\s+(job|role|position|opening)|on\s+company\s+(site|website)))?|easy\s+apply|quick\s+apply|start\s+application|submit\s+application)\b/i;

const APPLY_EXCLUDE_REGEX =
  /\b(already\s+applied|applied|apply\s+(filter|filters|coupon|promo|code|discount|voucher|changes|settings)|filter|filters|save\s+job|bookmark|share|report)\b/i;

const KNOWN_JOB_URL_REGEX =
  /(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|myworkdaysite\.com|naukri\.com|foundit\.in|internshala\.com|instahyre\.com|wellfound\.com|angel\.co|linkedin\.com\/jobs|smartrecruiters\.com|icims\.com|taleo\.net|bamboohr\.com|workable\.com|recruitee\.com|rippling\.com|jobvite\.com|successfactors\.com|dayforcehcm\.com|zohorecruit\.com|darwinbox\.|keka\.com|pinpointhq\.com|dover\.com|gem\.com|\/careers?\b|\/jobs?\b|\/apply\b|\/application\b|\/opening\b|\/requisition\b)/i;

const APPLICATION_FIELD_HINT_REGEX =
  /(resume|cv|cover\s+letter|linkedin|portfolio|github|notice\s+period|expected\s+ctc|current\s+ctc|work\s+authorization|sponsorship|first\s+name|last\s+name|full\s+name|email|phone|cgpa|graduation)/i;

const CTA_TAG = 'jobpilot-apply-cta';
const OVERLAY_HOST_ID = 'jobpilot-overlay-host';
const MAX_INJECTED_TARGETS = 2;

function getControlLabel(el: HTMLElement): string {
  if (el instanceof HTMLInputElement) {
    return (el.value || el.getAttribute('aria-label') || '').trim();
  }
  return (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim();
}

function isElementVisiblyInteractable(el: HTMLElement): boolean {
  if (!el.isConnected) return false;
  if (el.closest(CTA_TAG) || el.closest(`#${OVERLAY_HOST_ID}`)) return false;
  if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') {
    return false;
  }
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width >= 32 && rect.height >= 20;
}

export function findPrimaryApplyTargets(doc: Document): HTMLElement[] {
  const candidates = Array.from(
    doc.querySelectorAll<HTMLElement>(
      'button, a[href], [role="button"], input[type="button"], input[type="submit"]'
    )
  );

  const matched: Array<{ el: HTMLElement; score: number }> = [];

  for (const el of candidates) {
    if (!isElementVisiblyInteractable(el)) continue;
    const text = getControlLabel(el);
    if (!text || text.length > 64) continue;
    if (APPLY_EXCLUDE_REGEX.test(text)) continue;
    if (!APPLY_CTA_REGEX.test(text)) continue;

    let score = 1;
    if (/\b(apply\s+now|easy\s+apply|quick\s+apply|apply\s+for\s+this)\b/i.test(text)) {
      score += 3;
    }
    if (el.closest('main, [role="main"], article, form')) {
      score += 2;
    }
    const rect = el.getBoundingClientRect();
    if (rect.top >= 0 && rect.top <= window.innerHeight) {
      score += 1;
    }
    matched.push({ el, score });
  }

  matched.sort((a, b) => b.score - a.score);
  return matched.slice(0, MAX_INJECTED_TARGETS).map((item) => item.el);
}

export function isLikelyJobOrApplicationPage(url: string, doc: Document): boolean {
  if (!/^https?:\/\//i.test(url)) return false;

  if (KNOWN_JOB_URL_REGEX.test(url)) {
    return true;
  }

  if (findPrimaryApplyTargets(doc).length > 0) {
    return true;
  }

  const controls = doc.querySelectorAll('input:not([type="hidden"]), select, textarea, [contenteditable="true"]');
  if (controls.length >= 2) {
    let hintMatches = 0;
    const sampleLimit = Math.min(controls.length, 30);
    for (let i = 0; i < sampleLimit; i += 1) {
      const el = controls[i] as HTMLElement;
      const attrs = [
        el.getAttribute('name'),
        el.getAttribute('id'),
        el.getAttribute('placeholder'),
        el.getAttribute('aria-label'),
        el.getAttribute('autocomplete')
      ]
        .filter(Boolean)
        .join(' ');
      if (APPLICATION_FIELD_HINT_REGEX.test(attrs)) {
        hintMatches += 1;
      }
      if (hintMatches >= 2) return true;
    }

    const labels = doc.querySelectorAll('label');
    const labelLimit = Math.min(labels.length, 25);
    for (let i = 0; i < labelLimit; i += 1) {
      if (APPLICATION_FIELD_HINT_REGEX.test(labels[i]?.textContent ?? '')) {
        hintMatches += 1;
      }
      if (hintMatches >= 2) return true;
    }
  }

  return false;
}

export class ApplyButtonInjector {
  private readonly onTrigger: () => void;
  private readonly onHideDomain?: () => void;
  private readonly hostByTarget = new WeakMap<HTMLElement, HTMLElement>();
  private readonly activeHosts = new Set<HTMLElement>();
  private rafId: number | null = null;
  private destroyed = false;

  constructor(onTrigger: () => void, onHideDomain?: () => void) {
    this.onTrigger = onTrigger;
    this.onHideDomain = onHideDomain;
  }

  setPaused(paused: boolean): void {
    if (paused) {
      if (this.rafId !== null) {
        window.cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      for (const host of this.activeHosts) {
        host.remove();
      }
      this.activeHosts.clear();
    } else if (!this.destroyed) {
      this.scheduleSync();
    }
  }

  scheduleSync(): void {
    if (this.destroyed || this.rafId !== null) return;
    this.rafId = window.requestAnimationFrame(() => {
      this.rafId = null;
      if (!this.destroyed) {
        this.syncNow();
      }
    });
  }

  syncNow(): void {
    if (this.destroyed || !document.body) return;

    const targets = findPrimaryApplyTargets(document);
    const targetSet = new Set(targets);

    for (const host of Array.from(this.activeHosts)) {
      const linkedTarget = (host as HTMLElement & { __jpTarget?: HTMLElement }).__jpTarget;
      if (!host.isConnected || !linkedTarget || !targetSet.has(linkedTarget)) {
        host.remove();
        this.activeHosts.delete(host);
      }
    }

    for (const target of targets) {
      const existingHost = this.hostByTarget.get(target);
      if (existingHost && existingHost.isConnected) continue;

      const host = this.createCtaHost(target);
      this.hostByTarget.set(target, host);
      this.activeHosts.add(host);
      target.insertAdjacentElement('afterend', host);
    }
  }

  private createCtaHost(target: HTMLElement): HTMLElement {
    const host = document.createElement(CTA_TAG) as HTMLElement & { __jpTarget?: HTMLElement };
    host.__jpTarget = target;
    host.setAttribute('data-jobpilot-cta', '1');
    host.style.display = 'inline-flex';
    host.style.alignItems = 'center';
    host.style.verticalAlign = 'middle';
    host.style.marginLeft = '8px';
    host.style.zIndex = '2147483000';

    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host {
          display: inline-flex;
          align-items: center;
          vertical-align: middle;
        }
        .jp-wrap {
          display: inline-flex;
          align-items: center;
          border-radius: 6px;
          background: #141212;
          border: 1px solid #3f3b3b;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.16);
          overflow: hidden;
        }
        button {
          all: unset;
          box-sizing: border-box;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          min-height: 34px;
          padding: 0 11px;
          background: transparent;
          color: #ffffff;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 12px;
          font-weight: 600;
          line-height: 1;
          letter-spacing: 0.01em;
          cursor: pointer;
          white-space: nowrap;
          transition: background 120ms ease;
        }
        button:hover {
          background: #272323;
        }
        .jp-dismiss {
          padding: 0 8px;
          border-left: 1px solid #3f3b3b;
          color: #b4afaf;
          font-size: 13px;
          font-weight: 500;
        }
        .jp-dismiss:hover {
          background: #2f1f1f;
          color: #ffffff;
        }
        .jp-dot {
          width: 7px;
          height: 7px;
          border-radius: 9999px;
          background: #22c55e;
          flex-shrink: 0;
        }
      </style>
      <div class="jp-wrap">
        <button type="button" class="jp-main" part="button" aria-label="Autofill via JobPilot">
          <span class="jp-dot" aria-hidden="true"></span>
          <span class="jp-cta-text">Autofill via JobPilot</span>
        </button>
        <button
          type="button"
          class="jp-dismiss"
          title="Hide Autofill via JobPilot on this website"
          aria-label="Hide Autofill via JobPilot on this site"
        >
          &times;
        </button>
      </div>
    `;

    const btn = shadow.querySelector('.jp-main');
    const dismissBtn = shadow.querySelector('.jp-dismiss');
    const labelEl = shadow.querySelector('.jp-cta-text');
    btn?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (labelEl) {
        labelEl.textContent = 'Opening JobPilot...';
        window.setTimeout(() => {
          if (labelEl.isConnected) {
            labelEl.textContent = 'Autofill via JobPilot';
          }
        }, 1800);
      }
      this.onTrigger();
    });
    dismissBtn?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.onHideDomain?.();
      this.setPaused(true);
    });

    return host;
  }

  destroy(): void {
    this.destroyed = true;
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    for (const host of this.activeHosts) {
      host.remove();
    }
    this.activeHosts.clear();
  }
}
