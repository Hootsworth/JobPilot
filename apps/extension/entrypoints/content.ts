import {
  collectRawFormControls,
  executeFillPlanAsync,
  isSubmitControl,
  observeMultiStepForm,
  scanDocumentWithAdapter,
  type PageScanResult
} from '@jobpilot/form-engine';
import type { FillExecutionItemResult } from '@jobpilot/shared';
import { base64ToUint8 } from '../src/lib/api-client';
import {
  ApplyButtonInjector,
  isLikelyJobOrApplicationPage
} from '../src/lib/apply-button-injector';
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
const PENDING_SUBMIT_KEY = 'jobpilot_pending_submit';

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
  matches: ['https://*/*', 'http://*/*'],
  excludeMatches: ['https://jobpilot.singulr.tech/*'],
  allFrames: true,
  runAt: 'document_idle',

  async main() {
    if (
      window.location.hostname === 'localhost' &&
      (window.location.port === '3000' || window.location.port === '4000')
    ) {
      return;
    }

    const winFlag = window as unknown as { __jobpilotContentLoaded?: boolean };
    if (winFlag.__jobpilotContentLoaded) return;
    winFlag.__jobpilotContentLoaded = true;

    let lastScan: PageScanResult | null = null;
    let lastUndo: (() => number) | null = null;
    let observerStarted = false;
    const isTopFrame = window === window.top;

    const triggerAutofillFromPage = (source: 'apply_cta' | 'overlay') => {
      void chrome.runtime
        .sendMessage({
          type: 'TRIGGER_AUTOFILL_VIA_JOBPILOT',
          source
        } satisfies ExtensionMessage)
        .catch(() => {});
    };

    const overlay = new JobPilotOverlayController(() => {
      triggerAutofillFromPage('overlay');
    });

    const injector = isTopFrame
      ? new ApplyButtonInjector(() => {
          triggerAutofillFromPage('apply_cta');
        })
      : null;

    const checkPostSubmitConfirmation = () => {
      if (!isTopFrame) return;
      try {
        const raw = sessionStorage.getItem(PENDING_SUBMIT_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as {
          ts?: number;
          url?: string;
          title?: string;
          companyName?: string;
        };
        if (!parsed.ts || Date.now() - parsed.ts > 120_000) {
          sessionStorage.removeItem(PENDING_SUBMIT_KEY);
          return;
        }
        const urlLooksConfirmed = /thank|confirm|submit|success|received/i.test(window.location.href);
        const bodySample = (document.body?.innerText || '').slice(0, 2500);
        const textLooksConfirmed =
          /application\s+(?:has\s+been\s+)?(?:submitted|received)|thank\s+you\s+for\s+applying|thanks\s+for\s+applying|we\s+have\s+received\s+your\s+application/i.test(
            bodySample
          );

        if (urlLooksConfirmed || textLooksConfirmed) {
          sessionStorage.removeItem(PENDING_SUBMIT_KEY);
          void chrome.runtime
            .sendMessage({
              type: 'APPLICATION_SUBMIT_DETECTED',
              payload: {
                url: parsed.url || window.location.href,
                title: parsed.title || lastScan?.jobMetadata.title || document.title || 'Application',
                companyName:
                  parsed.companyName || lastScan?.jobMetadata.companyName || window.location.hostname
              }
            } satisfies ExtensionMessage)
            .catch(() => {});
        }
      } catch {
        // Ignore sessionStorage restrictions
      }
    };

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
        overlay.mount(scan.adapterId.toUpperCase(), `${scan.fields.length} fields detected`);
      } else if (!isTopFrame && scan.fields.length > 0) {
        overlay.mount(scan.adapterId.toUpperCase(), `${scan.fields.length} embedded fields`);
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

    // Passive user-click detection on native Submit buttons (NEVER clicks Submit!)
    document.addEventListener(
      'click',
      (evt) => {
        const target = evt.target as Element | null;
        const submitBtn = target?.closest('button, input[type="submit"]');
        if (!submitBtn || !isSubmitControl(submitBtn)) return;
        try {
          sessionStorage.setItem(
            PENDING_SUBMIT_KEY,
            JSON.stringify({
              ts: Date.now(),
              url: window.location.href,
              title: lastScan?.jobMetadata.title || document.title,
              companyName: lastScan?.jobMetadata.companyName || window.location.hostname
            })
          );
          setTimeout(checkPostSubmitConfirmation, 1500);
        } catch {
          // Ignore sessionStorage errors
        }
      },
      { capture: true, passive: true }
    );

    const startPageMonitoring = async () => {
      if (observerStarted) return;
      observerStarted = true;
      const initial = await performScan();
      injector?.scheduleSync();
      checkPostSubmitConfirmation();
      if (!initial.disabledByUser && document.body) {
        observeMultiStepForm(document.body, () => {
          checkPostSubmitConfirmation();
          injector?.scheduleSync();
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
    };

    const initialRelevant = isTopFrame
      ? isLikelyJobOrApplicationPage(window.location.href, document)
      : collectRawFormControls(document).length > 0;

    if (initialRelevant) {
      await startPageMonitoring();
    } else if (isTopFrame) {
      checkPostSubmitConfirmation();
      const recheckJobPage = () => {
        if (!observerStarted && isLikelyJobOrApplicationPage(window.location.href, document)) {
          void startPageMonitoring();
        }
      };
      window.addEventListener('popstate', recheckJobPage);
      window.addEventListener('hashchange', recheckJobPage);
    }

    chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
      if (message?.type === 'SCAN_PAGE') {
        if (!isTopFrame && collectRawFormControls(document).length === 0) {
          return false;
        }
        (async () => {
          const payload = await performScan();
          injector?.scheduleSync();
          if (isTopFrame && payload.fields.length === 0) {
            await new Promise((r) => setTimeout(r, 40));
          }
          sendResponse(payload);
        })();
        return true;
      }

      if (message?.type === 'EXECUTE_FILL') {
        if (
          !isTopFrame &&
          lastScan &&
          !message.planItems.some((item) => lastScan!.controlsById.has(item.fieldId))
        ) {
          return false;
        }
        (async () => {
          const current =
            lastScan ??
            (await (async () => {
              await performScan();
              return lastScan;
            })());
          if (!current) {
            sendResponse({ ok: false, error: 'Unable to inspect form DOM.' });
            return;
          }

          let resumeFile: { bytes: Uint8Array; filename: string } | undefined;
          let coverLetterFile: { bytes: Uint8Array; filename: string } | undefined;

          const wantsResumeUpload = message.planItems.some(
            (i) => i.included && i.controlType === 'file' && i.canonicalKey !== 'cover_letter'
          );
          const wantsCoverLetterUpload = message.planItems.some(
            (i) => i.included && i.controlType === 'file' && i.canonicalKey === 'cover_letter'
          );

          if (wantsResumeUpload && message.resumeVersionId) {
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

          if (wantsCoverLetterUpload && message.coverLetterId) {
            const clPdfRes = (await chrome.runtime.sendMessage({
              type: 'API_FETCH_COVER_LETTER_PDF_BYTES',
              coverLetterId: message.coverLetterId
            } satisfies ExtensionMessage)) as ApiProxyResponse<PdfBytesResponse>;

            if (clPdfRes?.ok) {
              coverLetterFile = {
                bytes: base64ToUint8(clPdfRes.data.base64),
                filename: clPdfRes.data.filename
              };
            }
          }

          // Strictly executes form fill (with async combobox portal waiting) and NEVER clicks Submit
          const exec = await executeFillPlanAsync(current.controlsById, message.planItems, {
            resumeFile,
            coverLetterFile
          });
          lastUndo = exec.undo;

          const toHighlight = exec.results
            .map((r) => {
              const ctrl = current.controlsById.get(r.fieldId);
              return ctrl
                ? { element: ctrl.element, status: r.status, confidence: r.confidence }
                : null;
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
          overlay.mount(refreshed.adapterId.toUpperCase(), `Undid ${restoredCount} field(s)`);
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
