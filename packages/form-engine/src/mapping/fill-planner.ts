import type {
  CoverLetterRecord,
  DetectedFormField,
  DraftAnswerItem,
  FallbackFillSuggestion,
  FillPlanItem,
  FillValueSource,
  MasterProfile,
  ResumeVersionRecord,
  SavedAnswer
} from '@jobpilot/shared';

function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0]!, lastName: '' };
  return {
    firstName: parts[0]!,
    lastName: parts.slice(1).join(' ')
  };
}

function findProfileUrl(profile: MasterProfile, matcher: RegExp): string {
  const profiles = profile.jsonResume.basics.profiles ?? [];
  for (const p of profiles) {
    if (matcher.test(p.network) || matcher.test(p.url ?? '')) {
      if (p.url?.trim()) return p.url.trim();
      if (p.username?.trim() && /linkedin/i.test(p.network)) {
        return `https://www.linkedin.com/in/${p.username.trim()}`;
      }
      if (p.username?.trim() && /github/i.test(p.network)) {
        return `https://github.com/${p.username.trim()}`;
      }
    }
  }
  return '';
}

function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3);
}

function matchSavedAnswer(label: string, savedAnswers: SavedAnswer[]): SavedAnswer | null {
  const lower = label.toLowerCase();
  const labelTokens = new Set(normalizeWords(label));
  if (labelTokens.size === 0) return null;

  let best: { item: SavedAnswer; score: number } | null = null;
  for (const item of savedAnswers) {
    const keyPhrase = item.questionKey.toLowerCase().replace(/_/g, ' ');
    if (lower.includes(keyPhrase) || lower.includes(item.questionPattern.toLowerCase())) {
      return item;
    }

    const patternTokens = normalizeWords(`${item.questionKey} ${item.questionPattern} ${item.tags.join(' ')}`);
    if (patternTokens.length === 0) continue;
    let hits = 0;
    for (const token of patternTokens) {
      if (labelTokens.has(token)) hits++;
    }
    const score = hits / Math.max(1, Math.min(labelTokens.size, patternTokens.length));
    if (score >= 0.55 && (!best || score > best.score)) {
      best = { item, score };
    }
  }
  return best?.item ?? null;
}

function estimateTotalExperienceYears(profile: MasterProfile): string {
  const work = profile.jsonResume.work ?? [];
  if (profile.indiaProfile.isFresher && work.length === 0) return '0';
  if (work.length === 0) return '0';
  let totalMonths = 0;
  for (const w of work) {
    const startYearMatch = w.startDate.match(/(\d{4})/);
    if (!startYearMatch) continue;
    const startYear = Number(startYearMatch[1]);
    const endYear = /present|current/i.test(w.endDate ?? '')
      ? new Date().getFullYear()
      : Number(w.endDate?.match(/(\d{4})/)?.[1] ?? startYear);
    totalMonths += Math.max(3, (endYear - startYear) * 12);
  }
  return String(Math.round((totalMonths / 12) * 10) / 10);
}

function formatCtcForField(lpa: number | null, field: DetectedFormField): string {
  if (lpa == null) return '';
  const asksRupees = /\b(?:inr|rupees|per\s*annum|annual)\b/i.test(field.label) && !/\blpa\b/i.test(field.label);
  if (field.controlType === 'number') {
    return asksRupees ? String(Math.round(lpa * 100_000)) : String(lpa);
  }
  return asksRupees ? `${Math.round(lpa * 100_000)}` : `${lpa} LPA`;
}

function resolveCanonicalValue(params: {
  field: DetectedFormField;
  profile: MasterProfile;
  savedAnswers: SavedAnswer[];
  resumeVersion?: ResumeVersionRecord | null;
  coverLetter?: CoverLetterRecord | null;
  draftsByFieldId: Map<string, DraftAnswerItem>;
}): { value: string; displayValue: string; source: FillValueSource; confidence: number } {
  const { field, profile, savedAnswers, resumeVersion, coverLetter, draftsByFieldId } = params;
  const activeResume = resumeVersion?.tailoredJsonResume ?? profile.jsonResume;
  const fullName = profile.fullName?.trim() || activeResume.basics.name?.trim() || '';
  const { firstName, lastName } = splitFullName(fullName);
  const email = profile.email?.trim() || activeResume.basics.email?.trim() || '';
  const phone = profile.phone?.trim() || activeResume.basics.phone?.trim() || '';
  const india = profile.indiaProfile;
  const primaryEdu = activeResume.education[0];
  const primaryWork = activeResume.work[0];

  // Check AI/saved draft first if explicitly provided for this field
  const explicitDraft = draftsByFieldId.get(field.fieldId);
  if (explicitDraft && explicitDraft.answer.trim()) {
    return {
      value: explicitDraft.answer,
      displayValue: explicitDraft.answer,
      source: explicitDraft.source === 'saved_answer' ? 'saved_answer' : 'llm_draft',
      confidence: explicitDraft.confidence
    };
  }

  switch (field.canonicalKey) {
    case 'resume_file':
      if (!resumeVersion) {
        return {
          value: profile.sourceResumeStoragePath ? 'Master Resume PDF' : '',
          displayValue: 'Select a tailored resume version',
          source: 'profile',
          confidence: 0.65
        };
      }
      return {
        value: `jobpilot-v${resumeVersion.versionNumber}.pdf`,
        displayValue: `v${resumeVersion.versionNumber} · ${resumeVersion.label}`,
        source: 'tailored_resume',
        confidence: field.confidence
      };

    case 'full_name':
      return { value: fullName, displayValue: fullName, source: 'profile', confidence: field.confidence };
    case 'first_name':
      return { value: firstName, displayValue: firstName, source: 'profile', confidence: field.confidence };
    case 'last_name':
      return { value: lastName, displayValue: lastName, source: 'profile', confidence: field.confidence };
    case 'email':
      return { value: email, displayValue: email, source: 'profile', confidence: field.confidence };
    case 'phone':
      return { value: phone, displayValue: phone, source: 'profile', confidence: field.confidence };

    case 'location_city':
    case 'location_full': {
      const city = activeResume.basics.location?.city?.trim() || india.preferredCities[0] || '';
      const country = activeResume.basics.location?.countryCode?.trim() || '';
      const val =
        field.canonicalKey === 'location_full' && city && country ? `${city}, ${country}` : city;
      return { value: val, displayValue: val, source: 'profile', confidence: field.confidence };
    }

    case 'linkedin_url': {
      const url = findProfileUrl(profile, /linkedin/i);
      return { value: url, displayValue: url, source: 'profile', confidence: url ? field.confidence : 0 };
    }
    case 'github_url': {
      const url = findProfileUrl(profile, /github/i);
      return { value: url, displayValue: url, source: 'profile', confidence: url ? field.confidence : 0 };
    }
    case 'portfolio_url': {
      const url = activeResume.basics.url?.trim() || findProfileUrl(profile, /website|portfolio|blog/i);
      return { value: url, displayValue: url, source: 'profile', confidence: url ? field.confidence : 0 };
    }

    case 'current_company': {
      const val = primaryWork?.name ?? '';
      return { value: val, displayValue: val, source: 'profile', confidence: val ? field.confidence : 0 };
    }
    case 'current_title': {
      const val = primaryWork?.position ?? activeResume.basics.label ?? '';
      return { value: val, displayValue: val, source: 'profile', confidence: val ? field.confidence : 0 };
    }
    case 'years_of_experience': {
      const val = estimateTotalExperienceYears(profile);
      return { value: val, displayValue: `${val} yrs`, source: 'profile', confidence: field.confidence };
    }

    case 'school': {
      const val = india.collegeName.trim() || primaryEdu?.institution || '';
      return { value: val, displayValue: val, source: 'india_profile', confidence: val ? field.confidence : 0 };
    }
    case 'degree': {
      const val = india.degree.trim() || primaryEdu?.studyType || '';
      return { value: val, displayValue: val, source: 'india_profile', confidence: val ? field.confidence : 0 };
    }
    case 'major': {
      const val = india.branch.trim() || primaryEdu?.area || '';
      return { value: val, displayValue: val, source: 'india_profile', confidence: val ? field.confidence : 0 };
    }
    case 'graduation_year': {
      const val =
        india.graduationYear != null
          ? String(india.graduationYear)
          : primaryEdu?.endDate?.match(/\d{4}/)?.[0] ?? '';
      return { value: val, displayValue: val, source: 'india_profile', confidence: val ? field.confidence : 0 };
    }
    case 'cgpa': {
      const val = india.cgpa != null ? String(india.cgpa) : primaryEdu?.score ?? '';
      return { value: val, displayValue: val, source: 'india_profile', confidence: val ? field.confidence : 0 };
    }
    case 'tenth_percentage': {
      const val = india.tenthPercentage != null ? String(india.tenthPercentage) : '';
      return { value: val, displayValue: val ? `${val}%` : '', source: 'india_profile', confidence: val ? field.confidence : 0 };
    }
    case 'twelfth_percentage': {
      const val = india.twelfthPercentage != null ? String(india.twelfthPercentage) : '';
      return { value: val, displayValue: val ? `${val}%` : '', source: 'india_profile', confidence: val ? field.confidence : 0 };
    }

    case 'current_ctc_lpa': {
      const val = formatCtcForField(india.currentCtcLpa, field);
      return { value: val, displayValue: val, source: 'india_profile', confidence: val ? field.confidence : 0 };
    }
    case 'expected_ctc_lpa': {
      const val = formatCtcForField(india.expectedCtcLpa, field);
      return { value: val, displayValue: val, source: 'india_profile', confidence: val ? field.confidence : 0 };
    }
    case 'notice_period_days': {
      if (india.noticePeriodDays == null) {
        return { value: '', displayValue: '', source: 'unmapped', confidence: 0 };
      }
      const val =
        field.controlType === 'number'
          ? String(india.noticePeriodDays)
          : india.noticePeriodDays === 0
            ? 'Immediate'
            : `${india.noticePeriodDays} days`;
      return { value: val, displayValue: val, source: 'india_profile', confidence: field.confidence };
    }
    case 'willing_to_relocate': {
      const val = india.willingToRelocate ? 'Yes' : 'No';
      return { value: val, displayValue: val, source: 'india_profile', confidence: field.confidence };
    }
    case 'preferred_cities': {
      const val = india.preferredCities.join(', ');
      return { value: val, displayValue: val, source: 'india_profile', confidence: val ? field.confidence : 0 };
    }
    case 'requires_sponsorship': {
      const val = india.workAuthorization === 'requires_sponsorship' ? 'Yes' : 'No';
      return { value: val, displayValue: val, source: 'india_profile', confidence: field.confidence };
    }
    case 'work_authorization': {
      const isAuthorized = india.workAuthorization !== 'requires_sponsorship';
      const hasYesNoOption = field.options.some((o) => /^(yes|no)$/i.test(o.trim()));
      const val = hasYesNoOption
        ? isAuthorized
          ? 'Yes'
          : 'No'
        : india.workAuthorization === 'indian_citizen'
          ? 'Authorized (Indian Citizen)'
          : india.workAuthorization.replace(/_/g, ' ');
      return { value: val, displayValue: val, source: 'india_profile', confidence: field.confidence };
    }
    case 'is_fresher': {
      const val = india.isFresher ? 'Yes' : 'No';
      return { value: val, displayValue: val, source: 'india_profile', confidence: field.confidence };
    }
    case 'active_backlogs': {
      const val =
        field.controlType === 'radio' || field.options.some((o) => /^(yes|no)$/i.test(o.trim()))
          ? india.activeBacklogs > 0
            ? 'Yes'
            : 'No'
          : String(india.activeBacklogs);
      return { value: val, displayValue: val, source: 'india_profile', confidence: field.confidence };
    }

    case 'cover_letter': {
      if (field.controlType === 'file') {
        if (!coverLetter) {
          return {
            value: '',
            displayValue: 'Select a cover letter above',
            source: 'unmapped',
            confidence: 0
          };
        }
        return {
          value: `jobpilot-cl-v${coverLetter.versionNumber}.pdf`,
          displayValue: `CL v${coverLetter.versionNumber} · ${coverLetter.label}`,
          source: 'tailored_resume',
          confidence: 0.94
        };
      }
      if (coverLetter?.plainText?.trim()) {
        return {
          value: coverLetter.plainText,
          displayValue: coverLetter.plainText,
          source: 'tailored_resume',
          confidence: 0.94
        };
      }
      const saved = matchSavedAnswer(field.label || 'cover letter', savedAnswers);
      if (saved) {
        return { value: saved.answer, displayValue: saved.answer, source: 'saved_answer', confidence: 0.92 };
      }
      const summary = activeResume.basics.summary?.trim() ?? '';
      return {
        value: summary,
        displayValue: summary,
        source: resumeVersion ? 'tailored_resume' : 'profile',
        confidence: summary ? 0.72 : 0
      };
    }

    case 'custom_question':
    case 'unknown': {
      const saved = matchSavedAnswer(field.label, savedAnswers);
      if (saved) {
        return {
          value: saved.answer,
          displayValue: saved.answer,
          source: 'saved_answer',
          confidence: 0.94
        };
      }
      return { value: '', displayValue: '', source: 'unmapped', confidence: 0 };
    }
  }
}

export function buildFillPlan(params: {
  fields: DetectedFormField[];
  profile: MasterProfile;
  savedAnswers?: SavedAnswer[];
  resumeVersion?: ResumeVersionRecord | null;
  coverLetter?: CoverLetterRecord | null;
  drafts?: DraftAnswerItem[];
  fallbackSuggestions?: FallbackFillSuggestion[];
}): FillPlanItem[] {
  const savedAnswers = params.savedAnswers ?? [];
  const draftsByFieldId = new Map((params.drafts ?? []).map((d) => [d.fieldId, d]));
  const fallbackByFieldId = new Map(
    (params.fallbackSuggestions ?? []).map((s) => [s.fieldId, s])
  );

  return params.fields.map((field) => {
    const resolved = resolveCanonicalValue({
      field,
      profile: params.profile,
      savedAnswers,
      resumeVersion: params.resumeVersion,
      coverLetter: params.coverLetter,
      draftsByFieldId
    });

    const deterministicHasValue =
      field.controlType === 'file'
        ? field.canonicalKey === 'cover_letter'
          ? Boolean(params.coverLetter)
          : Boolean(params.resumeVersion)
        : resolved.value.trim().length > 0;

    // Apply grounded LLM fallback ONLY when field is not already filled and deterministic/saved resolution found nothing
    const fallback = !field.alreadyFilled && !deterministicHasValue
      ? fallbackByFieldId.get(field.fieldId)
      : undefined;

    if (fallback && fallback.proposedValue.trim().length > 0) {
      const cappedConfidence = Math.min(0.85, Math.max(0.1, fallback.confidence));
      const nextCanonical =
        fallback.canonicalKey && fallback.canonicalKey !== 'unknown'
          ? fallback.canonicalKey
          : field.canonicalKey;

      return {
        fieldId: field.fieldId,
        canonicalKey: nextCanonical,
        label: field.label || field.name || field.id || nextCanonical,
        controlType: field.controlType,
        proposedValue: fallback.proposedValue,
        displayValue: fallback.proposedValue,
        confidence: cappedConfidence,
        source: 'llm_fallback',
        alreadyFilled: false,
        included: true,
        ...(fallback.rationale ? { skipReason: fallback.rationale } : {})
      };
    }

    const included = !field.alreadyFilled && deterministicHasValue;

    return {
      fieldId: field.fieldId,
      canonicalKey: field.canonicalKey,
      label: field.label || field.name || field.id || field.canonicalKey,
      controlType: field.controlType,
      proposedValue: resolved.value,
      displayValue: resolved.displayValue,
      confidence: deterministicHasValue ? resolved.confidence : 0,
      source: deterministicHasValue ? resolved.source : 'unmapped',
      alreadyFilled: field.alreadyFilled,
      included,
      ...(field.alreadyFilled
        ? { skipReason: 'Already filled on page — will never overwrite' }
        : !deterministicHasValue
          ? { skipReason: 'Unmapped or empty in profile — use Draft AI or LLM Fallback' }
          : {})
    };
  });
}
