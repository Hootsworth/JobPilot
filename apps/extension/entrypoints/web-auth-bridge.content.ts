import type { ExtensionMessage, WebConfigSyncPayload, WebSessionSyncPayload } from '../src/lib/messaging';
import { isExtensionContextValid, safeSendRuntimeMessage } from '../src/lib/runtime-safe';
import type { TailorHandoffPayload } from '../src/lib/storage';

export default defineContentScript({
  matches: ['https://jobpilot.singulr.tech/*', 'http://localhost:3000/*'],
  runAt: 'document_idle',

  main(ctx) {
    const winFlag = window as unknown as { __jobpilotWebBridgeLoaded?: boolean };
    if (winFlag.__jobpilotWebBridgeLoaded) return;
    winFlag.__jobpilotWebBridgeLoaded = true;

    const abortController = new AbortController();

    const requestFromPage = () => {
      if (ctx.isInvalid || !isExtensionContextValid()) return;
      window.postMessage(
        { source: 'jobpilot-extension', type: 'REQUEST_SESSION' },
        window.location.origin
      );
    };

    window.addEventListener(
      'message',
      (event: MessageEvent) => {
        if (ctx.isInvalid || !isExtensionContextValid()) return;
        if (event.source !== window || event.origin !== window.location.origin) return;
        const data = event.data as
          | { source?: string; type?: string; payload?: unknown }
          | undefined;
        if (data?.source !== 'jobpilot-web-auth') return;

        if (data.type === 'SESSION_SYNC') {
          void safeSendRuntimeMessage({
            type: 'WEB_SESSION_SYNC',
            payload: (data.payload as WebSessionSyncPayload | null) ?? null
          });
        } else if (data.type === 'WEB_CONFIG' && data.payload) {
          void safeSendRuntimeMessage({
            type: 'WEB_CONFIG_SYNC',
            payload: data.payload as WebConfigSyncPayload
          });
        } else if (data.type === 'TAILOR_HANDOFF' && data.payload) {
          void safeSendRuntimeMessage({
            type: 'WEB_TAILOR_HANDOFF',
            payload: data.payload as TailorHandoffPayload
          });
        }
      },
      { signal: abortController.signal }
    );

    const onRuntimeMessage = (
      message: ExtensionMessage,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void
    ) => {
      if (ctx.isInvalid || !isExtensionContextValid()) return false;
      if (message?.type === 'PULL_WEB_SESSION') {
        requestFromPage();
        try {
          sendResponse({ ok: true });
        } catch {
          // Ignore channel closed
        }
        return false;
      }
      return false;
    };

    if (isExtensionContextValid()) {
      chrome.runtime.onMessage.addListener(onRuntimeMessage);
    }

    ctx.onInvalidated(() => {
      abortController.abort();
      winFlag.__jobpilotWebBridgeLoaded = false;
      try {
        chrome.runtime?.onMessage?.removeListener(onRuntimeMessage);
      } catch {
        // Ignore invalidated context
      }
    });

    requestFromPage();
    ctx.setTimeout(requestFromPage, 800);
  }
});
