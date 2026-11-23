import type { AtsAdapterId, DetectedFormField } from '@jobpilot/shared';
import { collectRawFormControls } from '../dom/traverser.js';
import { classifyFormField } from '../mapping/field-classifier.js';
import type { AtsSiteAdapter, PageScanResult } from '../types.js';
import { AshbyAdapter } from './ashby.js';
import { buildGenericJobMetadata } from './base.js';
import { FounditAdapter } from './foundit.js';
import { GreenhouseAdapter } from './greenhouse.js';
import { InstahyreAdapter } from './instahyre.js';
import { InternshalaAdapter } from './internshala.js';
import { LeverAdapter } from './lever.js';
import { LinkedInAdapter } from './linkedin.js';
import { NaukriAdapter } from './naukri.js';
import { WellfoundAdapter } from './wellfound.js';
import { WorkdayAdapter } from './workday.js';

export const OFFICIAL_ATS_ADAPTERS: readonly AtsSiteAdapter[] = [
  GreenhouseAdapter,
  LeverAdapter,
  AshbyAdapter,
  WorkdayAdapter
];

export const NON_API_SESSION_ADAPTERS: readonly AtsSiteAdapter[] = [
  NaukriAdapter,
  FounditAdapter,
  InternshalaAdapter,
  InstahyreAdapter,
  WellfoundAdapter,
  LinkedInAdapter
];

export const ALL_SITE_ADAPTERS: readonly AtsSiteAdapter[] = [
  ...OFFICIAL_ATS_ADAPTERS,
  ...NON_API_SESSION_ADAPTERS
];

export const GenericFallbackAdapter: AtsSiteAdapter = {
  id: 'generic',
  displayName: 'Generic Form',
  category: 'fallback',
  defaultEnabled: true,
  tosRiskLevel: 'none',
  tosWarning: '',
  hostOriginPatterns: [],
  matchesHost: () => true,
  extractJobMetadata: (doc, url) => buildGenericJobMetadata(doc, url, 'generic')
};

export function getDefaultEnabledAdapterMap(): Record<
  Exclude<AtsAdapterId, 'generic'>,
  boolean
> {
  return {
    greenhouse: GreenhouseAdapter.defaultEnabled,
    lever: LeverAdapter.defaultEnabled,
    ashby: AshbyAdapter.defaultEnabled,
    workday: WorkdayAdapter.defaultEnabled,
    naukri: NaukriAdapter.defaultEnabled,
    foundit: FounditAdapter.defaultEnabled,
    internshala: InternshalaAdapter.defaultEnabled,
    instahyre: InstahyreAdapter.defaultEnabled,
    wellfound: WellfoundAdapter.defaultEnabled,
    linkedin: LinkedInAdapter.defaultEnabled
  };
}

export function getAdapterById(id: AtsAdapterId): AtsSiteAdapter {
  return ALL_SITE_ADAPTERS.find((a) => a.id === id) ?? GenericFallbackAdapter;
}

export function resolveAdapterForUrl(
  urlStr: string,
  enabledMap?: Partial<Record<AtsAdapterId, boolean>>
): { adapter: AtsSiteAdapter | null; detectedId: AtsAdapterId; disabledByUser: boolean } {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return { adapter: GenericFallbackAdapter, detectedId: 'generic', disabledByUser: false };
  }

  for (const adapter of ALL_SITE_ADAPTERS) {
    if (adapter.matchesHost(url)) {
      const enabled = enabledMap?.[adapter.id] ?? adapter.defaultEnabled;
      if (!enabled) {
        return { adapter: null, detectedId: adapter.id, disabledByUser: true };
      }
      return { adapter, detectedId: adapter.id, disabledByUser: false };
    }
  }

  return { adapter: GenericFallbackAdapter, detectedId: 'generic', disabledByUser: false };
}

export function scanDocumentWithAdapter(params: {
  doc: Document;
  url: string;
  enabledAdapters?: Partial<Record<AtsAdapterId, boolean>>;
}): PageScanResult {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(params.url);
  } catch {
    parsedUrl = new URL('https://example.invalid/');
  }

  const resolved = resolveAdapterForUrl(params.url, params.enabledAdapters);
  if (resolved.disabledByUser || !resolved.adapter) {
    const disabledMeta = getAdapterById(resolved.detectedId);
    return {
      adapterId: resolved.detectedId,
      disabledByUser: true,
      category: disabledMeta.category,
      tosRiskLevel: disabledMeta.tosRiskLevel,
      tosWarning: disabledMeta.tosWarning,
      jobMetadata: {
        atsAdapter: resolved.detectedId,
        sourceUrl: parsedUrl.href,
        title: params.doc.title || disabledMeta.displayName,
        companyName: parsedUrl.hostname
      },
      fields: [],
      controlsById: new Map()
    };
  }

  const activeAdapter = resolved.adapter;
  const rawControls = collectRawFormControls(params.doc);
  const controlsById = new Map(rawControls.map((c) => [c.fieldId, c]));

  const fields: DetectedFormField[] = rawControls.map((raw) => {
    const adapterHint = activeAdapter.classifyOverride?.(raw) ?? null;
    const hint = classifyFormField(raw, adapterHint);

    return {
      fieldId: raw.fieldId,
      atsAdapter: activeAdapter.id,
      controlType: raw.controlType,
      canonicalKey: hint.canonicalKey,
      label: raw.label,
      name: raw.name,
      id: raw.id,
      placeholder: raw.placeholder,
      required: raw.required,
      currentValue: raw.currentValue,
      alreadyFilled: raw.alreadyFilled,
      options: raw.options,
      selectorPath: raw.selectorPath,
      framePath: raw.framePath,
      inShadowDom: raw.inShadowDom,
      confidence: hint.confidence,
      matchReason: hint.reason
    };
  });

  return {
    adapterId: activeAdapter.id,
    disabledByUser: false,
    category: activeAdapter.category,
    tosRiskLevel: activeAdapter.tosRiskLevel,
    tosWarning: activeAdapter.tosWarning,
    jobMetadata: activeAdapter.extractJobMetadata(params.doc, parsedUrl),
    fields,
    controlsById
  };
}
