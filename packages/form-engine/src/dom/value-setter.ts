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
  coverLetterFile?: {
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

function setNativeCheckedValue(el: HTMLInputElement, checked: boolean): void {
  if (isSubmitControl(el)) {
    throw new Error('Refusing to mutate a submit control.');
  }
  const win = el.ownerDocument.defaultView;
  const proto = win?.HTMLInputElement?.prototype ?? HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'checked');
  if (descriptor?.set) {
    descriptor.set.call(el, checked);
  } else {
    el.checked = checked;
  }

  const tracker = (el as unknown as { _valueTracker?: { setValue: (v: string) => void } })
    ._valueTracker;
  if (tracker && typeof tracker.setValue === 'function') {
    tracker.setValue(String(!checked));
  }
  dispatchControlEvents(el, checked ? el.value || 'true' : 'false');
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

const COMBOBOX_OPTION_SELECTOR =
  '[role="option"], .select__option, .Select-option, .select2-results__option, [data-option-value]';

function collectComboboxOptionCandidates(
  searchRoots: Array<Document | ShadowRoot>
): Array<{ text: string; item: HTMLElement }> {
  const optionCandidates: Array<{ text: string; item: HTMLElement }> = [];
  for (const root of searchRoots) {
    const opts = root.querySelectorAll(COMBOBOX_OPTION_SELECTOR);
    for (const opt of opts) {
      if (isSubmitControl(opt)) continue;
      const text = (opt.textContent ?? opt.getAttribute('data-option-value') ?? '').trim();
      if (text) optionCandidates.push({ text, item: opt as HTMLElement });
    }
  }
  return optionCandidates;
}

function openComboboxAndType(raw: RawFormControl, targetValue: string): {
  inputEl: HTMLInputElement | null;
  searchRoots: Array<Document | ShadowRoot>;
} {
  const host = raw.element;
  host.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
  host.click();

  const inputEl =
    raw.comboboxInput ?? (host.tagName.toLowerCase() === 'input' ? (host as HTMLInputElement) : null);
  if (inputEl) {
    setNativeControlValue(inputEl, targetValue);
  }

  const searchRoots: Array<Document | ShadowRoot> =
    raw.rootNode === raw.rootDocument ? [raw.rootDocument] : [raw.rootNode, raw.rootDocument];
  return { inputEl, searchRoots };
}

function commitComboboxSelection(
  inputEl: HTMLInputElement | null,
  optionCandidates: Array<{ text: string; item: HTMLElement }>,
  targetValue: string
): { ok: boolean; appliedValue?: string } {
  const matched = matchBestCandidate(optionCandidates, targetValue);
  if (matched) {
    matched.item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
    matched.item.click();
    return { ok: true, appliedValue: matched.text };
  }
  if (inputEl) {
    inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return { ok: true, appliedValue: targetValue };
  }
  return { ok: false };
}

export function selectCustomComboboxOption(
  raw: RawFormControl,
  targetValue: string
): { ok: boolean; appliedValue?: string } {
  if (isSubmitControl(raw.element)) return { ok: false };
  const { inputEl, searchRoots } = openComboboxAndType(raw, targetValue);
  const optionCandidates = collectComboboxOptionCandidates(searchRoots);
  return commitComboboxSelection(inputEl, optionCandidates, targetValue);
}

export async function selectCustomComboboxOptionAsync(
  raw: RawFormControl,
  targetValue: string,
  timeoutMs: number = 450
): Promise<{ ok: boolean; appliedValue?: string }> {
  if (isSubmitControl(raw.element)) return { ok: false };
  const { inputEl, searchRoots } = openComboboxAndType(raw, targetValue);

  let optionCandidates = collectComboboxOptionCandidates(searchRoots);
  if (matchBestCandidate(optionCandidates, targetValue)) {
    return commitComboboxSelection(inputEl, optionCandidates, targetValue);
  }

  await new Promise<void>((resolve) => {
    const observers: MutationObserver[] = [];
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const obs of observers) obs.disconnect();
      resolve();
    };
    const checkNow = () => {
      optionCandidates = collectComboboxOptionCandidates(searchRoots);
      if (matchBestCandidate(optionCandidates, targetValue) || optionCandidates.length > 0) {
        finish();
      }
    };
    for (const root of searchRoots) {
      const targetNode =
        root instanceof Document ? root.body ?? root.documentElement : root;
      if (!targetNode) continue;
      const obs = new MutationObserver(() => checkNow());
      obs.observe(targetNode, { childList: true, subtree: true });
      observers.push(obs);
    }
    const timer = setTimeout(finish, timeoutMs);
  });

  optionCandidates = collectComboboxOptionCandidates(searchRoots);
  return commitComboboxSelection(inputEl, optionCandidates, targetValue);
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

type ComboboxSetter = (
  raw: RawFormControl,
  targetValue: string
) => Promise<{ ok: boolean; appliedValue?: string }> | { ok: boolean; appliedValue?: string };

function executePreCheck(
  item: FillPlanItem,
  raw: RawFormControl | undefined
):
  | { skip: true; result: FillExecutionItemResult; kind: 'failed' | 'already_filled' | 'excluded' }
  | { skip: false; raw: RawFormControl } {
  if (!raw) {
    return {
      skip: true,
      kind: 'failed',
      result: {
        fieldId: item.fieldId,
        label: item.label,
        status: 'failed',
        confidence: item.confidence,
        error: 'Control no longer present in DOM'
      }
    };
  }
  // Safety invariant: NEVER overwrite user-filled or pre-filled fields
  if (isControlAlreadyFilled(raw)) {
    return {
      skip: true,
      kind: 'already_filled',
      result: {
        fieldId: item.fieldId,
        label: item.label,
        status: 'skipped_already_filled',
        confidence: item.confidence
      }
    };
  }
  if (!item.included) {
    return {
      skip: true,
      kind: 'excluded',
      result: {
        fieldId: item.fieldId,
        label: item.label,
        status: 'skipped_excluded',
        confidence: item.confidence
      }
    };
  }
  return { skip: false, raw };
}

function executeNonComboboxFill(
  item: FillPlanItem,
  raw: RawFormControl,
  options: ExecuteFillOptions,
  undoStack: UndoRecord[]
): { filled: boolean; result: FillExecutionItemResult } {
  if (raw.controlType === 'file') {
    const filePayload =
      item.canonicalKey === 'cover_letter' ? options.coverLetterFile : options.resumeFile;
    if (!filePayload) {
      return {
        filled: false,
        result: {
          fieldId: item.fieldId,
          label: item.label,
          status: 'skipped_unmapped',
          confidence: item.confidence,
          error:
            item.canonicalKey === 'cover_letter'
              ? 'No rendered cover letter PDF loaded for attachment'
              : 'No rendered PDF loaded for attachment'
        }
      };
    }
    const fileInput = raw.element as HTMLInputElement;
    const prevFiles = fileInput.files;
    const attachRes = attachResumePdfFile(fileInput, filePayload.bytes, filePayload.filename);
    if (attachRes.ok) {
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
      return {
        filled: true,
        result: {
          fieldId: item.fieldId,
          label: item.label,
          status: 'filled',
          confidence: item.confidence,
          appliedValue: filePayload.filename
        }
      };
    }
    return {
      filled: false,
      result: {
        fieldId: item.fieldId,
        label: item.label,
        status: 'failed',
        confidence: item.confidence,
        error: attachRes.error
      }
    };
  }

  if (!item.proposedValue.trim()) {
    return {
      filled: false,
      result: {
        fieldId: item.fieldId,
        label: item.label,
        status: 'skipped_unmapped',
        confidence: item.confidence
      }
    };
  }

  if (raw.controlType === 'radio') {
    const candidates = raw.radioElements.map((r) => ({
      text: `${r.closest('label')?.textContent ?? ''} ${r.getAttribute('aria-label') ?? ''} ${r.value}`,
      item: r
    }));
    const matched = matchBestCandidate(candidates, item.proposedValue);
    if (!matched) {
      return {
        filled: false,
        result: {
          fieldId: item.fieldId,
          label: item.label,
          status: 'failed',
          confidence: item.confidence,
          error: `No matching radio option for "${item.proposedValue}"`
        }
      };
    }
    const prevCheckedStates = raw.radioElements.map((r) => r.checked);
    setNativeCheckedValue(matched.item, true);
    undoStack.push({
      restore: () => {
        raw.radioElements.forEach((r, idx) => {
          setNativeCheckedValue(r, prevCheckedStates[idx] ?? false);
        });
      }
    });
    return {
      filled: true,
      result: {
        fieldId: item.fieldId,
        label: item.label,
        status: 'filled',
        confidence: item.confidence,
        appliedValue: item.displayValue || matched.item.value
      }
    };
  }

  if (raw.controlType === 'checkbox') {
    const cb = raw.element as HTMLInputElement;
    const prevChecked = cb.checked;
    const shouldCheck = /^(true|yes|1|on|agree)$/i.test(item.proposedValue.trim());
    if (cb.checked !== shouldCheck) {
      setNativeCheckedValue(cb, shouldCheck);
    }
    undoStack.push({
      restore: () => setNativeCheckedValue(cb, prevChecked)
    });
    return {
      filled: true,
      result: {
        fieldId: item.fieldId,
        label: item.label,
        status: 'filled',
        confidence: item.confidence,
        appliedValue: String(shouldCheck)
      }
    };
  }

  if (raw.controlType === 'select') {
    const sel = raw.element as HTMLSelectElement;
    const prevValue = sel.value;
    const selRes = selectDropdownOption(sel, item.proposedValue);
    if (!selRes.ok) {
      return {
        filled: false,
        result: {
          fieldId: item.fieldId,
          label: item.label,
          status: 'failed',
          confidence: item.confidence,
          error: `No option matched "${item.proposedValue}"`
        }
      };
    }
    undoStack.push({
      restore: () => setNativeControlValue(sel, prevValue)
    });
    return {
      filled: true,
      result: {
        fieldId: item.fieldId,
        label: item.label,
        status: 'filled',
        confidence: item.confidence,
        appliedValue: selRes.appliedValue
      }
    };
  }

  const input = raw.element as HTMLInputElement | HTMLTextAreaElement;
  const prevValue = input.value;
  setNativeControlValue(input, item.proposedValue);
  undoStack.push({
    restore: () => setNativeControlValue(input, prevValue)
  });
  return {
    filled: true,
    result: {
      fieldId: item.fieldId,
      label: item.label,
      status: 'filled',
      confidence: item.confidence,
      appliedValue: item.proposedValue
    }
  };
}

function buildUndoCallback(undoStack: UndoRecord[]): () => number {
  return () => {
    let restored = 0;
    while (undoStack.length > 0) {
      const op = undoStack.pop();
      if (op) {
        op.restore();
        restored++;
      }
    }
    return restored;
  };
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
    const pre = executePreCheck(item, controlsById.get(item.fieldId));
    if (pre.skip) {
      if (pre.kind === 'already_filled') skippedAlreadyFilledCount++;
      results.push(pre.result);
      continue;
    }

    if (pre.raw.controlType === 'combobox') {
      if (!item.proposedValue.trim()) {
        results.push({
          fieldId: item.fieldId,
          label: item.label,
          status: 'skipped_unmapped',
          confidence: item.confidence
        });
        continue;
      }
      const prevValue = pre.raw.comboboxInput?.value ?? '';
      const comboRes = selectCustomComboboxOption(pre.raw, item.proposedValue);
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
          if (pre.raw.comboboxInput) setNativeControlValue(pre.raw.comboboxInput, prevValue);
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

    const res = executeNonComboboxFill(item, pre.raw, options, undoStack);
    if (res.filled) filledCount++;
    results.push(res.result);
  }

  return {
    results,
    filledCount,
    skippedAlreadyFilledCount,
    undo: buildUndoCallback(undoStack)
  };
}

export async function executeFillPlanAsync(
  controlsById: Map<string, RawFormControl>,
  planItems: FillPlanItem[],
  options: ExecuteFillOptions = {},
  comboboxSetter: ComboboxSetter = selectCustomComboboxOptionAsync
): Promise<ExecuteFillResult> {
  const results: FillExecutionItemResult[] = [];
  const undoStack: UndoRecord[] = [];
  let filledCount = 0;
  let skippedAlreadyFilledCount = 0;

  for (const item of planItems) {
    const pre = executePreCheck(item, controlsById.get(item.fieldId));
    if (pre.skip) {
      if (pre.kind === 'already_filled') skippedAlreadyFilledCount++;
      results.push(pre.result);
      continue;
    }

    if (pre.raw.controlType === 'combobox') {
      if (!item.proposedValue.trim()) {
        results.push({
          fieldId: item.fieldId,
          label: item.label,
          status: 'skipped_unmapped',
          confidence: item.confidence
        });
        continue;
      }
      const prevValue = pre.raw.comboboxInput?.value ?? '';
      const comboRes = await comboboxSetter(pre.raw, item.proposedValue);
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
          if (pre.raw.comboboxInput) setNativeControlValue(pre.raw.comboboxInput, prevValue);
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

    const res = executeNonComboboxFill(item, pre.raw, options, undoStack);
    if (res.filled) filledCount++;
    results.push(res.result);
  }

  return {
    results,
    filledCount,
    skippedAlreadyFilledCount,
    undo: buildUndoCallback(undoStack)
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
