'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type {
  AiQualityMode,
  BillingSnapshot,
  LlmProviderId,
  LlmSettingsItem,
  MasterProfile,
  ModelInfo,
  TestLlmKeyResult
} from '@jobpilot/shared';
import { AppShell } from '@/components/layout/app-shell';
import { ThemeSettingsControl } from '@/components/theme-toggle';
import { moToast } from '@/components/ui/mo';
import {
  AlertBanner,
  Badge,
  Button,
  ConfirmDialog,
  Field,
  Input,
  Select,
  SkeletonBlock
} from '@/components/ui/primitives';
import { api, ApiError, getApiBaseUrl } from '@/lib/api';
import { getSupabaseClient, getSupabasePublishableKey } from '@/lib/supabase';

const PROVIDER_META: Record<
  LlmProviderId,
  {
    shortName: string;
    name: string;
    tagline: string;
    docsNote: string;
    defaultEndpoint: string;
    suggestedModelPlaceholder: string;
  }
> = {
  gemini: {
    shortName: 'Google Gemini',
    name: 'Google Gemini',
    tagline: 'Fast Gemini Flash and Pro models',
    docsNote: 'Connect your Google AI Studio key or use a configured server key.',
    defaultEndpoint: 'https://generativelanguage.googleapis.com',
    suggestedModelPlaceholder: 'e.g. gemini-2.5-flash'
  },
  openai: {
    shortName: 'OpenAI',
    name: 'OpenAI',
    tagline: 'GPT-4o and reasoning models',
    docsNote: 'Connect an OpenAI API key for structured generation and matching.',
    defaultEndpoint: 'https://api.openai.com/v1',
    suggestedModelPlaceholder: 'e.g. gpt-4o-mini'
  },
  meta: {
    shortName: 'Meta Llama',
    name: 'Meta Llama API',
    tagline: 'Llama models via Meta API',
    docsNote: 'Connect a Meta Llama API key and optional custom base URL.',
    defaultEndpoint: 'https://api.llama.com/compat/v1/',
    suggestedModelPlaceholder: 'e.g. Llama-4-Maverick-17B-128E-Instruct-FP8'
  }
};

const PROVIDER_ORDER: LlmProviderId[] = ['gemini', 'openai', 'meta'];

interface CardDraftState {
  apiKey: string;
  showKey: boolean;
  selectedModel: string;
  baseUrlOverride: string;
  models: ModelInfo[];
  loadingModels: boolean;
  testing: boolean;
  saving: boolean;
  testResult: TestLlmKeyResult | null;
  error: string | null;
  info: string | null;
}

const INITIAL_DRAFT: CardDraftState = {
  apiKey: '',
  showKey: false,
  selectedModel: '',
  baseUrlOverride: '',
  models: [],
  loadingModels: false,
  testing: false,
  saving: false,
  testResult: null,
  error: null,
  info: null
};

export default function SettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<LlmSettingsItem[]>([]);
  const [defaultEnvProvider, setDefaultEnvProvider] = useState<LlmProviderId>('gemini');
  const [focusedProvider, setFocusedProvider] = useState<LlmProviderId>('gemini');
  const [drafts, setDrafts] = useState<Record<LlmProviderId, CardDraftState>>({
    openai: { ...INITIAL_DRAFT },
    gemini: { ...INITIAL_DRAFT },
    meta: { ...INITIAL_DRAFT }
  });
  const [profile, setProfile] = useState<MasterProfile | null>(null);
  const [billing, setBilling] = useState<BillingSnapshot | null>(null);
  const [savingBillingPref, setSavingBillingPref] = useState(false);
  const [byokOpen, setByokOpen] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [globalSuccess, setGlobalSuccess] = useState<string | null>(null);
  const [copiedExt, setCopiedExt] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [llmRes, prof, billingSnap] = await Promise.all([
        api.getLlmSettings(),
        api.getProfile(),
        api.getBillingStatus().catch(() => null)
      ]);
      setItems(llmRes.items);
      setDefaultEnvProvider(llmRes.defaultEnvProvider);
      setProfile(prof);
      setBilling(billingSnap);
      if (billingSnap?.subscription.useByokOverride) {
        setByokOpen(true);
      }
      const activeItem = llmRes.items.find((i) => i.isActive);
      if (activeItem) {
        setFocusedProvider(activeItem.provider);
      }
      setDrafts((prev) => {
        const next = { ...prev };
        for (const item of llmRes.items) {
          next[item.provider] = {
            ...next[item.provider],
            selectedModel: item.selectedModel ?? '',
            baseUrlOverride: item.baseUrlOverride ?? ''
          };
        }
        return next;
      });
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Failed to load settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  const updateDraft = (provider: LlmProviderId, patch: Partial<CardDraftState>) => {
    setDrafts((prev) => ({
      ...prev,
      [provider]: { ...prev[provider], ...patch }
    }));
  };

  const refreshItemsOnly = async () => {
    const res = await api.getLlmSettings();
    setItems(res.items);
  };

  const activeItem = useMemo(
    () => items.find((i) => i.isActive) ?? items.find((i) => i.provider === defaultEnvProvider) ?? items[0],
    [items, defaultEnvProvider]
  );

  const currentItem = useMemo(
    () => items.find((i) => i.provider === focusedProvider) ?? items[0],
    [items, focusedProvider]
  );

  const handleSaveProvider = async (provider: LlmProviderId, activate: boolean = false) => {
    const d = drafts[provider];
    updateDraft(provider, { saving: true, error: null, info: null });
    try {
      await api.upsertLlmSetting(provider, {
        ...(activate ? { isActive: true } : {}),
        selectedModel: d.selectedModel.trim() || null,
        baseUrlOverride: d.baseUrlOverride.trim() || null,
        ...(d.apiKey.trim() ? { apiKey: d.apiKey.trim() } : {})
      });
      updateDraft(provider, {
        apiKey: '',
        info: activate
          ? `Saved & set ${PROVIDER_META[provider].shortName} as your active AI engine.`
          : `Saved ${PROVIDER_META[provider].shortName} configuration.`
      });
      await refreshItemsOnly();
    } catch (err) {
      updateDraft(provider, {
        error: err instanceof Error ? err.message : 'Failed to save provider config.'
      });
    } finally {
      updateDraft(provider, { saving: false });
    }
  };

  const handleFetchModels = async (provider: LlmProviderId) => {
    const d = drafts[provider];
    updateDraft(provider, { loadingModels: true, error: null, info: null });
    try {
      const res = await api.listProviderModels({
        provider,
        ...(d.apiKey.trim() ? { apiKey: d.apiKey.trim() } : {}),
        ...(d.baseUrlOverride.trim() ? { baseUrlOverride: d.baseUrlOverride.trim() } : {})
      });
      const firstId = res.models[0]?.id ?? '';
      updateDraft(provider, {
        models: res.models,
        selectedModel: d.selectedModel || firstId,
        info: `Loaded ${res.models.length} live model(s) from ${PROVIDER_META[provider].shortName}.`
      });
    } catch (err) {
      updateDraft(provider, {
        error: err instanceof Error ? err.message : 'Failed to fetch live models.'
      });
    } finally {
      updateDraft(provider, { loadingModels: false });
    }
  };

  const handleTestKey = async (provider: LlmProviderId) => {
    const d = drafts[provider];
    updateDraft(provider, { testing: true, error: null, info: null, testResult: null });
    try {
      const res = await api.testLlmKey({
        provider,
        ...(d.apiKey.trim() ? { apiKey: d.apiKey.trim() } : {}),
        ...(d.selectedModel.trim() ? { model: d.selectedModel.trim() } : {}),
        ...(d.baseUrlOverride.trim() ? { baseUrlOverride: d.baseUrlOverride.trim() } : {})
      });
      updateDraft(provider, { testResult: res });
      await refreshItemsOnly();
    } catch (err) {
      updateDraft(provider, {
        error: err instanceof Error ? err.message : 'Test key call failed.'
      });
    } finally {
      updateDraft(provider, { testing: false });
    }
  };

  const handleClearKey = async (provider: LlmProviderId) => {
    updateDraft(provider, { saving: true, error: null, info: null });
    try {
      await api.clearLlmKey(provider);
      updateDraft(provider, { apiKey: '', info: 'Removed stored BYOK key.' });
      await refreshItemsOnly();
    } catch (err) {
      updateDraft(provider, { error: err instanceof Error ? err.message : 'Failed to clear key.' });
    } finally {
      updateDraft(provider, { saving: false });
    }
  };

  const handleUpdateAiPreferences = async (patch: {
    aiModePreference?: AiQualityMode;
    useByokOverride?: boolean;
  }) => {
    setSavingBillingPref(true);
    setGlobalError(null);
    setGlobalSuccess(null);
    try {
      const updated = await api.updateBillingPreferences(patch);
      setBilling(updated);
      if (patch.useByokOverride) {
        setByokOpen(true);
      }
      setGlobalSuccess('Updated AI routing preferences.');
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setGlobalError(`${err.message} Visit Plans & Credits to upgrade.`);
      } else {
        setGlobalError(err instanceof Error ? err.message : 'Failed to update AI preferences.');
      }
    } finally {
      setSavingBillingPref(false);
    }
  };

  const handleToggleTelemetry = async (checked: boolean) => {
    if (!profile) return;
    setGlobalError(null);
    try {
      const updated = await api.updateProfile({ telemetryOptIn: checked });
      setProfile(updated);
      setGlobalSuccess(`Diagnostic telemetry ${checked ? 'enabled' : 'disabled'}.`);
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Failed to update privacy setting.');
    }
  };

  const handleExportData = async () => {
    setGlobalError(null);
    try {
      const payload = await api.exportAccount();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `jobpilot-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setGlobalSuccess('Exported full account archive (.json).');
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Export failed.');
    }
  };

  const handleCopyExtensionSession = async () => {
    setGlobalError(null);
    setGlobalSuccess(null);
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        setGlobalError('Supabase client is not configured.');
        return;
      }
      const { data } = await supabase.auth.getSession();
      const session = data.session;
      if (!session?.access_token) {
        setGlobalError('Sign in first before copying an extension session.');
        return;
      }
      const payload = {
        apiBaseUrl: getApiBaseUrl(),
        webBaseUrl: window.location.origin,
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || '',
        supabaseAnonKey: getSupabasePublishableKey() || '',
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
        email: session.user?.email ?? ''
      };
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setCopiedExt(true);
      setTimeout(() => setCopiedExt(false), 3000);
      setGlobalSuccess(
        'Copied Extension Session JSON to clipboard — paste inside the JobPilot Chrome Side Panel.'
      );
    } catch (err) {
      setGlobalError(
        err instanceof Error ? err.message : 'Unable to copy extension session to clipboard.'
      );
    }
  };

  const handleDeleteAccount = async () => {
    setConfirmDeleteOpen(false);
    try {
      await api.deleteAccount();
      const supabase = getSupabaseClient();
      await supabase?.auth.signOut();
      router.replace('/');
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Failed to delete account.');
    }
  };

  const focusedMeta = PROVIDER_META[focusedProvider];
  const focusedDraft = drafts[focusedProvider];

  return (
    <AppShell
      title="Settings"
      actions={
        <Link href="/usage">
          <Button variant="secondary" size="sm">
            Usage logs
          </Button>
        </Link>
      }
    >
      {globalError ? <AlertBanner tone="error" message={globalError} /> : null}
      {globalSuccess ? <AlertBanner tone="success" message={globalSuccess} /> : null}

      {loading ? (
        <div className="space-y-6">
          <SkeletonBlock className="h-24 w-full" />
          <SkeletonBlock className="h-80 w-full" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SkeletonBlock className="h-56 w-full" />
            <SkeletonBlock className="h-56 w-full" />
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* 1. Managed AI & Plan Summary */}
          <section className="border border-[var(--hairline)] bg-[var(--canvas)] p-5 sm:p-6 space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-[var(--hairline)]">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-[var(--ink)]">Managed AI &amp; Plan</h2>
                  {billing ? (
                    <Badge tone={billing.executionMode === 'byok' ? 'accent' : 'success'}>
                      {billing.executionMode === 'byok' ? 'Developer BYOK Active' : `${billing.plan.name} · ${billing.totalCreditsRemaining} cr`}
                    </Badge>
                  ) : null}
                </div>
                <p className="text-xs text-[var(--mute)]">
                  JobPilot includes managed Fast and Precision AI routing out of the box—no API key setup needed.
                </p>
              </div>
              <Link href="/billing">
                <Button variant="primary" size="sm">
                  Plans &amp; Credits -&gt;
                </Button>
              </Link>
            </div>

            {billing ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-[var(--ink)]">Default AI Quality Mode</p>
                  <div className="grid grid-cols-2 gap-2">
                    {(['fast', 'precision'] as AiQualityMode[]).map((mode) => {
                      const allowed = billing.entitlements.allowedAiModes.includes(mode);
                      const selected = billing.subscription.aiModePreference === mode;
                      return (
                        <button
                          key={mode}
                          type="button"
                          disabled={savingBillingPref || (!allowed && !billing.subscription.useByokOverride)}
                          onClick={() => void handleUpdateAiPreferences({ aiModePreference: mode })}
                          className={`p-3 text-left border rounded-[4px] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                            selected
                              ? 'border-[var(--ink)] bg-[var(--surface-soft)] font-semibold'
                              : 'border-[var(--hairline)] bg-[var(--canvas)] hover:border-[var(--hairline-strong)]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1 text-xs">
                            <span className="capitalize font-bold text-[var(--ink)]">{mode}</span>
                            {!allowed ? <Badge tone="neutral">Plus</Badge> : null}
                          </div>
                          <p className="text-[11px] text-[var(--mute)] mt-1">
                            {mode === 'fast'
                              ? 'Fast Gemini 2.5 Flash-Lite routing'
                              : 'Frontier Gemini 2.5 Pro routing'}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium text-[var(--ink)]">Execution Mode</p>
                  <label className="flex items-start gap-3 p-3 bg-[var(--surface-soft)] border border-[var(--hairline)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={billing.subscription.useByokOverride}
                      disabled={savingBillingPref}
                      onChange={(e) =>
                        void handleUpdateAiPreferences({ useByokOverride: e.target.checked })
                      }
                      className="mt-0.5 w-4 h-4 shrink-0"
                    />
                    <span className="text-xs text-[var(--body)] leading-relaxed">
                      <strong className="text-[var(--ink)] block">
                        Enable Developer BYOK Override
                      </strong>
                      Route AI calls through your own encrypted API key below (0 managed credits deducted; requires a saved key).
                    </span>
                  </label>
                </div>
              </div>
            ) : null}
          </section>

          {/* 2. Advanced: Developer BYOK Console */}
          <details
            id="byok"
            open={byokOpen}
            onToggle={(e) => setByokOpen((e.currentTarget as HTMLDetailsElement).open)}
            className="border border-[var(--hairline)] bg-[var(--canvas)]"
          >
            <summary className="px-5 py-4 cursor-pointer flex flex-wrap items-center justify-between gap-2 bg-[var(--surface-soft)] hover:bg-[var(--surface-card)]">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-[var(--ink)]">
                  Advanced: Developer BYOK Mode (OpenAI / Gemini / Meta Llama)
                </span>
                {activeItem?.hasKey ? (
                  <Badge tone="success">Key saved ({activeItem.keyHint})</Badge>
                ) : (
                  <Badge tone="neutral">Optional</Badge>
                )}
              </div>
              <span className="text-xs text-[var(--mute)]">
                {byokOpen ? 'Hide [-]' : 'Expand [+]'}
              </span>
            </summary>

            <div className="border-t border-[var(--hairline)]">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-[var(--hairline)] border-b border-[var(--hairline)]">
                <div className="p-4 bg-[var(--surface-soft)]">
                  <div className="text-[11px] uppercase tracking-wider text-[var(--mute)]">
                    Provider
                  </div>
                  <div className="text-sm font-bold text-[var(--ink)] mt-1">
                    {activeItem ? PROVIDER_META[activeItem.provider].shortName : defaultEnvProvider}
                  </div>
                </div>

                <div className="p-4 bg-[var(--surface-soft)]">
                  <div className="text-[11px] uppercase tracking-wider text-[var(--mute)]">
                    Model
                  </div>
                  <div className="text-sm font-bold text-[var(--ink)] truncate mt-1">
                    {activeItem?.selectedModel || 'Default'}
                  </div>
                </div>

                <div className="p-4 bg-[var(--surface-soft)]">
                  <div className="text-[11px] uppercase tracking-wider text-[var(--mute)]">
                    API Key
                  </div>
                  <div className="text-sm font-bold text-[var(--ink)] mt-1">
                    {activeItem?.hasKey
                      ? `Saved (${activeItem.keyHint})`
                      : activeItem?.usingEnvFallback
                        ? 'Server default'
                        : 'Not set'}
                  </div>
                </div>

                <div className="p-4 bg-[var(--surface-soft)]">
                  <div className="text-[11px] uppercase tracking-wider text-[var(--mute)]">
                    Security
                  </div>
                  <div className="text-sm font-bold text-[var(--ink)] mt-1">AES-256-GCM</div>
                </div>
              </div>

              <div
                role="tablist"
                aria-label="Select AI Provider to configure"
                className="grid grid-cols-1 md:grid-cols-3 gap-px bg-[var(--hairline)] border-b border-[var(--hairline)]"
              >
              {PROVIDER_ORDER.map((provId) => {
                const item = items.find((i) => i.provider === provId);
                const meta = PROVIDER_META[provId];
                const isFocused = focusedProvider === provId;
                const isActive = item?.isActive ?? false;

                return (
                  <button
                    key={provId}
                    type="button"
                    role="tab"
                    aria-selected={isFocused}
                    onClick={() => setFocusedProvider(provId)}
                    className={`p-4 text-left transition-colors cursor-pointer ${
                      isFocused
                        ? 'bg-[var(--canvas)] border-t-2 border-t-[var(--ink)]'
                        : 'bg-[var(--surface-soft)] hover:bg-[var(--surface-card)]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold text-[var(--ink)]">
                        {meta.shortName}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {isActive ? <Badge tone="dark">Active</Badge> : null}
                        {item?.hasKey ? (
                          <Badge tone="success">{item.keyHint}</Badge>
                        ) : item?.usingEnvFallback ? (
                          <Badge tone="accent">Default</Badge>
                        ) : (
                          <Badge tone="neutral">Not set</Badge>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-[var(--mute)] mt-1.5 truncate">
                      {item?.selectedModel || meta.tagline}
                    </p>
                  </button>
                );
              })}
            </div>

            {currentItem ? (
              <div className="p-5 sm:p-6 space-y-6">
                <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-[var(--hairline)]">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-bold text-[var(--ink)]">{focusedMeta.name}</h2>
                      {currentItem.isActive ? <Badge tone="dark">Active</Badge> : null}
                    </div>
                    <p className="text-xs text-[var(--mute)]">{focusedMeta.docsNote}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {!currentItem.isActive ? (
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => void handleSaveProvider(focusedProvider, true)}
                        disabled={focusedDraft.saving}
                      >
                        Set as active
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void handleTestKey(focusedProvider)}
                      disabled={focusedDraft.testing}
                    >
                      {focusedDraft.testing ? 'Testing...' : 'Test key'}
                    </Button>
                  </div>
                </div>

                {focusedDraft.error ? (
                  <AlertBanner tone="error" message={focusedDraft.error} />
                ) : null}
                {focusedDraft.info ? (
                  <AlertBanner tone="success" message={focusedDraft.info} />
                ) : null}
                {focusedDraft.testResult ? (
                  <AlertBanner
                    tone={focusedDraft.testResult.ok ? 'success' : 'error'}
                    title={
                      focusedDraft.testResult.ok
                        ? `Verified (${focusedDraft.testResult.modelTested ?? 'default'}) · ${focusedDraft.testResult.latencyMs} ms`
                        : 'Connection test failed'
                    }
                    message={focusedDraft.testResult.message}
                  />
                ) : null}

                {/* 2-Column Credentials & Model Form */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label
                        htmlFor={`key-${focusedProvider}`}
                        className="text-sm font-medium text-[var(--ink)]"
                      >
                        API Key
                      </label>
                      <span className="text-xs text-[var(--mute)]">
                        {currentItem.hasKey
                          ? `Saved: ${currentItem.keyHint}`
                          : currentItem.usingEnvFallback
                            ? 'Using server default'
                            : 'No key saved'}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--mute)]">
                      Stored encrypted on the server and never exposed in browser logs.
                    </p>
                    <div className="flex gap-2">
                      <Input
                        id={`key-${focusedProvider}`}
                        type={focusedDraft.showKey ? 'text' : 'password'}
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        value={focusedDraft.apiKey}
                        onChange={(e) =>
                          updateDraft(focusedProvider, { apiKey: e.target.value })
                        }
                        placeholder={
                          currentItem.hasKey
                            ? '•••••••••••• (leave blank to keep)'
                            : `Paste ${focusedMeta.shortName} API key...`
                        }
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          updateDraft(focusedProvider, { showKey: !focusedDraft.showKey })
                        }
                      >
                        {focusedDraft.showKey ? 'Hide' : 'Show'}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label
                        htmlFor={`model-${focusedProvider}`}
                        className="text-sm font-medium text-[var(--ink)]"
                      >
                        Model
                      </label>
                      <button
                        type="button"
                        onClick={() => void handleFetchModels(focusedProvider)}
                        disabled={focusedDraft.loadingModels}
                        className="text-xs font-medium text-[var(--accent-text)] hover:underline cursor-pointer disabled:opacity-50"
                      >
                        {focusedDraft.loadingModels
                          ? 'Loading models...'
                          : focusedDraft.models.length > 0
                            ? `Refresh list (${focusedDraft.models.length})`
                            : 'Fetch live models'}
                      </button>
                    </div>
                    <p className="text-xs text-[var(--mute)]">
                      Pick from available models or enter a model identifier directly.
                    </p>
                    {focusedDraft.models.length > 0 ? (
                      <Select
                        id={`model-${focusedProvider}`}
                        value={focusedDraft.selectedModel}
                        onChange={(e) =>
                          updateDraft(focusedProvider, { selectedModel: e.target.value })
                        }
                      >
                        <option value="">Use provider default</option>
                        {focusedDraft.models.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.displayName && m.displayName !== m.id
                              ? `${m.displayName} (${m.id})`
                              : m.id}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Input
                        id={`model-${focusedProvider}`}
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        value={focusedDraft.selectedModel}
                        onChange={(e) =>
                          updateDraft(focusedProvider, { selectedModel: e.target.value })
                        }
                        placeholder={focusedMeta.suggestedModelPlaceholder}
                      />
                    )}
                  </div>
                </div>

                {focusedProvider === 'meta' ? (
                  <div className="pt-2 border-t border-[var(--hairline)]">
                    <Field
                      label="Custom Base URL"
                      htmlFor="meta-base-url"
                      hint={`Defaults to ${focusedMeta.defaultEndpoint}`}
                    >
                      {(props) => (
                        <Input
                          {...props}
                          type="url"
                          autoCorrect="off"
                          autoCapitalize="none"
                          spellCheck={false}
                          value={focusedDraft.baseUrlOverride}
                          onChange={(e) =>
                            updateDraft('meta', { baseUrlOverride: e.target.value })
                          }
                          placeholder="https://api.llama.com/compat/v1/"
                        />
                      )}
                    </Field>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-[var(--hairline)]">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => void handleSaveProvider(focusedProvider, true)}
                      disabled={focusedDraft.saving}
                    >
                      {focusedDraft.saving
                        ? 'Saving...'
                        : currentItem.isActive
                          ? 'Save changes'
                          : 'Save & activate'}
                    </Button>
                    {!currentItem.isActive ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void handleSaveProvider(focusedProvider, false)}
                        disabled={focusedDraft.saving}
                      >
                        Save only
                      </Button>
                    ) : null}
                    {currentItem.hasKey ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void handleClearKey(focusedProvider)}
                        disabled={focusedDraft.saving}
                      >
                        Remove key
                      </Button>
                    ) : null}
                  </div>

                  <span className="text-xs text-[var(--mute)]">
                    {currentItem.lastTestedAt
                      ? `Last checked ${new Date(currentItem.lastTestedAt).toLocaleString()}`
                      : focusedMeta.defaultEndpoint}
                  </span>
                </div>
              </div>
            ) : null}
            </div>
          </details>

          {/* 3. Lower Equal-Height 2-Column Workspace Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
            {/* Left Column: Extension & Theme */}
            <div className="border border-[var(--hairline)] bg-[var(--canvas)] divide-y divide-[var(--hairline)] flex flex-col justify-between">
              <div className="p-5 sm:p-6 space-y-4">
                <div>
                  <h2 className="text-base font-bold text-[var(--ink)]">Chrome Extension</h2>
                  <p className="text-xs text-[var(--mute)] mt-0.5">
                    Sign in once here and the JobPilot extension connects automatically.
                  </p>
                </div>

                <div className="p-3 bg-[var(--surface-soft)] border border-[var(--hairline)] text-xs space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[var(--mute)]">API Endpoint</span>
                    <code className="font-bold text-[var(--ink)] truncate">{getApiBaseUrl()}</code>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[var(--mute)]">Browser Sync</span>
                    <span className="text-[var(--body)]">Automatic via web login</span>
                  </div>
                </div>

                <details className="text-xs">
                  <summary className="cursor-pointer text-[var(--mute)] hover:text-[var(--ink)] font-medium">
                    Manual pairing fallback
                  </summary>
                  <div className="mt-3 space-y-2">
                    <Button
                      variant={copiedExt ? 'primary' : 'secondary'}
                      size="sm"
                      onClick={() => void handleCopyExtensionSession()}
                    >
                      {copiedExt ? 'Copied Session JSON' : 'Copy Session JSON'}
                    </Button>
                    <p className="text-[var(--mute)]">
                      Only needed for isolated Chrome profiles not signed into this site.
                    </p>
                  </div>
                </details>
              </div>

              <div className="p-5 sm:p-6 space-y-3">
                <div>
                  <h2 className="text-base font-bold text-[var(--ink)]">Appearance</h2>
                  <p className="text-xs text-[var(--mute)] mt-0.5">
                    Match your system theme or lock Light or Dark mode.
                  </p>
                </div>
                <ThemeSettingsControl />
              </div>
            </div>

            {/* Right Column: Privacy, Data Portability & Danger Zone */}
            <div className="border border-[var(--hairline)] bg-[var(--canvas)] divide-y divide-[var(--hairline)] flex flex-col justify-between">
              <div className="p-5 sm:p-6 space-y-4">
                <div>
                  <h2 className="text-base font-bold text-[var(--ink)]">Privacy &amp; Data</h2>
                  <p className="text-xs text-[var(--mute)] mt-0.5">
                    Your profile, resumes, and application history belong to your account.
                  </p>
                </div>

                <label className="flex items-start gap-3 p-3 bg-[var(--surface-soft)] border border-[var(--hairline)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={profile?.telemetryOptIn ?? false}
                    onChange={(e) => void handleToggleTelemetry(e.target.checked)}
                    className="mt-0.5 w-4 h-4 shrink-0"
                  />
                  <span className="text-xs text-[var(--body)] leading-relaxed">
                    <strong className="text-[var(--ink)] block">
                      Share anonymous diagnostics
                    </strong>
                    Off by default. Your personal token and cost ledger remains visible either way.
                  </span>
                </label>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <span className="text-xs text-[var(--mute)]">
                    Download your complete account archive as JSON.
                  </span>
                  <Button variant="secondary" size="sm" onClick={() => void handleExportData()}>
                    Export data
                  </Button>
                </div>
              </div>

              <div className="p-5 sm:p-6 bg-[var(--danger-bg)]/40 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-bold text-[var(--danger-text)]">Delete Account</h2>
                    <p className="text-xs text-[var(--body)] mt-0.5">
                      Permanently remove your profile, resumes, keys, and applications.
                    </p>
                  </div>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => setConfirmDeleteOpen(true)}
                  >
                    Delete account
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* 4. Feedback & Support */}
          <section className="border border-[var(--hairline)] bg-[var(--canvas)] p-5 sm:p-6 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-base font-bold text-[var(--ink)]">Feedback &amp; Support</h2>
              <p className="text-xs text-[var(--mute)]">
                Report broken application forms, parsing issues, or request features.{' '}
                <Link href="/privacy" className="text-[var(--ink)] underline">
                  Privacy Policy
                </Link>{' '}
                ·{' '}
                <Link href="/terms" className="text-[var(--ink)] underline">
                  Terms of Service
                </Link>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <a
                href="https://github.com/Hootsworth/JobPilot/issues/new?labels=bug&title=%5BBug%5D+"
                target="_blank"
                rel="noreferrer"
              >
                <Button type="button" variant="secondary" size="sm">
                  Report a bug
                </Button>
              </a>
              <a
                href="https://github.com/Hootsworth/JobPilot/issues/new?labels=enhancement&title=%5BFeature%5D+"
                target="_blank"
                rel="noreferrer"
              >
                <Button type="button" variant="secondary" size="sm">
                  Request a feature
                </Button>
              </a>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  const info = {
                    app: 'jobpilot-web',
                    version: '0.1.0',
                    apiBaseUrl: getApiBaseUrl(),
                    activeProvider: activeItem?.provider ?? defaultEnvProvider,
                    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'
                  };
                  void navigator.clipboard?.writeText(JSON.stringify(info, null, 2));
                  moToast('Copied debug info');
                }}
              >
                Copy debug info
              </Button>
            </div>
          </section>
        </div>
      )}

      <ConfirmDialog
        open={confirmDeleteOpen}
        title="Permanently Delete Account?"
        description="This immediately removes your profile, uploaded resumes, stories, saved answers, encrypted BYOK keys, and usage history. This action cannot be undone."
        confirmLabel="Delete everything"
        destructive
        onConfirm={handleDeleteAccount}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </AppShell>
  );
}
