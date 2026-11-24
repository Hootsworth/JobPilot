import { resolveAdapterForUrl } from '@jobpilot/form-engine';
import {
  captureExtensionJob,
  draftExtensionAnswers,
  fallbackFillExtensionFields,
  fetchResumePdfBytes
} from '../src/lib/api-client';
import type { ExtensionMessage } from '../src/lib/messaging';
import { getExtensionSession, getExtensionSettings } from '../src/lib/storage';

const MENU_OPEN_PANEL = 'jobpilot-open-panel';
const MENU_SAVE_JOB = 'jobpilot-save-job';

interface ExtractedPageJob {
  sourceType: 'greenhouse' | 'lever' | 'ashby' | 'workday' | 'naukri' | 'foundit' | 'internshala' | 'instahyre' | 'wellfound' | 'linkedin' | 'extension_capture';
  sourceUrl: string;
  applyUrl: string;
  title: string;
  companyName: string;
  locationRaw?: string;
  salaryText?: string;
  descriptionClean?: string;
}

function extractActiveTabJobInPage(fallbackLinkUrl: string | null): ExtractedPageJob {
  const href = fallbackLinkUrl || window.location.href;
  const host = window.location.hostname.toLowerCase();

  let sourceType: ExtractedPageJob['sourceType'] = 'extension_capture';
  if (host.includes('greenhouse.io')) sourceType = 'greenhouse';
  else if (host.includes('lever.co')) sourceType = 'lever';
  else if (host.includes('ashbyhq.com')) sourceType = 'ashby';
  else if (host.includes('myworkdayjobs.com') || host.includes('myworkdaysite.com')) sourceType = 'workday';
  else if (host.includes('naukri.com')) sourceType = 'naukri';
  else if (host.includes('foundit.in')) sourceType = 'foundit';
  else if (host.includes('internshala.com')) sourceType = 'internshala';
  else if (host.includes('instahyre.com')) sourceType = 'instahyre';
  else if (host.includes('wellfound.com') || host.includes('angel.co')) sourceType = 'wellfound';
  else if (host.includes('linkedin.com')) sourceType = 'linkedin';

  const findPosting = (node: unknown): Record<string, unknown> | null => {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
      for (const item of node) {
        const hit = findPosting(item);
        if (hit) return hit;
      }
      return null;
    }
    const obj = node as Record<string, unknown>;
    const rawType = obj['@type'];
    const types = Array.isArray(rawType) ? rawType : [rawType];
    if (types.some((t) => String(t).toLowerCase() === 'jobposting')) return obj;
    if (Array.isArray(obj['@graph'])) return findPosting(obj['@graph']);
    return null;
  };

  let ldTitle = '';
  let ldCompany = '';
  let ldLocation = '';
  let ldSalary = '';
  let ldDescription = '';

  const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
  for (const s of scripts) {
    try {
      const parsed = JSON.parse(s.textContent || '');
      const posting = findPosting(parsed);
      if (!posting) continue;
      if (typeof posting['title'] === 'string') ldTitle = posting['title'].trim();
      const org = posting['hiringOrganization'] as Record<string, unknown> | undefined;
      if (typeof org?.['name'] === 'string') ldCompany = org['name'].trim();

      const jobLoc = posting['jobLocation'] as Record<string, unknown> | Array<Record<string, unknown>> | undefined;
      const firstLoc = Array.isArray(jobLoc) ? jobLoc[0] : jobLoc;
      const addr = firstLoc?.['address'] as Record<string, unknown> | undefined;
      if (addr) {
        ldLocation = [addr['addressLocality'], addr['addressRegion'], addr['addressCountry']]
          .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
          .join(', ');
      }

      const baseSal = posting['baseSalary'] as Record<string, unknown> | undefined;
      const val = baseSal?.['value'] as Record<string, unknown> | number | undefined;
      if (typeof val === 'number') ldSalary = String(val);
      else if (val && typeof val === 'object') {
        const minV = val['minValue'];
        const maxV = val['maxValue'] ?? val['value'];
        const cur = typeof baseSal?.['currency'] === 'string' ? baseSal['currency'] : '';
        if (minV != null && maxV != null) ldSalary = `${cur} ${minV}-${maxV}`.trim();
        else if (maxV != null) ldSalary = `${cur} ${maxV}`.trim();
      }

      if (typeof posting['description'] === 'string') {
        ldDescription = posting['description'].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      }
      break;
    } catch {
      // Ignore malformed JSON-LD blocks
    }
  }

  const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim() || '';
  const ogSite = document.querySelector('meta[property="og:site_name"]')?.getAttribute('content')?.trim() || '';
  const ogDesc =
    document.querySelector('meta[property="og:description"]')?.getAttribute('content')?.trim() ||
    document.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() ||
    '';

  const h1 = document.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim() || '';
  const docTitle = document.title.split(/[|\-–]/)[0]?.trim() || '';
  const mainText = (document.querySelector('main, article, [role="main"]')?.textContent || document.body?.innerText || '')
    .replace(/\s+/g, ' ')
    .trim();

  const companyFallback = host.replace(/^www\./, '').split('.')[0] || 'Company';
  const formattedHostCompany = companyFallback.charAt(0).toUpperCase() + companyFallback.slice(1);

  const title = (ldTitle || h1 || ogTitle || docTitle || 'Saved Job Posting').slice(0, 220);
  const companyName = (ldCompany || ogSite || formattedHostCompany).slice(0, 180);
  const descriptionClean = (ldDescription || ogDesc || mainText).slice(0, 12000);

  return {
    sourceType,
    sourceUrl: href,
    applyUrl: href,
    title,
    companyName,
    ...(ldLocation ? { locationRaw: ldLocation.slice(0, 180) } : {}),
    ...(ldSalary ? { salaryText: ldSalary.slice(0, 100) } : {}),
    ...(descriptionClean ? { descriptionClean } : {})
  };
}

function showInPageTerminalToast(title: string, companyName: string, isError: boolean): void {
  const existing = document.getElementById('jobpilot-toast-host');
  if (existing) existing.remove();

  const host = document.createElement('div');
  host.id = 'jobpilot-toast-host';
  const shadow = host.attachShadow({ mode: 'open' });
  const wrap = document.createElement('div');
  wrap.setAttribute(
    'style',
    [
      'position:fixed',
      'bottom:20px',
      'right:20px',
      'z-index:2147483647',
      'background:#201d1d',
      'color:#fdfcfc',
      'border:1px solid #3f3b3b',
      'border-radius:4px',
      'padding:10px 14px',
      'font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace',
      'font-size:12px',
      'line-height:1.4',
      'max-width:360px',
      'display:flex',
      'align-items:center',
      'gap:8px'
    ].join(';')
  );

  const dot = document.createElement('span');
  dot.setAttribute(
    'style',
    `width:8px;height:8px;border-radius:9999px;flex-shrink:0;background:${isError ? '#f59e0b' : '#22c55e'};`
  );
  const msg = document.createElement('span');
  msg.textContent = isError
    ? `> JobPilot: ${title}`
    : `> Saved: ${title} @ ${companyName}`;

  wrap.appendChild(dot);
  wrap.appendChild(msg);
  shadow.appendChild(wrap);
  document.documentElement.appendChild(host);
  setTimeout(() => host.remove(), 4000);
}

function badgeForAdapter(adapterId: string): string {
  const codes: Record<string, string> = {
    greenhouse: 'GH',
    lever: 'LV',
    ashby: 'AB',
    workday: 'WD',
    naukri: 'NK',
    foundit: 'FD',
    internshala: 'IS',
    instahyre: 'IH',
    wellfound: 'WF',
    linkedin: 'LI'
  };
  return codes[adapterId] ?? '';
}

async function syncTabBadge(tabId: number, url?: string): Promise<void> {
  if (!url) {
    await chrome.action.setBadgeText({ tabId, text: '' });
    return;
  }
  const settings = await getExtensionSettings();
  const resolved = resolveAdapterForUrl(url, settings.enabledAdapters);
  const code = resolved.adapter ? badgeForAdapter(resolved.detectedId) : '';
  await chrome.action.setBadgeText({ tabId, text: code });
  if (code) {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#201d1d' });
  }
}

export default defineBackground(() => {
  // Open Side Panel directly on toolbar icon click (must NOT also set default_popup in manifest)
  try {
    void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (err) {
    console.warn('sidePanel.setPanelBehavior unavailable:', err);
  }

  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: MENU_OPEN_PANEL,
        title: 'Open JobPilot Autofill Review',
        contexts: ['page', 'editable']
      });
      chrome.contextMenus.create({
        id: MENU_SAVE_JOB,
        title: 'Save this job to JobPilot Tracker',
        contexts: ['page', 'link']
      });
    });
  });

  async function saveActiveTabJob(
    tabId: number,
    fallbackLinkUrl: string | null = null,
    tabUrl?: string
  ): Promise<{ title: string; companyName: string }> {
    const session = await getExtensionSession();
    if (!session?.accessToken) {
      await chrome.action.setBadgeText({ tabId, text: 'AUTH' });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#b45309' });
      setTimeout(() => {
        void syncTabBadge(tabId, tabUrl);
      }, 4000);
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          func: showInPageTerminalToast,
          args: ['Sign in via JobPilot Side Panel first', '', true]
        });
      } catch {
        // Ignore restricted chrome:// tabs
      }
      throw new Error('Sign in via JobPilot Side Panel first.');
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractActiveTabJobInPage,
      args: [fallbackLinkUrl]
    });
    const extracted = results[0]?.result as ExtractedPageJob | undefined;
    if (!extracted) {
      throw new Error('Could not read metadata from this tab.');
    }

    await captureExtensionJob({
      sourceType: extracted.sourceType,
      sourceUrl: extracted.sourceUrl,
      applyUrl: extracted.applyUrl,
      title: extracted.title,
      companyName: extracted.companyName,
      ...(extracted.locationRaw ? { locationRaw: extracted.locationRaw } : {}),
      ...(extracted.salaryText ? { salaryText: extracted.salaryText } : {}),
      ...(extracted.descriptionClean ? { descriptionClean: extracted.descriptionClean } : {})
    });

    await chrome.action.setBadgeText({ tabId, text: 'SAVED' });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#15803d' });
    setTimeout(() => {
      void syncTabBadge(tabId, tabUrl ?? extracted.sourceUrl);
    }, 4000);

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: showInPageTerminalToast,
        args: [extracted.title, extracted.companyName, false]
      });
    } catch {
      // Ignore if page blocks toast injection
    }

    return { title: extracted.title, companyName: extracted.companyName };
  }

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_OPEN_PANEL && tab?.windowId != null) {
      // Call synchronously on user gesture before awaiting other work
      const openPromise = chrome.sidePanel.open({ windowId: tab.windowId });
      void (async () => {
        try {
          await openPromise;
          if (tab.id != null) {
            await chrome.action.setBadgeText({ tabId: tab.id, text: 'JP' });
            await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#007aff' });
          }
        } catch (err) {
          console.warn('Failed opening side panel from context menu:', err);
        }
      })();
    }

    if (info.menuItemId === MENU_SAVE_JOB && tab?.id != null) {
      const linkUrl = typeof info.linkUrl === 'string' ? info.linkUrl : null;
      void saveActiveTabJob(tab.id, linkUrl, tab.url).catch((err) => {
        console.warn('Failed saving active tab job:', err);
      });
    }
  });

  chrome.commands.onCommand.addListener((command) => {
    if (command !== 'save-current-job') return;
    void chrome.tabs.query({ active: true, currentWindow: true }).then(([activeTab]) => {
      if (activeTab?.id != null) {
        return saveActiveTabJob(activeTab.id, null, activeTab.url);
      }
      return undefined;
    }).catch((err) => {
      console.warn('Shortcut save-current-job failed:', err);
    });
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' || changeInfo.url) {
      void syncTabBadge(tabId, tab.url);
    }
  });

  chrome.tabs.onActivated.addListener((activeInfo) => {
    void (async () => {
      try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        await syncTabBadge(activeInfo.tabId, tab.url);
      } catch {
        // Ignore closed tabs
      }
    })();
  });

  chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
    // Open side panel without any await beforehand so user gesture is preserved
    if (message?.type === 'OPEN_SIDEPANEL') {
      const windowId = sender.tab?.windowId;
      if (windowId == null) {
        sendResponse({ ok: false, error: 'Missing active windowId' });
        return false;
      }
      const openPromise = chrome.sidePanel.open({ windowId });
      void (async () => {
        try {
          await openPromise;
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ ok: false, error: String(err) });
        }
      })();
      return true;
    }

    if (message?.type === 'API_DRAFT_ANSWERS') {
      (async () => {
        try {
          const data = await draftExtensionAnswers(message.payload);
          sendResponse({ ok: true, data });
        } catch (err) {
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : 'Failed to draft answers'
          });
        }
      })();
      return true;
    }

    if (message?.type === 'API_FALLBACK_FILL') {
      (async () => {
        try {
          const data = await fallbackFillExtensionFields(message.payload);
          sendResponse({ ok: true, data });
        } catch (err) {
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : 'LLM fallback mapping failed'
          });
        }
      })();
      return true;
    }

    if (message?.type === 'API_CAPTURE_JOB') {
      (async () => {
        try {
          const data = await captureExtensionJob(message.payload);
          sendResponse({ ok: true, data });
        } catch (err) {
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : 'Failed to capture job'
          });
        }
      })();
      return true;
    }

    if (message?.type === 'API_FETCH_PDF_BYTES') {
      (async () => {
        try {
          const data = await fetchResumePdfBytes(message.versionId);
          sendResponse({ ok: true, data });
        } catch (err) {
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : 'Failed to download PDF'
          });
        }
      })();
      return true;
    }

    if (message?.type === 'JOBPILOT_SAVE_ACTIVE_TAB_JOB') {
      (async () => {
        try {
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!activeTab?.id) {
            throw new Error('No active browser tab found.');
          }
          const data = await saveActiveTabJob(activeTab.id, null, activeTab.url);
          sendResponse({ ok: true, data });
        } catch (err) {
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : 'Failed to save active page'
          });
        }
      })();
      return true;
    }

    return false;
  });
});
