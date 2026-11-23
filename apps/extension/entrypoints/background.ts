import { resolveAdapterForUrl } from '@jobpilot/form-engine';
import {
  captureExtensionJob,
  draftExtensionAnswers,
  fallbackFillExtensionFields,
  fetchResumePdfBytes
} from '../src/lib/api-client';
import type { ExtensionMessage } from '../src/lib/messaging';
import { getExtensionSettings } from '../src/lib/storage';

const MENU_OPEN_PANEL = 'jobpilot-open-panel';

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
    });
  });

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

    return false;
  });
});
