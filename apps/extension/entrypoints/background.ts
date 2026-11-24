import { resolveAdapterForUrl } from '@jobpilot/form-engine';
import type { CaptureExtensionJobRequest } from '@jobpilot/shared';
import {
  captureExtensionJob,
  createSavedAnswerInExtension,
  draftExtensionAnswers,
  fallbackFillExtensionFields,
  fetchCoverLetterPdfBytes,
  fetchResumePdfBytes,
  markApplicationApplied,
  scoreActiveJobAts,
  syncExtensionUserData,
  tailorResumeInExtension
} from '../src/lib/api-client';
import type { ExtensionMessage } from '../src/lib/messaging';
import {
  getExtensionSession,
  getExtensionSettings,
  saveCachedUserData,
  saveExtensionSession,
  saveExtensionSettings
} from '../src/lib/storage';

const MENU_OPEN_PANEL = 'jobpilot-open-panel';
const MENU_SAVE_JOB = 'jobpilot-save-job';

const WEB_APP_TAB_PATTERNS = ['https://jobpilot.singulr.tech/*'];

interface ExtractedPageJob {
  sourceType: CaptureExtensionJobRequest['sourceType'];
  sourceUrl: string;
  applyUrl: string;
  title: string;
  companyName: string;
  locationRaw?: string;
  salaryText?: string;
  descriptionClean?: string;
}

function inferSourceTypeAndCompany(urlString: string): {
  sourceType: CaptureExtensionJobRequest['sourceType'];
  fallbackCompany: string;
} {
  let host = '';
  try {
    host = new URL(urlString).hostname.toLowerCase();
  } catch {
    host = '';
  }

  let sourceType: CaptureExtensionJobRequest['sourceType'] = 'extension_capture';
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

  const hostPart = host.replace(/^www\./, '').split('.')[0] || 'Company';
  const fallbackCompany = hostPart.charAt(0).toUpperCase() + hostPart.slice(1);
  return { sourceType, fallbackCompany };
}

function extractActiveTabJobInPage(fallbackLinkUrl: string | null): ExtractedPageJob {
  const isClickedLink = Boolean(fallbackLinkUrl && fallbackLinkUrl !== window.location.href);
  const targetUrl = fallbackLinkUrl || window.location.href;
  let host = window.location.hostname.toLowerCase();
  try {
    host = new URL(targetUrl).hostname.toLowerCase();
  } catch {
    // Keep window hostname
  }

  let sourceType: CaptureExtensionJobRequest['sourceType'] = 'extension_capture';
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

  const companyFallback = host.replace(/^www\./, '').split('.')[0] || 'Company';
  const formattedHostCompany = companyFallback.charAt(0).toUpperCase() + companyFallback.slice(1);

  // When the user right-clicked a specific job card link on a directory page,
  // extract only from that anchor/card so we never mix in the outer page's title/JD.
  if (isClickedLink && fallbackLinkUrl) {
    const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'));
    const clickedAnchor = anchors.find((a) => a.href === fallbackLinkUrl);
    const card = clickedAnchor?.closest(
      '[class*="job"], [data-job-id], article, li, tr, [role="listitem"]'
    );

    const anchorTitle =
      clickedAnchor?.getAttribute('aria-label')?.trim() ||
      clickedAnchor?.querySelector('h1, h2, h3, h4, [class*="title"]')?.textContent?.trim() ||
      clickedAnchor?.textContent?.replace(/\s+/g, ' ').trim() ||
      '';
    const cardCompany =
      card?.querySelector('[class*="company"], [data-testid*="company"], .employer')?.textContent?.trim() ||
      '';
    const cardLocation =
      card?.querySelector('[class*="location"], [data-testid*="location"]')?.textContent?.trim() || '';

    const cleanAnchorTitle =
      anchorTitle && !/^(apply|view|read more|details|open)$/i.test(anchorTitle)
        ? anchorTitle
        : '';

    let slugCompany = formattedHostCompany;
    try {
      const parsed = new URL(fallbackLinkUrl);
      const firstSeg = parsed.pathname.split('/').filter(Boolean)[0];
      if (firstSeg && /greenhouse|lever|ashby/i.test(parsed.hostname)) {
        slugCompany = firstSeg.charAt(0).toUpperCase() + firstSeg.slice(1);
      }
    } catch {
      // Keep host fallback
    }

    return {
      sourceType,
      sourceUrl: fallbackLinkUrl,
      applyUrl: fallbackLinkUrl,
      title: (cleanAnchorTitle || `Job at ${cardCompany || slugCompany}`).slice(0, 220),
      companyName: (cardCompany || slugCompany).slice(0, 180),
      ...(cardLocation ? { locationRaw: cardLocation.slice(0, 180) } : {})
    };
  }

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

      const jobLoc = posting['jobLocation'] as
        | Record<string, unknown>
        | Array<Record<string, unknown>>
        | undefined;
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
  const ogSite =
    document.querySelector('meta[property="og:site_name"]')?.getAttribute('content')?.trim() || '';
  const ogDesc =
    document.querySelector('meta[property="og:description"]')?.getAttribute('content')?.trim() ||
    document.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() ||
    '';

  const h1 = document.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim() || '';
  const docTitle = document.title.split(/[|\-–]/)[0]?.trim() || '';
  const mainText = (
    document.querySelector('main, article, [role="main"]')?.textContent ||
    document.body?.innerText ||
    ''
  )
    .replace(/\s+/g, ' ')
    .trim();

  const title = (ldTitle || h1 || ogTitle || docTitle || 'Saved Job Posting').slice(0, 220);
  const companyName = (ldCompany || ogSite || formattedHostCompany).slice(0, 180);
  const descriptionClean = (ldDescription || ogDesc || mainText).slice(0, 12000);

  return {
    sourceType,
    sourceUrl: targetUrl,
    applyUrl: targetUrl,
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
    const tab = await chrome.tabs.get(tabId);
    const resolvedTabUrl = tab.url ?? tabUrl ?? '';
    if (resolvedTabUrl && !/^https?:\/\//i.test(resolvedTabUrl) && !fallbackLinkUrl) {
      throw new Error('Only http/https web pages can be saved to Tracker.');
    }

    const session = await getExtensionSession();
    if (!session?.accessToken) {
      await chrome.action.setBadgeText({ tabId, text: 'AUTH' });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#b45309' });
      setTimeout(() => {
        void syncTabBadge(tabId, resolvedTabUrl);
      }, 4000);
      if (/^https?:\/\//i.test(resolvedTabUrl)) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            func: showInPageTerminalToast,
            args: ['Sign in via JobPilot Web or Side Panel first', '', true]
          });
        } catch {
          // Ignore if no activeTab grant yet
        }
      }
      throw new Error('Sign in on JobPilot Web or Side Panel first.');
    }

    let extracted: ExtractedPageJob | undefined;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: extractActiveTabJobInPage,
        args: [fallbackLinkUrl]
      });
      extracted = results[0]?.result as ExtractedPageJob | undefined;
    } catch {
      // Side Panel button calls without activeTab permission gracefully fall back to chrome.tabs metadata
      const effectiveUrl = fallbackLinkUrl || resolvedTabUrl;
      if (!effectiveUrl || !/^https?:\/\//i.test(effectiveUrl)) {
        throw new Error('Cannot access this page. Press Alt+Shift+S or right-click to save full details.');
      }
      const { sourceType, fallbackCompany } = inferSourceTypeAndCompany(effectiveUrl);
      const rawTitle = tab.title?.split(/[|\-–]/)[0]?.trim() || 'Saved Job Posting';
      extracted = {
        sourceType,
        sourceUrl: effectiveUrl,
        applyUrl: effectiveUrl,
        title: rawTitle.slice(0, 220),
        companyName: fallbackCompany.slice(0, 180)
      };
    }

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

    await chrome.action.setBadgeText({ tabId, text: 'OK' });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#15803d' });
    setTimeout(() => {
      void syncTabBadge(tabId, resolvedTabUrl || extracted.sourceUrl);
    }, 4000);

    if (/^https?:\/\//i.test(resolvedTabUrl)) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          func: showInPageTerminalToast,
          args: [extracted.title, extracted.companyName, false]
        });
      } catch {
        // Ignore if page blocks toast injection or activeTab wasn't granted (Side Panel button path)
      }
    }

    return { title: extracted.title, companyName: extracted.companyName };
  }

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_OPEN_PANEL && tab?.windowId != null) {
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
    void chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(([activeTab]) => {
        if (activeTab?.id != null) {
          return saveActiveTabJob(activeTab.id, null, activeTab.url);
        }
        return undefined;
      })
      .catch((err) => {
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

    if (message?.type === 'WEB_CONFIG_SYNC') {
      (async () => {
        try {
          await saveExtensionSettings({
            ...(message.payload.apiBaseUrl ? { apiBaseUrl: message.payload.apiBaseUrl } : {}),
            ...(message.payload.webBaseUrl ? { webBaseUrl: message.payload.webBaseUrl } : {}),
            ...(message.payload.supabaseUrl ? { supabaseUrl: message.payload.supabaseUrl } : {}),
            ...(message.payload.supabaseAnonKey
              ? { supabaseAnonKey: message.payload.supabaseAnonKey }
              : {})
          });
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ ok: false, error: String(err) });
        }
      })();
      return true;
    }

    if (message?.type === 'WEB_SESSION_SYNC') {
      (async () => {
        try {
          const payload = message.payload;
          if (!payload) {
            await Promise.all([saveExtensionSession(null), saveCachedUserData(null)]);
            void chrome.runtime
              .sendMessage({
                type: 'AUTH_SESSION_UPDATED',
                connected: false
              } satisfies ExtensionMessage)
              .catch(() => {});
            sendResponse({ ok: true });
            return;
          }

          await saveExtensionSettings({
            ...(payload.apiBaseUrl ? { apiBaseUrl: payload.apiBaseUrl } : {}),
            ...(payload.webBaseUrl ? { webBaseUrl: payload.webBaseUrl } : {}),
            ...(payload.supabaseUrl ? { supabaseUrl: payload.supabaseUrl } : {}),
            ...(payload.supabaseAnonKey ? { supabaseAnonKey: payload.supabaseAnonKey } : {})
          });
          await saveExtensionSession({
            accessToken: payload.accessToken,
            refreshToken: payload.refreshToken,
            email: payload.email,
            expiresAt: payload.expiresAt
          });
          try {
            await syncExtensionUserData();
          } catch {
            // Side panel can retry sync on demand if API cold-starts
          }
          void chrome.runtime
            .sendMessage({
              type: 'AUTH_SESSION_UPDATED',
              connected: true,
              email: payload.email
            } satisfies ExtensionMessage)
            .catch(() => {});
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ ok: false, error: String(err) });
        }
      })();
      return true;
    }

    if (message?.type === 'JOBPILOT_SYNC_FROM_WEB_TAB') {
      (async () => {
        try {
          const webTabs = await chrome.tabs.query({ url: WEB_APP_TAB_PATTERNS });
          for (const wt of webTabs) {
            if (!wt.id) continue;
            try {
              await chrome.tabs.sendMessage(wt.id, {
                type: 'PULL_WEB_SESSION'
              } satisfies ExtensionMessage);
            } catch {
              // Tab may not have bridge loaded yet; try injecting cleanly
              try {
                await chrome.scripting.executeScript({
                  target: { tabId: wt.id },
                  files: ['content-scripts/web-auth-bridge.js']
                });
                await chrome.tabs.sendMessage(wt.id, {
                  type: 'PULL_WEB_SESSION'
                } satisfies ExtensionMessage);
              } catch {
                // Ignore tab error
              }
            }
          }

          if (webTabs.length > 0) {
            await new Promise((r) => setTimeout(r, 450));
          }
          const sess = await getExtensionSession();
          sendResponse({
            ok: true,
            data: {
              found: Boolean(sess?.accessToken),
              email: sess?.email,
              tabCount: webTabs.length
            }
          });
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

    if (message?.type === 'API_FETCH_COVER_LETTER_PDF_BYTES') {
      (async () => {
        try {
          const data = await fetchCoverLetterPdfBytes(message.coverLetterId);
          sendResponse({ ok: true, data });
        } catch (err) {
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : 'Failed to download cover letter PDF'
          });
        }
      })();
      return true;
    }

    if (message?.type === 'API_ATS_SCORE') {
      (async () => {
        try {
          const data = await scoreActiveJobAts(message.payload);
          sendResponse({ ok: true, data });
        } catch (err) {
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : 'Failed to compute ATS score'
          });
        }
      })();
      return true;
    }

    if (message?.type === 'API_TAILOR_RESUME') {
      (async () => {
        try {
          const data = await tailorResumeInExtension(message.payload);
          sendResponse({ ok: true, data });
        } catch (err) {
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : 'Failed to tailor resume'
          });
        }
      })();
      return true;
    }

    if (message?.type === 'API_SAVE_ANSWER') {
      (async () => {
        try {
          const data = await createSavedAnswerInExtension(message.payload);
          sendResponse({ ok: true, data });
        } catch (err) {
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : 'Failed to save answer'
          });
        }
      })();
      return true;
    }

    if (message?.type === 'API_MARK_APPLIED') {
      (async () => {
        try {
          const data = await markApplicationApplied(message.payload);
          sendResponse({ ok: true, data });
        } catch (err) {
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : 'Failed to mark application as applied'
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
