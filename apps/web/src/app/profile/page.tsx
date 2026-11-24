'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  INDIAN_TECH_HUBS,
  JsonResumeSchema,
  type ImportPreviewCandidate,
  type IndiaProfile,
  type JsonResume,
  type MasterProfile,
  type ProfileVariantRecord
} from '@jobpilot/shared';
import { AppShell } from '@/components/layout/app-shell';
import {
  ProfileImportPanel,
  ProfileVariantBar,
  type ImportSelectionState
} from '@/components/profile/variant-and-import-bar';
import { MoBar, MoSpinner, moToast } from '@/components/ui/mo';
import {
  AlertBanner,
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  Select,
  SkeletonBlock,
  TabStrip,
  Textarea
} from '@/components/ui/primitives';
import { api } from '@/lib/api';

type ProfileTab =
  | 'overview'
  | 'work'
  | 'projects'
  | 'education'
  | 'skills'
  | 'india'
  | 'json';

export default function ProfilePage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [profile, setProfile] = useState<MasterProfile | null>(null);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [resume, setResume] = useState<JsonResume | null>(null);
  const [india, setIndia] = useState<IndiaProfile | null>(null);
  const [rawJsonText, setRawJsonText] = useState('');
  const [rawJsonError, setRawJsonError] = useState<string | null>(null);
  const [customCity, setCustomCity] = useState('');
  const [skillDrafts, setSkillDrafts] = useState<Record<number, string>>({});

  const [tab, setTab] = useState<ProfileTab>('overview');
  const [editingBasics, setEditingBasics] = useState(false);
  const [editingWorkId, setEditingWorkId] = useState<string | null>(null);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingEduId, setEditingEduId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [variantBusy, setVariantBusy] = useState(false);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [variants, setVariants] = useState<ProfileVariantRecord[]>([]);
  const [activeVariantId, setActiveVariantId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const hydrateFromProfile = (p: MasterProfile, overrideVariant?: ProfileVariantRecord | null) => {
    setProfile(p);
    const activeResume = overrideVariant?.jsonResume ?? p.jsonResume;
    const activeIndia = overrideVariant?.indiaProfile ?? p.indiaProfile;
    setFullName(p.fullName ?? activeResume.basics.name ?? '');
    setEmail(p.email ?? activeResume.basics.email ?? '');
    setPhone(p.phone ?? activeResume.basics.phone ?? '');
    setResume(activeResume);
    setIndia(activeIndia);
    setRawJsonText(JSON.stringify(activeResume, null, 2));
  };

  useEffect(() => {
    Promise.all([api.getProfile(), api.listProfileVariants()])
      .then(([p, vList]) => {
        setVariants(vList);
        const def = vList.find((v) => v.isDefault) ?? vList[0] ?? null;
        setActiveVariantId(def?.id ?? null);
        hydrateFromProfile(p, def);
      })
      .catch((err) => setErrorMsg(err instanceof Error ? err.message : 'Failed to load profile.'))
      .finally(() => setLoading(false));
  }, []);

  const syncResume = (next: JsonResume) => {
    setResume(next);
    setRawJsonText(JSON.stringify(next, null, 2));
    setRawJsonError(null);
  };

  const completenessPct = useMemo(() => {
    if (!resume || !india) return 0;
    let score = 0;
    if (fullName.trim() || resume.basics.name?.trim()) score += 15;
    if (email.trim() || resume.basics.email?.trim()) score += 10;
    if (resume.work.length > 0) score += 20;
    if (resume.projects.length > 0) score += 20;
    if (resume.education.length > 0) score += 15;
    if (resume.skills.some((g) => g.keywords.length > 0)) score += 10;
    if (india.collegeName || india.cgpa != null || india.expectedCtcLpa != null) score += 10;
    return Math.min(100, score);
  }, [resume, india, fullName, email]);

  const handleSaveProfile = async () => {
    if (!resume || !india) return;
    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    let finalResume = resume;
    if (tab === 'json') {
      try {
        const parsedRaw = JSON.parse(rawJsonText);
        finalResume = JsonResumeSchema.parse(parsedRaw);
        setResume(finalResume);
        setRawJsonError(null);
      } catch (err) {
        setRawJsonError(err instanceof Error ? err.message : 'Invalid JSON Resume syntax.');
        setSaving(false);
        return;
      }
    }

    const activeVariant = variants.find((v) => v.id === activeVariantId) ?? null;
    const mergedResumePayload: JsonResume = {
      ...finalResume,
      basics: {
        ...finalResume.basics,
        name: fullName.trim() || finalResume.basics.name,
        email: email.trim() || finalResume.basics.email,
        phone: phone.trim() || finalResume.basics.phone
      }
    };

    try {
      if (activeVariant && !activeVariant.isDefault) {
        const updatedVariant = await api.updateProfileVariant(activeVariant.id, {
          jsonResume: mergedResumePayload,
          indiaProfile: india
        });
        setVariants((prev) =>
          prev.map((v) => (v.id === updatedVariant.id ? updatedVariant : v))
        );
        setResume(updatedVariant.jsonResume);
        setIndia(updatedVariant.indiaProfile);
        setRawJsonText(JSON.stringify(updatedVariant.jsonResume, null, 2));
        setSuccessMsg(`Saved variant "${updatedVariant.name}" (v${updatedVariant.version}).`);
      } else {
        const updated = await api.updateProfile({
          fullName: fullName.trim() || undefined,
          email: email.trim(),
          phone: phone.trim(),
          jsonResume: mergedResumePayload,
          indiaProfile: india
        });
        const refreshedVariants = await api.listProfileVariants();
        setVariants(refreshedVariants);
        const def = refreshedVariants.find((v) => v.id === activeVariantId) ?? refreshedVariants[0] ?? null;
        hydrateFromProfile(updated, def);
        setSuccessMsg(`Saved Profile (v${updated.activeProfileVersion}).`);
      }
      setEditingBasics(false);
      setEditingWorkId(null);
      setEditingProjectId(null);
      setEditingEduId(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save profile.');
    } finally {
      setSaving(false);
    }
  };

  const handleSelectVariant = (variant: ProfileVariantRecord) => {
    setActiveVariantId(variant.id);
    setResume(variant.jsonResume);
    setIndia(variant.indiaProfile);
    setRawJsonText(JSON.stringify(variant.jsonResume, null, 2));
    setEditingWorkId(null);
    setEditingProjectId(null);
    setEditingEduId(null);
    moToast(`Switched to variant "${variant.name}"`);
  };

  const handleCreateVariant = async (input: {
    name: string;
    targetRole: string;
    cloneFromVariantId?: string;
  }) => {
    setVariantBusy(true);
    setErrorMsg(null);
    try {
      const created = await api.createProfileVariant({ ...input, isDefault: false });
      const nextList = await api.listProfileVariants();
      setVariants(nextList);
      handleSelectVariant(created);
      setSuccessMsg(`Created variant "${created.name}".`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to create variant.');
    } finally {
      setVariantBusy(false);
    }
  };

  const handleSetDefaultVariant = async (variantId: string) => {
    setVariantBusy(true);
    setErrorMsg(null);
    try {
      await api.updateProfileVariant(variantId, { isDefault: true });
      const [p, vList] = await Promise.all([api.getProfile(), api.listProfileVariants()]);
      setVariants(vList);
      const next = vList.find((v) => v.id === variantId) ?? vList[0] ?? null;
      setActiveVariantId(next?.id ?? null);
      hydrateFromProfile(p, next);
      moToast('Updated default variant');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to set active default.');
    } finally {
      setVariantBusy(false);
    }
  };

  const handleDeleteVariant = async (variantId: string) => {
    setVariantBusy(true);
    setErrorMsg(null);
    try {
      await api.deleteProfileVariant(variantId);
      const [p, vList] = await Promise.all([api.getProfile(), api.listProfileVariants()]);
      setVariants(vList);
      const next = vList.find((v) => v.isDefault) ?? vList[0] ?? null;
      setActiveVariantId(next?.id ?? null);
      hydrateFromProfile(p, next);
      moToast('Variant deleted');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to delete variant.');
    } finally {
      setVariantBusy(false);
    }
  };

  const handleMergeImportedCandidate = async (
    candidate: ImportPreviewCandidate,
    selection: ImportSelectionState
  ) => {
    if (!resume || !india) return;
    const dedupeAppend = <T,>(existing: T[], incoming: T[], keyFn: (x: T) => string): T[] => {
      const seen = new Set(existing.map((x) => keyFn(x).toLowerCase().trim()));
      const out = [...existing];
      for (const item of incoming) {
        const k = keyFn(item).toLowerCase().trim();
        if (k && !seen.has(k)) {
          seen.add(k);
          out.push(item);
        }
      }
      return out;
    };

    const nextBasics = { ...resume.basics };
    if (selection.includeBasics) {
      if (candidate.headline && !nextBasics.label) nextBasics.label = candidate.headline;
      if (candidate.summary && !nextBasics.summary) nextBasics.summary = candidate.summary;
      if (candidate.githubUrl && !nextBasics.url) nextBasics.url = candidate.githubUrl;
    }

    const pickedWork = candidate.work.filter((w) => selection.selectedWorkIds.has(w.id));
    const pickedProjects = candidate.projects.filter((p) => selection.selectedProjectIds.has(p.id));
    const pickedEdu = candidate.education.filter((e) => selection.selectedEduIds.has(e.id));
    const pickedSkills = candidate.skills.filter((s) => selection.selectedSkillNames.has(s.name));
    const pickedCerts = candidate.certificates.filter((c) => selection.selectedCertNames.has(c.name));
    const pickedLangs = candidate.languages.filter((l) => selection.selectedLangNames.has(l.language));

    const merged: JsonResume = {
      ...resume,
      basics: nextBasics,
      work: dedupeAppend(resume.work, pickedWork, (w) => `${w.name}|${w.position}`),
      projects: dedupeAppend(resume.projects, pickedProjects, (p) => p.name),
      education: dedupeAppend(resume.education, pickedEdu, (e) => e.institution),
      skills: dedupeAppend(resume.skills, pickedSkills, (s) => s.name),
      certificates: dedupeAppend(resume.certificates, pickedCerts, (c) => c.name),
      languages: dedupeAppend(resume.languages, pickedLangs, (l) => l.language)
    };

    syncResume(merged);
    if (activeVariantId) {
      const updatedVariant = await api.updateProfileVariant(activeVariantId, {
        jsonResume: merged,
        indiaProfile: india
      });
      setVariants((prev) => prev.map((v) => (v.id === updatedVariant.id ? updatedVariant : v)));
      setImportOpen(false);
      moToast(`Merged ${candidate.sourceLabel} items`);
    }
  };

  const handlePdfFileSelected = async (file: File | null) => {
    if (!file) return;
    setUploadingPdf(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await api.parseResumePdf(file, { apply: true });
      if (res.appliedProfile) {
        hydrateFromProfile(res.appliedProfile);
      }
      const p = res.parsed.jsonResume;
      const summary = `Parsed "${file.name}" (${p.work.length} experience, ${p.projects.length} projects, ${p.education.length} education, ${p.skills.length} skill groups).`;
      moToast(summary);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Resume upload failed.');
    } finally {
      setUploadingPdf(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const togglePreferredCity = (city: string) => {
    if (!india) return;
    const exists = india.preferredCities.includes(city);
    setIndia({
      ...india,
      preferredCities: exists
        ? india.preferredCities.filter((c) => c !== city)
        : [...india.preferredCities, city]
    });
  };

  const addCustomCity = () => {
    if (!india || !customCity.trim()) return;
    const trimmed = customCity.trim();
    if (!india.preferredCities.includes(trimmed)) {
      setIndia({ ...india, preferredCities: [...india.preferredCities, trimmed] });
    }
    setCustomCity('');
  };

  const addWorkEntry = () => {
    if (!resume) return;
    const newId = `work-${Date.now()}`;
    syncResume({
      ...resume,
      work: [
        {
          id: newId,
          name: 'Company Name',
          position: 'Software Engineer',
          url: '',
          location: 'Bengaluru',
          employmentType: 'Full-time',
          startDate: '2025-01',
          endDate: 'Present',
          summary: '',
          highlights: ['Describe your engineering impact and quantified results...']
        },
        ...resume.work
      ]
    });
    setEditingWorkId(newId);
  };

  const addProjectEntry = () => {
    if (!resume) return;
    const newId = `proj-${Date.now()}`;
    syncResume({
      ...resume,
      projects: [
        {
          id: newId,
          name: 'Project Title',
          description: '',
          highlights: ['Describe architecture, technical stack, and measured performance...'],
          keywords: ['TypeScript', 'PostgreSQL'],
          startDate: '',
          endDate: '',
          url: '',
          roles: [],
          entity: '',
          type: ''
        },
        ...resume.projects
      ]
    });
    setEditingProjectId(newId);
  };

  const addEducationEntry = () => {
    if (!resume) return;
    const newId = `edu-${Date.now()}`;
    syncResume({
      ...resume,
      education: [
        ...resume.education,
        {
          id: newId,
          institution: 'Institute / University Name',
          url: '',
          area: 'Computer Science & Engineering',
          studyType: 'B.Tech',
          startDate: '2022',
          endDate: '2026',
          score: '8.8/10',
          courses: []
        }
      ]
    });
    setEditingEduId(newId);
  };

  const addKeywordToSkillGroup = (groupIdx: number, rawInput: string) => {
    if (!resume || !rawInput.trim()) return;
    const tokens = rawInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (tokens.length === 0) return;

    const nextSkills = [...resume.skills];
    const grp = nextSkills[groupIdx];
    if (!grp) return;
    const existingSet = new Set(grp.keywords.map((k) => k.toLowerCase()));
    const merged = [...grp.keywords];
    for (const tok of tokens) {
      if (!existingSet.has(tok.toLowerCase())) {
        existingSet.add(tok.toLowerCase());
        merged.push(tok);
      }
    }
    nextSkills[groupIdx] = { ...grp, keywords: merged };
    syncResume({ ...resume, skills: nextSkills });
    setSkillDrafts((prev) => ({ ...prev, [groupIdx]: '' }));
  };

  // --- Reusable Section Renderers ---
  const renderBasicsBlock = () => {
    if (!resume || !india) return null;
    const locationText = [resume.basics.location?.city, resume.basics.location?.countryCode]
      .filter(Boolean)
      .join(', ');

    return (
      <section className="border border-[var(--hairline)] bg-[var(--canvas)]">
        <div className="p-5 sm:p-6 flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5">
          <div className="space-y-2.5 min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-xl sm:text-2xl font-bold text-[var(--ink)]">
                {fullName || resume.basics.name || 'Candidate Profile'}
              </h2>
              <Badge tone="dark">v{profile?.activeProfileVersion ?? 1}</Badge>
              {india.isFresher ? <Badge tone="neutral">FRESHER</Badge> : null}
            </div>

            <p className="text-sm font-medium text-[var(--body)]">
              {resume.basics.label || 'Software Engineer — Click [Edit Basics] to set your headline'}
            </p>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-[var(--mute)]">
              {email ? <span>{email}</span> : null}
              {phone ? <span>{phone}</span> : null}
              {locationText ? <span>{locationText}</span> : null}
              {resume.basics.url ? (
                <a
                  href={resume.basics.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--ink)] underline"
                >
                  {resume.basics.url}
                </a>
              ) : null}
            </div>

            {resume.basics.summary ? (
              <p className="text-sm text-[var(--body)] leading-relaxed pt-1 max-w-3xl">
                {resume.basics.summary}
              </p>
            ) : null}

            {/* Quick India & Academic Pills */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {india.collegeName ? (
                <Badge tone="neutral">
                  {india.collegeName}
                  {india.graduationYear ? ` '${String(india.graduationYear).slice(-2)}` : ''}
                </Badge>
              ) : null}
              {india.cgpa != null ? (
                <Badge tone="neutral">
                  CGPA: {india.cgpa}/{india.cgpaScale}
                </Badge>
              ) : null}
              {india.expectedCtcLpa != null ? (
                <Badge tone="neutral">Expected: {india.expectedCtcLpa} LPA</Badge>
              ) : null}
              {india.noticePeriodDays != null ? (
                <Badge tone="neutral">Notice: {india.noticePeriodDays}d</Badge>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setEditingBasics((prev) => !prev)}
            >
              {editingBasics ? 'Close' : 'Edit basics'}
            </Button>
          </div>
        </div>

        {/* Collapsible Basics Editor */}
        {editingBasics ? (
          <div className="p-5 sm:p-6 border-t border-[var(--hairline)] bg-[var(--surface-soft)] space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Field label="Full Name" htmlFor="bas-name">
                {(props) => (
                  <Input
                    {...props}
                    value={fullName}
                    onChange={(e) => {
                      setFullName(e.target.value);
                      syncResume({
                        ...resume,
                        basics: { ...resume.basics, name: e.target.value }
                      });
                    }}
                  />
                )}
              </Field>
              <Field label="Headline / Target Title" htmlFor="bas-label">
                {(props) => (
                  <Input
                    {...props}
                    value={resume.basics.label ?? ''}
                    onChange={(e) =>
                      syncResume({
                        ...resume,
                        basics: { ...resume.basics, label: e.target.value }
                      })
                    }
                    placeholder="Backend & Full-Stack Software Engineer"
                  />
                )}
              </Field>
              <Field label="Email" htmlFor="bas-email">
                {(props) => (
                  <Input
                    {...props}
                    type="email"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      syncResume({
                        ...resume,
                        basics: { ...resume.basics, email: e.target.value }
                      });
                    }}
                  />
                )}
              </Field>
              <Field label="Phone" htmlFor="bas-phone">
                {(props) => (
                  <Input
                    {...props}
                    type="tel"
                    value={phone}
                    onChange={(e) => {
                      setPhone(e.target.value);
                      syncResume({
                        ...resume,
                        basics: { ...resume.basics, phone: e.target.value }
                      });
                    }}
                  />
                )}
              </Field>
              <Field label="GitHub / Portfolio URL" htmlFor="bas-url">
                {(props) => (
                  <Input
                    {...props}
                    type="url"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={resume.basics.url ?? ''}
                    onChange={(e) =>
                      syncResume({
                        ...resume,
                        basics: { ...resume.basics, url: e.target.value }
                      })
                    }
                    placeholder="https://github.com/username"
                  />
                )}
              </Field>
              <Field label="City & Country Code" htmlFor="bas-city">
                {(props) => (
                  <div className="grid grid-cols-3 gap-2">
                    <Input
                      {...props}
                      className="col-span-2"
                      placeholder="Bengaluru"
                      value={resume.basics.location?.city ?? ''}
                      onChange={(e) =>
                        syncResume({
                          ...resume,
                          basics: {
                            ...resume.basics,
                            location: {
                              ...resume.basics.location,
                              city: e.target.value
                            }
                          }
                        })
                      }
                    />
                    <Input
                      aria-label="Country code"
                      placeholder="IN"
                      maxLength={4}
                      value={resume.basics.location?.countryCode ?? ''}
                      onChange={(e) =>
                        syncResume({
                          ...resume,
                          basics: {
                            ...resume.basics,
                            location: {
                              ...resume.basics.location,
                              countryCode: e.target.value.toUpperCase()
                            }
                          }
                        })
                      }
                    />
                  </div>
                )}
              </Field>
            </div>

            <Field label="Professional Summary" htmlFor="bas-summary">
              {(props) => (
                <Textarea
                  {...props}
                  rows={3}
                  value={resume.basics.summary ?? ''}
                  onChange={(e) =>
                    syncResume({
                      ...resume,
                      basics: { ...resume.basics, summary: e.target.value }
                    })
                  }
                />
              )}
            </Field>
          </div>
        ) : null}

        {/* Completeness Bar Footer */}
        <div className="px-5 py-3 border-t border-[var(--hairline)] bg-[var(--surface-soft)] flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-3">
            <span className="font-bold text-[var(--ink)]">Profile Readiness</span>
            <span className="text-[var(--ink)]">
              <MoBar value={completenessPct} width={16} />
            </span>
          </div>
          <div className="text-[var(--mute)]">
            {resume.work.length} experience · {resume.projects.length} projects ·{' '}
            {resume.education.length} education ·{' '}
            {resume.skills.reduce((acc, g) => acc + g.keywords.length, 0)} skills
          </div>
        </div>
      </section>
    );
  };

  const renderWorkSection = () => {
    if (!resume) return null;
    return (
      <section className="border border-[var(--hairline)] bg-[var(--canvas)]">
        <div className="px-5 py-4 border-b border-[var(--hairline)] bg-[var(--surface-soft)] flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--ink)]">
              Experience ({resume.work.length})
            </h2>
            <p className="text-xs text-[var(--mute)]">
              Employer names and dates are locked as immutable anchors during resume tailoring.
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={addWorkEntry}>
            Add experience
          </Button>
        </div>

        {resume.work.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="No experience entries yet"
              description="Upload your PDF resume above or click Add experience to add internships and roles."
            />
          </div>
        ) : (
          <div className="divide-y divide-[var(--hairline)]">
            {resume.work.map((item, idx) => {
              const isEditing = editingWorkId === item.id;
              return (
                <div key={item.id} className="p-5 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-bold text-[var(--ink)]">
                        {item.position || 'Role Title'}{' '}
                        <span className="font-normal text-[var(--mute)]">@</span>{' '}
                        {item.name || 'Company'}
                      </h3>
                      <p className="text-xs text-[var(--mute)] mt-0.5">
                        {[item.startDate, item.endDate || 'Present'].filter(Boolean).join(' – ')}
                        {item.location ? ` · ${item.location}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setEditingWorkId(isEditing ? null : item.id)}
                      >
                        {isEditing ? 'Done' : 'Edit'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          syncResume({
                            ...resume,
                            work: resume.work.filter((_, i) => i !== idx)
                          })
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  </div>

                  {isEditing ? (
                    <div className="p-4 border border-[var(--hairline)] bg-[var(--surface-soft)] space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        <Field label="Company Name" htmlFor={`work-company-${idx}`}>
                          {(props) => (
                            <Input
                              {...props}
                              value={item.name}
                              onChange={(e) => {
                                const next = [...resume.work];
                                next[idx] = { ...item, name: e.target.value };
                                syncResume({ ...resume, work: next });
                              }}
                            />
                          )}
                        </Field>
                        <Field label="Role / Title" htmlFor={`work-role-${idx}`}>
                          {(props) => (
                            <Input
                              {...props}
                              value={item.position}
                              onChange={(e) => {
                                const next = [...resume.work];
                                next[idx] = { ...item, position: e.target.value };
                                syncResume({ ...resume, work: next });
                              }}
                            />
                          )}
                        </Field>
                        <Field label="Start Date" htmlFor={`work-start-${idx}`}>
                          {(props) => (
                            <Input
                              {...props}
                              placeholder="2024-05"
                              value={item.startDate}
                              onChange={(e) => {
                                const next = [...resume.work];
                                next[idx] = { ...item, startDate: e.target.value };
                                syncResume({ ...resume, work: next });
                              }}
                            />
                          )}
                        </Field>
                        <Field label="End Date" htmlFor={`work-end-${idx}`}>
                          {(props) => (
                            <Input
                              {...props}
                              placeholder="2024-07 or Present"
                              value={item.endDate ?? ''}
                              onChange={(e) => {
                                const next = [...resume.work];
                                next[idx] = { ...item, endDate: e.target.value };
                                syncResume({ ...resume, work: next });
                              }}
                            />
                          )}
                        </Field>
                      </div>
                      <Field
                        label="Impact Bullets (one bullet per line)"
                        htmlFor={`work-bullets-${idx}`}
                      >
                        {(props) => (
                          <Textarea
                            {...props}
                            rows={4}
                            value={item.highlights.join('\n')}
                            onChange={(e) => {
                              const next = [...resume.work];
                              next[idx] = {
                                ...item,
                                highlights: e.target.value
                                  .split('\n')
                                  .filter((l) => l.trim().length > 0)
                              };
                              syncResume({ ...resume, work: next });
                            }}
                          />
                        )}
                      </Field>
                    </div>
                  ) : item.highlights.length > 0 ? (
                    <ul className="space-y-1.5 text-sm text-[var(--body)] list-none p-0 m-0">
                      {item.highlights.map((bullet, bIdx) => (
                        <li key={bIdx} className="flex items-baseline gap-2.5">
                          <span className="text-[var(--mute)] shrink-0">•</span>
                          <span>{bullet}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>
    );
  };

  const renderProjectsSection = () => {
    if (!resume) return null;
    return (
      <section className="border border-[var(--hairline)] bg-[var(--canvas)]">
        <div className="px-5 py-4 border-b border-[var(--hairline)] bg-[var(--surface-soft)] flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--ink)]">
              Projects ({resume.projects.length})
            </h2>
            <p className="text-xs text-[var(--mute)]">
              All projects are retained and ordered by JD relevance when tailoring resumes.
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={addProjectEntry}>
            Add project
          </Button>
        </div>

        {resume.projects.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="No projects added yet"
              description="Upload your PDF resume above or click Add project to add technical projects."
            />
          </div>
        ) : (
          <div className="divide-y divide-[var(--hairline)]">
            {resume.projects.map((proj, idx) => {
              const isEditing = editingProjectId === proj.id;
              return (
                <div key={proj.id} className="p-5 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-bold text-[var(--ink)]">
                          {proj.name || 'Untitled Project'}
                        </h3>
                        {proj.url ? (
                          <a
                            href={proj.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-[var(--accent-text)] underline"
                          >
                            Link [&gt;]
                          </a>
                        ) : null}
                      </div>
                      {(proj.keywords ?? []).length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {(proj.keywords ?? []).map((kw) => (
                            <Badge key={kw} tone="neutral">
                              {kw}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setEditingProjectId(isEditing ? null : proj.id)}
                      >
                        {isEditing ? 'Done' : 'Edit'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          syncResume({
                            ...resume,
                            projects: resume.projects.filter((_, i) => i !== idx)
                          })
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  </div>

                  {isEditing ? (
                    <div className="p-4 border border-[var(--hairline)] bg-[var(--surface-soft)] space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Field label="Project Name" htmlFor={`proj-name-${idx}`}>
                          {(props) => (
                            <Input
                              {...props}
                              value={proj.name}
                              onChange={(e) => {
                                const next = [...resume.projects];
                                next[idx] = { ...proj, name: e.target.value };
                                syncResume({ ...resume, projects: next });
                              }}
                            />
                          )}
                        </Field>
                        <Field label="Repository / Live URL" htmlFor={`proj-url-${idx}`}>
                          {(props) => (
                            <Input
                              {...props}
                              value={proj.url ?? ''}
                              placeholder="https://github.com/..."
                              onChange={(e) => {
                                const next = [...resume.projects];
                                next[idx] = { ...proj, url: e.target.value };
                                syncResume({ ...resume, projects: next });
                              }}
                            />
                          )}
                        </Field>
                      </div>

                      <Field
                        label="Tech Stack Keywords (comma-separated)"
                        htmlFor={`proj-kw-${idx}`}
                      >
                        {(props) => (
                          <Input
                            {...props}
                            value={(proj.keywords ?? []).join(', ')}
                            placeholder="TypeScript, Next.js, PostgreSQL, Redis"
                            onChange={(e) => {
                              const next = [...resume.projects];
                              next[idx] = {
                                ...proj,
                                keywords: e.target.value
                                  .split(',')
                                  .map((s) => s.trim())
                                  .filter(Boolean)
                              };
                              syncResume({ ...resume, projects: next });
                            }}
                          />
                        )}
                      </Field>

                      <Field
                        label="Project Bullets (one bullet per line)"
                        htmlFor={`proj-bullets-${idx}`}
                      >
                        {(props) => (
                          <Textarea
                            {...props}
                            rows={4}
                            value={proj.highlights.join('\n')}
                            onChange={(e) => {
                              const next = [...resume.projects];
                              next[idx] = {
                                ...proj,
                                highlights: e.target.value
                                  .split('\n')
                                  .filter((l) => l.trim().length > 0)
                              };
                              syncResume({ ...resume, projects: next });
                            }}
                          />
                        )}
                      </Field>
                    </div>
                  ) : proj.highlights.length > 0 ? (
                    <ul className="space-y-1.5 text-sm text-[var(--body)] list-none p-0 m-0">
                      {proj.highlights.map((bullet, bIdx) => (
                        <li key={bIdx} className="flex items-baseline gap-2.5">
                          <span className="text-[var(--mute)] shrink-0">•</span>
                          <span>{bullet}</span>
                        </li>
                      ))}
                    </ul>
                  ) : proj.description ? (
                    <p className="text-sm text-[var(--body)]">{proj.description}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>
    );
  };

  const renderEducationSection = () => {
    if (!resume) return null;
    return (
      <section className="border border-[var(--hairline)] bg-[var(--canvas)]">
        <div className="px-5 py-4 border-b border-[var(--hairline)] bg-[var(--surface-soft)] flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--ink)]">
              Education ({resume.education.length})
            </h2>
            <p className="text-xs text-[var(--mute)]">
              Institutions, degrees, and CGPA / board scores.
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={addEducationEntry}>
            Add education
          </Button>
        </div>

        {resume.education.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="No education entries yet"
              description="Add your university/college degree and board examination scores."
            />
          </div>
        ) : (
          <div className="divide-y divide-[var(--hairline)]">
            {resume.education.map((edu, idx) => {
              const isEditing = editingEduId === edu.id;
              return (
                <div key={edu.id} className="p-5 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-bold text-[var(--ink)]">
                        {edu.institution || 'Institution'}
                      </h3>
                      <p className="text-sm text-[var(--body)] mt-0.5">
                        {[edu.studyType, edu.area].filter(Boolean).join(' in ') || 'Degree'}
                        {edu.score ? ` · Score/CGPA: ${edu.score}` : ''}
                      </p>
                      <p className="text-xs text-[var(--mute)] mt-0.5">
                        {[edu.startDate, edu.endDate].filter(Boolean).join(' – ')}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setEditingEduId(isEditing ? null : edu.id)}
                      >
                        {isEditing ? 'Done' : 'Edit'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          syncResume({
                            ...resume,
                            education: resume.education.filter((_, i) => i !== idx)
                          })
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  </div>

                  {isEditing ? (
                    <div className="p-4 border border-[var(--hairline)] bg-[var(--surface-soft)] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      <Field label="Institution" htmlFor={`edu-inst-${idx}`}>
                        {(props) => (
                          <Input
                            {...props}
                            value={edu.institution}
                            onChange={(e) => {
                              const next = [...resume.education];
                              next[idx] = { ...edu, institution: e.target.value };
                              syncResume({ ...resume, education: next });
                            }}
                          />
                        )}
                      </Field>
                      <Field label="Degree (e.g. B.Tech)" htmlFor={`edu-deg-${idx}`}>
                        {(props) => (
                          <Input
                            {...props}
                            value={edu.studyType ?? ''}
                            onChange={(e) => {
                              const next = [...resume.education];
                              next[idx] = { ...edu, studyType: e.target.value };
                              syncResume({ ...resume, education: next });
                            }}
                          />
                        )}
                      </Field>
                      <Field label="Major / Branch" htmlFor={`edu-area-${idx}`}>
                        {(props) => (
                          <Input
                            {...props}
                            value={edu.area ?? ''}
                            onChange={(e) => {
                              const next = [...resume.education];
                              next[idx] = { ...edu, area: e.target.value };
                              syncResume({ ...resume, education: next });
                            }}
                          />
                        )}
                      </Field>
                      <Field label="Start Year" htmlFor={`edu-start-${idx}`}>
                        {(props) => (
                          <Input
                            {...props}
                            value={edu.startDate ?? ''}
                            onChange={(e) => {
                              const next = [...resume.education];
                              next[idx] = { ...edu, startDate: e.target.value };
                              syncResume({ ...resume, education: next });
                            }}
                          />
                        )}
                      </Field>
                      <Field label="Graduation Year" htmlFor={`edu-end-${idx}`}>
                        {(props) => (
                          <Input
                            {...props}
                            value={edu.endDate ?? ''}
                            onChange={(e) => {
                              const next = [...resume.education];
                              next[idx] = { ...edu, endDate: e.target.value };
                              syncResume({ ...resume, education: next });
                            }}
                          />
                        )}
                      </Field>
                      <Field label="CGPA / Percentage" htmlFor={`edu-score-${idx}`}>
                        {(props) => (
                          <Input
                            {...props}
                            value={edu.score ?? ''}
                            onChange={(e) => {
                              const next = [...resume.education];
                              next[idx] = { ...edu, score: e.target.value };
                              syncResume({ ...resume, education: next });
                            }}
                          />
                        )}
                      </Field>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>
    );
  };

  const renderSkillsSection = () => {
    if (!resume) return null;
    return (
      <section className="border border-[var(--hairline)] bg-[var(--canvas)]">
        <div className="px-5 py-4 border-b border-[var(--hairline)] bg-[var(--surface-soft)] flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--ink)]">
              Technical Skills ({resume.skills.reduce((a, g) => a + g.keywords.length, 0)})
            </h2>
            <p className="text-xs text-[var(--mute)]">
              Grounded skill whitelist — tailoring can reorder these skills, never invent new ones.
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              syncResume({
                ...resume,
                skills: [...resume.skills, { name: 'Category', level: '', keywords: [] }]
              })
            }
          >
            Add category
          </Button>
        </div>

        {resume.skills.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="No skill groups yet"
              description="Add categories like Languages, Backend, Databases, and Cloud."
            />
          </div>
        ) : (
          <div className="divide-y divide-[var(--hairline)]">
            {resume.skills.map((grp, idx) => (
              <div key={idx} className="p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <input
                    aria-label="Skill category name"
                    value={grp.name}
                    onChange={(e) => {
                      const next = [...resume.skills];
                      next[idx] = { ...grp, name: e.target.value };
                      syncResume({ ...resume, skills: next });
                    }}
                    className="text-sm font-bold text-[var(--ink)] bg-transparent border-b border-transparent hover:border-[var(--hairline)] focus:border-[var(--ink)] focus:outline-none py-0.5"
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      syncResume({
                        ...resume,
                        skills: resume.skills.filter((_, i) => i !== idx)
                      })
                    }
                  >
                    Remove Category
                  </Button>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {grp.keywords.map((kw, kIdx) => (
                    <span
                      key={`${kw}-${kIdx}`}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-[var(--hairline)] bg-[var(--surface-soft)] text-[var(--ink)] rounded-[4px]"
                    >
                      <span>{kw}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${kw}`}
                        onClick={() => {
                          const next = [...resume.skills];
                          next[idx] = {
                            ...grp,
                            keywords: grp.keywords.filter((_, i) => i !== kIdx)
                          };
                          syncResume({ ...resume, skills: next });
                        }}
                        className="text-[var(--mute)] hover:text-[var(--danger-text)] cursor-pointer font-bold"
                      >
                        ×
                      </button>
                    </span>
                  ))}

                  <div className="inline-flex items-center gap-1.5">
                    <input
                      type="text"
                      placeholder="+ Add skill (Enter)..."
                      value={skillDrafts[idx] ?? ''}
                      onChange={(e) =>
                        setSkillDrafts((prev) => ({ ...prev, [idx]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ',') {
                          e.preventDefault();
                          addKeywordToSkillGroup(idx, skillDrafts[idx] ?? '');
                        }
                      }}
                      onBlur={() => {
                        if ((skillDrafts[idx] ?? '').trim()) {
                          addKeywordToSkillGroup(idx, skillDrafts[idx] ?? '');
                        }
                      }}
                      className="px-2.5 py-1 text-xs border border-dashed border-[var(--hairline-strong)] bg-transparent text-[var(--ink)] rounded-[4px] w-44 focus:outline-none focus:border-[var(--ink)]"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    );
  };

  const renderIndiaSection = () => {
    if (!india) return null;
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Card 1: Compensation & Availability */}
        <section className="border border-[var(--hairline)] bg-[var(--canvas)] p-5 sm:p-6 space-y-5">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--ink)]">
              [1] Compensation, Notice &amp; Work Auth
            </h2>
            <p className="text-xs text-[var(--mute)] mt-0.5">
              Used for LPA hard-filters and autofilling CTC &amp; notice period fields.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Current CTC (LPA)" htmlFor="ind-cctc">
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  step="0.1"
                  min={0}
                  placeholder="0 if fresher"
                  value={india.currentCtcLpa ?? ''}
                  onChange={(e) =>
                    setIndia({
                      ...india,
                      currentCtcLpa: e.target.value === '' ? null : Number(e.target.value)
                    })
                  }
                />
              )}
            </Field>
            <Field label="Expected CTC (LPA)" htmlFor="ind-ectc">
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  step="0.1"
                  min={0}
                  placeholder="e.g. 16"
                  value={india.expectedCtcLpa ?? ''}
                  onChange={(e) =>
                    setIndia({
                      ...india,
                      expectedCtcLpa: e.target.value === '' ? null : Number(e.target.value)
                    })
                  }
                />
              )}
            </Field>
            <Field label="Notice Period (Days)" htmlFor="ind-notice">
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  min={0}
                  max={365}
                  placeholder="0 / 15 / 30 / 60"
                  value={india.noticePeriodDays ?? ''}
                  onChange={(e) =>
                    setIndia({
                      ...india,
                      noticePeriodDays: e.target.value === '' ? null : Number(e.target.value)
                    })
                  }
                />
              )}
            </Field>
            <Field label="Work Authorization" htmlFor="ind-auth">
              {(props) => (
                <Select
                  {...props}
                  value={india.workAuthorization}
                  onChange={(e) =>
                    setIndia({
                      ...india,
                      workAuthorization: e.target.value as IndiaProfile['workAuthorization']
                    })
                  }
                >
                  <option value="indian_citizen">Indian Citizen</option>
                  <option value="oci">OCI</option>
                  <option value="requires_sponsorship">Requires Sponsorship (Global)</option>
                  <option value="us_citizen">US Citizen</option>
                  <option value="green_card">US Green Card</option>
                  <option value="eu_blue_card">EU Blue Card</option>
                  <option value="uk_ilr">UK ILR</option>
                  <option value="other">Other</option>
                </Select>
              )}
            </Field>
          </div>

          <div className="flex flex-wrap gap-5 pt-2 border-t border-[var(--hairline)] text-xs">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={india.isFresher}
                onChange={(e) => setIndia({ ...india, isFresher: e.target.checked })}
                className="w-4 h-4"
              />
              <span>Fresher / New Grad</span>
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={india.isServingNotice}
                onChange={(e) => setIndia({ ...india, isServingNotice: e.target.checked })}
                className="w-4 h-4"
              />
              <span>Serving notice period</span>
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={india.willingToRelocate}
                onChange={(e) => setIndia({ ...india, willingToRelocate: e.target.checked })}
                className="w-4 h-4"
              />
              <span>Willing to relocate</span>
            </label>
          </div>
        </section>

        {/* Card 2: Indian Academic & Campus Signals */}
        <section className="border border-[var(--hairline)] bg-[var(--canvas)] p-5 sm:p-6 space-y-5">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--ink)]">
              [2] Academic Eligibility &amp; Board Marks
            </h2>
            <p className="text-xs text-[var(--mute)] mt-0.5">
              Auto-fills campus/off-campus CGPA, graduation year, and 10th/12th fields.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="College / University" htmlFor="ind-college">
              {(props) => (
                <Input
                  {...props}
                  value={india.collegeName}
                  onChange={(e) => setIndia({ ...india, collegeName: e.target.value })}
                />
              )}
            </Field>
            <Field label="Degree & Branch" htmlFor="ind-degree">
              {(props) => (
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    {...props}
                    placeholder="B.Tech"
                    value={india.degree}
                    onChange={(e) => setIndia({ ...india, degree: e.target.value })}
                  />
                  <Input
                    aria-label="Branch"
                    placeholder="CSE"
                    value={india.branch}
                    onChange={(e) => setIndia({ ...india, branch: e.target.value })}
                  />
                </div>
              )}
            </Field>
            <Field label="CGPA & Scale" htmlFor="ind-cgpa">
              {(props) => (
                <div className="grid grid-cols-3 gap-2">
                  <Input
                    {...props}
                    type="number"
                    step="0.01"
                    className="col-span-2"
                    placeholder="8.85"
                    value={india.cgpa ?? ''}
                    onChange={(e) =>
                      setIndia({
                        ...india,
                        cgpa: e.target.value === '' ? null : Number(e.target.value)
                      })
                    }
                  />
                  <Input
                    aria-label="CGPA Scale"
                    type="number"
                    value={india.cgpaScale}
                    onChange={(e) =>
                      setIndia({ ...india, cgpaScale: Number(e.target.value || 10) })
                    }
                  />
                </div>
              )}
            </Field>
            <Field label="10th & 12th Marks (%)" htmlFor="ind-10th">
              {(props) => (
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    {...props}
                    type="number"
                    step="0.1"
                    placeholder="10th %"
                    value={india.tenthPercentage ?? ''}
                    onChange={(e) =>
                      setIndia({
                        ...india,
                        tenthPercentage:
                          e.target.value === '' ? null : Number(e.target.value)
                      })
                    }
                  />
                  <Input
                    aria-label="12th percentage"
                    type="number"
                    step="0.1"
                    placeholder="12th %"
                    value={india.twelfthPercentage ?? ''}
                    onChange={(e) =>
                      setIndia({
                        ...india,
                        twelfthPercentage:
                          e.target.value === '' ? null : Number(e.target.value)
                      })
                    }
                  />
                </div>
              )}
            </Field>
          </div>
        </section>

        {/* Card 3: Preferred Hubs */}
        <section className="lg:col-span-2 border border-[var(--hairline)] bg-[var(--canvas)] p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--ink)]">
                [3] Preferred Tech Hubs &amp; Locations
              </h2>
              <p className="text-xs text-[var(--mute)] mt-0.5">
                Prioritizes roles in these cities during Stage 1 hard-filtering.
              </p>
            </div>
            <div className="flex gap-2">
              <Input
                aria-label="Add custom preferred city"
                placeholder="Add city (e.g. Remote, London)..."
                value={customCity}
                onChange={(e) => setCustomCity(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addCustomCity();
                  }
                }}
                className="w-56"
              />
              <Button size="sm" variant="secondary" onClick={addCustomCity}>
                Add
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {INDIAN_TECH_HUBS.map((city) => {
              const active = india.preferredCities.includes(city);
              return (
                <button
                  key={city}
                  type="button"
                  onClick={() => togglePreferredCity(city)}
                  aria-pressed={active}
                  className={`inline-flex items-center h-8 px-3 text-xs rounded-[4px] border cursor-pointer transition-colors ${
                    active
                      ? 'bg-[var(--ink)] text-[var(--on-primary)] border-[var(--ink)] font-semibold'
                      : 'bg-[var(--surface-soft)] text-[var(--body)] border-[var(--hairline)] hover:border-[var(--hairline-strong)]'
                  }`}
                >
                  {city}
                </button>
              );
            })}
            {india.preferredCities
              .filter((c) => !(INDIAN_TECH_HUBS as readonly string[]).includes(c))
              .map((city) => (
                <button
                  key={city}
                  type="button"
                  onClick={() => togglePreferredCity(city)}
                  className="inline-flex items-center h-8 px-3 text-xs rounded-[4px] border bg-[var(--ink)] text-[var(--on-primary)] border-[var(--ink)] font-semibold cursor-pointer"
                >
                  {city} ×
                </button>
              ))}
          </div>
        </section>
      </div>
    );
  };

  return (
    <AppShell
      title="Profile"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            aria-label="Upload PDF resume"
            className="hidden"
            onChange={(e) => void handlePdfFileSelected(e.target.files?.[0] ?? null)}
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={uploadingPdf || loading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploadingPdf ? (
              <span className="inline-flex items-center gap-2">
                <MoSpinner name="braille" />
                <span>Parsing PDF...</span>
              </span>
            ) : (
              'Import PDF'
            )}
          </Button>
          <Button
            variant={importOpen ? 'primary' : 'secondary'}
            size="sm"
            disabled={loading}
            onClick={() => setImportOpen((prev) => !prev)}
          >
            Import GitHub / LinkedIn
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void handleSaveProfile()}
            disabled={saving || loading}
          >
            {saving ? 'Saving...' : 'Save changes'}
          </Button>
        </div>
      }
    >
      {errorMsg ? <AlertBanner tone="error" message={errorMsg} /> : null}
      {successMsg ? <AlertBanner tone="success" message={successMsg} /> : null}

      {loading || !resume || !india ? (
        <div className="space-y-5">
          <SkeletonBlock className="h-36 w-full" />
          <SkeletonBlock className="h-64 w-full" />
          <SkeletonBlock className="h-64 w-full" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Multi-Profile Variants Switcher (#8) */}
          {variants.length > 0 ? (
            <ProfileVariantBar
              variants={variants}
              activeVariantId={activeVariantId}
              busy={variantBusy || saving}
              onSelectVariant={handleSelectVariant}
              onCreateVariant={handleCreateVariant}
              onSetDefault={handleSetDefaultVariant}
              onDeleteVariant={handleDeleteVariant}
            />
          ) : null}

          {/* GitHub & LinkedIn PDF Import Studio (#9) */}
          {importOpen ? (
            <ProfileImportPanel
              onClose={() => setImportOpen(false)}
              onMergeCandidate={handleMergeImportedCandidate}
            />
          ) : null}

          {/* Candidate Dossier Header Card */}
          {renderBasicsBlock()}

          {/* Section Switcher Tabs */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabStrip
              label="Profile sections"
              activeTab={tab}
              onChange={setTab}
              tabs={[
                { id: 'overview', label: 'Overview' },
                { id: 'work', label: 'Experience', badge: resume.work.length },
                { id: 'projects', label: 'Projects', badge: resume.projects.length },
                { id: 'education', label: 'Education', badge: resume.education.length },
                {
                  id: 'skills',
                  label: 'Skills',
                  badge: resume.skills.reduce((a, g) => a + g.keywords.length, 0)
                },
                { id: 'india', label: 'Preferences' }
              ]}
            />
            <Button
              variant={tab === 'json' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setTab(tab === 'json' ? 'overview' : 'json')}
            >
              {tab === 'json' ? 'Back to overview' : 'View JSON'}
            </Button>
          </div>

          {tab === 'overview' ? (
            <div className="space-y-6">
              {renderWorkSection()}
              {renderProjectsSection()}
              {renderEducationSection()}
              {renderSkillsSection()}
            </div>
          ) : tab === 'work' ? (
            renderWorkSection()
          ) : tab === 'projects' ? (
            renderProjectsSection()
          ) : tab === 'education' ? (
            renderEducationSection()
          ) : tab === 'skills' ? (
            renderSkillsSection()
          ) : tab === 'india' ? (
            renderIndiaSection()
          ) : (
            <section className="border border-[var(--hairline)] bg-[var(--canvas)] p-5 sm:p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--ink)]">
                    Raw JSON Resume (Zod-Validated)
                  </h2>
                  <p className="text-xs text-[var(--mute)]">
                    Edit JSON Resume directly and click Save Changes above to validate and persist.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void navigator.clipboard?.writeText(rawJsonText);
                    moToast('Copied JSON Resume');
                  }}
                >
                  Copy JSON
                </Button>
              </div>
              {rawJsonError ? <AlertBanner tone="error" message={rawJsonError} /> : null}
              <Textarea
                aria-label="Raw JSON Resume editor"
                rows={22}
                spellCheck={false}
                value={rawJsonText}
                onChange={(e) => setRawJsonText(e.target.value)}
                className="text-xs leading-relaxed"
              />
            </section>
          )}
        </div>
      )}
    </AppShell>
  );
}
