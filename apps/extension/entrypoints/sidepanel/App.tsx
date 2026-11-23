import React, { useCallback, useEffect, useState } from 'react';
import {
  buildFillPlan,
  getAdapterById,
  NON_API_SESSION_ADAPTERS,
  OFFICIAL_ATS_ADAPTERS,
  resolveAdapterForUrl
} from '@jobpilot/form-engine';
import type {
  AtsAdapterId,
  CaptureExtensionJobResponse,
  DraftAnswersResponse,
  FallbackFillResponse,
  FallbackFillSuggestion,
  FillExecutionItemResult,
  FillPlanItem
} from '@jobpilot/shared';
import { signInWithSupabasePassword, syncExtensionUserData } from '../../src/lib/api-client';
import type {
  ApiProxyResponse,
  ExecuteFillTabResponse,
  ExtensionMessage,
  PageScanPayload,
  UndoFillTabResponse
} from '../../src/lib/messaging';
import {
  DEFAULT_SETTINGS,
  getCachedUserData,
  getExtensionSession,
  getExtensionSettings,
  saveCachedUserData,
  saveExtensionSession,
  saveExtensionSettings,
  type AdapterEnabledMap,
  type CachedUserData,
  type ExtensionAuthSession,
  type ExtensionSettingsState
} from '../../src/lib/storage';

type SideTab = 'review' | 'connect' | 'adapters';

function confidenceLabel(conf: number, alreadyFilled: boolean): { text: string; cls: string } {
  if (alreadyFilled) return { text: 'KEPT', cls: 'jp-badge' };
  const pct = Math.round(conf * 100);
  if (pct >= 88) return { text: `${pct}% HIGH`, cls: 'jp-badge jp-badge-ok' };
  if (pct > 0) return { text: `${pct}% DRAFT`, cls: 'jp-badge jp-badge-warn' };
  return { text: 'SKIP', cls: 'jp-badge' };
}

export function App() {
  const [tab, setTab] = useState<SideTab>('review');
  const [settings, setSettings] = useState<ExtensionSettingsState>(DEFAULT_SETTINGS);
  const [session, setSession] = useState<ExtensionAuthSession | null>(null);
  const [cachedData, setCachedData] = useState<CachedUserData | null>(null);

  const [scan, setScan] = useState<PageScanPayload | null>(null);
  const [selectedResumeId, setSelectedResumeId] = useState<string>('');
  const [planItems, setPlanItems] = useState<FillPlanItem[]>([]);
  const [fallbackSuggestions, setFallbackSuggestions] = useState<FallbackFillSuggestion[]>([]);
  const [execResults, setExecResults] = useState<Map<string, FillExecutionItemResult>>(new Map());
  const [pendingPermissionAdapterId, setPendingPermissionAdapterId] = useState<AtsAdapterId | null>(null);

  const [scanning, setScanning] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [mappingFallback, setMappingFallback] = useState(false);
  const [filling, setFilling] = useState(false);
  const [savingJob, setSavingJob] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Connect form inputs
  const [sessionJsonText, setSessionJsonText] = useState('');
  const [apiUrlInput, setApiUrlInput] = useState(DEFAULT_SETTINGS.apiBaseUrl);
  const [sbUrlInput, setSbUrlInput] = useState('');
  const [sbAnonInput, setSbAnonInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');

  const recomputePlan = useCallback(
    (
      nextScan: PageScanPayload | null,
      data: CachedUserData | null,
      resumeId: string,
      prevDraftItems?: FillPlanItem[],
      nextFallbackSuggestions?: FallbackFillSuggestion[]
    ) => {
      if (!nextScan || !data) {
        setPlanItems([]);
        return;
      }
      const resumeVersion = data.resumeVersions.find((v) => v.id === resumeId) ?? null;
      const computed = buildFillPlan({
        fields: nextScan.fields,
        profile: data.profile,
        savedAnswers: data.savedAnswers,
        resumeVersion,
        fallbackSuggestions: nextFallbackSuggestions ?? fallbackSuggestions
      });

      const prevEditedMap = new Map(
        (prevDraftItems ?? [])
          .filter(
            (i) =>
              i.source === 'user_edited' ||
              i.source === 'llm_draft' ||
              i.source === 'llm_fallback'
          )
          .map((i) => [i.fieldId, i])
      );

      setPlanItems(
        computed.map((item) => {
          const prev = prevEditedMap.get(item.fieldId);
          if (prev && !item.alreadyFilled && prev.proposedValue.trim()) {
            return {
              ...item,
              proposedValue: prev.proposedValue,
              displayValue: prev.displayValue,
              source: prev.source,
              confidence: prev.confidence,
              included: prev.included
            };
          }
          return item;
        })
      );
    },
    [fallbackSuggestions]
  );

  const scanActiveTab = useCallback(
    async (
      dataOverride?: CachedUserData | null,
      resumeIdOverride?: string,
      settingsOverride?: ExtensionSettingsState
    ) => {
      setScanning(true);
      setErrorMsg(null);
      setPendingPermissionAdapterId(null);
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!activeTab?.id) {
          setScan(null);
          return;
        }

        let response: PageScanPayload | undefined;
        try {
          response = (await chrome.tabs.sendMessage(activeTab.id, {
            type: 'SCAN_PAGE'
          } satisfies ExtensionMessage)) as PageScanPayload | undefined;
        } catch {
          // Content script is not static on Workday / opt-in non-API portals; inject on demand if permitted
          const activeSettings = settingsOverride ?? (await getExtensionSettings());
          if (activeTab.url) {
            const resolved = resolveAdapterForUrl(activeTab.url, activeSettings.enabledAdapters);
            const meta = getAdapterById(resolved.detectedId);

            if (resolved.disabledByUser) {
              setScan({
                adapterId: resolved.detectedId,
                disabledByUser: true,
                tosRiskLevel: meta.tosRiskLevel,
                tosWarning: meta.tosWarning,
                url: activeTab.url,
                jobMetadata: {
                  atsAdapter: resolved.detectedId,
                  sourceUrl: activeTab.url,
                  title: activeTab.title || meta.displayName,
                  companyName: meta.displayName
                },
                fields: [],
                hasSubmitControl: false
              });
              setPlanItems([]);
              return;
            }

            if (resolved.adapter && meta.hostOriginPatterns.length > 0) {
              const hasHostAccess = await chrome.permissions.contains({
                origins: [...meta.hostOriginPatterns]
              });
              if (!hasHostAccess) {
                setPendingPermissionAdapterId(meta.id);
                setScan(null);
                setPlanItems([]);
                return;
              }
              await chrome.scripting.executeScript({
                target: { tabId: activeTab.id, allFrames: true },
                files: ['content-scripts/content.js']
              });
              response = (await chrome.tabs.sendMessage(activeTab.id, {
                type: 'SCAN_PAGE'
              } satisfies ExtensionMessage)) as PageScanPayload | undefined;
            }
          }
        }

        if (!response) {
          setScan(null);
          return;
        }
        setScan(response);
        setExecResults(new Map());
        setFallbackSuggestions([]);
        recomputePlan(
          response,
          dataOverride ?? cachedData,
          resumeIdOverride ?? selectedResumeId,
          [],
          []
        );
      } catch {
        setScan(null);
      } finally {
        setScanning(false);
      }
    },
    [cachedData, recomputePlan, selectedResumeId]
  );

  useEffect(() => {
    void (async () => {
      const [s, sess, data] = await Promise.all([
        getExtensionSettings(),
        getExtensionSession(),
        getCachedUserData()
      ]);
      setSettings(s);
      setApiUrlInput(s.apiBaseUrl);
      setSbUrlInput(s.supabaseUrl);
      setSbAnonInput(s.supabaseAnonKey);
      setSession(sess);
      setCachedData(data);
      const defaultResumeId = data?.resumeVersions[0]?.id ?? '';
      setSelectedResumeId(defaultResumeId);

      if (!sess) {
        setTab('connect');
      }
      await scanActiveTab(data, defaultResumeId);
    })();
  }, []);

  useEffect(() => {
    const listener = (message: ExtensionMessage) => {
      if (message?.type === 'PAGE_STRUCTURE_UPDATED') {
        void scanActiveTab();
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [scanActiveTab]);

  const handleSyncData = async () => {
    setSyncing(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const fresh = await syncExtensionUserData();
      setCachedData(fresh);
      const nextResumeId =
        fresh.resumeVersions.find((v) => v.id === selectedResumeId)?.id ??
        fresh.resumeVersions[0]?.id ??
        '';
      setSelectedResumeId(nextResumeId);
      recomputePlan(scan, fresh, nextResumeId);
      setStatusMsg(
        `Synced profile, ${fresh.savedAnswers.length} saved answer(s), and ${fresh.resumeVersions.length} resume version(s).`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Sync failed.');
    } finally {
      setSyncing(false);
    }
  };

  const handleResumeChange = (nextId: string) => {
    setSelectedResumeId(nextId);
    recomputePlan(scan, cachedData, nextId, planItems);
  };

  const handleSaveJobToTracker = async () => {
    if (!scan) return;
    setSavingJob(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const sourceType = scan.adapterId === 'generic' ? 'extension_capture' : scan.adapterId;

      const res = (await chrome.runtime.sendMessage({
        type: 'API_CAPTURE_JOB',
        payload: {
          sourceType,
          sourceUrl: scan.jobMetadata.sourceUrl,
          applyUrl: scan.jobMetadata.applyUrl,
          title: scan.jobMetadata.title,
          companyName: scan.jobMetadata.companyName,
          locationRaw: scan.jobMetadata.locationRaw,
          ...(scan.jobMetadata.salaryText ? { salaryText: scan.jobMetadata.salaryText } : {}),
          descriptionClean: scan.jobMetadata.descriptionClean,
          ...(selectedResumeId ? { resumeVersionId: selectedResumeId } : {})
        }
      } satisfies ExtensionMessage)) as ApiProxyResponse<CaptureExtensionJobResponse>;

      if (!res?.ok) {
        throw new Error(res?.error || 'Failed to save job to tracker');
      }
      setStatusMsg(
        `Saved "${scan.jobMetadata.title}" @ ${scan.jobMetadata.companyName} to Tracker${
          selectedResumeId ? ' with selected resume version' : ''
        }.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Capture failed.');
    } finally {
      setSavingJob(false);
    }
  };

  const handleDraftAiAnswers = async () => {
    if (!scan) return;
    const openQuestions = scan.fields
      .filter((f) => {
        const planItem = planItems.find((p) => p.fieldId === f.fieldId);
        return (
          !f.alreadyFilled &&
          f.controlType !== 'file' &&
          (f.canonicalKey === 'custom_question' ||
            f.canonicalKey === 'cover_letter' ||
            f.canonicalKey === 'unknown' ||
            !planItem?.proposedValue)
        );
      })
      .map((f) => ({
        fieldId: f.fieldId,
        label: f.label || f.placeholder || f.name || 'Application question',
        required: f.required,
        options: f.options.length > 0 ? f.options : undefined
      }));

    if (openQuestions.length === 0) {
      setStatusMsg('No open unmapped questions need AI drafting.');
      return;
    }

    setDrafting(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'API_DRAFT_ANSWERS',
        payload: {
          jobTitle: scan.jobMetadata.title,
          companyName: scan.jobMetadata.companyName,
          jobDescription: scan.jobMetadata.descriptionClean,
          questions: openQuestions
        }
      } satisfies ExtensionMessage)) as ApiProxyResponse<DraftAnswersResponse>;

      if (!res?.ok) throw new Error(res?.error || 'Failed to draft answers.');
      const draftMap = new Map(res.data.drafts.map((d) => [d.fieldId, d]));

      setPlanItems((prev) =>
        prev.map((item) => {
          const hit = draftMap.get(item.fieldId);
          if (!hit || !hit.answer.trim()) return item;
          return {
            ...item,
            proposedValue: hit.answer,
            displayValue: hit.answer,
            confidence: hit.confidence,
            source: hit.source === 'saved_answer' ? 'saved_answer' : 'llm_draft',
            included: !item.alreadyFilled,
            skipReason: hit.rationale
          };
        })
      );

      setStatusMsg(
        res.data.note ||
          `Drafted ${res.data.drafts.filter((d) => d.answer.trim()).length} answer(s) for review.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'AI draft request failed.');
    } finally {
      setDrafting(false);
    }
  };

  const handleExecuteFill = async () => {
    if (!scan) return;
    setFilling(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab?.id) throw new Error('No active browser tab.');

      const res = (await chrome.tabs.sendMessage(activeTab.id, {
        type: 'EXECUTE_FILL',
        planItems,
        resumeVersionId: selectedResumeId || null
      } satisfies ExtensionMessage)) as ExecuteFillTabResponse;

      if (!res?.ok) throw new Error(res?.error || 'Fill execution failed.');
      setExecResults(new Map(res.results.map((r) => [r.fieldId, r])));
      setStatusMsg(
        `Filled ${res.filledCount} field(s) (preserved ${res.skippedAlreadyFilledCount} pre-filled). Paused for your review — click Submit on the page when ready.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to fill form on this tab.');
    } finally {
      setFilling(false);
    }
  };

  const handleUndoFill = async () => {
    setErrorMsg(null);
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab?.id) return;
      const res = (await chrome.tabs.sendMessage(activeTab.id, {
        type: 'UNDO_FILL'
      } satisfies ExtensionMessage)) as UndoFillTabResponse;
      setStatusMsg(`Restored ${res.restoredCount} field(s) and cleared highlights.`);
      await scanActiveTab();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Undo failed.');
    }
  };

  const handleConnectWithSessionJson = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const parsed = JSON.parse(sessionJsonText) as {
        apiBaseUrl?: string;
        accessToken?: string;
        refreshToken?: string;
        email?: string;
      };
      if (!parsed.accessToken) throw new Error('Session JSON is missing accessToken.');

      const nextSettings = await saveExtensionSettings({
        apiBaseUrl: parsed.apiBaseUrl || apiUrlInput
      });
      setSettings(nextSettings);
      setApiUrlInput(nextSettings.apiBaseUrl);

      const newSess: ExtensionAuthSession = {
        accessToken: parsed.accessToken,
        refreshToken: parsed.refreshToken ?? '',
        email: parsed.email ?? 'Connected User'
      };
      await saveExtensionSession(newSess);
      setSession(newSess);
      setSessionJsonText('');

      const fresh = await syncExtensionUserData();
      setCachedData(fresh);
      const nextResId = fresh.resumeVersions[0]?.id ?? '';
      setSelectedResumeId(nextResId);
      setStatusMsg(`Connected and synced (${newSess.email}).`);
      setTab('review');
      await scanActiveTab(fresh, nextResId);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Invalid Session JSON.');
    }
  };

  const handlePasswordSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const nextSettings = await saveExtensionSettings({
        apiBaseUrl: apiUrlInput,
        supabaseUrl: sbUrlInput,
        supabaseAnonKey: sbAnonInput
      });
      setSettings(nextSettings);
      const newSess = await signInWithSupabasePassword({
        supabaseUrl: nextSettings.supabaseUrl,
        supabaseAnonKey: nextSettings.supabaseAnonKey,
        email: emailInput,
        password: passwordInput
      });
      setSession(newSess);
      setPasswordInput('');

      const fresh = await syncExtensionUserData();
      setCachedData(fresh);
      const nextResId = fresh.resumeVersions[0]?.id ?? '';
      setSelectedResumeId(nextResId);
      setStatusMsg(`Signed in and synced (${newSess.email}).`);
      setTab('review');
      await scanActiveTab(fresh, nextResId);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Sign-in failed.');
    }
  };

  const handleDisconnect = async () => {
    await Promise.all([saveExtensionSession(null), saveCachedUserData(null)]);
    setSession(null);
    setCachedData(null);
    setPlanItems([]);
    setFallbackSuggestions([]);
    setStatusMsg('Cleared stored extension session & local profile cache.');
  };

  const handleLlmFallbackMap = async () => {
    if (!scan) return;
    const unresolved = scan.fields.filter((f) => {
      const planItem = planItems.find((p) => p.fieldId === f.fieldId);
      return !f.alreadyFilled && f.controlType !== 'file' && !planItem?.proposedValue.trim();
    });
    if (unresolved.length === 0) {
      setStatusMsg('All non-pre-filled fields already have values.');
      return;
    }

    setMappingFallback(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'API_FALLBACK_FILL',
        payload: {
          atsAdapter: scan.adapterId,
          jobTitle: scan.jobMetadata.title,
          companyName: scan.jobMetadata.companyName,
          jobDescription: scan.jobMetadata.descriptionClean,
          fields: unresolved.slice(0, 30).map((f) => ({
            fieldId: f.fieldId,
            label: f.label || f.placeholder || f.name || 'Field',
            controlType: f.controlType,
            placeholder: f.placeholder || undefined,
            name: f.name || undefined,
            options: f.options.length > 0 ? f.options : undefined,
            required: f.required
          }))
        }
      } satisfies ExtensionMessage)) as ApiProxyResponse<FallbackFillResponse>;

      if (!res?.ok) throw new Error(res?.error || 'LLM fallback mapping failed.');

      const merged = [...fallbackSuggestions];
      for (const s of res.data.suggestions) {
        const idx = merged.findIndex((m) => m.fieldId === s.fieldId);
        if (idx >= 0) merged[idx] = s;
        else merged.push(s);
      }
      setFallbackSuggestions(merged);
      recomputePlan(scan, cachedData, selectedResumeId, planItems, merged);
      setStatusMsg(
        res.data.note ||
          `LLM fallback mapped ${res.data.suggestions.length} additional field(s) (confidence capped <= 85% for review).`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'LLM fallback mapping failed.');
    } finally {
      setMappingFallback(false);
    }
  };

  const handleGrantPendingPermission = () => {
    if (!pendingPermissionAdapterId) return;
    const meta = getAdapterById(pendingPermissionAdapterId);
    if (meta.hostOriginPatterns.length === 0) return;
    // Call chrome.permissions.request synchronously in click turn before awaiting (preserves user gesture)
    const reqPromise = chrome.permissions.request({ origins: [...meta.hostOriginPatterns] });
    void (async () => {
      try {
        const granted = await reqPromise;
        if (!granted) {
          setErrorMsg(`Host permission declined for ${meta.displayName}.`);
          return;
        }
        await scanActiveTab();
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Unable to request site permission.');
      }
    })();
  };

  const handleToggleAdapter = (adapterKey: keyof AdapterEnabledMap, enabled: boolean) => {
    const meta = getAdapterById(adapterKey);
    // Request optional host permission synchronously in user-gesture handler before awaiting
    const permPromise =
      enabled && meta.hostOriginPatterns.length > 0
        ? chrome.permissions.request({ origins: [...meta.hostOriginPatterns] })
        : null;

    void (async () => {
      setErrorMsg(null);
      if (permPromise) {
        try {
          const granted = await permPromise;
          if (!granted) {
            setErrorMsg(`Permission denied — ${meta.displayName} remains disabled.`);
            return;
          }
        } catch (err) {
          setErrorMsg(
            err instanceof Error ? err.message : `Failed requesting permission for ${meta.displayName}.`
          );
          return;
        }
      } else if (!enabled && meta.category === 'non_api_session' && meta.hostOriginPatterns.length > 0) {
        try {
          await chrome.permissions.remove({ origins: [...meta.hostOriginPatterns] });
        } catch {
          // Optional permission already absent
        }
      }

      const next = await saveExtensionSettings({
        enabledAdapters: {
          ...settings.enabledAdapters,
          [adapterKey]: enabled
        }
      });
      setSettings(next);
      setStatusMsg(`${meta.displayName} ${enabled ? 'enabled' : 'disabled'}.`);
      await scanActiveTab(cachedData, selectedResumeId, next);
    })();
  };

  const includedCount = planItems.filter((p) => p.included).length;
  const unresolvedCount = planItems.filter((p) => !p.alreadyFilled && p.controlType !== 'file' && !p.proposedValue.trim()).length;

  return (
    <div className="jp-shell">
      <header className="jp-header">
        <div className="jp-brand-row">
          <span className="jp-brand">[JP] JobPilot MV3</span>
          <span className={session ? 'jp-badge jp-badge-ok' : 'jp-badge jp-badge-warn'}>
            {session ? 'CONNECTED' : 'OFFLINE'}
          </span>
        </div>
        {scan ? (
          <div className="jp-row">
            <span className="jp-badge jp-badge-accent">{scan.adapterId.toUpperCase()}</span>
            <span className="jp-meta">
              {scan.jobMetadata.companyName} · {scan.jobMetadata.title}
            </span>
          </div>
        ) : (
          <div className="jp-meta">
            Open a Greenhouse, Lever, or Ashby application page to scan fields.
          </div>
        )}
      </header>

      <nav className="jp-tabs" role="tablist" aria-label="Extension views">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'review'}
          className="jp-tab"
          onClick={() => setTab('review')}
        >
          Review
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'connect'}
          className="jp-tab"
          onClick={() => setTab('connect')}
        >
          Connect
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'adapters'}
          className="jp-tab"
          onClick={() => setTab('adapters')}
        >
          Adapters
        </button>
      </nav>

      <main className="jp-main">
        {errorMsg ? <div className="jp-banner jp-banner-error" role="alert">[err] {errorMsg}</div> : null}
        {statusMsg ? <div className="jp-banner jp-banner-ok" role="status">[ok] {statusMsg}</div> : null}

        {tab === 'review' ? (
          <>
            <div className="jp-banner jp-banner-warn">
              <strong>[!] REVIEW REQUIRED:</strong> JobPilot fills checked fields only and NEVER clicks Submit automatically.
            </div>

            {!session || !cachedData ? (
              <div className="jp-panel">
                <div className="jp-label">Connect JobPilot Account</div>
                <p className="jp-meta">
                  Open the Connect tab to paste your Session JSON (from Web Settings) or sign in directly.
                </p>
                <button
                  type="button"
                  className="jp-btn jp-btn-primary"
                  onClick={() => setTab('connect')}
                >
                  Go to Connect -&gt;
                </button>
              </div>
            ) : pendingPermissionAdapterId ? (
              <div className="jp-panel">
                <div className="jp-label">
                  Host Permission Required ({getAdapterById(pendingPermissionAdapterId).displayName})
                </div>
                <p className="jp-meta">
                  Grant access to this domain so JobPilot can read the active job details and scan application inputs on click.
                </p>
                <button
                  type="button"
                  className="jp-btn jp-btn-primary"
                  onClick={handleGrantPendingPermission}
                >
                  Grant Site Permission &amp; Scan
                </button>
              </div>
            ) : !scan ? (
              <div className="jp-panel">
                <div className="jp-label">No Active Job / Application Form Detected</div>
                <p className="jp-meta">
                  Open Greenhouse, Lever, Ashby, Workday — or enable an opt-in portal in Adapters — then click Rescan.
                </p>
                <button
                  type="button"
                  className="jp-btn"
                  disabled={scanning}
                  onClick={() => void scanActiveTab()}
                >
                  {scanning ? 'Scanning...' : 'Rescan Active Tab'}
                </button>
              </div>
            ) : scan.disabledByUser ? (
              <div className="jp-panel">
                <div className="jp-label">Adapter Disabled ({getAdapterById(scan.adapterId).displayName})</div>
                {scan.tosWarning ? (
                  <div className="jp-banner jp-banner-warn">{scan.tosWarning}</div>
                ) : null}
                <p className="jp-meta">
                  Turn this adapter on in the Adapters tab to enable &ldquo;Save this job&rdquo; and user-initiated autofill on this site.
                </p>
                <button
                  type="button"
                  className="jp-btn jp-btn-primary"
                  onClick={() => setTab('adapters')}
                >
                  Open Adapters Settings -&gt;
                </button>
              </div>
            ) : (
              <>
                {scan.tosRiskLevel !== 'none' && scan.tosWarning ? (
                  <div className="jp-banner jp-banner-warn">
                    <strong>[{scan.tosRiskLevel.toUpperCase()} ToS NOTICE]</strong> {scan.tosWarning}
                  </div>
                ) : null}

                {/* Save This Job card (works on job detail pages even before an Apply form opens) */}
                <section className="jp-panel" aria-label="Save captured job">
                  <div className="jp-field-top">
                    <div>
                      <div className="jp-label">{scan.jobMetadata.title}</div>
                      <div className="jp-meta">
                        {scan.jobMetadata.companyName}
                        {scan.jobMetadata.locationRaw ? ` · ${scan.jobMetadata.locationRaw}` : ''}
                        {scan.jobMetadata.salaryText ? ` · ${scan.jobMetadata.salaryText}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="jp-btn"
                      disabled={savingJob}
                      onClick={() => void handleSaveJobToTracker()}
                    >
                      {savingJob ? 'Saving...' : '[+] Save this job'}
                    </button>
                  </div>
                </section>

                <section className="jp-panel" aria-label="Tailored resume and actions">
                  <div className="jp-row" style={{ justifyContent: 'space-between' }}>
                    <span className="jp-label">
                      Tailored Resume Version ({cachedData.resumeVersions.length})
                    </span>
                    <span className="jp-meta">{scan.fields.length} field(s) detected</span>
                  </div>

                  <select
                    className="jp-select"
                    aria-label="Tailored resume version"
                    value={selectedResumeId}
                    onChange={(e) => handleResumeChange(e.target.value)}
                  >
                    <option value="">Profile details only (no PDF file upload)</option>
                    {cachedData.resumeVersions.map((ver) => (
                      <option key={ver.id} value={ver.id}>
                        v{ver.versionNumber} · {ver.label} (
                        {ver.verifierPassed ? 'VERIFIED' : 'FLAGGED'})
                      </option>
                    ))}
                  </select>

                  <div className="jp-row">
                    <button
                      type="button"
                      className="jp-btn"
                      disabled={scanning}
                      onClick={() => void scanActiveTab()}
                    >
                      {scanning ? 'Scanning...' : 'Rescan'}
                    </button>
                    <button
                      type="button"
                      className="jp-btn"
                      disabled={drafting || scan.fields.length === 0}
                      onClick={() => void handleDraftAiAnswers()}
                    >
                      {drafting ? 'Drafting...' : 'Draft Free-Text'}
                    </button>
                    <button
                      type="button"
                      className="jp-btn"
                      disabled={mappingFallback || unresolvedCount === 0}
                      onClick={() => void handleLlmFallbackMap()}
                    >
                      {mappingFallback ? 'Mapping...' : `LLM Fallback (${unresolvedCount})`}
                    </button>
                    <button
                      type="button"
                      className="jp-btn jp-btn-primary"
                      disabled={filling || includedCount === 0}
                      onClick={() => void handleExecuteFill()}
                    >
                      {filling ? 'Filling...' : `Fill Checked (${includedCount})`}
                    </button>
                    <button
                      type="button"
                      className="jp-btn"
                      disabled={scan.fields.length === 0}
                      onClick={() => void handleUndoFill()}
                    >
                      Undo
                    </button>
                  </div>
                </section>

                <section className="jp-field-list" aria-label="Detected form fields">
                  {planItems.map((item) => {
                    const conf = confidenceLabel(item.confidence, item.alreadyFilled);
                    const result = execResults.get(item.fieldId);
                    return (
                      <div key={item.fieldId} className="jp-field-card">
                        <div className="jp-field-top">
                          <label className="jp-row" style={{ cursor: item.alreadyFilled ? 'not-allowed' : 'pointer' }}>
                            <input
                              type="checkbox"
                              disabled={item.alreadyFilled}
                              checked={item.included}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setPlanItems((prev) =>
                                  prev.map((p) =>
                                    p.fieldId === item.fieldId ? { ...p, included: checked } : p
                                  )
                                );
                              }}
                            />
                            <span className="jp-label">{item.label}</span>
                          </label>
                          <span className={conf.cls}>{conf.text}</span>
                        </div>

                        <div className="jp-row">
                          <span className="jp-badge">{item.canonicalKey}</span>
                          <span className="jp-meta">{item.source}</span>
                          {result ? (
                            <span
                              className={
                                result.status === 'filled'
                                  ? 'jp-badge jp-badge-ok'
                                  : result.status === 'failed'
                                    ? 'jp-badge jp-badge-warn'
                                    : 'jp-badge'
                              }
                            >
                              {result.status}
                            </span>
                          ) : null}
                        </div>

                        {item.alreadyFilled ? (
                          <div className="jp-meta">
                            [=] Already filled by you/ATS — preserved untouched.
                          </div>
                        ) : item.controlType === 'file' ? (
                          <div className="jp-meta">
                            File upload: {item.displayValue || 'Select a tailored resume version above'}
                          </div>
                        ) : item.controlType === 'textarea' ? (
                          <textarea
                            rows={3}
                            className="jp-textarea"
                            aria-label={`Value for ${item.label}`}
                            value={item.proposedValue}
                            onChange={(e) => {
                              const nextVal = e.target.value;
                              setPlanItems((prev) =>
                                prev.map((p) =>
                                  p.fieldId === item.fieldId
                                    ? {
                                        ...p,
                                        proposedValue: nextVal,
                                        displayValue: nextVal,
                                        source: 'user_edited',
                                        included: nextVal.trim().length > 0
                                      }
                                    : p
                                )
                              );
                            }}
                          />
                        ) : (
                          <input
                            type="text"
                            className="jp-input"
                            aria-label={`Value for ${item.label}`}
                            value={item.proposedValue}
                            onChange={(e) => {
                              const nextVal = e.target.value;
                              setPlanItems((prev) =>
                                prev.map((p) =>
                                  p.fieldId === item.fieldId
                                    ? {
                                        ...p,
                                        proposedValue: nextVal,
                                        displayValue: nextVal,
                                        source: 'user_edited',
                                        included: nextVal.trim().length > 0
                                      }
                                    : p
                                )
                              );
                            }}
                          />
                        )}
                      </div>
                    );
                  })}
                </section>
              </>
            )}
          </>
        ) : null}

        {tab === 'connect' ? (
          <div className="jp-field-list">
            {session ? (
              <div className="jp-panel">
                <div className="jp-label">Active Connection</div>
                <div className="jp-meta">Signed in as: {session.email}</div>
                <div className="jp-meta">API: {settings.apiBaseUrl}</div>
                {cachedData ? (
                  <div className="jp-meta">
                    Last synced: {new Date(cachedData.syncedAt).toLocaleString()}
                  </div>
                ) : null}
                <div className="jp-row">
                  <button
                    type="button"
                    className="jp-btn jp-btn-primary"
                    disabled={syncing}
                    onClick={() => void handleSyncData()}
                  >
                    {syncing ? 'Syncing...' : 'Sync Profile & Resumes'}
                  </button>
                  <button
                    type="button"
                    className="jp-btn jp-btn-danger"
                    onClick={() => void handleDisconnect()}
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            ) : null}

            <form className="jp-panel" onSubmit={handleConnectWithSessionJson}>
              <div className="jp-label">Quick Connect via Session JSON</div>
              <p className="jp-meta">
                Click &ldquo;Copy Extension Session JSON&rdquo; inside JobPilot Web Settings, then paste below.
              </p>
              <label className="jp-label" htmlFor="jp-api-url">
                JobPilot API URL
              </label>
              <input
                id="jp-api-url"
                className="jp-input"
                value={apiUrlInput}
                onChange={(e) => setApiUrlInput(e.target.value)}
                placeholder="http://localhost:4000"
              />
              <label className="jp-label" htmlFor="jp-sess-json">
                Session JSON
              </label>
              <textarea
                id="jp-sess-json"
                rows={4}
                className="jp-textarea"
                value={sessionJsonText}
                onChange={(e) => setSessionJsonText(e.target.value)}
                placeholder='{"apiBaseUrl": "...", "accessToken": "...", "refreshToken": "..."}'
              />
              <button type="submit" className="jp-btn jp-btn-primary">
                Connect &amp; Sync
              </button>
            </form>

            <form className="jp-panel" onSubmit={handlePasswordSignIn}>
              <div className="jp-label">Or Sign In with Supabase Password</div>
              <input
                className="jp-input"
                aria-label="Supabase URL"
                placeholder="https://xxxx.supabase.co"
                value={sbUrlInput}
                onChange={(e) => setSbUrlInput(e.target.value)}
              />
              <input
                className="jp-input"
                aria-label="Supabase Anon Key"
                placeholder="Supabase Anon Key"
                value={sbAnonInput}
                onChange={(e) => setSbAnonInput(e.target.value)}
              />
              <input
                className="jp-input"
                type="email"
                aria-label="Email"
                placeholder="you@college.edu"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
              />
              <input
                className="jp-input"
                type="password"
                aria-label="Password"
                placeholder="Password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
              />
              <button type="submit" className="jp-btn">
                Sign In
              </button>
            </form>
          </div>
        ) : null}

        {tab === 'adapters' ? (
          <div className="jp-field-list">
            <div className="jp-panel">
              <div className="jp-label">Official ATS Adapters</div>
              <p className="jp-meta">
                Greenhouse, Lever, and Ashby are pre-scoped; Workday requests optional host permission on demand.
              </p>
              {OFFICIAL_ATS_ADAPTERS.map((adapter) => {
                const key = adapter.id as keyof AdapterEnabledMap;
                return (
                  <label key={adapter.id} className="jp-row" style={{ cursor: 'pointer', minHeight: 32 }}>
                    <input
                      type="checkbox"
                      checked={settings.enabledAdapters[key]}
                      onChange={(e) => handleToggleAdapter(key, e.target.checked)}
                    />
                    <span>{adapter.displayName}</span>
                  </label>
                );
              })}
            </div>

            <div className="jp-panel">
              <div className="jp-label">Opt-In Session Portals (Non-API, ToS Risk)</div>
              <p className="jp-meta">
                All 6 portals below are OFF by default and never scraped server-side. Turning one on requests host permission only for that portal, runs strictly when you click in your own logged-in tab, and pauses before Submit.
              </p>
              {NON_API_SESSION_ADAPTERS.map((adapter) => {
                const key = adapter.id as keyof AdapterEnabledMap;
                return (
                  <div key={adapter.id} className="jp-field-card">
                    <div className="jp-field-top">
                      <label className="jp-row" style={{ cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={settings.enabledAdapters[key]}
                          onChange={(e) => handleToggleAdapter(key, e.target.checked)}
                        />
                        <span className="jp-label">{adapter.displayName}</span>
                      </label>
                      <span
                        className={
                          adapter.tosRiskLevel === 'high'
                            ? 'jp-badge jp-badge-warn'
                            : 'jp-badge'
                        }
                      >
                        {adapter.tosRiskLevel.toUpperCase()} RISK
                      </span>
                    </div>
                    <div className="jp-meta">{adapter.tosWarning}</div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
