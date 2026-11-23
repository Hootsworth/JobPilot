import {
  executeFillPlan,
  observeMultiStepForm,
  scanDocumentWithAdapter,
  type PageScanResult
} from '@jobpilot/form-engine';
import type { FillExecutionItemResult } from '@jobpilot/shared';
import { base64ToUint8 } from '../src/lib/api-client';
import type {
  ApiProxyResponse,
  ExtensionMessage,
  PageScanPayload,
  PdfBytesResponse
} from '../src/lib/messaging';
import { JobPilotOverlayController } from '../src/lib/overlay';
import { getExtensionSettings } from '../src/lib/storage';

const HIGHLIGHT_CLASS_OK = '2px solid #007aff';
const HIGHLIGHT_CLASS_DRAFT = '2px solid #ff9f0a';

async function batchHighlightElements(
  items: Array<{ element: HTMLElement; status: FillExecutionItemResult['status']; confidence: number }>
): Promise<void> {
  const BATCH_SIZE = 20;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const slice = items.slice(i, i + BATCH_SIZE);
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        for (const entry of slice) {
          if (entry.status === 'filled') {
            entry.element.style.outline =
              entry.confidence < 0.8 ? HIGHLIGHT_CLASS_DRAFT : HIGHLIGHT_CLASS_OK;
            entry.element.style.outlineOffset = '1px';
            entry.element.setAttribute('data-jobpilot-filled', 'true');
          }
        }
        resolve();
      });
    });
    const navScheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
    if (navScheduler?.yield) {
      await navScheduler.yield();
    }
  }
}

async function clearAllHighlights(): Promise<void> {
  const marked = Array.from(document.querySelectorAll<HTMLElement>('[data-jobpilot-filled="true"]'));
  const BATCH_SIZE = 20;
  for (let i = 0; i < marked.length; i += BATCH_SIZE) {
    const slice = marked.slice(i, i + BATCH_SIZE);
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        for (const el of slice) {
          el.style.outline = '';
          el.style.outlineOffset = '';
          el.removeAttribute('data-jobpilot-filled');
        }
        resolve();
      });
    });
  }
}

export default defineContentScript({
  matches: [
    'https://boards.greenhouse.io/*',
    'https://job-boards.greenhouse.io/*',
    'https://boards.eu.greenhouse.io/*',
    'https://job-boards.eu.greenhouse.io/*',
    'https://jobs.lever.co/*',
    'https://jobs.eu.lever.co/*',
    'https://jobs.ashbyhq.com/*'
  ],
  allFrames: true,
  runAt: 'document_idle',

  async main() {
    const winFlag = window as unknown as { __jobpilotContentLoaded?: boolean };
    if (winFlag.__jobpilotContentLoaded) return;
    winFlag.__jobpilotContentLoaded = true;

    let lastScan: PageScanResult | null = null;
    let lastUndo: (() => number) | null = null;
    const isTopFrame = window === window.top;

    const overlay = new JobPilotOverlayController(() => {
      void chrome.runtime.sendMessage({ type: 'OPEN_SIDEPANEL' });
    });

    const performScan = async (): Promise<PageScanPayload> => {
      const settings = await getExtensionSettings();
      const scan = scanDocumentWithAdapter({
        doc: document,
        url: window.location.href,
        enabledAdapters: settings.enabledAdapters
      });

      if (scan.disabledByUser) {
        overlay.unmount();
        lastScan = null;
        return {
          adapterId: scan.adapterId,
          disabledByUser: true,
          tosRiskLevel: scan.tosRiskLevel,
          tosWarning: scan.tosWarning,
          url: window.location.href,
          jobMetadata: scan.jobMetadata,
          fields: [],
          hasSubmitControl: false
        };
      }

      lastScan = scan;

      if (isTopFrame && scan.fields.length > 0) {
        overlay.mount(
          scan.adapterId.toUpperCase(),
          `${scan.fields.length} fields detected`
        );
      } else if (!isTopFrame && scan.fields.length > 0) {
        overlay.mount(
          scan.adapterId.toUpperCase(),
          `${scan.fields.length} embedded fields`
        );
      } else {
        overlay.unmount();
      }

      return {
        adapterId: scan.adapterId,
        disabledByUser: false,
        tosRiskLevel: scan.tosRiskLevel,
        tosWarning: scan.tosWarning,
        url: window.location.href,
        jobMetadata: scan.jobMetadata,
        fields: scan.fields,
        hasSubmitControl: Boolean(
          document.querySelector('button[type="submit"], input[type="submit"]')
        )
      };
    };

    const initial = await performScan();
    if (!initial.disabledByUser && document.body) {
      observeMultiStepForm(document.body, () => {
        void (async () => {
          const updated = await performScan();
          try {
            await chrome.runtime.sendMessage({
              type: 'PAGE_STRUCTURE_UPDATED',
              adapterId: updated.adapterId,
              fieldCount: updated.fields.length
            });
          } catch {
            // Side panel not open
          }
        })();
      });
    }

    chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
      if (message?.type === 'SCAN_PAGE') {
        (async () => {
          const payload = await performScan();
          // Yield top frame response briefly if it has zero fields in case an iframe ATS form answers first
          if (isTopFrame && payload.fields.length === 0) {
            await new Promise((r) => setTimeout(r, 40));
          } else if (!isTopFrame && payload.fields.length === 0) {
            return;
          }
          sendResponse(payload);
        })();
        return true;
      }

      if (message?.type === 'EXECUTE_FILL') {
        (async () => {
          const current = lastScan ?? (await (async () => {
            await performScan();
            return lastScan;
          })());
          if (!current) {
            sendResponse({ ok: false, error: 'Unable to inspect form DOM.' });
            return;
          }

          const hasMatchingControl = message.planItems.some((item) =>
            current.controlsById.has(item.fieldId)
          );
          if (!hasMatchingControl && !isTopFrame) return;

          let resumeFile: { bytes: Uint8Array; filename: string } | undefined;
          const wantsFileUpload = message.planItems.some(
            (i) => i.included && i.controlType === 'file'
          );

          if (wantsFileUpload && message.resumeVersionId) {
            const pdfRes = (await chrome.runtime.sendMessage({
              type: 'API_FETCH_PDF_BYTES',
              versionId: message.resumeVersionId
            } satisfies ExtensionMessage)) as ApiProxyResponse<PdfBytesResponse>;

            if (pdfRes?.ok) {
              resumeFile = {
                bytes: base64ToUint8(pdfRes.data.base64),
                filename: pdfRes.data.filename
              };
            }
          }

          // Strictly executes form fill and NEVER clicks Submit
          const exec = executeFillPlan(current.controlsById, message.planItems, { resumeFile });
          lastUndo = exec.undo;

          const toHighlight = exec.results
            .map((r) => {
              const ctrl = current.controlsById.get(r.fieldId);
              return ctrl ? { element: ctrl.element, status: r.status, confidence: r.confidence } : null;
            })
            .filter((x): x is NonNullable<typeof x> => Boolean(x));

          await batchHighlightElements(toHighlight);

          overlay.mount(
            current.adapterId.toUpperCase(),
            `Filled ${exec.filledCount} — Review & click Submit`
          );

          sendResponse({
            ok: true,
            filledCount: exec.filledCount,
            skippedAlreadyFilledCount: exec.skippedAlreadyFilledCount,
            results: exec.results
          });
        })();
        return true;
      }

      if (message?.type === 'UNDO_FILL') {
        (async () => {
          const restoredCount = lastUndo ? lastUndo() : 0;
          lastUndo = null;
          await clearAllHighlights();
          const refreshed = await performScan();
          overlay.mount(
            refreshed.adapterId.toUpperCase(),
            `Undid ${restoredCount} field(s)`
          );
          sendResponse({ ok: true, restoredCount });
        })();
        return true;
      }

      if (message?.type === 'CLEAR_HIGHLIGHTS') {
        (async () => {
          await clearAllHighlights();
          sendResponse({ ok: true });
        })();
        return true;
      }

      return false;
    });
  }
});
