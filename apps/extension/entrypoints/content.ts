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
  PageValidationError,
  PdfBytesResponse
} from '../src/lib/messaging';
import {
  isExtensionContextValid,
  safeSendRuntimeMessage
} from '../src/lib/runtime-safe';
import { getExtensionSettings } from '../src/lib/storage';

const HIGHLIGHT_CLASS_OK = '2px solid #007aff';
const HIGHLIGHT_CLASS_DRAFT = '2px solid #ff9f0a';
const PENDING_SUBMIT_KEY = 'jobpilot_pending_submit';

function collectPageValidationErrors(
  doc: Document,
  scan: PageScanResult | null
): PageValidationError[] {
  const errors: PageValidationError[] = [];
  const seen = new Set<string>();

  const fieldIdByElement = new Map<HTMLElement, { fieldId: string; label: string }>();
  if (scan) {
    for (const f of scan.fields) {
      const ctrl = scan.controlsById.get(f.fieldId);
      if (ctrl) {
        fieldIdByElement.set(ctrl.element, { fieldId: f.fieldId, label: f.label || f.name || 'Field' });
      }
    }
  }

  const invalidControls = Array.from(
    doc.querySelectorAll<HTMLElement>('[aria-invalid="true"]')
  ).slice(0, 12);
  for (const el of invalidControls) {
    if (el.closest('jobpilot-status-chip, jobpilot-apply-cta')) continue;
    const errId = el.getAttribute('aria-errormessage');
    const linkedMsg = errId ? doc.getElementById(errId)?.textContent?.trim() : '';
    const msg =
      linkedMsg ||
      el.getAttribute('validationMessage') ||
      (el as HTMLInputElement).validationMessage ||
      'Required or invalid field';
    const meta = fieldIdByElement.get(el);
    const label = meta?.label || el.getAttribute('aria-label') || el.getAttribute('name') || 'Required field';
    const dedupeKey = `${label.toLowerCase()}::${msg.toLowerCase()}`;
    if (!seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      errors.push({ ...(meta?.fieldId ? { fieldId: meta.fieldId } : {}), label, message: msg.slice(0, 180) });
    }
  }

  const errorContainers = Array.from(
    doc.querySelectorAll<HTMLElement>(
      '[role="alert"], .field-error, .invalid-feedback, [data-automation-id*="error"], [data-test*="error"]'
    )
  ).slice(0, 20);
  for (const node of errorContainers) {
    if (errors.length >= 6) break;
    if (node.closest('jobpilot-status-chip, jobpilot-apply-cta')) continue;
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const text = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length < 4 || text.length > 180) continue;
    if (!/(required|invalid|missing|must|please|error|select|enter|upload)/i.test(text)) continue;
    const dedupeKey = `alert::${text.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    errors.push({ label: 'Form validation', message: text });
  }

  return errors.slice(0, 6);
}

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

  async main(ctx) {
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
    let hasExecutedFillOnPage = false;
    let previousFieldIds = new Set<string>();
    let stopObserver: (() => void) | null = null;
    let tornDown = false;
    const abortController = new AbortController();
    const filledValuesById = new Map<
      string,
      { value: string; label: string; canonicalKey: string }
    >();
    const isTopFrame = window === window.top;
    const currentHostname = window.location.hostname.toLowerCase();

    const triggerAutofillFromPage = (source: 'apply_cta') => {
      if (tornDown || ctx.isInvalid || !isExtensionContextValid()) return;
      void safeSendRuntimeMessage({
        type: 'TRIGGER_AUTOFILL_VIA_JOBPILOT',
        source
      });
    };

    const injector = isTopFrame
      ? new ApplyButtonInjector(
          () => {
            triggerAutofillFromPage('apply_cta');
          },
          () => {
            void safeSendRuntimeMessage({
              type: 'HIDE_CTA_FOR_DOMAIN',
              hostname: currentHostname
            });
          }
        )
      : null;

    const onStorageChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (tornDown || ctx.isInvalid || !isExtensionContextValid()) {
        teardown();
        return;
      }
      if (areaName === 'local' && changes['jobpilot_ext_settings']) {
        void (async () => {
          try {
            await syncInjectorHiddenState();
            if (tornDown || ctx.isInvalid || !isExtensionContextValid()) return;
            const updatedSettings = await getExtensionSettings();
            if (
              updatedSettings.showInlineApplyButton &&
              !observerStarted &&
              !updatedSettings.hiddenCtaDomains.includes(currentHostname) &&
              isLikelyJobOrApplicationPage(window.location.href, document)
            ) {
              await startPageMonitoring();
            }
          } catch {
            // Extension reloaded mid-update
          }
        })();
      }
    };

    const teardown = () => {
      if (tornDown) return;
      tornDown = true;
      abortController.abort();
      stopObserver?.();
      stopObserver = null;
      injector?.destroy();
      winFlag.__jobpilotContentLoaded = false;
      try {
        chrome.storage?.onChanged?.removeListener(onStorageChanged);
      } catch {
        // Ignore invalidated context
      }
    };

    ctx.onInvalidated(teardown);

    const isDead = () => tornDown || ctx.isInvalid || !isExtensionContextValid();

    const syncInjectorHiddenState = async () => {
      if (!injector || isDead()) return;
      try {
        const settings = await getExtensionSettings();
        if (isDead()) return;
        const shouldShow =
          settings.showInlineApplyButton &&
          !settings.hiddenCtaDomains.includes(currentHostname) &&
          isLikelyJobOrApplicationPage(window.location.href, document);
        injector.setPaused(!shouldShow);
      } catch {
        // Context invalidated
      }
    };

    if (isTopFrame && isExtensionContextValid()) {
      chrome.storage.onChanged.addListener(onStorageChanged);
    }

    const checkPostSubmitConfirmation = () => {
      if (!isTopFrame || isDead()) return;
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
          void safeSendRuntimeMessage({
            type: 'APPLICATION_SUBMIT_DETECTED',
            payload: {
              url: parsed.url || window.location.href,
              title: parsed.title || lastScan?.jobMetadata.title || document.title || 'Application',
              companyName:
                parsed.companyName || lastScan?.jobMetadata.companyName || window.location.hostname
            }
          });
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
        if (isDead()) return;
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
          ctx.setTimeout(checkPostSubmitConfirmation, 1500);
        } catch {
          // Ignore sessionStorage errors
        }
      },
      { capture: true, passive: true, signal: abortController.signal }
    );

    // Post-edit Answer Bank learning: notify Side Panel if user edits a JobPilot-filled field
    document.addEventListener(
      'change',
      (evt) => {
        if (isDead()) return;
        const target = evt.target;
        if (
          !(target instanceof HTMLInputElement) &&
          !(target instanceof HTMLTextAreaElement) &&
          !(target instanceof HTMLSelectElement)
        ) {
          return;
        }
        if (target.getAttribute('data-jobpilot-filled') !== 'true' || !lastScan) return;

        let matchedFieldId: string | null = null;
        for (const [fid, ctrl] of lastScan.controlsById.entries()) {
          if (ctrl.element === target) {
            matchedFieldId = fid;
            break;
          }
        }
        if (!matchedFieldId) return;

        const recorded = filledValuesById.get(matchedFieldId);
        if (!recorded) return;

        const nextValue =
          target instanceof HTMLInputElement && target.type === 'checkbox'
            ? String(target.checked)
            : target.value.trim();

        if (nextValue.length >= 2 && nextValue !== recorded.value) {
          void safeSendRuntimeMessage({
            type: 'USER_EDITED_FILLED_FIELD',
            payload: {
              fieldId: matchedFieldId,
              label: recorded.label,
              canonicalKey: recorded.canonicalKey,
              value: nextValue
            }
          });
        }
      },
      { capture: true, passive: true, signal: abortController.signal }
    );

    const ensureMultiStepObserver = (disabledByUser: boolean) => {
      if (isDead() || observerStarted || disabledByUser || !document.body) return;
      observerStarted = true;
      stopObserver = observeMultiStepForm(document.body, () => {
        if (isDead()) {
          teardown();
          return;
        }
        checkPostSubmitConfirmation();
        void syncInjectorHiddenState();
        void (async () => {
          try {
            const updated = await performScan();
            if (isDead()) return;
            const newFieldsCount = updated.fields.filter(
              (f) => !previousFieldIds.has(f.fieldId)
            ).length;
            const stepChanged = hasExecutedFillOnPage && newFieldsCount >= 2;
            previousFieldIds = new Set(updated.fields.map((f) => f.fieldId));
            const validationErrors = collectPageValidationErrors(document, lastScan);
            await safeSendRuntimeMessage({
              type: 'PAGE_STRUCTURE_UPDATED',
              adapterId: updated.adapterId,
              fieldCount: updated.fields.length,
              stepChanged,
              validationErrors
            });
          } catch {
            // Extension invalidated during callback
          }
        })();
      });
    };

    const startPageMonitoring = async () => {
      if (isDead() || observerStarted) return;
      const initial = await performScan();
      if (isDead()) return;
      previousFieldIds = new Set(initial.fields.map((f) => f.fieldId));
      await syncInjectorHiddenState();
      if (isDead()) return;
      checkPostSubmitConfirmation();
      ensureMultiStepObserver(initial.disabledByUser);
    };

    const initialSettings = await getExtensionSettings();
    if (isDead()) return;
    const initialRelevant =
      isTopFrame &&
      initialSettings.showInlineApplyButton &&
      !initialSettings.hiddenCtaDomains.includes(currentHostname) &&
      isLikelyJobOrApplicationPage(window.location.href, document);

    if (initialRelevant) {
      await startPageMonitoring();
    } else if (isTopFrame) {
      checkPostSubmitConfirmation();
      const recheckJobPage = () => {
        if (isDead()) return;
        void (async () => {
          try {
            const latest = await getExtensionSettings();
            if (isDead()) return;
            if (
              !observerStarted &&
              latest.showInlineApplyButton &&
              !latest.hiddenCtaDomains.includes(currentHostname) &&
              isLikelyJobOrApplicationPage(window.location.href, document)
            ) {
              await startPageMonitoring();
            }
          } catch {
            // Context invalidated
          }
        })();
      };
      window.addEventListener('popstate', recheckJobPage, { signal: abortController.signal });
      window.addEventListener('hashchange', recheckJobPage, { signal: abortController.signal });
    }

    const onRuntimeMessage = (
      message: ExtensionMessage,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void
    ) => {
      if (isDead()) return false;

      if (message?.type === 'SCAN_PAGE') {
        if (!isTopFrame && collectRawFormControls(document).length === 0) {
          return false;
        }
        (async () => {
          try {
            const payload = await performScan();
            if (isDead()) return;
            previousFieldIds = new Set(payload.fields.map((f) => f.fieldId));
            ensureMultiStepObserver(payload.disabledByUser);
            await syncInjectorHiddenState();
            if (isDead()) return;
            if (isTopFrame && payload.fields.length === 0) {
              await new Promise((r) => setTimeout(r, 40));
            }
            if (!isDead()) sendResponse(payload);
          } catch {
            // Context invalidated
          }
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
          try {
            const current =
              lastScan ??
              (await (async () => {
                await performScan();
                return lastScan;
              })());
            if (isDead()) return;
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
              const pdfRes = await safeSendRuntimeMessage<ApiProxyResponse<PdfBytesResponse>>({
                type: 'API_FETCH_PDF_BYTES',
                versionId: message.resumeVersionId
              });

              if (pdfRes?.ok) {
                resumeFile = {
                  bytes: base64ToUint8(pdfRes.data.base64),
                  filename: pdfRes.data.filename
                };
              }
            }

            if (wantsCoverLetterUpload && message.coverLetterId) {
              const clPdfRes = await safeSendRuntimeMessage<ApiProxyResponse<PdfBytesResponse>>({
                type: 'API_FETCH_COVER_LETTER_PDF_BYTES',
                coverLetterId: message.coverLetterId
              });

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
            if (isDead()) return;
            lastUndo = exec.undo;
            hasExecutedFillOnPage = true;
            const planById = new Map(message.planItems.map((p) => [p.fieldId, p]));
            for (const r of exec.results) {
              if (r.status === 'filled') {
                const p = planById.get(r.fieldId);
                if (p) {
                  filledValuesById.set(r.fieldId, {
                    value: p.proposedValue.trim(),
                    label: p.label,
                    canonicalKey: p.canonicalKey
                  });
                }
              }
            }

            const toHighlight = exec.results
              .map((r) => {
                const ctrl = current.controlsById.get(r.fieldId);
                return ctrl
                  ? { element: ctrl.element, status: r.status, confidence: r.confidence }
                  : null;
              })
              .filter((x): x is NonNullable<typeof x> => Boolean(x));

            await batchHighlightElements(toHighlight);

            if (!isDead()) {
              sendResponse({
                ok: true,
                filledCount: exec.filledCount,
                skippedAlreadyFilledCount: exec.skippedAlreadyFilledCount,
                results: exec.results
              });
            }
          } catch {
            // Context invalidated
          }
        })();
        return true;
      }

      if (message?.type === 'GET_PAGE_VALIDATION_ERRORS') {
        try {
          sendResponse({ ok: true, errors: collectPageValidationErrors(document, lastScan) });
        } catch {
          // Channel closed
        }
        return false;
      }

      if (message?.type === 'UNDO_FILL') {
        (async () => {
          try {
            const restoredCount = lastUndo ? lastUndo() : 0;
            lastUndo = null;
            await clearAllHighlights();
            await performScan();
            if (!isDead()) sendResponse({ ok: true, restoredCount });
          } catch {
            // Context invalidated
          }
        })();
        return true;
      }

      if (message?.type === 'CLEAR_HIGHLIGHTS') {
        (async () => {
          try {
            await clearAllHighlights();
            if (!isDead()) sendResponse({ ok: true });
          } catch {
            // Context invalidated
          }
        })();
        return true;
      }

      return false;
    };

    if (isExtensionContextValid()) {
      chrome.runtime.onMessage.addListener(onRuntimeMessage);
    }

    ctx.onInvalidated(() => {
      try {
        chrome.runtime?.onMessage?.removeListener(onRuntimeMessage);
      } catch {
        // Ignore invalidated context
      }
    });
  }
});
