'use client';

import React, { useEffect, useState } from 'react';
import {
  INDIAN_TECH_HUBS,
  JsonResumeSchema,
  type IndiaProfile,
  type JsonResume,
  type MasterProfile
} from '@jobpilot/shared';
import { AppShell } from '@/components/layout/app-shell';
import {
  AlertBanner,
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  SectionBlock,
  Select,
  SkeletonBlock,
  TabStrip,
  Textarea
} from '@/components/ui/primitives';
import { api } from '@/lib/api';

type ProfileTab =
  | 'basics'
  | 'india'
  | 'work'
  | 'projects'
  | 'education'
  | 'skills'
  | 'json';

export default function ProfilePage() {
  const [profile, setProfile] = useState<MasterProfile | null>(null);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [resume, setResume] = useState<JsonResume | null>(null);
  const [india, setIndia] = useState<IndiaProfile | null>(null);
  const [rawJsonText, setRawJsonText] = useState('');
  const [rawJsonError, setRawJsonError] = useState<string | null>(null);
  const [customCity, setCustomCity] = useState('');

  const [tab, setTab] = useState<ProfileTab>('india');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const hydrateFromProfile = (p: MasterProfile) => {
    setProfile(p);
    setFullName(p.fullName ?? p.jsonResume.basics.name ?? '');
    setEmail(p.email ?? p.jsonResume.basics.email ?? '');
    setPhone(p.phone ?? p.jsonResume.basics.phone ?? '');
    setResume(p.jsonResume);
    setIndia(p.indiaProfile);
    setRawJsonText(JSON.stringify(p.jsonResume, null, 2));
  };

  useEffect(() => {
    api
      .getProfile()
      .then(hydrateFromProfile)
      .catch((err) => setErrorMsg(err instanceof Error ? err.message : 'Failed to load profile.'))
      .finally(() => setLoading(false));
  }, []);

  const syncResume = (next: JsonResume) => {
    setResume(next);
    setRawJsonText(JSON.stringify(next, null, 2));
    setRawJsonError(null);
  };

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

    try {
      const updated = await api.updateProfile({
        fullName: fullName.trim() || undefined,
        email: email.trim(),
        phone: phone.trim(),
        jsonResume: {
          ...finalResume,
          basics: {
            ...finalResume.basics,
            name: fullName.trim() || finalResume.basics.name,
            email: email.trim() || finalResume.basics.email,
            phone: phone.trim() || finalResume.basics.phone
          }
        },
        indiaProfile: india
      });
      hydrateFromProfile(updated);
      setSuccessMsg(`Saved Master Profile (v${updated.activeProfileVersion}).`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save profile.');
    } finally {
      setSaving(false);
    }
  };

  const handleReuploadPdf = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pdfFile) return;
    setUploadingPdf(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await api.parseResumePdf(pdfFile, { apply: true });
      if (res.appliedProfile) {
        hydrateFromProfile(res.appliedProfile);
      }
      setPdfFile(null);
      setSuccessMsg(
        `Parsed "${pdfFile.name}" (${res.totalPages} page(s)) via ${res.modelUsed} and updated profile.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Resume upload failed.');
    } finally {
      setUploadingPdf(false);
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

  return (
    <AppShell
      title="Master Profile"
      subtitle="Single source of truth for resume tailoring and extension autofill. Every claim must trace back to this profile."
      actions={
        profile ? (
          <div className="flex items-center gap-2">
            <Badge tone="dark">v{profile.activeProfileVersion}</Badge>
            <Button variant="primary" onClick={handleSaveProfile} disabled={saving || loading}>
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        ) : null
      }
    >
      {errorMsg ? <AlertBanner tone="error" message={errorMsg} /> : null}
      {successMsg ? <AlertBanner tone="success" message={successMsg} /> : null}

      {/* Inline PDF Resume Re-import bar */}
      <SectionBlock
        title="Import / Re-parse PDF Resume"
        marker="[^]"
        description="Upload a text-based PDF to auto-populate JSON Resume + Indian academic fields."
      >
        <form onSubmit={handleReuploadPdf} className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept="application/pdf,.pdf"
            aria-label="Upload PDF resume"
            onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
            className="text-xs border border-[var(--hairline)] bg-[var(--surface-soft)] px-3 py-2 rounded-[4px] max-w-sm"
          />
          <Button type="submit" size="sm" variant="secondary" disabled={!pdfFile || uploadingPdf}>
            {uploadingPdf ? 'Parsing PDF...' : 'Parse & Apply PDF'}
          </Button>
          {profile?.sourceResumeStoragePath ? (
            <span className="text-xs text-[var(--mute)] truncate max-w-md">
              Stored: {profile.sourceResumeStoragePath}
            </span>
          ) : null}
        </form>
      </SectionBlock>

      {loading || !resume || !india ? (
        <div className="space-y-4">
          <SkeletonBlock className="h-12 w-full" />
          <SkeletonBlock className="h-64 w-full" />
        </div>
      ) : (
        <div className="space-y-6">
          <TabStrip
            label="Master Profile sections"
            activeTab={tab}
            onChange={setTab}
            tabs={[
              { id: 'india', label: 'India & Eligibility' },
              { id: 'basics', label: 'Basics & Links' },
              { id: 'work', label: 'Experience', badge: resume.work.length },
              { id: 'projects', label: 'Projects', badge: resume.projects.length },
              { id: 'education', label: 'Education', badge: resume.education.length },
              { id: 'skills', label: 'Skills', badge: resume.skills.length },
              { id: 'json', label: 'Raw JSON' }
            ]}
          />

          {tab === 'india' ? (
            <SectionBlock
              title="India-Specific Compensation, Notice & Academic Fields"
              description="Used by job hard-filters (LPA / YoE) and automatic form filling on Naukri, Greenhouse, Lever, Ashby, and campus portals."
            >
              <div className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <Field label="Current CTC (LPA)" htmlFor="ind-cctc">
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
                  <Field label="Preferred Currency" htmlFor="ind-cur">
                    {(props) => (
                      <Select
                        {...props}
                        value={india.ctcCurrency}
                        onChange={(e) =>
                          setIndia({
                            ...india,
                            ctcCurrency: e.target.value as IndiaProfile['ctcCurrency']
                          })
                        }
                      >
                        <option value="INR">INR (LPA)</option>
                        <option value="USD">USD</option>
                        <option value="EUR">EUR</option>
                        <option value="GBP">GBP</option>
                        <option value="SGD">SGD</option>
                        <option value="AED">AED</option>
                      </Select>
                    )}
                  </Field>
                  <Field label="Notice Period (Days)" htmlFor="ind-notice">
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
                            noticePeriodDays:
                              e.target.value === '' ? null : Number(e.target.value)
                          })
                        }
                      />
                    )}
                  </Field>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <Field label="Last Working Day" htmlFor="ind-lwd" hint="YYYY-MM-DD (if serving)">
                    {(props) => (
                      <Input
                        {...props}
                        type="date"
                        value={india.lastWorkingDay ?? ''}
                        onChange={(e) =>
                          setIndia({ ...india, lastWorkingDay: e.target.value || null })
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
                  <Field label="Internship Status" htmlFor="ind-intern">
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
                        <option value="none">None</option>
                        <option value="seeking_internship">Seeking Internship</option>
                        <option value="currently_interning">Currently Interning</option>
                        <option value="completed_internship">Completed Internship</option>
                        <option value="ppo_holder">PPO Holder</option>
                      </Select>
                    )}
                  </Field>
                  <Field label="Active Backlogs" htmlFor="ind-backlogs">
                    {(props) => (
                      <Input
                        {...props}
                        type="number"
                        min={0}
                        max={50}
                        value={india.activeBacklogs}
                        onChange={(e) =>
                          setIndia({ ...india, activeBacklogs: Number(e.target.value || 0) })
                        }
                      />
                    )}
                  </Field>
                </div>

                <div className="border-t border-[var(--hairline)] pt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <Field label="College / Institute" htmlFor="ind-college">
                    {(props) => (
                      <Input
                        {...props}
                        value={india.collegeName}
                        onChange={(e) => setIndia({ ...india, collegeName: e.target.value })}
                      />
                    )}
                  </Field>
                  <Field label="Degree" htmlFor="ind-degree" hint="e.g. B.Tech, B.E., M.Tech">
                    {(props) => (
                      <Input
                        {...props}
                        value={india.degree}
                        onChange={(e) => setIndia({ ...india, degree: e.target.value })}
                      />
                    )}
                  </Field>
                  <Field label="Branch / Major" htmlFor="ind-branch">
                    {(props) => (
                      <Input
                        {...props}
                        value={india.branch}
                        onChange={(e) => setIndia({ ...india, branch: e.target.value })}
                      />
                    )}
                  </Field>
                  <Field label="Graduation Year" htmlFor="ind-gradyear">
                    {(props) => (
                      <Input
                        {...props}
                        type="number"
                        min={1980}
                        max={2035}
                        value={india.graduationYear ?? ''}
                        onChange={(e) =>
                          setIndia({
                            ...india,
                            graduationYear:
                              e.target.value === '' ? null : Number(e.target.value)
                          })
                        }
                      />
                    )}
                  </Field>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <Field label="CGPA" htmlFor="ind-cgpa">
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
                  <Field label="CGPA Scale" htmlFor="ind-scale">
                    {(props) => (
                      <Input
                        {...props}
                        type="number"
                        step="0.1"
                        min={4}
                        max={100}
                        value={india.cgpaScale}
                        onChange={(e) =>
                          setIndia({ ...india, cgpaScale: Number(e.target.value || 10) })
                        }
                      />
                    )}
                  </Field>
                  <Field label="10th Marks (%)" htmlFor="ind-10th">
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
                            tenthPercentage:
                              e.target.value === '' ? null : Number(e.target.value)
                          })
                        }
                      />
                    )}
                  </Field>
                  <Field label="12th Marks (%)" htmlFor="ind-12th">
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
                            twelfthPercentage:
                              e.target.value === '' ? null : Number(e.target.value)
                          })
                        }
                      />
                    )}
                  </Field>
                </div>

                <div className="border-t border-[var(--hairline)] pt-5 space-y-3">
                  <p className="text-sm font-medium text-[var(--ink)]">Preferred Cities</p>
                  <div className="flex flex-wrap gap-2">
                    {INDIAN_TECH_HUBS.map((city) => {
                      const active = india.preferredCities.includes(city);
                      return (
                        <button
                          key={city}
                          type="button"
                          onClick={() => togglePreferredCity(city)}
                          aria-pressed={active}
                          className={`px-2.5 py-1 text-xs rounded-[4px] border cursor-pointer ${
                            active
                              ? 'bg-[var(--ink)] text-[var(--on-primary)] border-[var(--ink)]'
                              : 'bg-[var(--surface-soft)] text-[var(--body)] border-[var(--hairline)]'
                          }`}
                        >
                          {active ? '[x] ' : '[+] '}
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
                          className="px-2.5 py-1 text-xs rounded-[4px] border bg-[var(--ink)] text-[var(--on-primary)] border-[var(--ink)] cursor-pointer"
                        >
                          [x] {city}
                        </button>
                      ))}
                  </div>
                  <div className="flex gap-2 max-w-xs">
                    <Input
                      aria-label="Add custom preferred city"
                      placeholder="Add custom city (e.g. London)..."
                      value={customCity}
                      onChange={(e) => setCustomCity(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addCustomCity();
                        }
                      }}
                    />
                    <Button size="sm" variant="secondary" onClick={addCustomCity}>
                      Add
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-6 pt-2">
                  <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={india.isServingNotice}
                      onChange={(e) => setIndia({ ...india, isServingNotice: e.target.checked })}
                      className="w-4 h-4"
                    />
                    <span>Currently serving notice period</span>
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
                  <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={india.isFresher}
                      onChange={(e) => setIndia({ ...india, isFresher: e.target.checked })}
                      className="w-4 h-4"
                    />
                    <span>Fresher / New Grad</span>
                  </label>
                </div>
              </div>
            </SectionBlock>
          ) : tab === 'basics' ? (
            <SectionBlock title="Basics & Profile Links">
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                  <Field label="Headline / Role Label" htmlFor="bas-label">
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
                  <Field label="Portfolio / Website URL" htmlFor="bas-url">
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
                  <Field label="Current City & Country Code" htmlFor="bas-city">
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

                <Field label="Summary" htmlFor="bas-summary">
                  {(props) => (
                    <Textarea
                      {...props}
                      rows={4}
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
            </SectionBlock>
          ) : tab === 'work' ? (
            <SectionBlock
              title="Work & Internship Experience"
              action={
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    syncResume({
                      ...resume,
                      work: [
                        ...resume.work,
                        {
                          id: `work-${Date.now()}`,
                          name: 'Company Name',
                          position: 'Software Engineer Intern',
                          url: '',
                          location: '',
                          employmentType: 'Internship',
                          startDate: '2025-05',
                          endDate: '2025-07',
                          summary: '',
                          highlights: []
                        }
                      ]
                    })
                  }
                >
                  [+] Add Experience
                </Button>
              }
            >
              {resume.work.length === 0 ? (
                <EmptyState
                  title="No experience entries yet"
                  description="Add internships or full-time roles, or parse a PDF resume above."
                />
              ) : (
                <div className="space-y-6">
                  {resume.work.map((item, idx) => (
                    <div
                      key={item.id}
                      className="border border-[var(--hairline)] p-4 bg-[var(--surface-soft)] space-y-3"
                    >
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold text-[var(--mute)]">
                          #{idx + 1} · {item.id}
                        </span>
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
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Input
                          aria-label="Company name"
                          placeholder="Company"
                          value={item.name}
                          onChange={(e) => {
                            const next = [...resume.work];
                            next[idx] = { ...item, name: e.target.value };
                            syncResume({ ...resume, work: next });
                          }}
                        />
                        <Input
                          aria-label="Role title"
                          placeholder="Position"
                          value={item.position}
                          onChange={(e) => {
                            const next = [...resume.work];
                            next[idx] = { ...item, position: e.target.value };
                            syncResume({ ...resume, work: next });
                          }}
                        />
                        <Input
                          aria-label="Start date"
                          placeholder="Start (YYYY-MM)"
                          value={item.startDate}
                          onChange={(e) => {
                            const next = [...resume.work];
                            next[idx] = { ...item, startDate: e.target.value };
                            syncResume({ ...resume, work: next });
                          }}
                        />
                        <Input
                          aria-label="End date"
                          placeholder="End (YYYY-MM or Present)"
                          value={item.endDate ?? ''}
                          onChange={(e) => {
                            const next = [...resume.work];
                            next[idx] = { ...item, endDate: e.target.value };
                            syncResume({ ...resume, work: next });
                          }}
                        />
                      </div>
                      <Textarea
                        aria-label="Highlights (one bullet per line)"
                        rows={3}
                        placeholder="One achievement bullet per line..."
                        value={item.highlights.join('\n')}
                        onChange={(e) => {
                          const next = [...resume.work];
                          next[idx] = {
                            ...item,
                            highlights: e.target.value.split('\n').filter((l) => l.trim().length > 0)
                          };
                          syncResume({ ...resume, work: next });
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </SectionBlock>
          ) : tab === 'projects' ? (
            <SectionBlock
              title="Projects"
              action={
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    syncResume({
                      ...resume,
                      projects: [
                        ...resume.projects,
                        {
                          id: `proj-${Date.now()}`,
                          name: 'New Project',
                          description: '',
                          highlights: [],
                          keywords: [],
                          startDate: '',
                          endDate: '',
                          url: '',
                          roles: [],
                          entity: '',
                          type: ''
                        }
                      ]
                    })
                  }
                >
                  [+] Add Project
                </Button>
              }
            >
              {resume.projects.length === 0 ? (
                <EmptyState
                  title="No projects added yet"
                  description="Add technical projects with stack keywords and measured impact bullets."
                />
              ) : (
                <div className="space-y-6">
                  {resume.projects.map((proj, idx) => (
                    <div
                      key={proj.id}
                      className="border border-[var(--hairline)] p-4 bg-[var(--surface-soft)] space-y-3"
                    >
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold text-[var(--mute)]">{proj.id}</span>
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
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Input
                          aria-label="Project name"
                          placeholder="Project Name"
                          value={proj.name}
                          onChange={(e) => {
                            const next = [...resume.projects];
                            next[idx] = { ...proj, name: e.target.value };
                            syncResume({ ...resume, projects: next });
                          }}
                        />
                        <Input
                          aria-label="Project URL"
                          placeholder="GitHub / Live URL"
                          value={proj.url ?? ''}
                          onChange={(e) => {
                            const next = [...resume.projects];
                            next[idx] = { ...proj, url: e.target.value };
                            syncResume({ ...resume, projects: next });
                          }}
                        />
                      </div>
                      <Input
                        aria-label="Keywords"
                        placeholder="Comma-separated tech stack (e.g. Next.js, Postgres, Docker)"
                        value={(proj.keywords ?? []).join(', ')}
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
                      <Textarea
                        aria-label="Project highlights"
                        rows={3}
                        placeholder="One bullet per line..."
                        value={proj.highlights.join('\n')}
                        onChange={(e) => {
                          const next = [...resume.projects];
                          next[idx] = {
                            ...proj,
                            highlights: e.target.value.split('\n').filter((l) => l.trim().length > 0)
                          };
                          syncResume({ ...resume, projects: next });
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </SectionBlock>
          ) : tab === 'education' ? (
            <SectionBlock
              title="Education"
              action={
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    syncResume({
                      ...resume,
                      education: [
                        ...resume.education,
                        {
                          id: `edu-${Date.now()}`,
                          institution: 'Institute Name',
                          url: '',
                          area: 'Computer Science',
                          studyType: 'B.Tech',
                          startDate: '2022',
                          endDate: '2026',
                          score: '',
                          courses: []
                        }
                      ]
                    })
                  }
                >
                  [+] Add Education
                </Button>
              }
            >
              {resume.education.length === 0 ? (
                <EmptyState
                  title="No education entries yet"
                  description="Add your college/university degree details."
                />
              ) : (
                <div className="space-y-4">
                  {resume.education.map((edu, idx) => (
                    <div
                      key={edu.id}
                      className="border border-[var(--hairline)] p-4 bg-[var(--surface-soft)] space-y-3"
                    >
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold text-[var(--mute)]">{edu.id}</span>
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
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        <Input
                          aria-label="Institution"
                          placeholder="Institution"
                          value={edu.institution}
                          onChange={(e) => {
                            const next = [...resume.education];
                            next[idx] = { ...edu, institution: e.target.value };
                            syncResume({ ...resume, education: next });
                          }}
                        />
                        <Input
                          aria-label="Degree"
                          placeholder="Degree (e.g. B.Tech)"
                          value={edu.studyType ?? ''}
                          onChange={(e) => {
                            const next = [...resume.education];
                            next[idx] = { ...edu, studyType: e.target.value };
                            syncResume({ ...resume, education: next });
                          }}
                        />
                        <Input
                          aria-label="Field of study"
                          placeholder="Area (e.g. Computer Science)"
                          value={edu.area ?? ''}
                          onChange={(e) => {
                            const next = [...resume.education];
                            next[idx] = { ...edu, area: e.target.value };
                            syncResume({ ...resume, education: next });
                          }}
                        />
                        <Input
                          aria-label="Start year"
                          placeholder="Start"
                          value={edu.startDate ?? ''}
                          onChange={(e) => {
                            const next = [...resume.education];
                            next[idx] = { ...edu, startDate: e.target.value };
                            syncResume({ ...resume, education: next });
                          }}
                        />
                        <Input
                          aria-label="End year"
                          placeholder="End"
                          value={edu.endDate ?? ''}
                          onChange={(e) => {
                            const next = [...resume.education];
                            next[idx] = { ...edu, endDate: e.target.value };
                            syncResume({ ...resume, education: next });
                          }}
                        />
                        <Input
                          aria-label="Score or CGPA"
                          placeholder="Score / CGPA"
                          value={edu.score ?? ''}
                          onChange={(e) => {
                            const next = [...resume.education];
                            next[idx] = { ...edu, score: e.target.value };
                            syncResume({ ...resume, education: next });
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionBlock>
          ) : tab === 'skills' ? (
            <SectionBlock
              title="Skills Matrix"
              action={
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    syncResume({
                      ...resume,
                      skills: [...resume.skills, { name: 'Languages', level: '', keywords: [] }]
                    })
                  }
                >
                  [+] Add Skill Group
                </Button>
              }
            >
              {resume.skills.length === 0 ? (
                <EmptyState
                  title="No skill groups yet"
                  description="Group skills by Languages, Frameworks, Databases, Cloud, etc."
                />
              ) : (
                <div className="space-y-4">
                  {resume.skills.map((grp, idx) => (
                    <div
                      key={idx}
                      className="border border-[var(--hairline)] p-4 bg-[var(--surface-soft)] grid grid-cols-1 md:grid-cols-12 gap-3 items-center"
                    >
                      <div className="md:col-span-4">
                        <Input
                          aria-label="Skill category"
                          placeholder="Category (e.g. Backend)"
                          value={grp.name}
                          onChange={(e) => {
                            const next = [...resume.skills];
                            next[idx] = { ...grp, name: e.target.value };
                            syncResume({ ...resume, skills: next });
                          }}
                        />
                      </div>
                      <div className="md:col-span-7">
                        <Input
                          aria-label="Skill keywords"
                          placeholder="Comma-separated (e.g. Node.js, Fastify, PostgreSQL)"
                          value={grp.keywords.join(', ')}
                          onChange={(e) => {
                            const next = [...resume.skills];
                            next[idx] = {
                              ...grp,
                              keywords: e.target.value
                                .split(',')
                                .map((s) => s.trim())
                                .filter(Boolean)
                            };
                            syncResume({ ...resume, skills: next });
                          }}
                        />
                      </div>
                      <div className="md:col-span-1 flex justify-end">
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
                          [x]
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionBlock>
          ) : (
            <SectionBlock
              title="Raw JSON Resume (Zod-validated)"
              description="Direct JSON Resume editing. Click Save Changes above to validate and persist."
              action={
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    navigator.clipboard?.writeText(rawJsonText);
                    setSuccessMsg('Copied JSON Resume to clipboard.');
                  }}
                >
                  Copy JSON
                </Button>
              }
            >
              <div className="space-y-3">
                {rawJsonError ? <AlertBanner tone="error" message={rawJsonError} /> : null}
                <Textarea
                  aria-label="Raw JSON Resume editor"
                  rows={22}
                  spellCheck={false}
                  value={rawJsonText}
                  onChange={(e) => setRawJsonText(e.target.value)}
                  className="text-xs leading-relaxed"
                />
              </div>
            </SectionBlock>
          )}
        </div>
      )}
    </AppShell>
  );
}
