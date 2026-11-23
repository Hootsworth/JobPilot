const HOST_ATTR = 'data-jobpilot-overlay';

const template = document.createElement('template');
template.innerHTML = `
  <div class="jp-chip" part="chip">
    <span class="jp-badge" id="jp-ats">JP</span>
    <span class="jp-label" id="jp-text">Scanning form...</span>
    <button type="button" class="jp-btn" id="jp-open-btn" part="button">Review</button>
  </div>
`;

let sharedSheet: CSSStyleSheet | null = null;

function getSharedStyleSheet(): CSSStyleSheet | null {
  if (typeof CSSStyleSheet === 'undefined') return null;
  if (sharedSheet) return sharedSheet;

  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    :host {
      color-scheme: light dark;
      --_bg-light: #201d1d;
      --_fg-light: #fdfcfc;
      --_border-light: rgba(253, 252, 252, 0.22);
      --_bg-dark: #f8f7f7;
      --_fg-dark: #0f0000;
      --_border-dark: rgba(15, 0, 0, 0.2);

      --_bg: var(--jobpilot-chip-bg, var(--_bg-light));
      --_fg: var(--jobpilot-chip-fg, var(--_fg-light));
      --_border: var(--jobpilot-chip-border, var(--_border-light));
      --_accent: var(--jobpilot-chip-accent, #007aff);

      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 2147483646;
      display: block;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      line-height: 1.4;
    }

    @media (prefers-color-scheme: dark) {
      :host {
        --_bg: var(--jobpilot-chip-bg, var(--_bg-dark));
        --_fg: var(--jobpilot-chip-fg, var(--_fg-dark));
        --_border: var(--jobpilot-chip-border, var(--_border-dark));
      }
    }

    @supports (color: light-dark(white, black)) {
      :host {
        --_bg: var(--jobpilot-chip-bg, light-dark(var(--_bg-light), var(--_bg-dark)));
        --_fg: var(--jobpilot-chip-fg, light-dark(var(--_fg-light), var(--_fg-dark)));
        --_border: var(--jobpilot-chip-border, light-dark(var(--_border-light), var(--_border-dark)));
      }
    }

    .jp-chip {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border-radius: 0px;
      border: 1px solid var(--_border);
      background: var(--_bg);
      color: var(--_fg);
    }

    .jp-badge {
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--_accent);
      color: #ffffff;
      font-weight: 700;
      font-size: 11px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .jp-label {
      max-width: 240px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .jp-btn {
      font: inherit;
      color: var(--_bg);
      background: var(--_fg);
      border: 1px solid var(--_border);
      border-radius: 4px;
      padding: 4px 10px;
      font-weight: 600;
      cursor: pointer;
    }

    .jp-btn:focus-visible {
      outline: 2px solid var(--_accent);
      outline-offset: 2px;
    }
  `);
  sharedSheet = sheet;
  return sheet;
}

export class JobPilotOverlayController {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private atsEl: HTMLElement | null = null;
  private textEl: HTMLElement | null = null;

  constructor(private readonly onReviewClick: () => void) {}

  mount(atsLabel: string, message: string): void {
    if (!document.body) return;
    if (!this.host) {
      const host = document.createElement('jobpilot-status-chip');
      host.setAttribute(HOST_ATTR, 'true');
      const shadow = host.attachShadow({ mode: 'open', delegatesFocus: true });
      const sheet = getSharedStyleSheet();
      if (sheet && 'adoptedStyleSheets' in shadow) {
        shadow.adoptedStyleSheets = [sheet];
      }
      shadow.append(template.content.cloneNode(true));
      this.atsEl = shadow.getElementById('jp-ats');
      this.textEl = shadow.getElementById('jp-text');
      const btn = shadow.getElementById('jp-open-btn');
      btn?.addEventListener('click', () => this.onReviewClick());

      document.body.appendChild(host);
      this.host = host;
      this.shadow = shadow;
    }

    if (this.atsEl) this.atsEl.textContent = atsLabel;
    if (this.textEl) this.textEl.textContent = message;
  }

  unmount(): void {
    if (this.host) {
      this.host.remove();
      this.host = null;
      this.shadow = null;
      this.atsEl = null;
      this.textEl = null;
    }
  }
}
