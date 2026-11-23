import type { FillExecutionItemResult, FillPlanItem } from '@jobpilot/shared';
import type { RawFormControl } from '../types.js';
import { isControlAlreadyFilled, isSubmitControl } from './traverser.js';

interface UndoRecord {
  restore: () => void;
}

export interface ExecuteFillOptions {
  resumeFile?: {
    bytes: Uint8Array;
    filename: string;
  };
}

export interface ExecuteFillResult {
  results: FillExecutionItemResult[];
  filledCount: number;
  skippedAlreadyFilledCount: number;
  undo: () => number;
}

function dispatchControlEvents(el: HTMLElement, value: string): void {
  const win = el.ownerDocument.defaultView;
  el.dispatchEvent(new Event('focus', { bubbles: false }));

  if (win && typeof win.InputEvent === 'function') {
    try {
      el.dispatchEvent(
        new win.InputEvent('input', {
          bubbles: true,
          composed: true,
          inputType: 'insertText',
          data: value
        })
      );
    } catch {
      el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    }
  } else {
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  }

  el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  el.dispatchEvent(new Event('blur', { bubbles: false }));
}

export function setNativeControlValue(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string
): void {
  if (isSubmitControl(el)) {
    throw new Error('Refusing to mutate a submit control.');
  }

  const tag = el.tagName.toLowerCase();
  const win = el.ownerDocument.defaultView;
  const proto =
    tag === 'textarea'
      ? win?.HTMLTextAreaElement?.prototype ?? HTMLTextAreaElement.prototype
      : tag === 'select'
        ? win?.HTMLSelectElement?.prototype ?? HTMLSelectElement.prototype
        : win?.HTMLInputElement?.prototype ?? HTMLInputElement.prototype;

  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  if (descriptor?.set) {
    descriptor.set.call(el, value);
  } else {
    el.value = value;
  }

  // Reset React 16+ internal value tracker so controlled components detect the change
  const tracker = (el as unknown as { _valueTracker?: { setValue: (v: string) => void } })
    ._valueTracker;
  if (tracker && typeof tracker.setValue === 'function') {
    tracker.setValue('');
  }

  dispatchControlEvents(el, value);
}

function normalizeMatchText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function matchBestCandidate<T>(
  candidates: Array<{ text: string; item: T }>,
  target: string
): { text: string; item: T } | null {
  const targetNorm = normalizeMatchText(target);
  if (!targetNorm) return null;

  // 1. Exact normalized equality
  for (const c of candidates) {
    if (normalizeMatchText(c.text) === targetNorm) return c;
  }

  // 2. Domain synonyms (Yes/No, India, Immediate notice, B.Tech/Bachelor)
  const yesSet = new Set(['yes', 'true', 'y', 'yeah', 'i am', 'willing']);
  const noSet = new Set(['no', 'false', 'n', 'not required', 'do not require']);
  if (yesSet.has(targetNorm)) {
    const hit = candidates.find((c) => /^yes\b/i.test(c.text.trim()));
    if (hit) return hit;
  }
  if (noSet.has(targetNorm)) {
    const hit = candidates.find((c) => /^no\b/i.test(c.text.trim()));
    if (hit) return hit;
  }
  if (targetNorm === 'in' || targetNorm === 'india') {
    const hit = candidates.find((c) => /\bindia\b/i.test(c.text));
    if (hit) return hit;
  }

  // 3. Contains / word overlap
  let best: { candidate: { text: string; item: T }; score: number } | null = null;
  const targetWords = targetNorm.split(' ').filter(Boolean);
  for (const c of candidates) {
    const cNorm = normalizeMatchText(c.text);
    if (!cNorm) continue;
    if (cNorm.includes(targetNorm) || targetNorm.includes(cNorm)) {
      return c;
    }
    const overlap = targetWords.filter((w) => cNorm.includes(w)).length;
    const score = overlap / Math.max(1, targetWords.length);
    if (score >= 0.6 && (!best || score > best.score)) {
      best = { candidate: c, score };
    }
  }
  return best?.candidate ?? null;
}

export function selectDropdownOption(
  selectEl: HTMLSelectElement,
  targetValue: string
): { ok: boolean; appliedValue?: string } {
  const candidates = Array.from(selectEl.options)
    .filter((o) => !o.disabled && o.value !== '')
    .map((o) => ({ text: `${o.text} ${o.value}`, label: o.text || o.value, item: o }));

  const exactByValue = Array.from(selectEl.options).find(
    (o) => !o.disabled && o.value.toLowerCase() === targetValue.trim().toLowerCase()
  );
  const chosen = exactByValue ?? matchBestCandidate(candidates, targetValue)?.item;
  if (!chosen) return { ok: false };

  setNativeControlValue(selectEl, chosen.value);
  return { ok: true, appliedValue: chosen.text || chosen.value };
}

export function selectCustomComboboxOption(
  raw: RawFormControl,
  targetValue: string
): { ok: boolean; appliedValue?: string } {
  const host = raw.element;
  if (isSubmitControl(host)) return { ok: false };

  // Open dropdown / focus input
  host.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
  host.click();

  const inputEl = raw.comboboxInput ?? (host.tagName.toLowerCase() === 'input' ? (host as HTMLInputElement) : null);
  if (inputEl) {
    setNativeControlValue(inputEl, targetValue);
  }

  const searchRoots: Array<Document | ShadowRoot> =
    raw.rootNode === raw.rootDocument ? [raw.rootDocument] : [raw.rootNode, raw.rootDocument];
  const optionCandidates: Array<{ text: string; item: HTMLElement }> = [];
  for (const root of searchRoots) {
    const opts = root.querySelectorAll(
      '[role="option"], .select__option, .Select-option, .select2-results__option, [data-option-value]'
    );
    for (const opt of opts) {
      if (isSubmitControl(opt)) continue;
      const text = (opt.textContent ?? opt.getAttribute('data-option-value') ?? '').trim();
      if (text) optionCandidates.push({ text, item: opt as HTMLElement });
    }
  }

  const matched = matchBestCandidate(optionCandidates, targetValue);
  if (matched) {
    matched.item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
    matched.item.click();
    return { ok: true, appliedValue: matched.text };
  }

  // Fallback for free-text comboboxes that accept Enter after typing
  if (inputEl) {
    inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return { ok: true, appliedValue: targetValue };
  }

  return { ok: false };
}

export function attachResumePdfFile(
  fileInput: HTMLInputElement,
  bytes: Uint8Array,
  filename: string
): { ok: boolean; error?: string } {
  const safeCopy = Uint8Array.from(bytes);
  const FileCtor = fileInput.ownerDocument.defaultView?.File ?? File;
  const DataTransferCtor = fileInput.ownerDocument.defaultView?.DataTransfer ?? DataTransfer;

  const file = new FileCtor([safeCopy], filename, { type: 'application/pdf' });
  const dt = new DataTransferCtor();
  dt.items.add(file);

  try {
    fileInput.files = dt.files;
  } catch {
    try {
      Object.defineProperty(fileInput, 'files', {
        configurable: true,
        value: dt.files
      });
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to assign file input'
      };
    }
  }

  dispatchControlEvents(fileInput, filename);
  return { ok: true };
}

export function executeFillPlan(
  controlsById: Map<string, RawFormControl>,
  planItems: FillPlanItem[],
  options: ExecuteFillOptions = {}
): ExecuteFillResult {
  const results: FillExecutionItemResult[] = [];
  const undoStack: UndoRecord[] = [];
  let filledCount = 0;
  let skippedAlreadyFilledCount = 0;

  for (const item of planItems) {
    const raw = controlsById.get(item.fieldId);
    if (!raw) {
      results.push({
        fieldId: item.fieldId,
        label: item.label,
        status: 'failed',
        confidence: item.confidence,
        error: 'Control no longer present in DOM'
      });
      continue;
    }

    // Safety invariant: NEVER overwrite user-filled or pre-filled fields
    if (isControlAlreadyFilled(raw)) {
      skippedAlreadyFilledCount++;
      results.push({
        fieldId: item.fieldId,
        label: item.label,
        status: 'skipped_already_filled',
        confidence: item.confidence
      });
      continue;
    }

    if (!item.included) {
      results.push({
        fieldId: item.fieldId,
        label: item.label,
        status: 'skipped_excluded',
        confidence: item.confidence
      });
      continue;
    }

    if (raw.controlType === 'file') {
      if (!options.resumeFile) {
        results.push({
          fieldId: item.fieldId,
          label: item.label,
          status: 'skipped_unmapped',
          confidence: item.confidence,
          error: 'No rendered PDF loaded for attachment'
        });
        continue;
      }
      const fileInput = raw.element as HTMLInputElement;
      const prevFiles = fileInput.files;
      const attachRes = attachResumePdfFile(
        fileInput,
        options.resumeFile.bytes,
        options.resumeFile.filename
      );
      if (attachRes.ok) {
        filledCount++;
        undoStack.push({
          restore: () => {
            try {
              const dt = new (fileInput.ownerDocument.defaultView?.DataTransfer ?? DataTransfer)();
              if (prevFiles) {
                for (const f of Array.from(prevFiles)) dt.items.add(f);
              }
              fileInput.files = dt.files;
            } catch {
              try {
                Object.defineProperty(fileInput, 'files', {
                  configurable: true,
                  value: prevFiles
                });
              } catch {
                // Ignore immutable fallback
              }
            }
            dispatchControlEvents(fileInput, '');
          }
        });
        results.push({
          fieldId: item.fieldId,
          label: item.label,
          status: 'filled',
          confidence: item.confidence,
          appliedValue: options.resumeFile.filename
        });
      } else {
        results.push({
          fieldId: item.fieldId,
          label: item.label,
          status: 'failed',
          confidence: item.confidence,
          error: attachRes.error
        });
      }
      continue;
    }

    if (!item.proposedValue.trim()) {
      results.push({
        fieldId: item.fieldId,
        label: item.label,
        status: 'skipped_unmapped',
        confidence: item.confidence
      });
      continue;
    }

    if (raw.controlType === 'radio') {
      const candidates = raw.radioElements.map((r) => ({
        text: `${r.closest('label')?.textContent ?? ''} ${r.getAttribute('aria-label') ?? ''} ${r.value}`,
        item: r
      }));
      const matched = matchBestCandidate(candidates, item.proposedValue);
      if (!matched) {
        results.push({
          fieldId: item.fieldId,
          label: item.label,
          status: 'failed',
          confidence: item.confidence,
          error: `No matching radio option for "${item.proposedValue}"`
        });
        continue;
      }
      const prevCheckedStates = raw.radioElements.map((r) => r.checked);
      matched.item.checked = true;
      matched.item.click();
      dispatchControlEvents(matched.item, matched.item.value);
      filledCount++;
      undoStack.push({
        restore: () => {
          raw.radioElements.forEach((r, idx) => {
            r.checked = prevCheckedStates[idx] ?? false;
          });
        }
      });
      results.push({
        fieldId: item.fieldId,
        label: item.label,
        status: 'filled',
        confidence: item.confidence,
        appliedValue: item.displayValue || matched.item.value
      });
      continue;
    }

    if (raw.controlType === 'checkbox') {
      const cb = raw.element as HTMLInputElement;
      const prevChecked = cb.checked;
      const shouldCheck = /^(true|yes|1|on|agree)$/i.test(item.proposedValue.trim());
      if (cb.checked !== shouldCheck) {
        cb.checked = shouldCheck;
        dispatchControlEvents(cb, shouldCheck ? 'true' : 'false');
      }
      filledCount++;
      undoStack.push({
        restore: () => {
          cb.checked = prevChecked;
          dispatchControlEvents(cb, String(prevChecked));
        }
      });
      results.push({
        fieldId: item.fieldId,
        label: item.label,
        status: 'filled',
        confidence: item.confidence,
        appliedValue: String(shouldCheck)
      });
      continue;
    }

    if (raw.controlType === 'select') {
      const sel = raw.element as HTMLSelectElement;
      const prevValue = sel.value;
      const selRes = selectDropdownOption(sel, item.proposedValue);
      if (!selRes.ok) {
        results.push({
          fieldId: item.fieldId,
          label: item.label,
          status: 'failed',
          confidence: item.confidence,
          error: `No option matched "${item.proposedValue}"`
        });
        continue;
      }
      filledCount++;
      undoStack.push({
        restore: () => setNativeControlValue(sel, prevValue)
      });
      results.push({
        fieldId: item.fieldId,
        label: item.label,
        status: 'filled',
        confidence: item.confidence,
        appliedValue: selRes.appliedValue
      });
      continue;
    }

    if (raw.controlType === 'combobox') {
      const prevValue = raw.comboboxInput?.value ?? '';
      const comboRes = selectCustomComboboxOption(raw, item.proposedValue);
      if (!comboRes.ok) {
        results.push({
          fieldId: item.fieldId,
          label: item.label,
          status: 'failed',
          confidence: item.confidence,
          error: `No combobox option matched "${item.proposedValue}"`
        });
        continue;
      }
      filledCount++;
      undoStack.push({
        restore: () => {
          if (raw.comboboxInput) setNativeControlValue(raw.comboboxInput, prevValue);
        }
      });
      results.push({
        fieldId: item.fieldId,
        label: item.label,
        status: 'filled',
        confidence: item.confidence,
        appliedValue: comboRes.appliedValue
      });
      continue;
    }

    // text, email, tel, url, number, textarea, date
    const input = raw.element as HTMLInputElement | HTMLTextAreaElement;
    const prevValue = input.value;
    setNativeControlValue(input, item.proposedValue);
    filledCount++;
    undoStack.push({
      restore: () => setNativeControlValue(input, prevValue)
    });
    results.push({
      fieldId: item.fieldId,
      label: item.label,
      status: 'filled',
      confidence: item.confidence,
      appliedValue: item.proposedValue
    });
  }

  return {
    results,
    filledCount,
    skippedAlreadyFilledCount,
    undo: () => {
      let restored = 0;
      while (undoStack.length > 0) {
        const op = undoStack.pop();
        if (op) {
          op.restore();
          restored++;
        }
      }
      return restored;
    }
  };
}

export function observeMultiStepForm(
  root: Element,
  onStructureChanged: () => void,
  debounceMs: number = 350
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const observer = new MutationObserver((mutations) => {
    const relevant = mutations.some((m) =>
      Array.from(m.addedNodes).some(
        (n) =>
          n.nodeType === 1 &&
          (n as Element).getAttribute?.('data-jobpilot-overlay') !== 'true' &&
          ((n as Element).matches?.('input, select, textarea, form, [role="combobox"]') ||
            Boolean((n as Element).querySelector?.('input, select, textarea, [role="combobox"]')))
      )
    );
    if (!relevant) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(onStructureChanged, debounceMs);
  });

  observer.observe(root, { childList: true, subtree: true });
  return () => {
    if (timer) clearTimeout(timer);
    observer.disconnect();
  };
}
