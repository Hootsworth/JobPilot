import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildFillPlan,
  getAdapterById,
  NON_API_SESSION_ADAPTERS,
  OFFICIAL_ATS_ADAPTERS,
  resolveAdapterForUrl
} from '@jobpilot/form-engine';
import type {
  AtsAdapterId,
  AtsScoreReport,
  CaptureExtensionJobResponse,
  DraftAnswersResponse,
  FallbackFillResponse,
  FallbackFillSuggestion,
  FillExecutionItemResult,
  FillPlanItem,
  MasterProfile,
  MissingRequiredQuestion,
  ResumeTemplateId
} from '@jobpilot/shared';
import { AtsMatchCard } from '../../src/components/AtsMatchCard';
import { QuickCopyBar } from '../../src/components/QuickCopyBar';
import { signInWithSupabasePassword, syncExtensionUserData } from '../../src/lib/api-client';
import type {
  ApiProxyResponse,
  AtsScoreProxyResponse,
  ExtensionMessage,
  LearnedFieldEdit,
  PageScanPayload,
  PageValidationError,
  SaveAnswerProxyResponse,
  SubmitDetectedPayload,
  TailorResumeProxyResponse,
  UndoFillTabResponse,
  ExecuteFillTabResponse
} from '../../src/lib/messaging';
import {
  DEFAULT_SETTINGS,
  getCachedUserData,
  getExtensionSession,
  getExtensionSettings,
  getTailorHandoff,
  saveCachedUserData,
  saveExtensionSession,
  saveExtensionSettings,
  saveTailorHandoff,
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

function normalizeUrlKey(rawUrl: string): string {
  return rawUrl.split('#')[0]?.trim() || rawUrl;
}

function slugAnswerKey(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'custom_question'
  );
}

export function App() {
  const [tab, setTab] = useState<SideTab>('review');
  const [settings, setSettings] = useState<ExtensionSettingsState>(DEFAULT_SETTINGS);
  const [session, setSession] = useState<ExtensionAuthSession | null>(null);
  const [cachedData, setCachedData] = useState<CachedUserData | null>(null);

  const [scan, setScan] = useState<PageScanPayload | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string>('');
  const [selectedResumeId, setSelectedResumeId] = useState<string>('');
  const [selectedCoverLetterId, setSelectedCoverLetterId] = useState<string>('');
  const [tailorTemplateId, setTailorTemplateId] = useState<ResumeTemplateId>('ats-classic');

  const [planItems, setPlanItems] = useState<FillPlanItem[]>([]);
  const [execResults, setExecResults] = useState<Map<string, FillExecutionItemResult>>(new Map());
  const [pendingPermissionAdapterId, setPendingPermissionAdapterId] =
    useState<AtsAdapterId | null>(null);

  const [atsReport, setAtsReport] = useState<AtsScoreReport | null>(null);
  const [scoringAts, setScoringAts] = useState(false);
  const [submitPrompt, setSubmitPrompt] = useState<SubmitDetectedPayload | null>(null);
  const [markingApplied, setMarkingApplied] = useState(false);

  const [scanning, setScanning] = useState(false);
  const [autofilling, setAutofilling] = useState(false);
  const [waitingForForm, setWaitingForForm] = useState(false);
  const [nextStepFieldCount, setNextStepFieldCount] = useState<number | null>(null);
  const [pageValidationErrors, setPageValidationErrors] = useState<PageValidationError[]>([]);
  const [learnedEdits, setLearnedEdits] = useState<LearnedFieldEdit[]>([]);
  const [savingLearnedFieldId, setSavingLearnedFieldId] = useState<string | null>(null);
  const [tailorHandoffNote, setTailorHandoffNote] = useState<string | null>(null);
  const [pendingQuestions, setPendingQuestions] = useState<MissingRequiredQuestion[]>([]);
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string>>({});
  const [saveQuestionIds, setSaveQuestionIds] = useState<Record<string, boolean>>({});
  const [submittingAnswers, setSubmittingAnswers] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [detectingWebAuth, setDetectingWebAuth] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [mappingFallback, setMappingFallback] = useState(false);
  const [tailoringHere, setTailoringHere] = useState(false);
  const [filling, setFilling] = useState(false);
  const [savingJob, setSavingJob] = useState(false);
  const [savingAnswerFieldId, setSavingAnswerFieldId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [upgradePrompt, setUpgradePrompt] = useState<string | null>(null);

  // Direct Sign-in & Advanced Override fields
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [sessionJsonText, setSessionJsonText] = useState('');
  const [apiUrlInput, setApiUrlInput] = useState(DEFAULT_SETTINGS.apiBaseUrl);
  const [webUrlInput, setWebUrlInput] = useState(DEFAULT_SETTINGS.webBaseUrl);
  const [sbUrlInput, setSbUrlInput] = useState(DEFAULT_SETTINGS.supabaseUrl);
  const [sbAnonInput, setSbAnonInput] = useState(DEFAULT_SETTINGS.supabaseAnonKey);

  // Persistent cache of manual edits / AI drafts keyed by `${normalizedUrl}::${fieldId}` (Bug #5 fix)
  const savedEditsRef = useRef<Map<string, FillPlanItem>>(new Map());
  const lastScanUrlRef = useRef<string>('');
  const lastFallbackRef = useRef<FallbackFillSuggestion[]>([]);
  const scanRef = useRef<PageScanPayload | null>(null);
  scanRef.current = scan;
  const autofillInFlightRef = useRef(false);
  const waitingForFormRef = useRef(false);
  waitingForFormRef.current = waitingForForm;
  const runAutofillRef = useRef<() => Promise<void>>(async () => {});

  const effectiveProfile: MasterProfile | null = useMemo(() => {
    if (!cachedData?.profile) return null;
    const variant = cachedData.profileVariants.find((v) => v.id === selectedVariantId);
    if (!variant) return cachedData.profile;
    return {
      ...cachedData.profile,
      activeProfileVersion: variant.version,
      jsonResume: variant.jsonResume,
      indiaProfile: variant.indiaProfile
    };
  }, [cachedData, selectedVariantId]);

  const recomputePlan = useCallback(
    (
      nextScan: PageScanPayload | null,
      data: CachedUserData | null,
      variantId: string,
      resumeId: string,
      coverLetterId: string,
      nextFallbackSuggestions?: FallbackFillSuggestion[]
    ): FillPlanItem[] => {
      if (!nextScan || !data) {
        setPlanItems([]);
        return [];
      }
      const variant = data.profileVariants.find((v) => v.id === variantId);
      const profileForFill: MasterProfile = variant
        ? {
            ...data.profile,
            activeProfileVersion: variant.version,
            jsonResume: variant.jsonResume,
            indiaProfile: variant.indiaProfile
          }
        : data.profile;

      const resumeVersion = data.resumeVersions.find((v) => v.id === resumeId) ?? null;
      const coverLetter = data.coverLetters.find((c) => c.id === coverLetterId) ?? null;
      const computed = buildFillPlan({
        fields: nextScan.fields,
        profile: profileForFill,
        savedAnswers: data.savedAnswers,
        resumeVersion,
        coverLetter,
        fallbackSuggestions: nextFallbackSuggestions ?? lastFallbackRef.current
      });

      const urlKey = normalizeUrlKey(nextScan.url);
      const mergedItems = computed.map((item) => {
        const remembered = savedEditsRef.current.get(`${urlKey}::${item.fieldId}`);
        if (remembered && !item.alreadyFilled && remembered.proposedValue.trim()) {
          return {
            ...item,
            proposedValue: remembered.proposedValue,
            displayValue: remembered.displayValue,
            source: remembered.source,
            confidence: remembered.confidence,
            included: remembered.included
          };
        }
        return item;
      });
      setPlanItems(mergedItems);
      return mergedItems;
    },
    []
  );

  const scanActiveTab = useCallback(
    async (
      dataOverride?: CachedUserData | null,
      variantIdOverride?: string,
      resumeIdOverride?: string,
      coverLetterIdOverride?: string,
      settingsOverride?: ExtensionSettingsState
    ): Promise<PageScanPayload | null> => {
      setScanning(true);
      setErrorMsg(null);
      setPendingPermissionAdapterId(null);
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!activeTab?.id) {
          setScan(null);
          return null;
        }

        const nextUrlKey = activeTab.url ? normalizeUrlKey(activeTab.url) : '';
        const samePage = Boolean(nextUrlKey && nextUrlKey === lastScanUrlRef.current);
        if (!samePage) {
          lastFallbackRef.current = [];
          setAtsReport(null);
          setPendingQuestions([]);
          setQuestionAnswers({});
          setSaveQuestionIds({});
          setWaitingForForm(false);
          setNextStepFieldCount(null);
          setPageValidationErrors([]);
          setLearnedEdits([]);
          setTailorHandoffNote(null);
        }

        let effectiveData = dataOverride ?? cachedData;
        let resolvedVariantId = variantIdOverride ?? selectedVariantId;
        let resolvedResumeId = resumeIdOverride ?? selectedResumeId;
        let resolvedCoverLetterId = coverLetterIdOverride ?? selectedCoverLetterId;

        // Check for web Tailor & Apply handoff targeting this application tab
        if (activeTab.url && /^https?:\/\//i.test(activeTab.url) && effectiveData) {
          const handoff = await getTailorHandoff();
          if (handoff) {
            let tabHost = '';
            let applyHost = '';
            try {
              tabHost = new URL(activeTab.url).hostname.replace(/^www\./, '').toLowerCase();
              applyHost = new URL(handoff.applyUrl).hostname.replace(/^www\./, '').toLowerCase();
            } catch {
              // Ignore malformed URLs
            }
            const isWebAppTab =
              tabHost === 'jobpilot.singulr.tech' ||
              (tabHost === 'localhost' && activeTab.url.includes(':3000'));
            const recentRedirect = Date.now() - handoff.createdAt < 120_000;
            if (!isWebAppTab && ((tabHost && tabHost === applyHost) || recentRedirect)) {
              const needsSync =
                (handoff.resumeVersionId &&
                  !effectiveData.resumeVersions.some((r) => r.id === handoff.resumeVersionId)) ||
                (handoff.coverLetterId &&
                  !effectiveData.coverLetters.some((c) => c.id === handoff.coverLetterId));
              if (needsSync) {
                try {
                  effectiveData = await syncExtensionUserData();
                  setCachedData(effectiveData);
                } catch {
                  // Use cached data if sync fails
                }
              }
              if (
                handoff.profileVariantId &&
                effectiveData.profileVariants.some((v) => v.id === handoff.profileVariantId)
              ) {
                resolvedVariantId = handoff.profileVariantId;
                setSelectedVariantId(resolvedVariantId);
              }
              if (
                handoff.resumeVersionId &&
                effectiveData.resumeVersions.some((r) => r.id === handoff.resumeVersionId)
              ) {
                resolvedResumeId = handoff.resumeVersionId;
                setSelectedResumeId(resolvedResumeId);
              }
              if (
                handoff.coverLetterId &&
                effectiveData.coverLetters.some((c) => c.id === handoff.coverLetterId)
              ) {
                resolvedCoverLetterId = handoff.coverLetterId;
                setSelectedCoverLetterId(resolvedCoverLetterId);
              }
              setTailorHandoffNote(
                `Tailored resume pre-selected${handoff.companyName ? ` for ${handoff.companyName}` : ''}.`
              );
              await saveTailorHandoff(null);
            }
          }
        }

        let response: PageScanPayload | undefined;
        try {
          response = (await chrome.tabs.sendMessage(activeTab.id, {
            type: 'SCAN_PAGE'
          } satisfies ExtensionMessage)) as PageScanPayload | undefined;
        } catch {
          const activeSettings = settingsOverride ?? (await getExtensionSettings());
          if (activeTab.url && /^https?:\/\//i.test(activeTab.url)) {
            const resolved = resolveAdapterForUrl(activeTab.url, activeSettings.enabledAdapters);
            const meta = getAdapterById(resolved.detectedId);

            if (resolved.disabledByUser) {
              const disabledPayload: PageScanPayload = {
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
              };
              setScan(disabledPayload);
              lastScanUrlRef.current = nextUrlKey;
              setPlanItems([]);
              return disabledPayload;
            }

            try {
              await chrome.scripting.executeScript({
                target: { tabId: activeTab.id, allFrames: true },
                files: ['content-scripts/content.js']
              });
              response = (await chrome.tabs.sendMessage(activeTab.id, {
                type: 'SCAN_PAGE'
              } satisfies ExtensionMessage)) as PageScanPayload | undefined;
            } catch {
              response = undefined;
            }
          }
        }

        if (!response) {
          setScan(null);
          lastScanUrlRef.current = nextUrlKey;
          return null;
        }
        setScan(response);
        lastScanUrlRef.current = normalizeUrlKey(response.url);
        if (!samePage) {
          setExecResults(new Map());
        }
        recomputePlan(
          response,
          effectiveData,
          resolvedVariantId,
          resolvedResumeId,
          resolvedCoverLetterId,
          samePage ? lastFallbackRef.current : []
        );
        return response;
      } catch {
        setScan(null);
        return null;
      } finally {
        setScanning(false);
      }
    },
    [
      cachedData,
      recomputePlan,
      selectedCoverLetterId,
      selectedResumeId,
      selectedVariantId
    ]
  );

  // Initial load + automatic web-session detection if signed out
  useEffect(() => {
    void (async () => {
      let [s, sess, data] = await Promise.all([
        getExtensionSettings(),
        getExtensionSession(),
        getCachedUserData()
      ]);

      if (!sess) {
        await chrome.runtime
          .sendMessage({ type: 'JOBPILOT_SYNC_FROM_WEB_TAB' } satisfies ExtensionMessage)
          .catch(() => {});
        [s, sess, data] = await Promise.all([
          getExtensionSettings(),
          getExtensionSession(),
          getCachedUserData()
        ]);
      }

      setSettings(s);
      setApiUrlInput(s.apiBaseUrl);
      setWebUrlInput(s.webBaseUrl);
      setSbUrlInput(s.supabaseUrl);
      setSbAnonInput(s.supabaseAnonKey);
      setSession(sess);
      setCachedData(data);

      const defaultVariantId =
        data?.profileVariants.find((v) => v.isDefault)?.id ?? data?.profileVariants[0]?.id ?? '';
      const defaultResumeId = data?.resumeVersions[0]?.id ?? '';
      const defaultCoverId = data?.coverLetters[0]?.id ?? '';
      setSelectedVariantId(defaultVariantId);
      setSelectedResumeId(defaultResumeId);
      setSelectedCoverLetterId(defaultCoverId);

      if (!sess) {
        setTab('connect');
        await scanActiveTab(data, defaultVariantId, defaultResumeId, defaultCoverId, s);
        return;
      }

      const storedSessionState = await chrome.storage.session
        .get('pendingAutofill')
        .catch(() => ({}));
      const pending = (
        storedSessionState as {
          pendingAutofill?: { tabId?: number; url?: string; requestedAt?: number };
        }
      )?.pendingAutofill;
      if (pending?.requestedAt && Date.now() - pending.requestedAt < 30_000) {
        await chrome.storage.session.remove('pendingAutofill').catch(() => {});
        await runAutofillRef.current();
      } else {
        await scanActiveTab(data, defaultVariantId, defaultResumeId, defaultCoverId, s);
      }
    })();
  }, []);

  // Keep Side Panel reactive to tab switches, URL changes, Web Auth sync, & Post-Submit confirmation (#4, #6)
  useEffect(() => {
    const onMessage = (message: ExtensionMessage) => {
      if (message?.type === 'RUN_AUTOFILL_VIA_JOBPILOT') {
        void chrome.storage.session.remove('pendingAutofill').catch(() => {});
        void runAutofillRef.current();
      } else if (message?.type === 'PAGE_STRUCTURE_UPDATED') {
        setPageValidationErrors(message.validationErrors ?? []);
        if (message.stepChanged && message.fieldCount > 0) {
          setNextStepFieldCount(message.fieldCount);
        }
        if (waitingForFormRef.current && message.fieldCount > 0) {
          setWaitingForForm(false);
          void runAutofillRef.current();
        } else {
          void scanActiveTab();
        }
      } else if (message?.type === 'USER_EDITED_FILLED_FIELD') {
        setLearnedEdits((prev) => {
          const filtered = prev.filter((item) => item.fieldId !== message.payload.fieldId);
          return [message.payload, ...filtered].slice(0, 5);
        });
      } else if (message?.type === 'APPLICATION_SUBMIT_DETECTED') {
        setSubmitPrompt(message.payload);
      } else if (message?.type === 'AUTH_SESSION_UPDATED') {
        void (async () => {
          const [s, sess, data] = await Promise.all([
            getExtensionSettings(),
            getExtensionSession(),
            getCachedUserData()
          ]);
          setSettings(s);
          setApiUrlInput(s.apiBaseUrl);
          setWebUrlInput(s.webBaseUrl);
          setSbUrlInput(s.supabaseUrl);
          setSbAnonInput(s.supabaseAnonKey);
          setSession(sess);
          setCachedData(data);
          if (sess && data) {
            const vId =
              data.profileVariants.find((v) => v.isDefault)?.id ??
              data.profileVariants[0]?.id ??
              '';
            const rId = data.resumeVersions[0]?.id ?? '';
            const cId = data.coverLetters[0]?.id ?? '';
            setSelectedVariantId(vId);
            setSelectedResumeId(rId);
            setSelectedCoverLetterId(cId);
            setTab('review');
            setStatusMsg(`Auto-connected via JobPilot Web (${sess.email}).`);
            await scanActiveTab(data, vId, rId, cId, s);
          } else if (!sess) {
            setTab('connect');
          }
        })();
      }
    };

    const onTabActivated = () => {
      setSubmitPrompt(null);
      void scanActiveTab();
    };
    const onTabUpdated = (_tabId: number, info: { status?: string; url?: string }, updatedTab: chrome.tabs.Tab) => {
      if (updatedTab.active && (info.status === 'complete' || info.url)) {
        void scanActiveTab();
      }
    };

    chrome.runtime.onMessage.addListener(onMessage);
    chrome.tabs.onActivated.addListener(onTabActivated);
    chrome.tabs.onUpdated.addListener(onTabUpdated);
    return () => {
      chrome.runtime.onMessage.removeListener(onMessage);
      chrome.tabs.onActivated.removeListener(onTabActivated);
      chrome.tabs.onUpdated.removeListener(onTabUpdated);
    };
  }, [scanActiveTab]);

  // Live In-Tab ATS Score (#2)
  useEffect(() => {
    const desc = scan?.jobMetadata.descriptionClean?.trim() ?? '';
    if (!session || !cachedData || !scan || desc.length < 20) {
      setAtsReport(null);
      return;
    }

    let cancelled = false;
    setScoringAts(true);
    void (async () => {
      try {
        const res = (await chrome.runtime.sendMessage({
          type: 'API_ATS_SCORE',
          payload: {
            ...(selectedResumeId
              ? { resumeVersionId: selectedResumeId }
              : selectedVariantId
                ? { profileVariantId: selectedVariantId }
                : {}),
            customJob: {
              title: scan.jobMetadata.title || 'Target Role',
              companyName: scan.jobMetadata.companyName || '',
              description: desc
            }
          }
        } satisfies ExtensionMessage)) as AtsScoreProxyResponse;
        if (!cancelled && res?.ok) {
          setAtsReport(res.data);
        }
      } catch {
        if (!cancelled) setAtsReport(null);
      } finally {
        if (!cancelled) setScoringAts(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [scan, session, cachedData, selectedVariantId, selectedResumeId]);

  const persistFieldEdit = (fieldId: string, nextItem: FillPlanItem) => {
    const activeUrl = scanRef.current?.url;
    if (activeUrl) {
      savedEditsRef.current.set(`${normalizeUrlKey(activeUrl)}::${fieldId}`, nextItem);
    }
  };

  const handleSyncData = async () => {
    setSyncing(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const fresh = await syncExtensionUserData();
      setCachedData(fresh);
      const nextVarId =
        fresh.profileVariants.find((v) => v.id === selectedVariantId)?.id ??
        fresh.profileVariants.find((v) => v.isDefault)?.id ??
        fresh.profileVariants[0]?.id ??
        '';
      const nextResId =
        fresh.resumeVersions.find((v) => v.id === selectedResumeId)?.id ??
        fresh.resumeVersions[0]?.id ??
        '';
      const nextCoverId =
        fresh.coverLetters.find((c) => c.id === selectedCoverLetterId)?.id ??
        fresh.coverLetters[0]?.id ??
        '';
      setSelectedVariantId(nextVarId);
      setSelectedResumeId(nextResId);
      setSelectedCoverLetterId(nextCoverId);
      recomputePlan(scan, fresh, nextVarId, nextResId, nextCoverId);
      setStatusMsg(
        `Synced profile, ${fresh.profileVariants.length} variant(s), ${fresh.coverLetters.length} cover letter(s), ${fresh.savedAnswers.length} answer(s), ${fresh.resumeVersions.length} resume(s).`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Sync failed.');
    } finally {
      setSyncing(false);
    }
  };

  const handleDetectWebSession = async () => {
    setDetectingWebAuth(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'JOBPILOT_SYNC_FROM_WEB_TAB'
      } satisfies ExtensionMessage)) as ApiProxyResponse<{
        found: boolean;
        email?: string;
        tabCount: number;
      }>;

      if (!res?.ok) throw new Error(res?.error || 'Unable to inspect web tabs.');
      if (!res.data.found) {
        if (res.data.tabCount === 0) {
          throw new Error(
            `No open JobPilot web tab found. Click "Sign in on JobPilot Web" below.`
          );
        }
        throw new Error('JobPilot web tab is open, but you are not signed in there yet.');
      }

      const [s, sess, data] = await Promise.all([
        getExtensionSettings(),
        getExtensionSession(),
        getCachedUserData()
      ]);
      setSettings(s);
      setSession(sess);
      const fresh = data ?? (await syncExtensionUserData());
      setCachedData(fresh);
      const vId =
        fresh.profileVariants.find((v) => v.isDefault)?.id ??
        fresh.profileVariants[0]?.id ??
        '';
      const rId = fresh.resumeVersions[0]?.id ?? '';
      const cId = fresh.coverLetters[0]?.id ?? '';
      setSelectedVariantId(vId);
      setSelectedResumeId(rId);
      setSelectedCoverLetterId(cId);
      setTab('review');
      setStatusMsg(`Connected from JobPilot Web (${sess?.email ?? 'signed in'}).`);
      await scanActiveTab(fresh, vId, rId, cId, s);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to detect website login.');
    } finally {
      setDetectingWebAuth(false);
    }
  };

  const handleOpenWebLogin = () => {
    const loginUrl = `${settings.webBaseUrl.replace(/\/$/, '')}/login`;
    void chrome.tabs.create({ url: loginUrl });
    setStatusMsg('Opened JobPilot login tab — extension connects automatically once signed in.');
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

      if (!res?.ok) throw new Error(res?.error || 'Failed to save job to tracker');
      setStatusMsg(
        `Saved "${scan.jobMetadata.title}" @ ${scan.jobMetadata.companyName} to Tracker.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Capture failed.');
    } finally {
      setSavingJob(false);
    }
  };

  const handleSaveAnyActivePage = async () => {
    setSavingJob(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'JOBPILOT_SAVE_ACTIVE_TAB_JOB'
      } satisfies ExtensionMessage)) as ApiProxyResponse<{ title: string; companyName: string }>;
      if (!res?.ok) throw new Error(res?.error || 'Failed to save active page.');
      setStatusMsg(`Saved "${res.data.title}" @ ${res.data.companyName} to Tracker.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save active page.');
    } finally {
      setSavingJob(false);
    }
  };

  const handleTailorNowInExtension = async () => {
    if (!scan) return;
    const desc = scan.jobMetadata.descriptionClean?.trim() ?? '';
    if (desc.length < 30) {
      setErrorMsg(
        'Not enough job description text on this tab to tailor directly — click "Tailor Studio ->" to paste JD.'
      );
      return;
    }

    setTailoringHere(true);
    setErrorMsg(null);
    setUpgradePrompt(null);
    setStatusMsg(null);
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'API_TAILOR_RESUME',
        payload: {
          ...(selectedVariantId ? { profileVariantId: selectedVariantId } : {}),
          customJob: {
            title: scan.jobMetadata.title || 'Software Engineer',
            companyName: scan.jobMetadata.companyName || 'Company',
            description: desc
          },
          templateId: tailorTemplateId,
          autoRepairFlagged: true
        }
      } satisfies ExtensionMessage)) as TailorResumeProxyResponse;

      if (!res?.ok) {
        if (res?.status === 402 || res?.status === 403) {
          setUpgradePrompt(res.error);
          return;
        }
        throw new Error(res?.error || 'Tailoring failed.');
      }
      const created = res.data;
      if (cachedData) {
        const updatedCache: CachedUserData = {
          ...cachedData,
          resumeVersions: [created, ...cachedData.resumeVersions]
        };
        setCachedData(updatedCache);
        await saveCachedUserData(updatedCache);
        setSelectedResumeId(created.id);
        recomputePlan(scan, updatedCache, selectedVariantId, created.id, selectedCoverLetterId);
      }
      setStatusMsg(
        `Created v${created.versionNumber} (${created.verifierPassed ? 'VERIFIED' : 'FLAGGED'}) and selected for attachment.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Tailor failed.');
    } finally {
      setTailoringHere(false);
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
      .slice(0, 20) // Bug #6 fix: matches DraftAnswersRequestSchema max(20)
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
    setUpgradePrompt(null);
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

      if (!res?.ok) {
        if (res?.status === 402 || res?.status === 403) {
          setUpgradePrompt(res.error);
          return;
        }
        throw new Error(res?.error || 'Failed to draft answers.');
      }
      const draftMap = new Map(res.data.drafts.map((d) => [d.fieldId, d]));

      setPlanItems((prev) =>
        prev.map((item) => {
          const hit = draftMap.get(item.fieldId);
          if (!hit || !hit.answer.trim()) return item;
          const nextItem: FillPlanItem = {
            ...item,
            proposedValue: hit.answer,
            displayValue: hit.answer,
            confidence: hit.confidence,
            source: hit.source === 'saved_answer' ? 'saved_answer' : 'llm_draft',
            included: !item.alreadyFilled,
            skipReason: hit.rationale
          };
          persistFieldEdit(item.fieldId, nextItem);
          return nextItem;
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
    setUpgradePrompt(null);
    setStatusMsg(null);
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'API_FALLBACK_FILL',
        payload: {
          atsAdapter: scan.adapterId,
          jobTitle: scan.jobMetadata.title,
          companyName: scan.jobMetadata.companyName,
          jobDescription: scan.jobMetadata.descriptionClean,
          fields: unresolved.slice(0, 40).map((f) => ({
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

      if (!res?.ok) {
        if (res?.status === 402 || res?.status === 403) {
          setUpgradePrompt(res.error);
          return;
        }
        throw new Error(res?.error || 'LLM fallback mapping failed.');
      }

      const merged = [...lastFallbackRef.current];
      for (const s of res.data.suggestions) {
        const idx = merged.findIndex((m) => m.fieldId === s.fieldId);
        if (idx >= 0) merged[idx] = s;
        else merged.push(s);
      }
      lastFallbackRef.current = merged;
      recomputePlan(
        scan,
        cachedData,
        selectedVariantId,
        selectedResumeId,
        selectedCoverLetterId,
        merged
      );
      if (res.data.missingRequired && res.data.missingRequired.length > 0) {
        setPendingQuestions(res.data.missingRequired);
        setSaveQuestionIds(
          Object.fromEntries(
            res.data.missingRequired.map((q) => [q.fieldId, q.controlType !== 'checkbox'])
          )
        );
      }
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

  const handleSaveFieldToAnswerBank = async (item: FillPlanItem) => {
    if (!item.proposedValue.trim() || !cachedData) return;
    setSavingAnswerFieldId(item.fieldId);
    setErrorMsg(null);
    try {
      const questionKey =
        item.canonicalKey === 'unknown' || item.canonicalKey === 'custom_question'
          ? slugAnswerKey(item.label)
          : item.canonicalKey;

      const res = (await chrome.runtime.sendMessage({
        type: 'API_SAVE_ANSWER',
        payload: {
          questionKey,
          questionPattern: item.label,
          answer: item.proposedValue.trim(),
          tags: scan ? [scan.adapterId] : []
        }
      } satisfies ExtensionMessage)) as SaveAnswerProxyResponse;

      if (!res?.ok) throw new Error(res?.error || 'Failed to save answer.');

      const updatedCache: CachedUserData = {
        ...cachedData,
        savedAnswers: [res.data, ...cachedData.savedAnswers]
      };
      setCachedData(updatedCache);
      await saveCachedUserData(updatedCache);
      setPlanItems((prev) =>
        prev.map((p) => {
          if (p.fieldId !== item.fieldId) return p;
          const nextItem: FillPlanItem = { ...p, source: 'saved_answer', confidence: 0.94 };
          persistFieldEdit(p.fieldId, nextItem);
          return nextItem;
        })
      );
      setStatusMsg(`Saved "${item.label}" to your Answer Bank.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save answer.');
    } finally {
      setSavingAnswerFieldId(null);
    }
  };

  const handleMarkSubmittedApplied = async () => {
    if (!submitPrompt) return;
    setMarkingApplied(true);
    setErrorMsg(null);
    try {
      const sourceType = scan?.adapterId && scan.adapterId !== 'generic' ? scan.adapterId : 'extension_capture';
      const res = (await chrome.runtime.sendMessage({
        type: 'API_MARK_APPLIED',
        payload: {
          sourceType,
          sourceUrl: submitPrompt.url,
          applyUrl: submitPrompt.url,
          title: submitPrompt.title,
          companyName: submitPrompt.companyName,
          ...(selectedResumeId ? { resumeVersionId: selectedResumeId } : {}),
          ...(selectedCoverLetterId ? { coverLetterId: selectedCoverLetterId } : {})
        }
      } satisfies ExtensionMessage)) as ApiProxyResponse<unknown>;

      if (!res?.ok) throw new Error(res?.error || 'Failed to mark application applied.');
      setSubmitPrompt(null);
      setStatusMsg(`Logged "${submitPrompt.title}" @ ${submitPrompt.companyName} as APPLIED.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to log application.');
    } finally {
      setMarkingApplied(false);
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
        resumeVersionId: selectedResumeId || null,
        coverLetterId: selectedCoverLetterId || null
      } satisfies ExtensionMessage)) as ExecuteFillTabResponse;

      if (!res?.ok) throw new Error(res?.error || 'Fill execution failed.');
      setExecResults(new Map(res.results.map((r) => [r.fieldId, r])));
      const valRes = (await chrome.tabs
        .sendMessage(activeTab.id, { type: 'GET_PAGE_VALIDATION_ERRORS' } satisfies ExtensionMessage)
        .catch(() => null)) as { ok: boolean; errors?: PageValidationError[] } | null;
      setPageValidationErrors(valRes?.errors ?? []);
      setNextStepFieldCount(null);
      setStatusMsg(
        `Filled ${res.filledCount} field(s) (preserved ${res.skippedAlreadyFilledCount} pre-filled). Review & click Submit when ready.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to fill form on this tab.');
    } finally {
      setFilling(false);
    }
  };

  const handleSaveLearnedEdit = async (edit: LearnedFieldEdit) => {
    if (!cachedData) return;
    setSavingLearnedFieldId(edit.fieldId);
    setErrorMsg(null);
    try {
      const questionKey =
        edit.canonicalKey === 'unknown' || edit.canonicalKey === 'custom_question'
          ? slugAnswerKey(edit.label)
          : edit.canonicalKey;
      const res = (await chrome.runtime.sendMessage({
        type: 'API_SAVE_ANSWER',
        payload: {
          questionKey,
          questionPattern: edit.label,
          answer: edit.value.trim(),
          tags: scan ? [scan.adapterId] : []
        }
      } satisfies ExtensionMessage)) as SaveAnswerProxyResponse;

      if (!res?.ok) throw new Error(res?.error || 'Failed to save learned answer.');
      const updatedCache: CachedUserData = {
        ...cachedData,
        savedAnswers: [res.data, ...cachedData.savedAnswers]
      };
      setCachedData(updatedCache);
      await saveCachedUserData(updatedCache);
      setLearnedEdits((prev) => prev.filter((item) => item.fieldId !== edit.fieldId));
      setStatusMsg(`Saved "${edit.label}" to your Answer Bank for future applications.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save correction.');
    } finally {
      setSavingLearnedFieldId(null);
    }
  };

  const handleToggleHiddenDomain = async (hostname: string, hide: boolean) => {
    const clean = hostname.trim().toLowerCase();
    if (!clean) return;
    const nextList = hide
      ? Array.from(new Set([...settings.hiddenCtaDomains, clean]))
      : settings.hiddenCtaDomains.filter((d) => d !== clean);
    const next = await saveExtensionSettings({ hiddenCtaDomains: nextList });
    setSettings(next);
    setStatusMsg(
      hide
        ? `Hid inline "Autofill via JobPilot" button on ${clean}.`
        : `Restored inline "Autofill via JobPilot" button on ${clean}.`
    );
  };

  const runAutofillViaJobPilot = useCallback(async () => {
    if (autofillInFlightRef.current) return;

    const activeSession = session ?? (await getExtensionSession());
    const activeData = cachedData ?? (await getCachedUserData());
    const activeSettings = settings ?? (await getExtensionSettings());

    if (!activeSession || !activeData) {
      setTab('connect');
      setStatusMsg('Connect your JobPilot account first, then click Autofill via JobPilot.');
      return;
    }

    const vId =
      selectedVariantId ||
      activeData.profileVariants.find((v) => v.isDefault)?.id ||
      activeData.profileVariants[0]?.id ||
      '';
    const rId = selectedResumeId || activeData.resumeVersions[0]?.id || '';
    const cId = selectedCoverLetterId || activeData.coverLetters[0]?.id || '';

    autofillInFlightRef.current = true;
    setTab('review');
    setAutofilling(true);
    setErrorMsg(null);
    setUpgradePrompt(null);
    setPendingQuestions([]);
    setQuestionAnswers({});
    setStatusMsg('Scanning page for application fields...');

    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab?.id) {
        throw new Error('No active browser tab found.');
      }

      const scanned = await scanActiveTab(activeData, vId, rId, cId, activeSettings);
      if (!scanned || scanned.disabledByUser || scanned.fields.length === 0) {
        setWaitingForForm(true);
        setStatusMsg(
          'No form inputs detected on this view yet — click Apply / Next on the page and JobPilot will autofill as soon as the form opens.'
        );
        return;
      }

      setWaitingForForm(false);
      let workingPlan = recomputePlan(scanned, activeData, vId, rId, cId, lastFallbackRef.current);

      const unresolved = scanned.fields.filter((f) => {
        const item = workingPlan.find((p) => p.fieldId === f.fieldId);
        return item && !item.alreadyFilled && item.controlType !== 'file' && !item.proposedValue.trim();
      });

      let aiMissing: MissingRequiredQuestion[] = [];
      let aiNote: string | undefined;

      if (unresolved.length > 0) {
        setStatusMsg(`Identifying & mapping ${unresolved.length} additional field(s) with AI...`);
        const aiRes = (await chrome.runtime.sendMessage({
          type: 'API_FALLBACK_FILL',
          payload: {
            atsAdapter: scanned.adapterId,
            jobTitle: scanned.jobMetadata.title || 'Open Role',
            companyName: scanned.jobMetadata.companyName || 'Company',
            jobDescription: scanned.jobMetadata.descriptionClean,
            fields: unresolved.slice(0, 40).map((f) => ({
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

        if (aiRes?.ok) {
          const merged = [...lastFallbackRef.current];
          for (const s of aiRes.data.suggestions) {
            const idx = merged.findIndex((m) => m.fieldId === s.fieldId);
            if (idx >= 0) merged[idx] = s;
            else merged.push(s);
          }
          lastFallbackRef.current = merged;
          workingPlan = recomputePlan(scanned, activeData, vId, rId, cId, merged);
          aiMissing = aiRes.data.missingRequired ?? [];
          aiNote = aiRes.data.note;
        } else if (aiRes?.status === 402 || aiRes?.status === 403) {
          setUpgradePrompt(aiRes.error);
        }
      }

      const scannedFieldById = new Map(scanned.fields.map((f) => [f.fieldId, f]));
      const emptyRequiredPlanItems = workingPlan.filter((p) => {
        const meta = scannedFieldById.get(p.fieldId);
        return (
          Boolean(meta?.required) &&
          !p.alreadyFilled &&
          p.controlType !== 'file' &&
          !p.proposedValue.trim()
        );
      });
      const emptyRequiredIds = new Set(emptyRequiredPlanItems.map((p) => p.fieldId));
      const finalQuestions: MissingRequiredQuestion[] = aiMissing.filter((q) =>
        emptyRequiredIds.has(q.fieldId)
      );
      const seenQuestionIds = new Set(finalQuestions.map((q) => q.fieldId));

      for (const item of emptyRequiredPlanItems) {
        if (seenQuestionIds.has(item.fieldId)) continue;
        const fieldMeta = scannedFieldById.get(item.fieldId);
        finalQuestions.push({
          fieldId: item.fieldId,
          label: item.label,
          controlType: item.controlType,
          ...(fieldMeta?.options && fieldMeta.options.length > 0 ? { options: fieldMeta.options } : {}),
          canonicalKey: item.canonicalKey,
          question: item.label,
          reason: 'Required field was not found in your profile or saved answers.'
        });
      }

      let filledCount = 0;
      if (workingPlan.some((p) => p.included)) {
        const execRes = (await chrome.tabs.sendMessage(activeTab.id, {
          type: 'EXECUTE_FILL',
          planItems: workingPlan,
          resumeVersionId: rId || null,
          coverLetterId: cId || null
        } satisfies ExtensionMessage)) as ExecuteFillTabResponse;

        if (!execRes?.ok) {
          throw new Error(execRes?.error || 'Form fill failed on active page.');
        }
        filledCount = execRes.filledCount;
        setExecResults(new Map(execRes.results.map((r) => [r.fieldId, r])));
        const valRes = (await chrome.tabs
          .sendMessage(activeTab.id, {
            type: 'GET_PAGE_VALIDATION_ERRORS'
          } satisfies ExtensionMessage)
          .catch(() => null)) as { ok: boolean; errors?: PageValidationError[] } | null;
        setPageValidationErrors(valRes?.errors ?? []);
        setNextStepFieldCount(null);
      }

      setPendingQuestions(finalQuestions);
      setQuestionAnswers(Object.fromEntries(finalQuestions.map((q) => [q.fieldId, ''])));
      setSaveQuestionIds(
        Object.fromEntries(finalQuestions.map((q) => [q.fieldId, q.controlType !== 'checkbox']))
      );

      if (finalQuestions.length > 0) {
        setStatusMsg(
          `Filled ${filledCount} field(s). Please answer ${finalQuestions.length} required question(s) below (optional fields skipped).`
        );
      } else if (aiNote && filledCount === 0) {
        setStatusMsg(aiNote);
      } else {
        setStatusMsg(
          `Autofilled ${filledCount} field(s). All required fields complete — review and click Submit on the page when ready.`
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Autofill via JobPilot failed.');
    } finally {
      setAutofilling(false);
      autofillInFlightRef.current = false;
    }
  }, [
    cachedData,
    recomputePlan,
    scanActiveTab,
    selectedCoverLetterId,
    selectedResumeId,
    selectedVariantId,
    session,
    settings
  ]);
  runAutofillRef.current = runAutofillViaJobPilot;

  const handleSubmitMissingQuestions = async () => {
    if (!scan || pendingQuestions.length === 0) return;

    const answeredQuestions = pendingQuestions.filter(
      (q) => (questionAnswers[q.fieldId] ?? '').trim().length > 0
    );
    if (answeredQuestions.length === 0) return;

    setSubmittingAnswers(true);
    setErrorMsg(null);
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab?.id) throw new Error('No active browser tab.');

      const answerMap = new Map(
        answeredQuestions.map((q) => [q.fieldId, questionAnswers[q.fieldId].trim()])
      );

      const updatedPlan = planItems.map((item) => {
        const val = answerMap.get(item.fieldId);
        if (!val) return item;
        const nextItem: FillPlanItem = {
          ...item,
          proposedValue: val,
          displayValue: val,
          source: 'user_edited',
          confidence: 1,
          included: true
        };
        persistFieldEdit(item.fieldId, nextItem);
        return nextItem;
      });
      setPlanItems(updatedPlan);

      const subsetToFill = updatedPlan.filter((item) => answerMap.has(item.fieldId));
      const execRes = (await chrome.tabs.sendMessage(activeTab.id, {
        type: 'EXECUTE_FILL',
        planItems: subsetToFill,
        resumeVersionId: selectedResumeId || null,
        coverLetterId: selectedCoverLetterId || null
      } satisfies ExtensionMessage)) as ExecuteFillTabResponse;

      if (!execRes?.ok) {
        throw new Error(execRes?.error || 'Could not fill required answers.');
      }

      setExecResults((prev) => {
        const next = new Map(prev);
        for (const r of execRes.results) next.set(r.fieldId, r);
        return next;
      });

      const newlySavedAnswers = [];
      for (const q of answeredQuestions) {
        if (!saveQuestionIds[q.fieldId]) continue;
        const val = answerMap.get(q.fieldId) ?? '';
        if (!val) continue;
        const questionKey =
          !q.canonicalKey || q.canonicalKey === 'unknown' || q.canonicalKey === 'custom_question'
            ? slugAnswerKey(q.label)
            : q.canonicalKey;
        const savedRes = (await chrome.runtime.sendMessage({
          type: 'API_SAVE_ANSWER',
          payload: {
            questionKey,
            questionPattern: q.label,
            answer: val,
            tags: [scan.adapterId]
          }
        } satisfies ExtensionMessage)) as SaveAnswerProxyResponse;
        if (savedRes?.ok) {
          newlySavedAnswers.push(savedRes.data);
        }
      }

      if (newlySavedAnswers.length > 0 && cachedData) {
        const updatedCache: CachedUserData = {
          ...cachedData,
          savedAnswers: [...newlySavedAnswers, ...cachedData.savedAnswers]
        };
        setCachedData(updatedCache);
        await saveCachedUserData(updatedCache);
      }

      const answeredIds = new Set(answeredQuestions.map((q) => q.fieldId));
      const remaining = pendingQuestions.filter((q) => !answeredIds.has(q.fieldId));
      setPendingQuestions(remaining);
      setStatusMsg(
        remaining.length === 0
          ? `Filled ${execRes.filledCount} required answer(s). Review & click Submit when ready.`
          : `Filled ${execRes.filledCount} answer(s); ${remaining.length} required field(s) remaining.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to fill answers.');
    } finally {
      setSubmittingAnswers(false);
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
        webBaseUrl?: string;
        supabaseUrl?: string;
        supabaseAnonKey?: string;
        accessToken?: string;
        refreshToken?: string;
        email?: string;
      };
      if (!parsed.accessToken) throw new Error('Session JSON is missing accessToken.');

      const nextSettings = await saveExtensionSettings({
        apiBaseUrl: parsed.apiBaseUrl || apiUrlInput,
        webBaseUrl: parsed.webBaseUrl || webUrlInput,
        ...(parsed.supabaseUrl ? { supabaseUrl: parsed.supabaseUrl } : {}),
        ...(parsed.supabaseAnonKey ? { supabaseAnonKey: parsed.supabaseAnonKey } : {})
      });
      setSettings(nextSettings);
      setApiUrlInput(nextSettings.apiBaseUrl);
      setWebUrlInput(nextSettings.webBaseUrl);
      setSbUrlInput(nextSettings.supabaseUrl);
      setSbAnonInput(nextSettings.supabaseAnonKey);

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
      const nextVarId =
        fresh.profileVariants.find((v) => v.isDefault)?.id ??
        fresh.profileVariants[0]?.id ??
        '';
      const nextResId = fresh.resumeVersions[0]?.id ?? '';
      const nextCoverId = fresh.coverLetters[0]?.id ?? '';
      setSelectedVariantId(nextVarId);
      setSelectedResumeId(nextResId);
      setSelectedCoverLetterId(nextCoverId);
      setStatusMsg(`Connected and synced (${newSess.email}).`);
      setTab('review');
      await scanActiveTab(fresh, nextVarId, nextResId, nextCoverId, nextSettings);
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
        webBaseUrl: webUrlInput,
        supabaseUrl: sbUrlInput,
        supabaseAnonKey: sbAnonInput
      });
      setSettings(nextSettings);
      if (!nextSettings.supabaseUrl || !nextSettings.supabaseAnonKey) {
        throw new Error('Open JobPilot Web once or set Supabase URL & Key in Advanced Settings below.');
      }
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
      const nextVarId =
        fresh.profileVariants.find((v) => v.isDefault)?.id ??
        fresh.profileVariants[0]?.id ??
        '';
      const nextResId = fresh.resumeVersions[0]?.id ?? '';
      const nextCoverId = fresh.coverLetters[0]?.id ?? '';
      setSelectedVariantId(nextVarId);
      setSelectedResumeId(nextResId);
      setSelectedCoverLetterId(nextCoverId);
      setStatusMsg(`Signed in and synced (${newSess.email}).`);
      setTab('review');
      await scanActiveTab(fresh, nextVarId, nextResId, nextCoverId, nextSettings);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Sign-in failed.');
    }
  };

  const handleDisconnect = async () => {
    await Promise.all([saveExtensionSession(null), saveCachedUserData(null)]);
    setSession(null);
    setCachedData(null);
    setPlanItems([]);
    lastFallbackRef.current = [];
    setAtsReport(null);
    setStatusMsg('Cleared stored extension session & local profile cache.');
  };

  const handleGrantPendingPermission = () => {
    if (!pendingPermissionAdapterId) return;
    const meta = getAdapterById(pendingPermissionAdapterId);
    if (meta.hostOriginPatterns.length === 0) return;
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
    const nonApiUnlocked = cachedData?.billing?.entitlements.nonApiAdaptersUnlocked ?? true;
    if (enabled && meta.category === 'non_api_session' && !nonApiUnlocked) {
      setUpgradePrompt(
        `${meta.displayName} opt-in autofill requires Pro, 90-Day Sprint Pass, or Plus.`
      );
      return;
    }
    void (async () => {
      setErrorMsg(null);
      if (enabled && meta.hostOriginPatterns.length > 0) {
        try {
          const alreadyAllowed = await chrome.permissions.contains({
            origins: [...meta.hostOriginPatterns]
          });
          if (!alreadyAllowed) {
            const granted = await chrome.permissions.request({
              origins: [...meta.hostOriginPatterns]
            });
            if (!granted) {
              setErrorMsg(`Permission denied — ${meta.displayName} remains disabled.`);
              return;
            }
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
          // Host access is managed via host_permissions
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
      await scanActiveTab(
        cachedData,
        selectedVariantId,
        selectedResumeId,
        selectedCoverLetterId,
        next
      );
    })();
  };

  const includedCount = planItems.filter((p) => p.included).length;
  const unresolvedCount = planItems.filter(
    (p) => !p.alreadyFilled && p.controlType !== 'file' && !p.proposedValue.trim()
  ).length;
  const hasEnoughJdForAts = Boolean(
    scan?.jobMetadata.descriptionClean && scan.jobMetadata.descriptionClean.trim().length >= 20
  );

  return (
    <div className="jp-shell">
      <header className="jp-header">
        <div className="jp-brand-row">
          <span className="jp-brand">[JP] JobPilot MV3</span>
          <div className="jp-row" style={{ gap: '6px' }}>
            {cachedData?.billing ? (
              <button
                type="button"
                className="jp-badge"
                style={{ cursor: 'pointer' }}
                title="Open Plans & Credits"
                onClick={() => void chrome.tabs.create({ url: `${settings.webBaseUrl}/billing` })}
              >
                {cachedData.billing.plan.name.toUpperCase()} ·{' '}
                {cachedData.billing.executionMode === 'byok'
                  ? 'BYOK'
                  : `${cachedData.billing.totalCreditsRemaining} CR`}
              </button>
            ) : null}
            <span className={session ? 'jp-badge jp-badge-ok' : 'jp-badge jp-badge-warn'}>
              {session ? 'CONNECTED' : 'OFFLINE'}
            </span>
          </div>
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
            Works on any job portal or custom career site · Never submits automatically.
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
          Account
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
        {errorMsg ? (
          <div className="jp-banner jp-banner-error" role="alert">
            [err] {errorMsg}
          </div>
        ) : null}
        {upgradePrompt ? (
          <div className="jp-banner jp-banner-warn" role="alert">
            <div style={{ marginBottom: 6 }}>[upgrade] {upgradePrompt}</div>
            <button
              type="button"
              className="jp-btn jp-btn-primary"
              onClick={() => void chrome.tabs.create({ url: `${settings.webBaseUrl}/billing` })}
            >
              Open Plans &amp; Credits -&gt;
            </button>
          </div>
        ) : null}
        {statusMsg ? (
          <div className="jp-banner jp-banner-ok" role="status">
            [ok] {statusMsg}
          </div>
        ) : null}

        {submitPrompt ? (
          <div className="jp-panel" role="status" aria-label="Post-submit tracker confirmation">
            <div className="jp-label">&gt; Submitted! Mark application as APPLIED?</div>
            <div className="jp-meta">
              {submitPrompt.companyName} — {submitPrompt.title}
            </div>
            <div className="jp-row">
              <button
                type="button"
                className="jp-btn jp-btn-primary"
                disabled={markingApplied}
                onClick={() => void handleMarkSubmittedApplied()}
              >
                {markingApplied ? 'Saving...' : 'Mark Applied'}
              </button>
              <button
                type="button"
                className="jp-btn"
                onClick={() => setSubmitPrompt(null)}
              >
                Dismiss
              </button>
            </div>
          </div>
        ) : null}

        {tab === 'review' ? (
          <>
            <div className="jp-banner jp-banner-warn">
              <strong>[!] REVIEW REQUIRED:</strong> JobPilot fills checked fields only and NEVER
              clicks Submit automatically.
            </div>

            {effectiveProfile ? <QuickCopyBar profile={effectiveProfile} /> : null}

            {tailorHandoffNote ? (
              <div className="jp-banner jp-banner-ok" role="status">
                [tailor] {tailorHandoffNote}
              </div>
            ) : null}

            {nextStepFieldCount != null ? (
              <div className="jp-panel jp-hero-card" role="status" aria-label="Next application step detected">
                <div className="jp-row" style={{ justifyContent: 'space-between' }}>
                  <div className="jp-label">Next Step Detected ({nextStepFieldCount} fields)</div>
                  <span className="jp-badge jp-badge-accent">MULTI-STEP</span>
                </div>
                <p className="jp-meta">
                  New application inputs appeared on this page. Autofill the next step in one click.
                </p>
                <div className="jp-row">
                  <button
                    type="button"
                    className="jp-btn jp-btn-primary"
                    disabled={autofilling}
                    onClick={() => {
                      setNextStepFieldCount(null);
                      void runAutofillViaJobPilot();
                    }}
                  >
                    {autofilling ? 'Autofilling...' : 'Autofill Next Step'}
                  </button>
                  <button
                    type="button"
                    className="jp-btn"
                    onClick={() => setNextStepFieldCount(null)}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ) : null}

            {pageValidationErrors.length > 0 ? (
              <div className="jp-panel jp-questions-card" role="alert" aria-label="Page validation warnings">
                <div className="jp-row" style={{ justifyContent: 'space-between' }}>
                  <div className="jp-label">
                    Page Validation Errors ({pageValidationErrors.length})
                  </div>
                  <button
                    type="button"
                    className="jp-link-btn"
                    onClick={() => setPageValidationErrors([])}
                  >
                    Dismiss
                  </button>
                </div>
                {pageValidationErrors.map((errItem, idx) => (
                  <div key={`${errItem.label}-${idx}`} className="jp-meta">
                    <strong>{errItem.label}:</strong> {errItem.message}
                  </div>
                ))}
              </div>
            ) : null}

            {learnedEdits.length > 0 ? (
              <div className="jp-panel" role="status" aria-label="Save edited answers">
                <div className="jp-label">Save Your Edits to Answer Bank?</div>
                {learnedEdits.map((edit) => (
                  <div key={edit.fieldId} className="jp-field-card">
                    <div className="jp-label">{edit.label}</div>
                    <div className="jp-meta">{edit.value}</div>
                    <div className="jp-row">
                      <button
                        type="button"
                        className="jp-btn jp-btn-primary"
                        disabled={savingLearnedFieldId === edit.fieldId}
                        onClick={() => void handleSaveLearnedEdit(edit)}
                      >
                        {savingLearnedFieldId === edit.fieldId ? 'Saving...' : 'Save Answer'}
                      </button>
                      <button
                        type="button"
                        className="jp-btn"
                        onClick={() =>
                          setLearnedEdits((prev) =>
                            prev.filter((item) => item.fieldId !== edit.fieldId)
                          )
                        }
                      >
                        Ignore
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {!session || !cachedData ? (
              <div className="jp-panel">
                <div className="jp-label">Connect Your JobPilot Account</div>
                <p className="jp-meta">
                  Sign in once on JobPilot Web and this extension syncs automatically.
                </p>
                <div className="jp-row">
                  <button
                    type="button"
                    className="jp-btn jp-btn-primary"
                    onClick={handleOpenWebLogin}
                  >
                    Sign in on JobPilot Web -&gt;
                  </button>
                  <button
                    type="button"
                    className="jp-btn"
                    disabled={detectingWebAuth}
                    onClick={() => void handleDetectWebSession()}
                  >
                    {detectingWebAuth ? 'Checking...' : 'Detect Web Login'}
                  </button>
                </div>
              </div>
            ) : pendingPermissionAdapterId ? (
              <div className="jp-panel">
                <div className="jp-label">
                  Host Permission Required ({getAdapterById(pendingPermissionAdapterId).displayName})
                </div>
                <p className="jp-meta">
                  Grant access to this domain so JobPilot can read the active job details and scan
                  application inputs on click.
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
              <div className="jp-panel jp-hero-card">
                <div className="jp-row" style={{ justifyContent: 'space-between' }}>
                  <div className="jp-label">Autofill via JobPilot</div>
                  <span className="jp-badge jp-badge-accent">ANY SITE</span>
                </div>
                <p className="jp-meta">
                  {waitingForForm
                    ? 'Waiting for application inputs to appear — click Apply or Next on the page, or click below once inputs render.'
                    : 'Scan and autofill any job portal or company career page using AI, asking only missing required questions.'}
                </p>
                <div className="jp-row" style={{ gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="jp-btn jp-btn-primary jp-btn-lg"
                    disabled={autofilling || scanning}
                    onClick={() => void runAutofillViaJobPilot()}
                  >
                    {autofilling ? 'Autofilling...' : 'Autofill via JobPilot'}
                  </button>
                  <button
                    type="button"
                    className="jp-btn"
                    disabled={savingJob}
                    onClick={() => void handleSaveAnyActivePage()}
                  >
                    {savingJob ? 'Saving...' : '[+] Save Page'}
                  </button>
                  <button
                    type="button"
                    className="jp-btn"
                    disabled={scanning}
                    onClick={() => void scanActiveTab()}
                  >
                    {scanning ? 'Scanning...' : 'Scan Tab'}
                  </button>
                </div>
              </div>
            ) : scan.disabledByUser ? (
              <div className="jp-panel">
                <div className="jp-label">
                  Adapter Disabled ({getAdapterById(scan.adapterId).displayName})
                </div>
                {scan.tosWarning ? (
                  <div className="jp-banner jp-banner-warn">{scan.tosWarning}</div>
                ) : null}
                <p className="jp-meta">
                  Turn this adapter on in Adapters for autofill, or save this page directly to your
                  Tracker (Alt+Shift+S).
                </p>
                <div className="jp-row" style={{ gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="jp-btn"
                    disabled={savingJob}
                    onClick={() => void handleSaveAnyActivePage()}
                  >
                    {savingJob ? 'Saving...' : '[+] Save Page to Tracker'}
                  </button>
                  <button
                    type="button"
                    className="jp-btn jp-btn-primary"
                    onClick={() => setTab('adapters')}
                  >
                    Open Adapters Settings -&gt;
                  </button>
                </div>
              </div>
            ) : (
              <>
                {scan.tosRiskLevel !== 'none' && scan.tosWarning ? (
                  <div className="jp-banner jp-banner-warn">
                    <strong>[{scan.tosRiskLevel.toUpperCase()} ToS NOTICE]</strong> {scan.tosWarning}
                  </div>
                ) : null}

                <section className="jp-panel jp-hero-card" aria-label="Autofill via JobPilot">
                  <div className="jp-row" style={{ justifyContent: 'space-between' }}>
                    <div className="jp-label">Autofill via JobPilot</div>
                    <span className="jp-badge jp-badge-accent">
                      {scan.adapterId === 'generic' ? 'UNIVERSAL' : scan.adapterId.toUpperCase()} ·{' '}
                      {scan.fields.length} FIELD(S)
                    </span>
                  </div>
                  <p className="jp-meta">
                    {waitingForForm
                      ? 'No form inputs visible yet — click Apply on this job page and JobPilot will fill automatically.'
                      : 'Maps known fields + AI-matched answers automatically, skipping optional guesswork.'}
                  </p>
                  <div className="jp-row">
                    <button
                      type="button"
                      className="jp-btn jp-btn-primary jp-btn-lg"
                      disabled={autofilling}
                      onClick={() => void runAutofillViaJobPilot()}
                    >
                      {autofilling ? 'Autofilling...' : 'Autofill via JobPilot'}
                    </button>
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
                      disabled={scan.fields.length === 0}
                      onClick={() => void handleUndoFill()}
                    >
                      Undo
                    </button>
                  </div>
                </section>

                {pendingQuestions.length > 0 ? (
                  <section className="jp-panel jp-questions-card" aria-label="Required questions needed">
                    <div className="jp-row" style={{ justifyContent: 'space-between' }}>
                      <span className="jp-label">
                        Quick Questions Needed ({pendingQuestions.length})
                      </span>
                      <span className="jp-badge jp-badge-warn">REQUIRED ONLY</span>
                    </div>
                    <div className="jp-meta">
                      Optional fields were skipped. Answer these required items to finish filling:
                    </div>
                    <div className="jp-field-list">
                      {pendingQuestions.map((q) => {
                        const answerVal = questionAnswers[q.fieldId] ?? '';
                        return (
                          <div key={q.fieldId} className="jp-field-card">
                            <div className="jp-field-top">
                              <span className="jp-label">{q.question}</span>
                              <span className="jp-badge jp-badge-warn">REQUIRED</span>
                            </div>
                            {q.reason ? <div className="jp-meta">{q.reason}</div> : null}
                            {q.options && q.options.length > 0 ? (
                              <div className="jp-select-wrap">
                                <select
                                  className="jp-select"
                                  aria-label={q.question}
                                  value={answerVal}
                                  onChange={(e) =>
                                    setQuestionAnswers((prev) => ({
                                      ...prev,
                                      [q.fieldId]: e.target.value
                                    }))
                                  }
                                >
                                  <option value="">-- Select an option --</option>
                                  {q.options.map((opt) => (
                                    <option key={opt} value={opt}>
                                      {opt}
                                    </option>
                                  ))}
                                </select>
                                <span className="jp-select-chevron" aria-hidden="true">
                                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                                    <path
                                      d="M4 6L8 10L12 6"
                                      stroke="currentColor"
                                      strokeWidth="1.5"
                                      strokeLinecap="square"
                                    />
                                  </svg>
                                </span>
                              </div>
                            ) : q.controlType === 'textarea' ? (
                              <textarea
                                rows={2}
                                className="jp-textarea"
                                aria-label={q.question}
                                placeholder="Type your answer..."
                                value={answerVal}
                                onChange={(e) =>
                                  setQuestionAnswers((prev) => ({
                                    ...prev,
                                    [q.fieldId]: e.target.value
                                  }))
                                }
                              />
                            ) : (
                              <input
                                type="text"
                                className="jp-input"
                                aria-label={q.question}
                                placeholder="Type your answer..."
                                value={answerVal}
                                onChange={(e) =>
                                  setQuestionAnswers((prev) => ({
                                    ...prev,
                                    [q.fieldId]: e.target.value
                                  }))
                                }
                              />
                            )}
                            <label className="jp-row" style={{ cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={Boolean(saveQuestionIds[q.fieldId])}
                                onChange={(e) =>
                                  setSaveQuestionIds((prev) => ({
                                    ...prev,
                                    [q.fieldId]: e.target.checked
                                  }))
                                }
                              />
                              <span className="jp-meta">Save to Answer Bank for future portals</span>
                            </label>
                          </div>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      className="jp-btn jp-btn-primary"
                      disabled={
                        submittingAnswers ||
                        pendingQuestions.every((q) => !(questionAnswers[q.fieldId] ?? '').trim())
                      }
                      onClick={() => void handleSubmitMissingQuestions()}
                    >
                      {submittingAnswers
                        ? 'Filling Answers...'
                        : `Fill ${pendingQuestions.filter((q) => (questionAnswers[q.fieldId] ?? '').trim()).length} Answer(s)`}
                    </button>
                  </section>
                ) : null}

                {/* Save This Job card */}
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

                {/* Live ATS Score Card (#2) */}
                <AtsMatchCard
                  report={atsReport}
                  loading={scoringAts}
                  hasEnoughJd={hasEnoughJdForAts}
                  onOpenTailor={() => {
                    void chrome.tabs.create({
                      url: `${settings.webBaseUrl.replace(/\/$/, '')}/tailor`
                    });
                  }}
                />

                {/* Variant, Tailored Resume + Quick Tailor, Cover Letter & Action Toolbar (#3, #4) */}
                <section className="jp-panel" aria-label="Tailored resume and actions">
                  {cachedData.profileVariants.length > 0 ? (
                    <>
                      <span className="jp-label">
                        Profile Variant ({cachedData.profileVariants.length})
                      </span>
                      <div className="jp-select-wrap">
                        <select
                          className="jp-select"
                          aria-label="Profile variant"
                          value={selectedVariantId}
                          onChange={(e) => {
                            const nextVarId = e.target.value;
                            setSelectedVariantId(nextVarId);
                            recomputePlan(
                              scan,
                              cachedData,
                              nextVarId,
                              selectedResumeId,
                              selectedCoverLetterId
                            );
                          }}
                        >
                          {cachedData.profileVariants.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.name} {v.isDefault ? '(Default)' : ''}
                            </option>
                          ))}
                        </select>
                        <span className="jp-select-chevron" aria-hidden="true">
                          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                            <path
                              d="M4 6L8 10L12 6"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="square"
                            />
                          </svg>
                        </span>
                      </div>
                    </>
                  ) : null}

                  <div className="jp-row" style={{ justifyContent: 'space-between' }}>
                    <span className="jp-label">
                      Tailored Resume ({cachedData.resumeVersions.length})
                    </span>
                    <span className="jp-meta">{scan.fields.length} field(s) detected</span>
                  </div>

                  <div className="jp-select-wrap">
                    <select
                      className="jp-select"
                      aria-label="Tailored resume version"
                      value={selectedResumeId}
                      onChange={(e) => {
                        const nextId = e.target.value;
                        setSelectedResumeId(nextId);
                        recomputePlan(
                          scan,
                          cachedData,
                          selectedVariantId,
                          nextId,
                          selectedCoverLetterId
                        );
                      }}
                    >
                      <option value="">Profile details only (no PDF upload)</option>
                      {cachedData.resumeVersions.map((ver) => (
                        <option key={ver.id} value={ver.id}>
                          v{ver.versionNumber} · {ver.label} (
                          {ver.verifierPassed ? 'VERIFIED' : 'FLAGGED'})
                        </option>
                      ))}
                    </select>
                    <span className="jp-select-chevron" aria-hidden="true">
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                        <path
                          d="M4 6L8 10L12 6"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="square"
                        />
                      </svg>
                    </span>
                  </div>

                  {/* Quick Tailor in-place (#3) */}
                  <div className="jp-row" style={{ gap: '6px' }}>
                    <div className="jp-select-wrap" style={{ flex: 1 }}>
                      <select
                        className="jp-select"
                        aria-label="Template for quick tailor"
                        value={tailorTemplateId}
                        onChange={(e) => setTailorTemplateId(e.target.value as ResumeTemplateId)}
                      >
                        <option value="ats-classic">Classic 1-pg</option>
                        <option value="ats-compact">Compact 1-pg</option>
                        <option value="ats-detailed">Detailed 2-pg</option>
                        <option value="ats-executive">Executive Serif</option>
                      </select>
                      <span className="jp-select-chevron" aria-hidden="true">
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                          <path
                            d="M4 6L8 10L12 6"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="square"
                          />
                        </svg>
                      </span>
                    </div>
                    <button
                      type="button"
                      className="jp-btn"
                      disabled={tailoringHere || !hasEnoughJdForAts}
                      onClick={() => void handleTailorNowInExtension()}
                    >
                      {tailoringHere ? 'Tailoring...' : '[+] Tailor Now'}
                    </button>
                  </div>

                  {cachedData.coverLetters.length > 0 ? (
                    <>
                      <span className="jp-label">
                        Cover Letter ({cachedData.coverLetters.length})
                      </span>
                      <div className="jp-select-wrap">
                        <select
                          className="jp-select"
                          aria-label="Cover letter version"
                          value={selectedCoverLetterId}
                          onChange={(e) => {
                            const nextClId = e.target.value;
                            setSelectedCoverLetterId(nextClId);
                            recomputePlan(
                              scan,
                              cachedData,
                              selectedVariantId,
                              selectedResumeId,
                              nextClId
                            );
                          }}
                        >
                          <option value="">-- Fallback to summary / saved answer --</option>
                          {cachedData.coverLetters.map((cl) => (
                            <option key={cl.id} value={cl.id}>
                              v{cl.versionNumber} · {cl.label} ({cl.tone})
                            </option>
                          ))}
                        </select>
                        <span className="jp-select-chevron" aria-hidden="true">
                          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                            <path
                              d="M4 6L8 10L12 6"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="square"
                            />
                          </svg>
                        </span>
                      </div>
                    </>
                  ) : null}

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

                <details className="jp-details">
                  <summary>
                    Review All Detected Fields ({planItems.length}) · {includedCount} Ready
                  </summary>
                  <section className="jp-field-list" aria-label="Detected form fields">
                  {planItems.map((item) => {
                    const conf = confidenceLabel(item.confidence, item.alreadyFilled);
                    const result = execResults.get(item.fieldId);
                    const canSaveToBank =
                      !item.alreadyFilled &&
                      item.controlType !== 'file' &&
                      item.proposedValue.trim().length > 0 &&
                      (item.source === 'user_edited' || item.source === 'llm_draft');

                    return (
                      <div key={item.fieldId} className="jp-field-card">
                        <div className="jp-field-top">
                          <label
                            className="jp-row"
                            style={{ cursor: item.alreadyFilled ? 'not-allowed' : 'pointer' }}
                          >
                            <input
                              type="checkbox"
                              disabled={item.alreadyFilled}
                              checked={item.included}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setPlanItems((prev) =>
                                  prev.map((p) => {
                                    if (p.fieldId !== item.fieldId) return p;
                                    const nextItem = { ...p, included: checked };
                                    persistFieldEdit(p.fieldId, nextItem);
                                    return nextItem;
                                  })
                                );
                              }}
                            />
                            <span className="jp-label">{item.label}</span>
                          </label>
                          <span className={conf.cls}>{conf.text}</span>
                        </div>

                        <div className="jp-row" style={{ justifyContent: 'space-between' }}>
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

                          {canSaveToBank ? (
                            <button
                              type="button"
                              className="jp-link-btn"
                              disabled={savingAnswerFieldId === item.fieldId}
                              onClick={() => void handleSaveFieldToAnswerBank(item)}
                            >
                              {savingAnswerFieldId === item.fieldId
                                ? 'Saving...'
                                : '+ Save Answer'}
                            </button>
                          ) : null}
                        </div>

                        {item.alreadyFilled ? (
                          <div className="jp-meta">
                            [=] Already filled by you/ATS — preserved untouched.
                          </div>
                        ) : item.controlType === 'file' ? (
                          <div className="jp-meta">
                            File upload: {item.displayValue || 'Select a version above'}
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
                                prev.map((p) => {
                                  if (p.fieldId !== item.fieldId) return p;
                                  const nextItem: FillPlanItem = {
                                    ...p,
                                    proposedValue: nextVal,
                                    displayValue: nextVal,
                                    source: 'user_edited',
                                    included: nextVal.trim().length > 0
                                  };
                                  persistFieldEdit(p.fieldId, nextItem);
                                  return nextItem;
                                })
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
                                prev.map((p) => {
                                  if (p.fieldId !== item.fieldId) return p;
                                  const nextItem: FillPlanItem = {
                                    ...p,
                                    proposedValue: nextVal,
                                    displayValue: nextVal,
                                    source: 'user_edited',
                                    included: nextVal.trim().length > 0
                                  };
                                  persistFieldEdit(p.fieldId, nextItem);
                                  return nextItem;
                                })
                              );
                            }}
                          />
                        )}
                      </div>
                    );
                  })}
                  </section>
                </details>
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
                    className="jp-btn"
                    disabled={detectingWebAuth}
                    onClick={() => void handleDetectWebSession()}
                  >
                    {detectingWebAuth ? 'Checking...' : 'Re-sync Web Session'}
                  </button>
                  <button
                    type="button"
                    className="jp-btn jp-btn-danger"
                    onClick={() => void handleDisconnect()}
                  >
                    Sign Out
                  </button>
                </div>
              </div>
            ) : (
              <div className="jp-panel">
                <div className="jp-label">One-Click Sign In via JobPilot Web</div>
                <p className="jp-meta">
                  Already logged in on Google or Email in the web app? Or open the login page —
                  extension syncs automatically the moment you sign in.
                </p>
                <div className="jp-row">
                  <button
                    type="button"
                    className="jp-btn jp-btn-primary"
                    onClick={handleOpenWebLogin}
                  >
                    [→] Sign in on JobPilot Web
                  </button>
                  <button
                    type="button"
                    className="jp-btn"
                    disabled={detectingWebAuth}
                    onClick={() => void handleDetectWebSession()}
                  >
                    {detectingWebAuth ? 'Checking...' : '[↻] Detect Website Login'}
                  </button>
                </div>
              </div>
            )}

            <form className="jp-panel" onSubmit={handlePasswordSignIn}>
              <div className="jp-label">Sign In Directly (Email &amp; Password)</div>
              <input
                className="jp-input"
                type="email"
                aria-label="Email"
                placeholder="you@example.com"
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
              <button
                type="submit"
                className="jp-btn"
                disabled={!emailInput.trim() || !passwordInput}
              >
                Sign In to Extension
              </button>
            </form>

            <details className="jp-details">
              <summary>Advanced: Custom Server &amp; Manual Session JSON</summary>
              <form className="jp-field-list" onSubmit={handleConnectWithSessionJson}>
                <label className="jp-label" htmlFor="jp-web-url">
                  Web App URL
                </label>
                <input
                  id="jp-web-url"
                  className="jp-input"
                  value={webUrlInput}
                  onChange={(e) => setWebUrlInput(e.target.value)}
                />
                <label className="jp-label" htmlFor="jp-api-url">
                  API Server URL
                </label>
                <input
                  id="jp-api-url"
                  className="jp-input"
                  value={apiUrlInput}
                  onChange={(e) => setApiUrlInput(e.target.value)}
                />
                <label className="jp-label" htmlFor="jp-sb-url">
                  Supabase URL (auto-populated from web tab)
                </label>
                <input
                  id="jp-sb-url"
                  className="jp-input"
                  placeholder="https://xxxx.supabase.co"
                  value={sbUrlInput}
                  onChange={(e) => setSbUrlInput(e.target.value)}
                />
                <label className="jp-label" htmlFor="jp-sb-key">
                  Supabase Publishable Key
                </label>
                <input
                  id="jp-sb-key"
                  className="jp-input"
                  placeholder="sb_publishable_..."
                  value={sbAnonInput}
                  onChange={(e) => setSbAnonInput(e.target.value)}
                />
                <button
                  type="button"
                  className="jp-btn"
                  onClick={() => {
                    void saveExtensionSettings({
                      webBaseUrl: webUrlInput,
                      apiBaseUrl: apiUrlInput,
                      supabaseUrl: sbUrlInput,
                      supabaseAnonKey: sbAnonInput
                    }).then((next) => {
                      setSettings(next);
                      setStatusMsg('Saved custom endpoint settings.');
                    });
                  }}
                >
                  Save Endpoints
                </button>
                <label className="jp-label" htmlFor="jp-sess-json">
                  Manual Session JSON Fallback
                </label>
                <textarea
                  id="jp-sess-json"
                  rows={3}
                  className="jp-textarea"
                  value={sessionJsonText}
                  onChange={(e) => setSessionJsonText(e.target.value)}
                  placeholder='{"apiBaseUrl": "...", "accessToken": "...", "refreshToken": "..."}'
                />
                <button type="submit" className="jp-btn" disabled={!sessionJsonText.trim()}>
                  Import Session JSON
                </button>
              </form>
            </details>
          </div>
        ) : null}

        {tab === 'adapters' ? (
          <div className="jp-field-list">
            <div className="jp-panel">
              <div className="jp-label">Official ATS Adapters</div>
              <p className="jp-meta">
                Greenhouse, Lever, and Ashby are pre-scoped; Workday requests optional host
                permission on demand.
              </p>
              {OFFICIAL_ATS_ADAPTERS.map((adapter) => {
                const key = adapter.id as keyof AdapterEnabledMap;
                return (
                  <label
                    key={adapter.id}
                    className="jp-row"
                    style={{ cursor: 'pointer', minHeight: 32 }}
                  >
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
              <div className="jp-field-top">
                <div className="jp-label">Opt-In Session Portals (Non-API, ToS Risk)</div>
                {cachedData?.billing && !cachedData.billing.entitlements.nonApiAdaptersUnlocked ? (
                  <button
                    type="button"
                    className="jp-btn jp-btn-primary"
                    onClick={() => void chrome.tabs.create({ url: `${settings.webBaseUrl}/billing` })}
                  >
                    Unlock on Pro -&gt;
                  </button>
                ) : null}
              </div>
              <p className="jp-meta">
                All 6 portals below are OFF by default and never scraped server-side. Turning one on
                requests host permission only for that portal, runs strictly when you click in your
                own logged-in tab, and pauses before Submit.
              </p>
              {NON_API_SESSION_ADAPTERS.map((adapter) => {
                const key = adapter.id as keyof AdapterEnabledMap;
                const nonApiUnlocked =
                  cachedData?.billing?.entitlements.nonApiAdaptersUnlocked ?? true;
                return (
                  <div key={adapter.id} className="jp-field-card">
                    <div className="jp-field-top">
                      <label
                        className="jp-row"
                        style={{
                          cursor: nonApiUnlocked ? 'pointer' : 'not-allowed',
                          opacity: nonApiUnlocked ? 1 : 0.65
                        }}
                      >
                        <input
                          type="checkbox"
                          disabled={!nonApiUnlocked}
                          checked={settings.enabledAdapters[key]}
                          onChange={(e) => handleToggleAdapter(key, e.target.checked)}
                        />
                        <span className="jp-label">{adapter.displayName}</span>
                      </label>
                      <div className="jp-row" style={{ gap: 4 }}>
                        {!nonApiUnlocked ? <span className="jp-badge">PRO</span> : null}
                        <span
                          className={
                            adapter.tosRiskLevel === 'high' ? 'jp-badge jp-badge-warn' : 'jp-badge'
                          }
                        >
                          {adapter.tosRiskLevel.toUpperCase()} RISK
                        </span>
                      </div>
                    </div>
                    <div className="jp-meta">{adapter.tosWarning}</div>
                  </div>
                );
              })}
            </div>
            <div className="jp-panel">
              <div className="jp-label">Inline Button Visibility (&quot;Autofill via JobPilot&quot;)</div>
              <p className="jp-meta">
                Off by default so non-job pages stay clean. Side panel and right-click Autofill
                always work on any website without enabling this.
              </p>
              <label className="jp-row" style={{ cursor: 'pointer', minHeight: 32 }}>
                <input
                  type="checkbox"
                  checked={settings.showInlineApplyButton}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    void saveExtensionSettings({ showInlineApplyButton: checked }).then((next) => {
                      setSettings(next);
                      setStatusMsg(
                        checked
                          ? 'Enabled opt-in inline "Autofill via JobPilot" button beside job Apply CTAs.'
                          : 'Disabled inline "Autofill via JobPilot" button on web pages.'
                      );
                    });
                  }}
                />
                <span>
                  Show inline &quot;Autofill via JobPilot&quot; button beside Apply CTAs (Opt-in)
                </span>
              </label>
              {settings.showInlineApplyButton && scan?.url && /^https?:\/\//i.test(scan.url) ? (
                (() => {
                  let currentHost = '';
                  try {
                    currentHost = new URL(scan.url).hostname.toLowerCase();
                  } catch {
                    currentHost = '';
                  }
                  if (!currentHost) return null;
                  const currentlyHidden = settings.hiddenCtaDomains.includes(currentHost);
                  return (
                    <div className="jp-row" style={{ justifyContent: 'space-between' }}>
                      <span className="jp-meta">Current site: {currentHost}</span>
                      <button
                        type="button"
                        className="jp-btn"
                        onClick={() =>
                          void handleToggleHiddenDomain(currentHost, !currentlyHidden)
                        }
                      >
                        {currentlyHidden ? 'Show on This Site' : 'Hide on This Site'}
                      </button>
                    </div>
                  );
                })()
              ) : null}
              {settings.showInlineApplyButton && settings.hiddenCtaDomains.length > 0 ? (
                <div className="jp-field-list">
                  {settings.hiddenCtaDomains.map((domain) => (
                    <div
                      key={domain}
                      className="jp-field-card"
                      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                    >
                      <span className="jp-label">{domain}</span>
                      <button
                        type="button"
                        className="jp-btn"
                        onClick={() => void handleToggleHiddenDomain(domain, false)}
                      >
                        Restore
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
