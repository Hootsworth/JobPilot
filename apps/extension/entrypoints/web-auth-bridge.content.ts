import type { ExtensionMessage, WebConfigSyncPayload, WebSessionSyncPayload } from '../src/lib/messaging';
import type { TailorHandoffPayload } from '../src/lib/storage';

export default defineContentScript({
  matches: ['https://jobpilot.singulr.tech/*', 'http://localhost:3000/*'],
  runAt: 'document_idle',

  main() {
    const winFlag = window as unknown as { __jobpilotWebBridgeLoaded?: boolean };
    if (winFlag.__jobpilotWebBridgeLoaded) return;
    winFlag.__jobpilotWebBridgeLoaded = true;

    const requestFromPage = () => {
      window.postMessage(
        { source: 'jobpilot-extension', type: 'REQUEST_SESSION' },
        window.location.origin
      );
    };

    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as
        | { source?: string; type?: string; payload?: unknown }
        | undefined;
      if (data?.source !== 'jobpilot-web-auth') return;

      if (data.type === 'SESSION_SYNC') {
        void chrome.runtime
          .sendMessage({
            type: 'WEB_SESSION_SYNC',
            payload: (data.payload as WebSessionSyncPayload | null) ?? null
          } satisfies ExtensionMessage)
          .catch(() => {
            // Extension context may reload cleanly
          });
      } else if (data.type === 'WEB_CONFIG' && data.payload) {
        void chrome.runtime
          .sendMessage({
            type: 'WEB_CONFIG_SYNC',
            payload: data.payload as WebConfigSyncPayload
          } satisfies ExtensionMessage)
          .catch(() => {
            // Ignore
          });
      } else if (data.type === 'TAILOR_HANDOFF' && data.payload) {
        void chrome.runtime
          .sendMessage({
            type: 'WEB_TAILOR_HANDOFF',
            payload: data.payload as TailorHandoffPayload
          } satisfies ExtensionMessage)
          .catch(() => {
            // Ignore
          });
      }
    });

    chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
      if (message?.type === 'PULL_WEB_SESSION') {
        requestFromPage();
        sendResponse({ ok: true });
        return false;
      }
      return false;
    });

    requestFromPage();
    setTimeout(requestFromPage, 800);
  }
});
