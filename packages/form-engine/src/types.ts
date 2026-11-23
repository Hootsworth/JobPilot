import type {
  AdapterTosRisk,
  AtsAdapterId,
  CanonicalFieldKey,
  CapturedJobMetadata,
  DetectedFormField,
  FieldControlType
} from '@jobpilot/shared';

export interface FieldClassificationHint {
  canonicalKey: CanonicalFieldKey;
  confidence: number;
  reason: string;
}

export interface RawFormControl {
  fieldId: string;
  controlType: FieldControlType;
  element: HTMLElement;
  /** Non-empty when controlType === 'radio' */
  radioElements: HTMLInputElement[];
  /** Combobox trigger or filter input element */
  comboboxInput?: HTMLInputElement | null;
  label: string;
  name: string;
  id: string;
  automationId: string;
  placeholder: string;
  autocomplete: string;
  inputType: string;
  required: boolean;
  currentValue: string;
  alreadyFilled: boolean;
  options: string[];
  selectorPath: string;
  framePath: string;
  inShadowDom: boolean;
  rootDocument: Document;
  rootNode: Document | ShadowRoot;
}

export type AdapterCategory = 'official_ats' | 'non_api_session' | 'fallback';

export interface AtsSiteAdapter {
  readonly id: AtsAdapterId;
  readonly displayName: string;
  readonly category: AdapterCategory;
  readonly defaultEnabled: boolean;
  readonly tosRiskLevel: AdapterTosRisk;
  readonly tosWarning: string;
  readonly hostOriginPatterns: readonly string[];
  readonly matchesHost: (url: URL) => boolean;
  extractJobMetadata: (doc: Document, url: URL) => CapturedJobMetadata;
  classifyOverride?: (raw: RawFormControl) => FieldClassificationHint | null;
}

export interface PageScanResult {
  adapterId: AtsAdapterId;
  disabledByUser: boolean;
  category: AdapterCategory;
  tosRiskLevel: AdapterTosRisk;
  tosWarning: string;
  jobMetadata: CapturedJobMetadata;
  fields: DetectedFormField[];
  controlsById: Map<string, RawFormControl>;
}
