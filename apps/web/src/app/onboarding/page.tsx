'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  INDIAN_TECH_HUBS,
  type IndiaProfile,
  type LlmProviderId,
  type LlmSettingsItem,
  type MasterProfile,
  type ModelInfo,
  type ParsedResumeOutput
} from '@jobpilot/shared';
import { AppShell } from '@/components/layout/app-shell';
import {
  AlertBanner,
  Badge,
  Button,
  Field,
  Input,
  SectionBlock,
  Select
} from '@/components/ui/primitives';
import { api } from '@/lib/api';

const PROVIDER_LABELS: Record<LlmProviderId, string> = {
  gemini: 'Google Gemini',
  openai: 'OpenAI',
  meta: 'Meta Llama API'
};

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Step 1: AI Provider quick setup
  const [llmItems, setLlmItems] = useState<LlmSettingsItem[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<LlmProviderId>('gemini');
  const [byokInput, setByokInput] = useState('');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [testingKey, setTestingKey] = useState(false);

  // Step 2: PDF Resume Upload
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parsedPreview, setParsedPreview] = useState<ParsedResumeOutput | null>(null);
  const [storagePath, setStoragePath] = useState<string | null>(null);

  // Step 3: India & Eligibility confirmation
  const [profile, setProfile] = useState<MasterProfile | null>(null);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [india, setIndia] = useState<IndiaProfile | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([api.getProfile(), api.getLlmSettings()])
      .then(([prof, llm]) => {
        if (!active) return;
        setProfile(prof);
        setFullName(prof.fullName ?? '');
        setEmail(prof.email ?? '');
        setPhone(prof.phone ?? '');
        setIndia(prof.indiaProfile);
        setLlmItems(llm.items);
        const activeProv = llm.items.find((i) => i.isActive) ?? llm.items[0];
        if (activeProv) {
          setSelectedProvider(activeProv.provider);
          setSelectedModel(activeProv.selectedModel ?? '');
        }
      })
      .catch((err) => {
        if (active) setErrorMsg(err instanceof Error ? err.message : 'Failed to load setup.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const currentProviderRow = llmItems.find((i) => i.provider === selectedProvider);

  const handleSaveAndTestKey = async () => {
    setTestingKey(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      await api.upsertLlmSetting(selectedProvider, {
        isActive: true,
        ...(byokInput.trim() ? { apiKey: byokInput.trim() } : {}),
        ...(selectedModel ? { selectedModel } : {})
      });
      const modelsRes = await api.listProviderModels({
        provider: selectedProvider,
        ...(byokInput.trim() ? { apiKey: byokInput.trim() } : {})
      });
      setModels(modelsRes.models);
      const modelToTest = selectedModel || modelsRes.models[0]?.id;
      if (modelToTest && !selectedModel) {
        setSelectedModel(modelToTest);
        await api.upsertLlmSetting(selectedProvider, { selectedModel: modelToTest });
      }
      const testRes = await api.testLlmKey({
        provider: selectedProvider,
        model: modelToTest
      });
      if (!testRes.ok) {
        setErrorMsg(testRes.message);
      } else {
        setStatusMsg(`${testRes.message} (${testRes.latencyMs} ms)`);
        setByokInput('');
        const refreshed = await api.getLlmSettings();
        setLlmItems(refreshed.items);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Provider verification failed.');
    } finally {
      setTestingKey(false);
    }
  };

  const handleParseResume = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setErrorMsg('Select a text-based PDF resume file first.');
      return;
    }
    setParsing(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await api.parseResumePdf(selectedFile, {
        apply: true,
        provider: selectedProvider,
        model: selectedModel || undefined
      });
      setParsedPreview(res.parsed);
      setStoragePath(res.storagePath);
      if (res.appliedProfile) {
        setProfile(res.appliedProfile);
      }
      if (res.parsed.fullName) setFullName(res.parsed.fullName);
      if (res.parsed.email) setEmail(res.parsed.email);
      if (res.parsed.phone) setPhone(res.parsed.phone);
      if (india) {
        const sig = res.parsed.extractedIndiaSignals;
        setIndia({
          ...india,
          collegeName: sig.collegeName ?? india.collegeName,
          degree: sig.degree ?? india.degree,
          branch: sig.branch ?? india.branch,
          graduationYear:
            sig.graduationYear !== undefined ? sig.graduationYear : india.graduationYear,
          cgpa: sig.cgpa !== undefined ? sig.cgpa : india.cgpa,
          cgpaScale: sig.cgpaScale ?? india.cgpaScale,
          tenthPercentage:
            sig.tenthPercentage !== undefined ? sig.tenthPercentage : india.tenthPercentage,
          twelfthPercentage:
            sig.twelfthPercentage !== undefined ? sig.twelfthPercentage : india.twelfthPercentage,
          isFresher: sig.isFresher !== undefined ? sig.isFresher : india.isFresher,
          preferredCities:
            sig.preferredCities && sig.preferredCities.length > 0
              ? sig.preferredCities
              : india.preferredCities
        });
      }
      setStatusMsg(
        `Parsed ${res.totalPages} page(s) with ${res.modelUsed} in ${res.latencyMs} ms. Review below & continue.`
      );
      setStep(3);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Resume parsing failed.');
    } finally {
      setParsing(false);
    }
  };

  const saveAndNavigate = async (destination: '/profile' | '/jobs' | '/tailor' | '/tracker') => {
    if (!india || !profile) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      await api.updateProfile({
        fullName: fullName.trim() || undefined,
        email: email.trim(),
        phone: phone.trim(),
        jsonResume: parsedPreview?.jsonResume ?? profile.jsonResume,
        indiaProfile: india,
        markOnboardingComplete: true
      });
      router.push(destination);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save onboarding profile.');
    } finally {
      setSaving(false);
    }
  };

  const handleCompleteOnboarding = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveAndNavigate('/profile');
  };

  const toggleCity = (city: string) => {
    if (!india) return;
    const exists = india.preferredCities.includes(city);
    setIndia({
      ...india,
      preferredCities: exists
        ? india.preferredCities.filter((c) => c !== city)
        : [...india.preferredCities, city]
    });
  };

  return (
    <AppShell
      title="Onboarding // Under 2 Minutes"
      subtitle="Connect your AI provider, parse your PDF resume into JSON Resume, and confirm India/global eligibility details."
    >
      {/* Multi-step progress tracker per forms guide */}
      <nav aria-label="Onboarding progress" className="grid grid-cols-3 gap-2">
        {[
          { num: 1 as const, label: '1. AI Provider' },
          { num: 2 as const, label: '2. Parse Resume' },
          { num: 3 as const, label: '3. India & Review' }
        ].map((item) => {
          const active = step === item.num;
          const done = step > item.num;
          return (
            <button
              key={item.num}
              type="button"
              onClick={() => setStep(item.num)}
              aria-current={active ? 'step' : undefined}
              className={`text-left px-3 py-2.5 border rounded-[4px] text-xs sm:text-sm cursor-pointer ${
                active
                  ? 'border-[var(--ink)] bg-[var(--surface-card)] font-bold text-[var(--ink)]'
                  : done
                    ? 'border-[var(--success-text)]/40 bg-[var(--success-bg)] text-[var(--success-text)]'
                    : 'border-[var(--hairline)] bg-[var(--surface-soft)] text-[var(--mute)]'
              }`}
            >
              {done ? '[x] ' : active ? '[>] ' : '[ ] '}
              {item.label}
            </button>
          );
        })}
      </nav>

      {errorMsg ? <AlertBanner tone="error" message={errorMsg} /> : null}
      {statusMsg ? <AlertBanner tone="success" message={statusMsg} /> : null}

      {loading ? (
        <div className="p-8 border border-[var(--hairline)] text-sm text-[var(--mute)]">
          Loading workspace...
        </div>
      ) : step === 1 ? (
        <SectionBlock
          title="Step 1: Choose & Verify AI Provider"
          description="Bring your own API key (encrypted AES-256-GCM server-side) or use a configured server key."
        >
          <div className="space-y-4 max-w-xl">
            <Field label="Provider" htmlFor="onb-provider">
              {(props) => (
                <Select
                  {...props}
                  value={selectedProvider}
                  onChange={(e) => {
                    setSelectedProvider(e.target.value as LlmProviderId);
                    setModels([]);
                    setSelectedModel('');
                  }}
                >
                  {(['gemini', 'openai', 'meta'] as LlmProviderId[]).map((p) => (
                    <option key={p} value={p}>
                      {PROVIDER_LABELS[p]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            {currentProviderRow ? (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge tone={currentProviderRow.hasKey ? 'success' : 'neutral'}>
                  {currentProviderRow.hasKey
                    ? `BYOK saved (${currentProviderRow.keyHint})`
                    : currentProviderRow.usingEnvFallback
                      ? 'Using server env key'
                      : 'No key saved yet'}
                </Badge>
                {currentProviderRow.lastTestStatus === 'ok' ? (
                  <Badge tone="success">Verified</Badge>
                ) : null}
              </div>
            ) : null}

            <Field
              label="API Key (BYOK — optional if server key exists)"
              htmlFor="onb-apikey"
              hint="Never logged or returned in plaintext. Leave blank to use saved/server key."
            >
              {(props) => (
                <Input
                  {...props}
                  type="password"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={byokInput}
                  onChange={(e) => setByokInput(e.target.value)}
                  placeholder="Paste provider API key..."
                />
              )}
            </Field>

            {models.length > 0 ? (
              <Field label="Live Model Selection" htmlFor="onb-model">
                {(props) => (
                  <Select
                    {...props}
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                  >
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.displayName} ({m.id})
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}

            <div className="flex flex-wrap gap-2 pt-2">
              <Button variant="primary" onClick={handleSaveAndTestKey} disabled={testingKey}>
                {testingKey ? 'Testing & fetching models...' : 'Verify & Fetch Models'}
              </Button>
              <Button variant="secondary" onClick={() => setStep(2)}>
                Continue to Resume Upload -&gt;
              </Button>
            </div>
          </div>
        </SectionBlock>
      ) : step === 2 ? (
        <SectionBlock
          title="Step 2: Upload & Parse PDF Resume"
          description="Text-based PDF up to 10 MB. Stored privately in Supabase Storage and parsed strictly without hallucinating facts."
        >
          <form onSubmit={handleParseResume} className="space-y-4 max-w-xl">
            <Field
              label="Resume PDF File"
              htmlFor="onb-pdf"
              hint="Accepted: .pdf (text-selectable, max 10 MB)"
              required
            >
              {(props) => (
                <input
                  {...props}
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm border border-dashed border-[var(--hairline-strong)] bg-[var(--surface-soft)] p-4 rounded-[4px] cursor-pointer file:mr-4 file:py-1.5 file:px-3 file:rounded-[4px] file:border file:border-[var(--hairline-strong)] file:bg-[var(--canvas)] file:text-[var(--ink)] file:text-xs file:font-medium"
                />
              )}
            </Field>

            {selectedFile ? (
              <p className="text-xs text-[var(--body)]">
                Selected: <strong>{selectedFile.name}</strong> (
                {Math.round(selectedFile.size / 1024)} KB)
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2 pt-2">
              <Button type="submit" variant="primary" disabled={parsing || !selectedFile}>
                {parsing ? 'Parsing PDF with LLM...' : 'Extract JSON Resume'}
              </Button>
              <Button variant="secondary" onClick={() => setStep(3)}>
                Skip &amp; Enter Manually -&gt;
              </Button>
            </div>
          </form>
        </SectionBlock>
      ) : india ? (
        <SectionBlock
          title="Step 3: Review Parsed Resume & India Fields"
          description={
            parsedPreview
              ? `Extracted ${parsedPreview.jsonResume.work.length} experience, ${parsedPreview.jsonResume.projects.length} project, ${parsedPreview.jsonResume.education.length} education entries.${storagePath ? ` Stored at ${storagePath}` : ''}`
              : 'Fill your key India-specific autofill fields below.'
          }
        >
          <form onSubmit={handleCompleteOnboarding} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Full Name" htmlFor="onb-name" required>
                {(props) => (
                  <Input
                    {...props}
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Email" htmlFor="onb-email">
                {(props) => (
                  <Input
                    {...props}
                    type="email"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Phone" htmlFor="onb-phone">
                {(props) => (
                  <Input
                    {...props}
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91 98XXXXXXXX"
                  />
                )}
              </Field>
            </div>

            <div className="border-t border-[var(--hairline)] pt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Field label="Current CTC (LPA)" htmlFor="onb-cctc">
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    step="0.1"
                    min={0}
                    value={india.currentCtcLpa ?? ''}
                    onChange={(e) =>
                      setIndia({
                        ...india,
                        currentCtcLpa: e.target.value === '' ? null : Number(e.target.value)
                      })
                    }
                    placeholder="0 for fresher"
                  />
                )}
              </Field>
              <Field label="Expected CTC (LPA)" htmlFor="onb-ectc">
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    step="0.1"
                    min={0}
                    value={india.expectedCtcLpa ?? ''}
                    onChange={(e) =>
                      setIndia({
                        ...india,
                        expectedCtcLpa: e.target.value === '' ? null : Number(e.target.value)
                      })
                    }
                    placeholder="12"
                  />
                )}
              </Field>
              <Field label="Notice Period (Days)" htmlFor="onb-notice">
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    min={0}
                    max={365}
                    value={india.noticePeriodDays ?? ''}
                    onChange={(e) =>
                      setIndia({
                        ...india,
                        noticePeriodDays: e.target.value === '' ? null : Number(e.target.value)
                      })
                    }
                    placeholder="0 = Immediate"
                  />
                )}
              </Field>
              <Field label="Internship / Fresher Status" htmlFor="onb-intern">
                {(props) => (
                  <Select
                    {...props}
                    value={india.internshipStatus}
                    onChange={(e) =>
                      setIndia({
                        ...india,
                        internshipStatus: e.target.value as IndiaProfile['internshipStatus']
                      })
                    }
                  >
                    <option value="none">None / Experienced</option>
                    <option value="seeking_internship">Seeking Internship</option>
                    <option value="currently_interning">Currently Interning</option>
                    <option value="completed_internship">Completed Internship</option>
                    <option value="ppo_holder">PPO Holder</option>
                  </Select>
                )}
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Field label="College / University" htmlFor="onb-college">
                {(props) => (
                  <Input
                    {...props}
                    value={india.collegeName}
                    onChange={(e) => setIndia({ ...india, collegeName: e.target.value })}
                    placeholder="IIIT / NIT / BITS..."
                  />
                )}
              </Field>
              <Field label="CGPA" htmlFor="onb-cgpa">
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    step="0.01"
                    min={0}
                    max={100}
                    value={india.cgpa ?? ''}
                    onChange={(e) =>
                      setIndia({
                        ...india,
                        cgpa: e.target.value === '' ? null : Number(e.target.value)
                      })
                    }
                  />
                )}
              </Field>
              <Field label="10th Percentage (%)" htmlFor="onb-10th">
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    step="0.1"
                    min={0}
                    max={100}
                    value={india.tenthPercentage ?? ''}
                    onChange={(e) =>
                      setIndia({
                        ...india,
                        tenthPercentage: e.target.value === '' ? null : Number(e.target.value)
                      })
                    }
                  />
                )}
              </Field>
              <Field label="12th Percentage (%)" htmlFor="onb-12th">
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    step="0.1"
                    min={0}
                    max={100}
                    value={india.twelfthPercentage ?? ''}
                    onChange={(e) =>
                      setIndia({
                        ...india,
                        twelfthPercentage: e.target.value === '' ? null : Number(e.target.value)
                      })
                    }
                  />
                )}
              </Field>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-[var(--ink)]">Preferred Cities / Hubs</p>
              <div className="flex flex-wrap gap-2">
                {INDIAN_TECH_HUBS.map((city) => {
                  const selected = india.preferredCities.includes(city);
                  return (
                    <button
                      key={city}
                      type="button"
                      onClick={() => toggleCity(city)}
                      aria-pressed={selected}
                      className={`px-2.5 py-1 text-xs rounded-[4px] border cursor-pointer ${
                        selected
                          ? 'bg-[var(--ink)] text-[var(--on-primary)] border-[var(--ink)] font-medium'
                          : 'bg-[var(--surface-soft)] text-[var(--body)] border-[var(--hairline)] hover:border-[var(--hairline-strong)]'
                      }`}
                    >
                      {selected ? '[x] ' : '[+] '}
                      {city}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-6">
              <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={india.isFresher}
                  onChange={(e) => setIndia({ ...india, isFresher: e.target.checked })}
                  className="w-4 h-4"
                />
                <span>I am a fresher / 2025–2026 grad</span>
              </label>
              <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={india.willingToRelocate}
                  onChange={(e) => setIndia({ ...india, willingToRelocate: e.target.checked })}
                  className="w-4 h-4"
                />
                <span>Willing to relocate</span>
              </label>
            </div>

            <div className="p-3.5 border border-[var(--hairline)] bg-[var(--surface-soft)] space-y-2 text-xs">
              <p className="font-bold uppercase tracking-wider text-[var(--ink)]">
                [+] Under-2-Minute Readiness Summary
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[var(--body)]">
                <div>
                  <span className="font-bold text-[var(--ink)]">
                    {parsedPreview ? '[x]' : '[·]'}
                  </span>{' '}
                  Resume PDF:{' '}
                  {parsedPreview
                    ? `${parsedPreview.jsonResume.work.length} roles, ${parsedPreview.jsonResume.projects.length} projects`
                    : 'Manual entry'}
                </div>
                <div>
                  <span className="font-bold text-[var(--ink)]">
                    {india.expectedCtcLpa != null || india.cgpa != null ? '[x]' : '[·]'}
                  </span>{' '}
                  India Autofill: {india.expectedCtcLpa ?? '—'} LPA · CGPA {india.cgpa ?? '—'}/
                  {india.cgpaScale}
                </div>
                <div>
                  <span className="font-bold text-[var(--ink)]">
                    {india.preferredCities.length > 0 ? '[x]' : '[·]'}
                  </span>{' '}
                  Preferred Hubs:{' '}
                  {india.preferredCities.length > 0
                    ? india.preferredCities.slice(0, 3).join(', ')
                    : 'Any / Global'}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-2 border-t border-[var(--hairline)]">
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? 'Saving Master Profile...' : 'Complete & Open Master Profile'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={saving}
                onClick={() => void saveAndNavigate('/jobs')}
              >
                Complete &amp; Browse Matched Jobs -&gt;
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={saving}
                onClick={() => void saveAndNavigate('/tailor')}
              >
                Complete &amp; Tailor Resume -&gt;
              </Button>
              <Button type="button" variant="secondary" onClick={() => setStep(2)}>
                &lt;- Back to PDF Upload
              </Button>
            </div>
          </form>
        </SectionBlock>
      ) : null}
    </AppShell>
  );
}
