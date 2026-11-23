import type { JobRecord, MasterProfile } from '@jobpilot/shared';

export interface HardFilterResult {
  passed: boolean;
  reasons: string[];
}

function parseYearMonth(raw: string | undefined | null): number | null {
  if (!raw?.trim()) return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === 'present' || trimmed === 'current') {
    return Date.now();
  }
  const ym = trimmed.match(/^(\d{4})(?:-(\d{1,2}))?/);
  if (!ym?.[1]) {
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const year = Number.parseInt(ym[1], 10);
  const month = ym[2] ? Math.max(0, Math.min(11, Number.parseInt(ym[2], 10) - 1)) : 0;
  return Date.UTC(year, month, 1);
}

export function estimateCandidateExperienceYears(profile: MasterProfile): number {
  let totalMonths = 0;
  for (const w of profile.jsonResume.work) {
    const isIntern =
      /\bintern\b/i.test(w.position) || /\bintern\b/i.test(w.employmentType ?? '');
    if (isIntern && profile.indiaProfile.isFresher) {
      // Internships count as 0.25x toward full-time YoE when candidate marks fresher
      const start = parseYearMonth(w.startDate);
      const end = parseYearMonth(w.endDate || 'present');
      if (start && end && end >= start) {
        const months = Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24 * 30.4)));
        totalMonths += months * 0.25;
      }
      continue;
    }

    const start = parseYearMonth(w.startDate);
    const end = parseYearMonth(w.endDate || 'present');
    if (start && end && end >= start) {
      const months = Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24 * 30.4)));
      totalMonths += months;
    }
  }
  return Math.round((totalMonths / 12) * 10) / 10;
}

function normalizeCityToken(city: string): string {
  const c = city.toLowerCase().trim();
  if (c === 'bangalore' || c === 'blr') return 'bengaluru';
  if (c === 'gurgaon') return 'gurugram';
  if (c === 'new delhi' || c === 'delhi') return 'delhi ncr';
  return c;
}

export function evaluateHardFilters(
  profile: MasterProfile,
  job: Pick<
    JobRecord,
    | 'city'
    | 'countryCode'
    | 'workMode'
    | 'seniority'
    | 'experienceMinYears'
    | 'salaryMaxLpa'
    | 'locationRaw'
  >
): HardFilterResult {
  const reasons: string[] = [];
  const { indiaProfile, searchPreferences } = profile;

  // 1. Work mode check
  if (
    searchPreferences.workModes.length > 0 &&
    job.workMode !== 'unknown' &&
    !searchPreferences.workModes.includes(job.workMode)
  ) {
    reasons.push(`Work mode "${job.workMode}" not in preferred modes`);
  }

  // 2. Country & location / relocation check
  const allowedCountries = searchPreferences.countries.map((c) => c.toUpperCase());
  const allowsGlobalRemote = indiaProfile.preferredCities.some((c) =>
    c.toLowerCase().includes('remote (global)')
  );
  const isRemote = job.workMode === 'remote';

  if (
    allowedCountries.length > 0 &&
    job.countryCode &&
    !allowedCountries.includes(job.countryCode.toUpperCase()) &&
    !(isRemote && allowsGlobalRemote)
  ) {
    reasons.push(
      `Country "${job.countryCode}" outside target countries (${allowedCountries.join(', ')})`
    );
  }

  const concretePreferredCities = indiaProfile.preferredCities
    .filter((c) => !c.toLowerCase().startsWith('remote'))
    .map(normalizeCityToken);

  if (
    !indiaProfile.willingToRelocate &&
    !isRemote &&
    concretePreferredCities.length > 0 &&
    job.city
  ) {
    const jobCity = normalizeCityToken(job.city);
    if (!concretePreferredCities.includes(jobCity)) {
      reasons.push(
        `City "${job.city}" does not match preferred cities and willingToRelocate=false`
      );
    }
  }

  // 3. Seniority check
  if (
    indiaProfile.isFresher &&
    ['senior', 'staff', 'lead', 'manager'].includes(job.seniority)
  ) {
    reasons.push(`Seniority "${job.seniority}" exceeds fresher eligibility`);
  } else if (
    searchPreferences.seniorityLevels.length > 0 &&
    job.seniority !== 'unknown' &&
    !searchPreferences.seniorityLevels.includes(job.seniority)
  ) {
    reasons.push(`Seniority "${job.seniority}" outside selected seniority levels`);
  }

  // 4. Experience years check
  const candidateYoe = estimateCandidateExperienceYears(profile);
  const maxAllowedExp = searchPreferences.maxExperienceYears;
  if (job.experienceMinYears != null) {
    if (maxAllowedExp != null && job.experienceMinYears > maxAllowedExp) {
      reasons.push(
        `Minimum experience ${job.experienceMinYears}y exceeds max preference ${maxAllowedExp}y`
      );
    } else if (job.experienceMinYears > candidateYoe + 1) {
      reasons.push(
        `Requires ${job.experienceMinYears}+ yrs experience (profile ~${candidateYoe.toFixed(1)}y)`
      );
    }
  }

  // 5. Salary floor check (normalized INR LPA)
  const floorLpa = searchPreferences.minSalaryLpa ?? indiaProfile.expectedCtcLpa;
  if (floorLpa != null && floorLpa > 0 && job.salaryMaxLpa != null) {
    if (job.salaryMaxLpa < floorLpa) {
      reasons.push(`Max disclosed salary ${job.salaryMaxLpa} LPA is below ${floorLpa} LPA expectation`);
    }
  }

  return {
    passed: reasons.length === 0,
    reasons
  };
}
