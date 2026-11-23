import type { FieldControlType } from '@jobpilot/shared';
import type { RawFormControl } from '../types.js';

const PLACEHOLDER_SELECT_RE =
  /^(?:select(?:\s+one|\s+an\s+option|\.\.\.)?|choose(?:\s+one)?|please\s+select|--+|none|\s*)$/i;

const SUBMIT_LABEL_RE = /^(?:submit|apply|send\s+application|finish\s+application)/i;

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function cleanLabelText(raw: string): string {
  return normalizeWhitespace(raw)
    .replace(/\s*\*+\s*$/, '')
    .replace(/\s*\(optional\)\s*$/i, '')
    .trim();
}

function getAutomationId(el: Element): string {
  return (
    el.getAttribute('data-automation-id') ||
    el.closest('[data-automation-id]')?.getAttribute('data-automation-id') ||
    ''
  );
}

export function isSubmitControl(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' && (el as HTMLInputElement).type.toLowerCase() === 'submit') return true;
  if (tag === 'button') {
    const type = ((el as HTMLButtonElement).getAttribute('type') ?? 'submit').toLowerCase();
    const label = normalizeWhitespace(el.textContent ?? '');
    if (type === 'submit' || SUBMIT_LABEL_RE.test(label)) return true;
  }
  return false;
}

export function isElementHidden(el: Element): boolean {
  if (el.getAttribute('aria-hidden') === 'true') return true;
  if ((el as HTMLElement).hidden) return true;

  const tag = el.tagName.toLowerCase();
  const type = tag === 'input' ? (el as HTMLInputElement).type.toLowerCase() : '';
  // Greenhouse, Lever & Ashby visually hide <input type="file"> behind custom dropzones
  if (type === 'file') return false;
  if (type === 'hidden') return true;

  const win = el.ownerDocument.defaultView;
  if (win && typeof win.getComputedStyle === 'function') {
    try {
      const style = win.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return true;
    } catch {
      // Ignore synthetic DOM style errors
    }
  }
  return false;
}

function getSelectorPath(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  let depth = 0;
  while (cur && cur.nodeType === 1 && depth < 5) {
    const tag = cur.tagName.toLowerCase();
    if (cur.id) {
      parts.unshift(`${tag}#${cur.id}`);
      break;
    }
    const name = cur.getAttribute('name');
    if (name) {
      parts.unshift(`${tag}[name="${name}"]`);
    } else {
      parts.unshift(tag);
    }
    cur = cur.parentElement;
    depth++;
  }
  return parts.join(' > ');
}

function findLabelByFor(root: Document | ShadowRoot, id: string): HTMLLabelElement | null {
  if (!id) return null;
  const labels = root.querySelectorAll('label[for]');
  for (const label of labels) {
    if ((label as HTMLLabelElement).htmlFor === id) {
      return label as HTMLLabelElement;
    }
  }
  return null;
}

function resolveLabelText(el: Element, rootNode: Document | ShadowRoot, doc: Document): string {
  const id = el.getAttribute('id') ?? '';
  if (id) {
    const explicit = findLabelByFor(rootNode, id) ?? findLabelByFor(doc, id);
    if (explicit?.textContent) {
      const cleaned = cleanLabelText(explicit.textContent);
      if (cleaned) return cleaned;
    }
  }

  const wrappingLabel = el.closest('label');
  if (wrappingLabel) {
    const clone = wrappingLabel.cloneNode(true) as Element;
    clone.querySelectorAll('input, select, textarea, button').forEach((n) => n.remove());
    const cleaned = cleanLabelText(clone.textContent ?? '');
    if (cleaned) return cleaned;
  }

  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((refId) => {
        const refEl =
          (rootNode as { getElementById?: (id: string) => Element | null }).getElementById?.(
            refId
          ) ??
          doc.getElementById(refId) ??
          rootNode.querySelector(`[id="${refId.replace(/"/g, '\\"')}"]`);
        return refEl?.textContent ?? '';
      })
      .join(' ');
    const cleaned = cleanLabelText(text);
    if (cleaned) return cleaned;
  }

  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) {
    const cleaned = cleanLabelText(ariaLabel);
    if (cleaned) return cleaned;
  }

  const container = el.closest(
    '.application-question, .field, .ashby-application-form-field-entry, .form-field, .form-group, fieldset, [data-field], [class*="question"], [class*="field"]'
  );
  if (container) {
    const legendOrLabel = container.querySelector(
      ':scope > legend, :scope > label, .application-label, [class*="question-text"], [class*="field-label"], .label, legend, label'
    );
    if (legendOrLabel && legendOrLabel !== el && !legendOrLabel.contains(el)) {
      const cleaned = cleanLabelText(legendOrLabel.textContent ?? '');
      if (cleaned) return cleaned;
    }
  }

  return cleanLabelText(
    el.getAttribute('placeholder') ||
      el.getAttribute('data-placeholder') ||
      el.getAttribute('name') ||
      id ||
      ''
  );
}

function getComboboxCurrentValue(el: Element): string {
  const singleVal = el.querySelector(
    '.select__single-value, .Select-value-label, [data-selected-label], [aria-selected="true"]'
  );
  if (singleVal?.textContent) {
    const text = normalizeWhitespace(singleVal.textContent);
    if (!PLACEHOLDER_SELECT_RE.test(text)) return text;
  }
  if (el.tagName.toLowerCase() === 'input') {
    return (el as HTMLInputElement).value.trim();
  }
  const innerInput = el.querySelector('input');
  if (innerInput && innerInput.value.trim()) {
    return innerInput.value.trim();
  }
  return '';
}

function getComboboxOptions(el: Element, rootNode: Document | ShadowRoot, doc: Document): string[] {
  const options = new Set<string>();
  const controlsId = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
  if (controlsId) {
    const listbox = rootNode.querySelector(`#${controlsId}`) ?? doc.getElementById(controlsId);
    if (listbox) {
      listbox.querySelectorAll('[role="option"], li, option').forEach((o) => {
        const text = normalizeWhitespace(o.textContent ?? '');
        if (text) options.add(text);
      });
    }
  }

  const container = el.closest('.field, .select-container, .ashby-application-form-field-entry, div');
  if (container) {
    container
      .querySelectorAll('[role="option"], .select__option, .Select-option, datalist option')
      .forEach((o) => {
        const text = normalizeWhitespace(o.textContent ?? (o as HTMLOptionElement).value ?? '');
        if (text) options.add(text);
      });
  }
  return Array.from(options);
}

export function isControlAlreadyFilled(raw: {
  controlType: FieldControlType;
  element: HTMLElement;
  radioElements?: HTMLInputElement[];
}): boolean {
  const { controlType, element, radioElements = [] } = raw;
  if (controlType === 'radio') {
    return radioElements.some((r) => r.checked);
  }
  if (controlType === 'checkbox') {
    return (element as HTMLInputElement).checked;
  }
  if (controlType === 'file') {
    const files = (element as HTMLInputElement).files;
    return Boolean(files && files.length > 0);
  }
  if (controlType === 'select') {
    const sel = element as HTMLSelectElement;
    if (sel.selectedIndex < 0) return false;
    const opt = sel.options[sel.selectedIndex];
    if (!opt) return false;
    if (!opt.value.trim()) return false;
    return !PLACEHOLDER_SELECT_RE.test(opt.text);
  }
  if (controlType === 'combobox') {
    return getComboboxCurrentValue(element).length > 0;
  }
  const val = (element as HTMLInputElement | HTMLTextAreaElement).value ?? '';
  return val.trim().length > 0;
}

function mapInputControlType(input: HTMLInputElement): FieldControlType {
  const role = input.getAttribute('role')?.toLowerCase();
  if (role === 'combobox' || input.getAttribute('aria-haspopup') === 'listbox') return 'combobox';
  const t = (input.type || 'text').toLowerCase();
  if (t === 'email') return 'email';
  if (t === 'tel') return 'tel';
  if (t === 'url') return 'url';
  if (t === 'number') return 'number';
  if (t === 'checkbox') return 'checkbox';
  if (t === 'radio') return 'radio';
  if (t === 'file') return 'file';
  if (t === 'date') return 'date';
  return 'text';
}

export function collectRawFormControls(rootDoc: Document): RawFormControl[] {
  const results: RawFormControl[] = [];
  const claimedElements = new WeakSet<Element>();
  const radioGroupsSeen = new Map<string, RawFormControl>();
  let seq = 0;

  const walkNode = (
    container: Document | ShadowRoot,
    doc: Document,
    framePath: string,
    inShadowDom: boolean
  ) => {
    const elements = container.querySelectorAll(
      'input, textarea, select, [role="combobox"], [aria-haspopup="listbox"], .select__control, .Select-control, iframe'
    );

    for (const el of elements) {
      if (el.getAttribute('data-jobpilot-overlay') === 'true') continue;
      if (el.closest('[data-jobpilot-overlay="true"]')) continue;

      const tag = el.tagName.toLowerCase();

      // Same-origin iframe traversal
      if (tag === 'iframe') {
        try {
          const childDoc = (el as HTMLIFrameElement).contentDocument;
          if (childDoc) {
            const idx = Array.from(container.querySelectorAll('iframe')).indexOf(
              el as HTMLIFrameElement
            );
            walkNode(childDoc, childDoc, `${framePath}/iframe[${idx}]`, inShadowDom);
          }
        } catch {
          // Cross-origin iframes are handled independently via manifest all_frames: true
        }
        continue;
      }

      if (claimedElements.has(el)) continue;
      if (isSubmitControl(el) || isElementHidden(el)) continue;
      if ((el as HTMLInputElement).disabled || (el as HTMLInputElement).readOnly) continue;

      // Custom combobox wrapper detection (React-Select, Ashby combobox, ARIA combobox)
      const isCustomCombobox =
        el.getAttribute('role') === 'combobox' ||
        el.getAttribute('aria-haspopup') === 'listbox' ||
        el.classList.contains('select__control') ||
        el.classList.contains('Select-control');

      if (isCustomCombobox) {
        const innerInput =
          el.tagName.toLowerCase() === 'input'
            ? (el as HTMLInputElement)
            : (el.querySelector('input') as HTMLInputElement | null);
        if (innerInput) claimedElements.add(innerInput);
        claimedElements.add(el);

        const fieldId = `jp-${++seq}-${el.id || innerInput?.name || 'combobox'}`;
        const label = resolveLabelText(innerInput ?? el, container, doc);
        const currentValue = getComboboxCurrentValue(el);
        const options = getComboboxOptions(el, container, doc);

        results.push({
          fieldId,
          controlType: 'combobox',
          element: el as HTMLElement,
          radioElements: [],
          comboboxInput: innerInput,
          label,
          name: innerInput?.name ?? el.getAttribute('name') ?? '',
          id: el.id || innerInput?.id || '',
          automationId: getAutomationId(el),
          placeholder:
            innerInput?.placeholder || el.getAttribute('data-placeholder') || el.getAttribute('placeholder') || '',
          autocomplete: innerInput?.autocomplete || el.getAttribute('autocomplete') || '',
          inputType: 'combobox',
          required:
            el.getAttribute('aria-required') === 'true' || Boolean(innerInput?.required),
          currentValue,
          alreadyFilled: currentValue.length > 0,
          options,
          selectorPath: getSelectorPath(el),
          framePath,
          inShadowDom,
          rootDocument: doc,
          rootNode: container
        });
        continue;
      }

      // Radio grouping by name or radiogroup container
      if (tag === 'input' && (el as HTMLInputElement).type.toLowerCase() === 'radio') {
        const radio = el as HTMLInputElement;
        const rg = radio.closest('[role="radiogroup"]');
        const groupKey = `${framePath}:${inShadowDom ? 'sd' : 'ld'}:${
          radio.name || rg?.id || resolveLabelText(rg ?? radio, container, doc) || `anon-${seq}`
        }`;

        const optionLabel = cleanLabelText(
          findLabelByFor(container, radio.id)?.textContent ??
            radio.closest('label')?.textContent ??
            radio.getAttribute('aria-label') ??
            radio.value
        );

        const existingGroup = radioGroupsSeen.get(groupKey);
        if (existingGroup) {
          existingGroup.radioElements.push(radio);
          if (optionLabel && !existingGroup.options.includes(optionLabel)) {
            existingGroup.options.push(optionLabel);
          }
          if (radio.checked) {
            existingGroup.alreadyFilled = true;
            existingGroup.currentValue = optionLabel || radio.value;
          }
          continue;
        }

        const groupContainer = rg ?? radio.closest('.field, fieldset, .application-question, [class*="field"]') ?? radio;
        const groupLabel = resolveLabelText(groupContainer === radio ? radio : groupContainer, container, doc);
        const fieldId = `jp-${++seq}-radio-${radio.name || seq}`;
        const groupRecord: RawFormControl = {
          fieldId,
          controlType: 'radio',
          element: (rg as HTMLElement) ?? radio,
          radioElements: [radio],
          label: groupLabel,
          name: radio.name,
          id: radio.id,
          automationId: getAutomationId(radio),
          placeholder: '',
          autocomplete: '',
          inputType: 'radio',
          required: radio.required,
          currentValue: radio.checked ? optionLabel || radio.value : '',
          alreadyFilled: radio.checked,
          options: optionLabel ? [optionLabel] : [],
          selectorPath: getSelectorPath(groupContainer),
          framePath,
          inShadowDom,
          rootDocument: doc,
          rootNode: container
        };
        radioGroupsSeen.set(groupKey, groupRecord);
        results.push(groupRecord);
        continue;
      }

      if (tag === 'input') {
        const input = el as HTMLInputElement;
        const controlType = mapInputControlType(input);
        const fieldId = `jp-${++seq}-${input.id || input.name || controlType}`;
        const label = resolveLabelText(input, container, doc);
        const currentValue =
          controlType === 'checkbox'
            ? input.checked
              ? 'true'
              : ''
            : controlType === 'file'
              ? input.files?.[0]?.name ?? ''
              : input.value;

        results.push({
          fieldId,
          controlType,
          element: input,
          radioElements: [],
          label,
          name: input.name,
          id: input.id,
          automationId: getAutomationId(input),
          placeholder: input.placeholder,
          autocomplete: input.autocomplete || '',
          inputType: input.type || 'text',
          required: input.required || input.getAttribute('aria-required') === 'true',
          currentValue,
          alreadyFilled: isControlAlreadyFilled({ controlType, element: input }),
          options: [],
          selectorPath: getSelectorPath(input),
          framePath,
          inShadowDom,
          rootDocument: doc,
          rootNode: container
        });
        continue;
      }

      if (tag === 'textarea') {
        const ta = el as HTMLTextAreaElement;
        const fieldId = `jp-${++seq}-${ta.id || ta.name || 'textarea'}`;
        results.push({
          fieldId,
          controlType: 'textarea',
          element: ta,
          radioElements: [],
          label: resolveLabelText(ta, container, doc),
          name: ta.name,
          id: ta.id,
          automationId: getAutomationId(ta),
          placeholder: ta.placeholder,
          autocomplete: ta.autocomplete || '',
          inputType: 'textarea',
          required: ta.required || ta.getAttribute('aria-required') === 'true',
          currentValue: ta.value,
          alreadyFilled: isControlAlreadyFilled({ controlType: 'textarea', element: ta }),
          options: [],
          selectorPath: getSelectorPath(ta),
          framePath,
          inShadowDom,
          rootDocument: doc,
          rootNode: container
        });
        continue;
      }

      if (tag === 'select') {
        const sel = el as HTMLSelectElement;
        const fieldId = `jp-${++seq}-${sel.id || sel.name || 'select'}`;
        const options = Array.from(sel.options)
          .map((o) => normalizeWhitespace(o.text || o.value))
          .filter((t) => t && !PLACEHOLDER_SELECT_RE.test(t));
        const selectedText =
          sel.selectedIndex >= 0 ? normalizeWhitespace(sel.options[sel.selectedIndex]?.text ?? '') : '';

        results.push({
          fieldId,
          controlType: 'select',
          element: sel,
          radioElements: [],
          label: resolveLabelText(sel, container, doc),
          name: sel.name,
          id: sel.id,
          automationId: getAutomationId(sel),
          placeholder: '',
          autocomplete: sel.autocomplete || '',
          inputType: 'select',
          required: sel.required || sel.getAttribute('aria-required') === 'true',
          currentValue: PLACEHOLDER_SELECT_RE.test(selectedText) ? '' : selectedText,
          alreadyFilled: isControlAlreadyFilled({ controlType: 'select', element: sel }),
          options,
          selectorPath: getSelectorPath(sel),
          framePath,
          inShadowDom,
          rootDocument: doc,
          rootNode: container
        });
      }
    }

    // Recurse into any open ShadowRoots hosted inside this container
    const allNodes = container.querySelectorAll('*');
    for (const host of allNodes) {
      if (host.getAttribute('data-jobpilot-overlay') === 'true') continue;
      if (host.shadowRoot) {
        walkNode(host.shadowRoot, doc, framePath, true);
      }
    }
  };

  walkNode(rootDoc, rootDoc, 'top', false);
  return results;
}
