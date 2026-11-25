import {
  NormalizedJobInputSchema,
  type JobSourceType,
  type NormalizedJobInput,
  type SalaryPeriod
} from '@jobpilot/shared';
import { cleanHtmlDescription } from '../normalize/html-clean.js';
import { normalizeTitle } from '../normalize/dedupe.js';
import {
  extractExperienceYears,
  extractSalary,
  extractSkillsFromText,
  inferCareerCategory,
  inferEmploymentType,
  inferFresherEligibility,
  inferSeniority,
  parseLocation
} from '../normalize/extractors.js';

export interface ConnectorFetchResult {
  jobs: NormalizedJobInput[];
  etag: string | null;
  lastModified: string | null;
  notModified: boolean;
  skippedReason?: string;
}

export function buildNormalizedJob(input: {
  sourceType: JobSourceType;
  externalId: string;
  sourceUrl: string;
  applyUrl?: string | null;
  companyName: string;
  companyDomain?: string | null;
  companyLogoUrl?: string | null;
  title: string;
  locationRaw?: string | null;
  workModeHint?: string | null;
  explicitEmploymentType?: string | null;
  boardKey?: string | null;
  descriptionHtmlOrText?: string | null;
  explicitTags?: string[];
  postedAt?: string | null;
  explicitSalaryMin?: number | null;
  explicitSalaryMax?: number | null;
  explicitSalaryCurrency?: string | null;
  explicitSalaryPeriod?: SalaryPeriod | null;
  rawPayload?: Record<string, unknown>;
}): NormalizedJobInput | null {
  const title = input.title.trim();
  const companyName = input.companyName.trim();
  if (!title || !companyName || !input.sourceUrl) return null;

  const descriptionClean = cleanHtmlDescription(input.descriptionHtmlOrText);
  const loc = parseLocation(input.locationRaw, input.workModeHint);
  const seniority = inferSeniority(title, descriptionClean);
  const exp = extractExperienceYears(title, descriptionClean);
  const employmentType = inferEmploymentType(title, descriptionClean, input.explicitEmploymentType);
  const fresherEligible = inferFresherEligibility(
    title,
    descriptionClean,
    seniority,
    exp.minYears
  );
  const sal = extractSalary({
    description: `${title}\n${descriptionClean}`,
    explicitMin: input.explicitSalaryMin,
    explicitMax: input.explicitSalaryMax,
    explicitCurrency: input.explicitSalaryCurrency,
    explicitPeriod: input.explicitSalaryPeriod
  });

  const inferredSkills = extractSkillsFromText(`${title}\n${descriptionClean}`);
  const extractedSkills = Array.from(
    new Set([...(input.explicitTags ?? []).map((t) => t.trim()).filter(Boolean), ...inferredSkills])
  );
  const careerCategory = inferCareerCategory(title, extractedSkills, descriptionClean);

  let postedAt: string | null = null;
  if (input.postedAt) {
    const ms = Date.parse(input.postedAt);
    if (Number.isFinite(ms)) postedAt = new Date(ms).toISOString();
  }

  const parsed = NormalizedJobInputSchema.safeParse({
    sourceType: input.sourceType,
    externalId: input.externalId,
    sourceUrl: input.sourceUrl,
    applyUrl: input.applyUrl ?? input.sourceUrl,
    companyName,
    companyDomain: input.companyDomain ?? null,
    companyLogoUrl: input.companyLogoUrl ?? null,
    title,
    normalizedTitle: normalizeTitle(title),
    locationRaw: loc.locationRaw,
    city: loc.city,
    countryCode: loc.countryCode,
    workMode: loc.workMode,
    seniority,
    employmentType,
    fresherEligible,
    stipendMonthlyInr: sal.stipendMonthlyInr,
    careerCategory,
    boardKey: input.boardKey ?? null,
    experienceMinYears: exp.minYears,
    experienceMaxYears: exp.maxYears,
    salaryMin: sal.salaryMin,
    salaryMax: sal.salaryMax,
    salaryCurrency: sal.salaryCurrency,
    salaryPeriod: sal.salaryPeriod,
    salaryMinLpa: sal.salaryMinLpa,
    salaryMaxLpa: sal.salaryMaxLpa,
    descriptionRaw: (input.descriptionHtmlOrText ?? '').slice(0, 50_000),
    descriptionClean: descriptionClean.slice(0, 30_000),
    extractedSkills,
    postedAt,
    rawPayload: input.rawPayload
  });

  return parsed.success ? parsed.data : null;
}

export function buildJobEmbeddingText(job: {
  title: string;
  companyName: string;
  locationRaw?: string | null;
  workMode?: string | null;
  seniority?: string | null;
  extractedSkills?: string[];
  descriptionClean?: string | null;
}): string {
  return [
    `Role: ${job.title}`,
    `Company: ${job.companyName}`,
    job.locationRaw ? `Location: ${job.locationRaw}` : '',
    job.workMode && job.workMode !== 'unknown' ? `Work Mode: ${job.workMode}` : '',
    job.seniority && job.seniority !== 'unknown' ? `Seniority: ${job.seniority}` : '',
    job.extractedSkills && job.extractedSkills.length > 0
      ? `Skills: ${job.extractedSkills.join(', ')}`
      : '',
    job.descriptionClean ? `Description: ${job.descriptionClean.slice(0, 3500)}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}
