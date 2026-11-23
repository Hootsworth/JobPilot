'use client';

import React, { useEffect, useState } from 'react';
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
  SectionBlock,
  Select,
  SkeletonBlock
} from '@/components/ui/primitives';
import { api, getApiBaseUrl } from '@/lib/api';
import { getSupabaseClient } from '@/lib/supabase';

const PROVIDER_META: Record<
  LlmProviderId,
  { name: string; docsNote: string; defaultEndpoint: string }
> = {
  openai: {
    name: 'OpenAI (Official SDK)',
    docsNote: 'Uses official openai SDK with strict json_schema structured outputs.',
    defaultEndpoint: 'https://api.openai.com/v1'
  },
  gemini: {
    name: 'Google Gemini (Official SDK)',
    docsNote: 'Uses @google/genai with responseMimeType application/json and responseSchema.',
    defaultEndpoint: 'https://generativelanguage.googleapis.com'
  },
  meta: {
    name: 'Meta Llama API (OpenAI Compat)',
    docsNote:
      'Uses OpenAI SDK pointed at META_BASE_URL (/compat/v1/, NOT native /v1) with runtime capability detection.',
    defaultEndpoint: 'https://api.llama.com/compat/v1/'
  }
};

interface CardDraftState {
  apiKey: string;
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
  const [drafts, setDrafts] = useState<Record<LlmProviderId, CardDraftState>>({
    openai: { ...INITIAL_DRAFT },
    gemini: { ...INITIAL_DRAFT },
    meta: { ...INITIAL_DRAFT }
  });
  const [profile, setProfile] = useState<MasterProfile | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [globalSuccess, setGlobalSuccess] = useState<string | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [llmRes, prof] = await Promise.all([api.getLlmSettings(), api.getProfile()]);
      setItems(llmRes.items);
      setDefaultEnvProvider(llmRes.defaultEnvProvider);
      setProfile(prof);
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
          ? `Saved & activated ${PROVIDER_META[provider].name}.`
          : 'Configuration saved.'
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
        info: `Fetched ${res.models.length} live model(s) from ${provider}.`
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
      setGlobalSuccess(`Telemetry opt-in ${checked ? 'enabled' : 'disabled'}.`);
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
      setGlobalSuccess('Exported account archive.');
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
      setGlobalSuccess(
        'Copied Extension Session JSON to clipboard — paste inside the JobPilot Side Panel Connect tab.'
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
      router.replace('/login');
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Failed to delete account.');
    }
  };

  return (
    <AppShell
      title="AI Providers, Theme & Privacy"
      subtitle={`Switch seamlessly between OpenAI, Gemini, and Meta Llama API (default server provider: ${defaultEnvProvider}). Models are always fetched live — never hardcoded.`}
    >
      {globalError ? <AlertBanner tone="error" message={globalError} /> : null}
      {globalSuccess ? <AlertBanner tone="success" message={globalSuccess} /> : null}

      {loading ? (
        <div className="space-y-4">
          <SkeletonBlock className="h-44 w-full" />
          <SkeletonBlock className="h-44 w-full" />
        </div>
      ) : (
        <div className="space-y-8">
          <div className="space-y-5">
            {items.map((item) => {
              const meta = PROVIDER_META[item.provider];
              const d = drafts[item.provider];
              return (
                <SectionBlock
                  key={item.provider}
                  title={meta.name}
                  marker={item.isActive ? '[x]' : '[ ]'}
                  description={meta.docsNote}
                  action={
                    <div className="flex flex-wrap items-center gap-2">
                      {item.isActive ? (
                        <Badge tone="dark">ACTIVE PROVIDER</Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleSaveProvider(item.provider, true)}
                          disabled={d.saving}
                        >
                          Set Active
                        </Button>
                      )}
                      {item.hasKey ? (
                        <Badge tone="success">BYOK {item.keyHint}</Badge>
                      ) : item.usingEnvFallback ? (
                        <Badge tone="accent">ENV FALLBACK</Badge>
                      ) : (
                        <Badge tone="neutral">NO KEY</Badge>
                      )}
                    </div>
                  }
                >
                  <div className="space-y-4">
                    {d.error ? <AlertBanner tone="error" message={d.error} /> : null}
                    {d.info ? <AlertBanner tone="success" message={d.info} /> : null}
                    {d.testResult ? (
                      <AlertBanner
                        tone={d.testResult.ok ? 'success' : 'error'}
                        title={
                          d.testResult.ok
                            ? `Verified (${d.testResult.modelTested ?? 'model'}) in ${d.testResult.latencyMs} ms`
                            : 'Verification Failed'
                        }
                        message={
                          d.testResult.detectedCapabilities
                            ? `${d.testResult.message} · Detected mode: ${d.testResult.detectedCapabilities.structuredOutputMode}, token param: ${d.testResult.detectedCapabilities.tokenLimitParam}`
                            : d.testResult.message
                        }
                      />
                    ) : null}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Field
                        label="BYOK API Key"
                        htmlFor={`key-${item.provider}`}
                        hint={
                          item.hasKey
                            ? `Stored encrypted (${item.keyHint}). Enter a new key only to replace it.`
                            : 'Encrypted server-side with AES-256-GCM. Never logged.'
                        }
                      >
                        {(props) => (
                          <Input
                            {...props}
                            type="password"
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="none"
                            spellCheck={false}
                            value={d.apiKey}
                            onChange={(e) =>
                              updateDraft(item.provider, { apiKey: e.target.value })
                            }
                            placeholder={item.hasKey ? '•••••••••••• (leave blank to keep)' : 'Paste API key...'}
                          />
                        )}
                      </Field>

                      <Field
                        label="Selected Model (Live list)"
                        htmlFor={`model-${item.provider}`}
                        hint="Click 'Fetch Live Models' to populate available IDs from the provider."
                      >
                        {(props) =>
                          d.models.length > 0 ? (
                            <Select
                              {...props}
                              value={d.selectedModel}
                              onChange={(e) =>
                                updateDraft(item.provider, { selectedModel: e.target.value })
                              }
                            >
                              <option value="">-- Select live model --</option>
                              {d.models.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.displayName !== m.id ? `${m.displayName} (${m.id})` : m.id}
                                </option>
                              ))}
                            </Select>
                          ) : (
                            <Input
                              {...props}
                              autoCorrect="off"
                              autoCapitalize="none"
                              spellCheck={false}
                              value={d.selectedModel}
                              onChange={(e) =>
                                updateDraft(item.provider, { selectedModel: e.target.value })
                              }
                              placeholder="Click Fetch Live Models ->"
                            />
                          )
                        }
                      </Field>
                    </div>

                    {item.provider === 'meta' ? (
                      <Field
                        label="META_BASE_URL Override"
                        htmlFor="meta-base-url"
                        hint={`Defaults to ${meta.defaultEndpoint}. Must point to OpenAI-compatible /compat/v1/, not native /v1.`}
                      >
                        {(props) => (
                          <Input
                            {...props}
                            type="url"
                            autoCorrect="off"
                            autoCapitalize="none"
                            spellCheck={false}
                            value={d.baseUrlOverride}
                            onChange={(e) =>
                              updateDraft('meta', { baseUrlOverride: e.target.value })
                            }
                            placeholder="https://api.llama.com/compat/v1/"
                          />
                        )}
                      </Field>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => handleSaveProvider(item.provider, false)}
                        disabled={d.saving}
                      >
                        {d.saving ? 'Saving...' : 'Save Settings'}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleFetchModels(item.provider)}
                        disabled={d.loadingModels}
                      >
                        {d.loadingModels ? 'Fetching...' : 'Fetch Live Models'}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleTestKey(item.provider)}
                        disabled={d.testing}
                      >
                        {d.testing ? 'Testing...' : 'Test Key'}
                      </Button>
                      {item.hasKey ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleClearKey(item.provider)}
                          disabled={d.saving}
                        >
                          Clear Stored Key
                        </Button>
                      ) : null}
                      {item.lastTestedAt ? (
                        <span className="text-xs text-[var(--mute)] ml-auto">
                          Last tested: {new Date(item.lastTestedAt).toLocaleString()} (
                          {item.lastTestStatus})
                        </span>
                      ) : null}
                    </div>
                  </div>
                </SectionBlock>
              );
            })}
          </div>

          <SectionBlock
            title="Chrome Extension Connection"
            marker="[ext]"
            description="Connect the JobPilot MV3 Side Panel without re-entering credentials."
          >
            <div className="space-y-3 text-sm text-[var(--body)]">
              <p>
                API endpoint: <code className="text-[var(--ink)]">{getApiBaseUrl()}</code>
              </p>
              <p className="text-xs text-[var(--mute)]">
                The copied session JSON stays strictly inside local browser storage (
                <code>chrome.storage.local</code>) and expires automatically with your Supabase JWT.
              </p>
              <div className="pt-1">
                <Button variant="secondary" onClick={handleCopyExtensionSession}>
                  Copy Extension Session JSON
                </Button>
              </div>
            </div>
          </SectionBlock>

          <SectionBlock
            title="Appearance & Color Scheme"
            description="Follows system preference by default, or pin Light / Dark explicitly."
          >
            <ThemeSettingsControl />
          </SectionBlock>

          <SectionBlock
            title="Privacy, Export & Account Deletion"
            description="Your profile, resumes, and LLM logs remain private under Postgres RLS."
          >
            <div className="space-y-5">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={profile?.telemetryOptIn ?? false}
                  onChange={(e) => handleToggleTelemetry(e.target.checked)}
                  className="mt-1 w-4 h-4"
                />
                <span className="text-sm text-[var(--body)]">
                  <strong className="text-[var(--ink)]">Opt in to anonymous diagnostic telemetry</strong>{' '}
                  (off by default). Your own LLM token &amp; cost dashboard remains active either way.
                </span>
              </label>

              <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-[var(--hairline)]">
                <Button variant="secondary" onClick={handleExportData}>
                  Export All Data (.json)
                </Button>
                <Button variant="danger" onClick={() => setConfirmDeleteOpen(true)}>
                  Delete Account &amp; Data
                </Button>
              </div>
            </div>
          </SectionBlock>
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
