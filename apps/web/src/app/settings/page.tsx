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
  Disclosure,
  Field,
  Input,
  SectionBlock,
  Select,
  SkeletonBlock,
  TabStrip
} from '@/components/ui/primitives';
import { api, ApiError, getApiBaseUrl } from '@/lib/api';
import { setCachedBillingSnapshot } from '@/lib/billing-cache';
import { getSupabaseClient, getSupabasePublishableKey } from '@/lib/supabase';

type SettingsSection = 'general' | 'ai' | 'privacy' | 'account';

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
    suggestedModelPlaceholder: 'e.g. gemini-3.5-flash-lite'
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
  const [section, setSection] = useState<SettingsSection>('general');
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

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hash === '#byok') {
      setSection('ai');
      setByokOpen(true);
    }
  }, []);

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
      if (billingSnap) {
        setCachedBillingSnapshot(billingSnap);
      }
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
    () =>
      items.find((i) => i.isActive) ??
      items.find((i) => i.provider === defaultEnvProvider) ??
      items[0],
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
      setCachedBillingSnapshot(updated);
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

  const sectionTabs: Array<{ id: SettingsSection; label: string; badge?: string }> = [
    { id: 'general', label: 'General' },
    {
      id: 'ai',
      label: 'AI & Models',
      badge: billing?.executionMode === 'byok' ? 'BYOK' : billing?.subscription.aiModePreference
    },
    { id: 'privacy', label: 'Privacy & Data' },
    { id: 'account', label: 'Account' }
  ];

  return (
    <AppShell
      title="Settings"
      subtitle="Manage appearance, AI routing preferences, browser pairing, and account data."
      actions={
        <Link href="/billing">
          <Button variant="secondary" size="sm">
            Plans &amp; Credits
          </Button>
        </Link>
      }
    >
      {globalError ? <AlertBanner tone="error" message={globalError} /> : null}
      {globalSuccess ? <AlertBanner tone="success" message={globalSuccess} /> : null}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6">
          <SkeletonBlock className="h-44 w-full" />
          <SkeletonBlock className="h-80 w-full" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6 items-start">
          {/* Categorized Navigation: Horizontal on Mobile, Vertical Sticky Sidebar on Desktop */}
          <div className="md:hidden">
            <TabStrip<SettingsSection>
              label="Settings categories"
              activeTab={section}
              onChange={setSection}
              tabs={sectionTabs}
            />
          </div>

          <aside className="hidden md:block md:sticky md:top-6">
            <TabStrip<SettingsSection>
              label="Settings categories"
              orientation="vertical"
              activeTab={section}
              onChange={setSection}
              tabs={sectionTabs}
            />
          </aside>

          {/* Focused Content Panel */}
          <div role="tabpanel" aria-label={`${section} settings`} className="space-y-6 min-w-0">
            {section === 'general' ? (
              <>
                <SectionBlock
                  title="Appearance"
                  description="Match your system theme or lock Light or Dark mode."
                >
                  <ThemeSettingsControl />
                </SectionBlock>

                <SectionBlock
                  title="Chrome Extension"
                  description="Sign in once here and the JobPilot extension connects automatically."
                >
                  <div className="space-y-4">
                    <div className="p-3 bg-[var(--surface-soft)] border border-[var(--hairline)] text-xs space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[var(--mute)]">API Endpoint</span>
                        <code className="font-bold text-[var(--ink)] truncate">
                          {getApiBaseUrl()}
                        </code>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[var(--mute)]">Browser Sync</span>
                        <span className="text-[var(--body)]">Automatic via web login</span>
                      </div>
                    </div>

                    <Disclosure title="Manual pairing fallback">
                      <div className="space-y-2 text-xs">
                        <p className="text-[var(--mute)]">
                          Only needed for isolated Chrome profiles not signed into this site.
                        </p>
                        <Button
                          variant={copiedExt ? 'primary' : 'secondary'}
                          size="sm"
                          onClick={() => void handleCopyExtensionSession()}
                        >
                          {copiedExt ? 'Copied Session JSON' : 'Copy Session JSON'}
                        </Button>
                      </div>
                    </Disclosure>
                  </div>
                </SectionBlock>

                <SectionBlock
                  title="Support & Legal"
                  description="Report broken application forms, parsing issues, or request features."
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
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
                            userAgent:
                              typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'
                          };
                          void navigator.clipboard?.writeText(JSON.stringify(info, null, 2));
                          moToast('Copied debug info');
                        }}
                      >
                        Copy debug info
                      </Button>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-[var(--mute)]">
                      <Link href="/privacy" className="text-[var(--ink)] underline">
                        Privacy Policy
                      </Link>
                      <span>·</span>
                      <Link href="/terms" className="text-[var(--ink)] underline">
                        Terms of Service
                      </Link>
                    </div>
                  </div>
                </SectionBlock>
              </>
            ) : null}

            {section === 'ai' ? (
              <>
                <SectionBlock
                  title="Managed AI Routing"
                  description="JobPilot includes managed Fast and Precision AI routing out of the box."
                  action={
                    billing ? (
                      <Badge tone={billing.executionMode === 'byok' ? 'accent' : 'success'}>
                        {billing.executionMode === 'byok'
                          ? 'Developer BYOK Active'
                          : `${billing.plan.name} · ${billing.totalCreditsRemaining} cr`}
                      </Badge>
                    ) : undefined
                  }
                >
                  {billing ? (
                    <div className="space-y-5">
                      <div className="space-y-2">
                        <p className="text-sm font-medium text-[var(--ink)]">
                          Default AI Quality Mode
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {(['fast', 'precision'] as AiQualityMode[]).map((mode) => {
                            const allowed = billing.entitlements.allowedAiModes.includes(mode);
                            const selected = billing.subscription.aiModePreference === mode;
                            return (
                              <button
                                key={mode}
                                type="button"
                                disabled={
                                  savingBillingPref ||
                                  (!allowed && !billing.subscription.useByokOverride)
                                }
                                onClick={() =>
                                  void handleUpdateAiPreferences({ aiModePreference: mode })
                                }
                                className={`p-3.5 text-left border rounded-[4px] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                                  selected
                                    ? 'border-[var(--ink)] bg-[var(--surface-soft)] font-semibold'
                                    : 'border-[var(--hairline)] bg-[var(--canvas)] hover:border-[var(--hairline-strong)]'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-1 text-xs">
                                  <span className="capitalize font-bold text-[var(--ink)]">
                                    {mode} Mode
                                  </span>
                                  {!allowed ? <Badge tone="neutral">Plus</Badge> : null}
                                </div>
                                <p className="text-[11px] text-[var(--mute)] mt-1">
                                  {mode === 'fast'
                                    ? 'Fast Gemini 3.5 Flash-Lite routing'
                                    : 'Precision Gemini 3.8 Flash routing'}
                                </p>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <label className="flex items-start gap-3 p-3.5 bg-[var(--surface-soft)] border border-[var(--hairline)] cursor-pointer">
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
                          Route AI calls through your own encrypted API key below (0 managed credits
                          deducted; requires a saved key).
                        </span>
                      </label>
                    </div>
                  ) : null}
                </SectionBlock>

                <Disclosure
                  id="byok"
                  title="Developer BYOK Keys (Gemini / OpenAI / Meta Llama)"
                  summaryMeta={
                    activeItem?.hasKey ? (
                      <Badge tone="success">Key saved ({activeItem.keyHint})</Badge>
                    ) : (
                      <Badge tone="neutral">Optional</Badge>
                    )
                  }
                  open={byokOpen}
                  onToggle={setByokOpen}
                >
                  <div className="space-y-5">
                    <div
                      role="tablist"
                      aria-label="Select AI Provider to configure"
                      className="grid grid-cols-1 md:grid-cols-3 gap-px bg-[var(--hairline)] border border-[var(--hairline)]"
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
                            className={`p-3.5 text-left transition-colors cursor-pointer ${
                              isFocused
                                ? 'bg-[var(--canvas)] border-t-2 border-t-[var(--ink)]'
                                : 'bg-[var(--surface-soft)] hover:bg-[var(--surface-card)]'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-bold text-[var(--ink)]">
                                {meta.shortName}
                              </span>
                              <div className="flex items-center gap-1">
                                {isActive ? <Badge tone="dark">Active</Badge> : null}
                                {item?.hasKey ? (
                                  <Badge tone="success">{item.keyHint}</Badge>
                                ) : (
                                  <Badge tone="neutral">Not set</Badge>
                                )}
                              </div>
                            </div>
                            <p className="text-[11px] text-[var(--mute)] mt-1 truncate">
                              {item?.selectedModel || meta.tagline}
                            </p>
                          </button>
                        );
                      })}
                    </div>

                    {currentItem ? (
                      <div className="space-y-5">
                        <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-[var(--hairline)]">
                          <div>
                            <h3 className="text-sm font-bold text-[var(--ink)]">
                              {focusedMeta.name}
                            </h3>
                            <p className="text-xs text-[var(--mute)] mt-0.5">
                              {focusedMeta.docsNote}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => void handleTestKey(focusedProvider)}
                            disabled={focusedDraft.testing}
                          >
                            {focusedDraft.testing ? 'Testing...' : 'Test connection'}
                          </Button>
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

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <label
                                htmlFor={`key-${focusedProvider}`}
                                className="text-sm font-medium text-[var(--ink)]"
                              >
                                API Key
                              </label>
                              <span className="text-xs text-[var(--mute)]">
                                {currentItem.hasKey ? `Saved: ${currentItem.keyHint}` : 'No key saved'}
                              </span>
                            </div>
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
                                  ? 'Loading...'
                                  : focusedDraft.models.length > 0
                                    ? `Refresh (${focusedDraft.models.length})`
                                    : 'Fetch models'}
                              </button>
                            </div>
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
                        ) : null}

                        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[var(--hairline)]">
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
                              : 'AES-256-GCM encrypted at rest'}
                          </span>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </Disclosure>
              </>
            ) : null}

            {section === 'privacy' ? (
              <SectionBlock
                title="Privacy & Data Portability"
                description="Your profile, tailored resumes, and application history belong to your account."
              >
                <div className="space-y-5">
                  <label className="flex items-start gap-3 p-3.5 bg-[var(--surface-soft)] border border-[var(--hairline)] cursor-pointer">
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
                      Off by default. Your personal usage logs and credit ledger remain visible
                      either way.
                    </span>
                  </label>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[var(--hairline)]">
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium text-[var(--ink)]">Export Account Data</p>
                      <p className="text-xs text-[var(--mute)]">
                        Download your complete profile, resumes, cover letters, and tracker history
                        as JSON.
                      </p>
                    </div>
                    <Button variant="secondary" size="sm" onClick={() => void handleExportData()}>
                      Export JSON
                    </Button>
                  </div>
                </div>
              </SectionBlock>
            ) : null}

            {section === 'account' ? (
              <>
                <SectionBlock
                  title="Subscription & Usage"
                  description="Review your active plan, credit balance, and AI call activity."
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <Link href="/billing">
                      <Button variant="secondary" size="sm">
                        Manage Plans &amp; Credits
                      </Button>
                    </Link>
                    <Link href="/usage">
                      <Button variant="secondary" size="sm">
                        View AI Usage Logs
                      </Button>
                    </Link>
                  </div>
                </SectionBlock>

                <section className="border border-[var(--danger-text)]/40 bg-[var(--danger-bg)]/40 p-5 flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="text-sm font-bold text-[var(--danger-text)]">Delete Account</h2>
                    <p className="text-xs text-[var(--body)] mt-1">
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
                </section>
              </>
            ) : null}
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
