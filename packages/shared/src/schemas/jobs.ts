import { z } from 'zod';
import { AiQualityModeSchema } from './billing.js';
import { LlmProviderIdSchema } from './llm.js';

export const JobSourceTypeSchema = z.enum([
  'greenhouse',
  'lever',
  'ashby',
  'workable',
  'smartrecruiters',
  'workday',
  'adzuna',
  'jooble',
  'remotive',
  'arbeitnow',
  'remoteok',
  'himalayas',
  'jobicy',
  'themuse',
  'hackernews',
  'jsearch',
  'naukri',
  'foundit',
  'internshala',
  'instahyre',
  'wellfound',
  'linkedin',
  'extension_capture',
  'manual'
]);
export type JobSourceType = z.infer<typeof JobSourceTypeSchema>;

export const JobFeedBucketSchema = z.enum([
  'all',
  'for_you',
  'fresh',
  'remote',
  'india',
  'near_matches'
]);
export type JobFeedBucket = z.infer<typeof JobFeedBucketSchema>;

export const DismissReasonSchema = z.enum([
  'seniority',
  'stack',
  'company',
  'location',
  'salary',
  'other'
]);
export type DismissReason = z.infer<typeof DismissReasonSchema>;

export const DismissJobRequestSchema = z.object({
  dismissed: z.boolean().default(true),
  reason: DismissReasonSchema.optional()
});
export type DismissJobRequest = z.infer<typeof DismissJobRequestSchema>;

export const JobWorkModeSchema = z.enum(['remote', 'hybrid', 'onsite', 'unknown']);
export type JobWorkMode = z.infer<typeof JobWorkModeSchema>;

export const JobSenioritySchema = z.enum([
  'intern',
  'fresher',
  'junior',
  'mid',
  'senior',
  'staff',
  'lead',
  'manager',
  'unknown'
]);
export type JobSeniority = z.infer<typeof JobSenioritySchema>;

export const JobEmploymentTypeSchema = z.enum([
  'full_time',
  'internship',
  'contract',
  'part_time',
  'unknown'
]);
export type JobEmploymentType = z.infer<typeof JobEmploymentTypeSchema>;

export const JobCareerCategorySchema = z.enum([
  'software_engineering',
  'ai_ml',
  'data_science',
  'product_management',
  'design_ux',
  'cybersecurity',
  'other'
]);
export type JobCareerCategory = z.infer<typeof JobCareerCategorySchema>;

export const NormalizedJobInputSchema = z.object({
  sourceType: JobSourceTypeSchema,
  externalId: z.string().min(1),
  sourceUrl: z.string().url(),
  applyUrl: z.string().url().nullable().default(null),
  companyName: z.string().min(1),
  companyDomain: z.string().nullable().default(null),
  companyLogoUrl: z.string().url().nullable().default(null),
  title: z.string().min(1),
  normalizedTitle: z.string().default(''),
  locationRaw: z.string().default(''),
  city: z.string().nullable().default(null),
  countryCode: z.string().nullable().default(null),
  workMode: JobWorkModeSchema.default('unknown'),
  seniority: JobSenioritySchema.default('unknown'),
  employmentType: JobEmploymentTypeSchema.default('unknown'),
  fresherEligible: z.boolean().nullable().default(null),
  stipendMonthlyInr: z.number().min(0).nullable().default(null),
  careerCategory: JobCareerCategorySchema.default('other'),
  boardKey: z.string().nullable().default(null),
  experienceMinYears: z.number().min(0).max(50).nullable().default(null),
  experienceMaxYears: z.number().min(0).max(50).nullable().default(null),
  salaryMin: z.number().min(0).nullable().default(null),
  salaryMax: z.number().min(0).nullable().default(null),
  salaryCurrency: z.string().nullable().default(null),
  salaryPeriod: z.enum(['year', 'month', 'hour']).nullable().default(null),
  salaryMinLpa: z.number().min(0).nullable().default(null),
  salaryMaxLpa: z.number().min(0).nullable().default(null),
  descriptionRaw: z.string().default(''),
  descriptionClean: z.string().default(''),
  extractedSkills: z.array(z.string()).default([]),
  postedAt: z.string().nullable().default(null),
  rawPayload: z.record(z.unknown()).optional()
});
export type NormalizedJobInput = z.infer<typeof NormalizedJobInputSchema>;

export const JobSightingSchema = z.object({
  sourceType: JobSourceTypeSchema,
  externalId: z.string(),
  sourceUrl: z.string(),
  seenAt: z.string()
});
export type JobSighting = z.infer<typeof JobSightingSchema>;

export const JobRecordSchema = z.object({
  id: z.string().uuid(),
  ownerUserId: z.string().uuid().nullable().default(null),
  dedupeFingerprint: z.string(),
  sourceType: JobSourceTypeSchema,
  externalId: z.string().nullable().default(null),
  sourceUrl: z.string(),
  applyUrl: z.string().nullable().default(null),
  companyName: z.string(),
  companyDomain: z.string().nullable().default(null),
  companyLogoUrl: z.string().nullable().default(null),
  title: z.string(),
  normalizedTitle: z.string().nullable().default(null),
  locationRaw: z.string().nullable().default(null),
  city: z.string().nullable().default(null),
  countryCode: z.string().nullable().default(null),
  workMode: JobWorkModeSchema.default('unknown'),
  seniority: JobSenioritySchema.default('unknown'),
  employmentType: JobEmploymentTypeSchema.default('unknown'),
  fresherEligible: z.boolean().nullable().default(null),
  stipendMonthlyInr: z.number().nullable().default(null),
  careerCategory: JobCareerCategorySchema.default('other'),
  boardKey: z.string().nullable().default(null),
  experienceMinYears: z.number().nullable().default(null),
  experienceMaxYears: z.number().nullable().default(null),
  salaryMin: z.number().nullable().default(null),
  salaryMax: z.number().nullable().default(null),
  salaryCurrency: z.string().nullable().default(null),
  salaryPeriod: z.string().nullable().default(null),
  salaryMinLpa: z.number().nullable().default(null),
  salaryMaxLpa: z.number().nullable().default(null),
  descriptionClean: z.string().default(''),
  extractedSkills: z.array(z.string()).default([]),
  postedAt: z.string().nullable().default(null),
  isActive: z.boolean().default(true),
  lastSeenAt: z.string(),
  embeddingModel: z.string().nullable().default(null),
  embeddingModelVersion: z.string().nullable().default(null),
  embeddedAt: z.string().nullable().default(null),
  sightingsCount: z.number().int().min(1).default(1)
});
export type JobRecord = z.infer<typeof JobRecordSchema>;

export const JobMatchSchema = z.object({
  id: z.string().uuid().optional(),
  jobId: z.string().uuid(),
  profileVersion: z.number().int().min(1),
  hardFilterPassed: z.boolean(),
  hardFilterReasons: z.array(z.string()).default([]),
  vectorSimilarity: z.number().min(-1).max(1).nullable().default(null),
  llmScore: z.number().int().min(0).max(100).nullable().default(null),
  matchReason: z.string().nullable().default(null),
  matchedSkills: z.array(z.string()).default([]),
  skillGaps: z.array(z.string()).default([]),
  provider: LlmProviderIdSchema.nullable().default(null),
  model: z.string().nullable().default(null),
  dismissed: z.boolean().default(false),
  computedAt: z.string()
});
export type JobMatch = z.infer<typeof JobMatchSchema>;

export const JobFeedItemSchema = z.object({
  job: JobRecordSchema,
  match: JobMatchSchema.nullable(),
  applicationStatus: z.string().nullable().default(null)
});
export type JobFeedItem = z.infer<typeof JobFeedItemSchema>;

export const JobFeedQuerySchema = z.object({
  q: z.string().optional(),
  country: z.string().optional(),
  city: z.string().optional(),
  workMode: JobWorkModeSchema.optional(),
  seniority: JobSenioritySchema.optional(),
  minSalaryLpa: z.coerce.number().min(0).optional(),
  maxExperienceYears: z.coerce.number().min(0).optional(),
  source: JobSourceTypeSchema.optional(),
  onlyPassed: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => (typeof v === 'string' ? v === 'true' : v))
    .optional(),
  includeDismissed: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => (typeof v === 'string' ? v === 'true' : v))
    .optional(),
  bucket: JobFeedBucketSchema.optional(),
  freshHours: z.coerce.number().int().min(1).max(720).optional(),
  sortBy: z.enum(['match_score', 'recent', 'salary_lpa']).default('match_score'),
  limit: z.coerce.number().int().min(1).max(100).default(40),
  offset: z.coerce.number().int().min(0).default(0)
});
export type JobFeedQuery = z.infer<typeof JobFeedQuerySchema>;

export const LlmMatchRerankItemSchema = z.object({
  jobId: z.string().min(1),
  score: z.number().int().min(0).max(100),
  oneLineReason: z.string().min(1).max(260),
  matchedSkills: z.array(z.string()).default([]),
  skillGaps: z.array(z.string()).default([])
});

export const LlmMatchRerankOutputSchema = z.object({
  results: z.array(LlmMatchRerankItemSchema)
});
export type LlmMatchRerankOutput = z.infer<typeof LlmMatchRerankOutputSchema>;

export const SeedBoardSchema = z.object({
  sourceType: z.enum([
    'greenhouse',
    'lever',
    'ashby',
    'workable',
    'smartrecruiters',
    'workday'
  ]),
  slug: z.string().min(1),
  displayName: z.string().min(1),
  regionFocus: z.enum(['india', 'global', 'hybrid']),
  careersUrl: z.string().url().optional(),
  refreshTier: z.enum(['high_volume', 'standard']).default('standard'),
  workday: z
    .object({
      host: z.string().min(1),
      tenant: z.string().min(1),
      site: z.string().min(1)
    })
    .optional(),
  enabled: z.boolean().default(true)
});
export type SeedBoard = z.infer<typeof SeedBoardSchema>;

export const JobSourceStatusSchema = z.object({
  id: z.string(),
  sourceType: z.string(),
  slug: z.string(),
  displayName: z.string(),
  regionFocus: z.string(),
  enabled: z.boolean(),
  lastCrawledAt: z.string().nullable(),
  lastStatus: z.string().nullable(),
  consecutiveFailures: z.number().int()
});
export type JobSourceStatus = z.infer<typeof JobSourceStatusSchema>;

export const CrawlRunSummarySchema = z.object({
  id: z.string(),
  jobName: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  status: z.string(),
  stats: z.record(z.unknown())
});
export type CrawlRunSummary = z.infer<typeof CrawlRunSummarySchema>;

export const RefreshMatchesRequestSchema = z.object({
  topKVector: z.number().int().min(5).max(100).default(30),
  topKLlm: z.number().int().min(0).max(30).default(15),
  forceRecompute: z.boolean().default(false),
  aiMode: AiQualityModeSchema.optional()
});
export type RefreshMatchesRequest = z.infer<typeof RefreshMatchesRequestSchema>;

export const SyncJobsRequestSchema = z.object({
  mode: z.enum(['quick', 'full']).default('quick'),
  force: z.boolean().default(false),
  includeLlm: z.boolean().default(false)
});
export type SyncJobsRequest = z.infer<typeof SyncJobsRequestSchema>;

export const JobSyncStatusSchema = z.object({
  status: z.enum(['idle', 'running']),
  isStale: z.boolean(),
  totalActiveJobs: z.number().int().min(0),
  activeSourcesCount: z.number().int().min(0),
  lastSyncedAt: z.string().nullable(),
  lastRun: CrawlRunSummarySchema.nullable(),
  sourceBreakdown: z.record(z.number().int()).default({})
});
export type JobSyncStatus = z.infer<typeof JobSyncStatusSchema>;

export const RecommendationsResponseSchema = z.object({
  buckets: z.object({
    forYou: z.array(JobFeedItemSchema),
    fresh: z.array(JobFeedItemSchema),
    india: z.array(JobFeedItemSchema),
    remote: z.array(JobFeedItemSchema),
    nearMatches: z.array(JobFeedItemSchema)
  }),
  counts: z.object({
    forYou: z.number().int().min(0),
    fresh: z.number().int().min(0),
    india: z.number().int().min(0),
    remote: z.number().int().min(0),
    nearMatches: z.number().int().min(0),
    totalActiveCatalog: z.number().int().min(0)
  }),
  syncStatus: JobSyncStatusSchema,
  profileSignals: z.object({
    targetRoles: z.array(z.string()),
    topSkills: z.array(z.string()),
    countries: z.array(z.string()),
    preferredCities: z.array(z.string()),
    isFresher: z.boolean(),
    hasProfileData: z.boolean()
  }),
  autoMatchedCount: z.number().int().min(0)
});
export type RecommendationsResponse = z.infer<typeof RecommendationsResponseSchema>;

export const AddCompanyBoardRequestSchema = z.object({
  boardUrl: z.string().url().max(400),
  displayName: z.string().min(1).max(120).optional(),
  regionFocus: z.enum(['india', 'global', 'hybrid']).default('india')
});
export type AddCompanyBoardRequest = z.infer<typeof AddCompanyBoardRequestSchema>;

export const AddCompanyBoardResponseSchema = z.object({
  source: JobSourceStatusSchema,
  syncedJobsCount: z.number().int().min(0),
  insertedCount: z.number().int().min(0),
  updatedCount: z.number().int().min(0)
});
export type AddCompanyBoardResponse = z.infer<typeof AddCompanyBoardResponseSchema>;
