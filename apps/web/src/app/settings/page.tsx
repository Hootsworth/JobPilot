'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type {
  LlmProviderId,
  LlmSettingsItem,
  MasterProfile,
  ModelInfo,
  TestLlmKeyResult
} from '@jobpilot/shared';
import { AppShell } from '@/components/layout/app-shell';
import { ThemeSettingsControl } from '@/components/theme-toggle';
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
import { api, getApiBaseUrl } from '@/lib/api';
import { getSupabaseClient } from '@/lib/supabase';

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
    name: 'Google Gemini (@google/genai)',
    tagline: 'Structured responseSchema + fast Flash/Pro inference',
    docsNote: 'Uses official @google/genai SDK with responseMimeType application/json and responseSchema.',
    defaultEndpoint: 'https://generativelanguage.googleapis.com',
    suggestedModelPlaceholder: 'e.g. gemini-2.5-flash'
  },
  openai: {
    shortName: 'OpenAI',
    name: 'OpenAI (Official SDK)',
    tagline: 'Strict json_schema structured outputs',
    docsNote: 'Uses official openai SDK with strict json_schema validation and automatic repair.',
    defaultEndpoint: 'https://api.openai.com/v1',
    suggestedModelPlaceholder: 'e.g. gpt-4o-mini'
  },
  meta: {
    shortName: 'Meta Llama API',
    name: 'Meta Llama API (OpenAI Compat)',
    tagline: 'OpenAI-compatible /compat/v1/ wire with live capability probing',
    docsNote:
      'Connects via OpenAI SDK pointed at META_BASE_URL (/compat/v1/) with runtime capability detection.',
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
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [globalSuccess, setGlobalSuccess] = useState<string | null>(null);
  const [copiedExt, setCopiedExt] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [llmRes, prof] = await Promise.all([api.getLlmSettings(), api.getProfile()]);
      setItems(llmRes.items);
      setDefaultEnvProvider(llmRes.defaultEnvProvider);
      setProfile(prof);
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
      title="Settings // AI Engine, Extension & Privacy"
      subtitle="Configure your active LLM provider (BYOK encrypted AES-256-GCM), pair the Chrome MV3 extension, and manage your data."
      actions={
        <Link href="/usage">
          <Button variant="secondary" size="sm">
            View Token &amp; Cost Logs -&gt;
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
        <div className="space-y-8">
          {/* 1. Active Engine Summary Bar */}
          <div className="grid grid-cols-2 lg:grid-cols-4 border border-[var(--hairline)] bg-[var(--surface-card)]">
            <div className="p-4 border-b lg:border-b-0 border-r border-[var(--hairline)]">
              <div className="text-[11px] uppercase tracking-wider text-[var(--mute)]">
                Active AI Provider
              </div>
              <div className="text-base font-bold text-[var(--ink)] mt-1">
                {activeItem ? PROVIDER_META[activeItem.provider].shortName : defaultEnvProvider}
              </div>
            </div>

            <div className="p-4 border-b lg:border-b-0 lg:border-r border-[var(--hairline)]">
              <div className="text-[11px] uppercase tracking-wider text-[var(--mute)]">
                Selected Model
              </div>
              <div className="text-base font-bold text-[var(--ink)] truncate mt-1">
                {activeItem?.selectedModel || 'Auto (Live Default)'}
              </div>
            </div>

            <div className="p-4 border-r border-[var(--hairline)]">
              <div className="text-[11px] uppercase tracking-wider text-[var(--mute)]">
                Credential Source
              </div>
              <div className="text-base font-bold text-[var(--ink)] mt-1">
                {activeItem?.hasKey
                  ? `BYOK (${activeItem.keyHint})`
                  : activeItem?.usingEnvFallback
                    ? 'Server Default Key'
                    : 'No Key Configured'}
              </div>
            </div>

            <div className="p-4">
              <div className="text-[11px] uppercase tracking-wider text-[var(--mute)]">
                Key Storage &amp; Wire
              </div>
              <div className="text-base font-bold text-[var(--ink)] mt-1">
                AES-256-GCM · RLS
              </div>
            </div>
          </div>

          {/* 2. AI Provider Console: 3-Column Selector + Focused Inspector */}
          <section className="border border-[var(--hairline)] bg-[var(--canvas)]">
            {/* Top 3-Column Provider Selector Tabs */}
            <div
              role="tablist"
              aria-label="Select AI Provider to configure"
              className="grid grid-cols-1 md:grid-cols-3 border-b border-[var(--hairline)] bg-[var(--surface-soft)]"
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
                    className={`p-4 text-left border-b md:border-b-0 md:border-r last:border-r-0 border-[var(--hairline)] transition-colors cursor-pointer ${
                      isFocused
                        ? 'bg-[var(--canvas)] border-t-2 border-t-[var(--ink)]'
                        : 'hover:bg-[var(--surface-card)] opacity-85'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold text-[var(--ink)]">
                        {isFocused ? '> ' : ''}
                        {meta.shortName}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {isActive ? <Badge tone="dark">ACTIVE</Badge> : null}
                        {item?.hasKey ? (
                          <Badge tone="success">BYOK {item.keyHint}</Badge>
                        ) : item?.usingEnvFallback ? (
                          <Badge tone="accent">ENV</Badge>
                        ) : (
                          <Badge tone="neutral">NO KEY</Badge>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-[var(--mute)] mt-1.5 truncate">
                      {item?.selectedModel
                        ? `Model: ${item.selectedModel}`
                        : meta.tagline}
                    </p>
                  </button>
                );
              })}
            </div>

            {/* Focused Provider Inspector Body */}
            {currentItem ? (
              <div className="p-5 sm:p-6 space-y-6">
                <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-[var(--hairline)]">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-bold text-[var(--ink)]">{focusedMeta.name}</h2>
                      {currentItem.isActive ? (
                        <Badge tone="dark">[*] CURRENTLY ACTIVE</Badge>
                      ) : null}
                    </div>
                    <p className="text-xs text-[var(--body)]">{focusedMeta.docsNote}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {!currentItem.isActive ? (
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => void handleSaveProvider(focusedProvider, true)}
                        disabled={focusedDraft.saving}
                      >
                        Set as Active Engine
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void handleTestKey(focusedProvider)}
                      disabled={focusedDraft.testing}
                    >
                      {focusedDraft.testing ? 'Testing Connection...' : 'Test Connection'}
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
                        ? `Connection Verified (${focusedDraft.testResult.modelTested ?? 'default'}) · ${focusedDraft.testResult.latencyMs} ms`
                        : 'Connection Test Failed'
                    }
                    message={
                      focusedDraft.testResult.detectedCapabilities
                        ? `${focusedDraft.testResult.message} · Mode: ${focusedDraft.testResult.detectedCapabilities.structuredOutputMode}`
                        : focusedDraft.testResult.message
                    }
                  />
                ) : null}

                {/* 2-Column Credentials & Model Form */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Left: API Key */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label
                        htmlFor={`key-${focusedProvider}`}
                        className="text-sm font-medium text-[var(--ink)]"
                      >
                        BYOK API Key
                      </label>
                      <span className="text-xs text-[var(--mute)]">
                        {currentItem.hasKey
                          ? `Stored: ${currentItem.keyHint}`
                          : currentItem.usingEnvFallback
                            ? 'Using server env key'
                            : 'No key stored'}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--mute)]">
                      Encrypted server-side with AES-256-GCM before storage. Never logged or exposed.
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
                            ? '•••••••••••• (leave blank to keep existing key)'
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

                  {/* Right: Live Model Picker */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label
                        htmlFor={`model-${focusedProvider}`}
                        className="text-sm font-medium text-[var(--ink)]"
                      >
                        Model ID
                      </label>
                      <button
                        type="button"
                        onClick={() => void handleFetchModels(focusedProvider)}
                        disabled={focusedDraft.loadingModels}
                        className="text-xs font-bold text-[var(--accent-text)] hover:underline cursor-pointer disabled:opacity-50"
                      >
                        {focusedDraft.loadingModels
                          ? '[Fetching live models...]'
                          : focusedDraft.models.length > 0
                            ? `[Refresh live list (${focusedDraft.models.length})]`
                            : '[Fetch live models from API ->]'}
                      </button>
                    </div>
                    <p className="text-xs text-[var(--mute)]">
                      Pick from the provider&apos;s live <code>/models</code> list or enter a model ID.
                    </p>
                    {focusedDraft.models.length > 0 ? (
                      <Select
                        id={`model-${focusedProvider}`}
                        value={focusedDraft.selectedModel}
                        onChange={(e) =>
                          updateDraft(focusedProvider, { selectedModel: e.target.value })
                        }
                      >
                        <option value="">-- Use provider default model --</option>
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

                {/* Meta Base URL Override */}
                {focusedProvider === 'meta' ? (
                  <div className="pt-2 border-t border-[var(--hairline)]">
                    <Field
                      label="META_BASE_URL Endpoint Override"
                      htmlFor="meta-base-url"
                      hint={`Defaults to ${focusedMeta.defaultEndpoint} (OpenAI-compatible wire).`}
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

                {/* Footer Action Bar */}
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
                          ? 'Save Configuration'
                          : 'Save & Set Active'}
                    </Button>
                    {!currentItem.isActive ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void handleSaveProvider(focusedProvider, false)}
                        disabled={focusedDraft.saving}
                      >
                        Save Without Activating
                      </Button>
                    ) : null}
                    {currentItem.hasKey ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void handleClearKey(focusedProvider)}
                        disabled={focusedDraft.saving}
                      >
                        Remove Stored Key
                      </Button>
                    ) : null}
                  </div>

                  <span className="text-xs text-[var(--mute)]">
                    {currentItem.lastTestedAt
                      ? `Last verified: ${new Date(currentItem.lastTestedAt).toLocaleString()} (${currentItem.lastTestStatus?.toUpperCase()})`
                      : `Default endpoint: ${focusedMeta.defaultEndpoint}`}
                  </span>
                </div>
              </div>
            ) : null}
          </section>

          {/* 3. Lower 2-Column Workspace Grid: Extension + Appearance vs Privacy + Danger Zone */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* Left Column: Chrome Extension & Theme */}
            <div className="border border-[var(--hairline)] bg-[var(--canvas)] divide-y divide-[var(--hairline)]">
              <div className="p-5 sm:p-6 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-bold text-[var(--ink)]">
                      [ext] Chrome MV3 Extension Pairing
                    </h2>
                    <p className="text-xs text-[var(--mute)] mt-0.5">
                      Connect the JobPilot Side Panel in one click to autofill ATS &amp; Indian job portals.
                    </p>
                  </div>
                  <Badge tone="neutral">MV3 Side Panel</Badge>
                </div>

                <div className="p-3 bg-[var(--surface-soft)] border border-[var(--hairline)] text-xs space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[var(--mute)]">API Endpoint</span>
                    <code className="font-bold text-[var(--ink)]">{getApiBaseUrl()}</code>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[var(--mute)]">Session Scope</span>
                    <span className="text-[var(--body)]">chrome.storage.local (auto-expires)</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant={copiedExt ? 'primary' : 'secondary'}
                    size="sm"
                    onClick={() => void handleCopyExtensionSession()}
                  >
                    {copiedExt
                      ? '[x] Copied Session JSON!'
                      : 'Copy Extension Session JSON'}
                  </Button>
                  <span className="text-xs text-[var(--mute)]">
                    Paste into the extension&apos;s <strong>Connect</strong> tab.
                  </span>
                </div>
              </div>

              <div className="p-5 sm:p-6 space-y-3">
                <div>
                  <h2 className="text-base font-bold text-[var(--ink)]">
                    [*] Appearance &amp; Color Scheme
                  </h2>
                  <p className="text-xs text-[var(--mute)] mt-0.5">
                    Follows your OS preference by default, or lock Light / Dark mode.
                  </p>
                </div>
                <ThemeSettingsControl />
              </div>
            </div>

            {/* Right Column: Privacy, Data Portability & Danger Zone */}
            <div className="border border-[var(--hairline)] bg-[var(--canvas)] divide-y divide-[var(--hairline)]">
              <div className="p-5 sm:p-6 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-bold text-[var(--ink)]">
                      [+] Privacy &amp; Data Portability
                    </h2>
                    <p className="text-xs text-[var(--mute)] mt-0.5">
                      Protected by Supabase Postgres Row-Level Security. Export your full archive anytime.
                    </p>
                  </div>
                  <Badge tone="success">RLS ACTIVE</Badge>
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
                      Allow anonymous diagnostic telemetry
                    </strong>
                    Off by default. Your personal token &amp; cost usage dashboard works regardless of this toggle.
                  </span>
                </label>

                <div className="flex items-center justify-between gap-3 pt-1">
                  <div className="text-xs text-[var(--mute)]">
                    Includes Master Profile, Stories, Answers, Tailored Resumes &amp; Tracker history.
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => void handleExportData()}>
                    Export JSON
                  </Button>
                </div>
              </div>

              {/* Danger Zone */}
              <div className="p-5 sm:p-6 bg-[var(--danger-bg)]/40 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-bold text-[var(--danger-text)] uppercase tracking-wider">
                      [!] Danger Zone — Delete Account
                    </h2>
                    <p className="text-xs text-[var(--body)] mt-0.5">
                      Permanently erases your profile, resumes, encrypted BYOK keys, and applications.
                    </p>
                  </div>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => setConfirmDeleteOpen(true)}
                  >
                    Delete Account
                  </Button>
                </div>
              </div>
            </div>
          </div>
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
