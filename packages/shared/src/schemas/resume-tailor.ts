import { z } from 'zod';
import { AiQualityModeSchema } from './billing.js';
import { JsonResumeSchema, ResumeSkillGroupSchema } from './json-resume.js';
import { LlmProviderIdSchema } from './llm.js';

export const ResumeTemplateIdSchema = z.enum([
  'ats-classic',
  'ats-compact',
  'ats-detailed',
  'ats-executive'
]);
export type ResumeTemplateId = z.infer<typeof ResumeTemplateIdSchema>;

export const JdRequirementsSchema = z.object({
  roleTitle: z.string().default(''),
  companyName: z.string().default(''),
  mustHaveSkills: z.array(z.string()).default([]),
  niceToHaveSkills: z.array(z.string()).default([]),
  keyResponsibilities: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
  senioritySignals: z.array(z.string()).default([]),
  domainTerms: z.array(z.string()).default([])
});
export type JdRequirements = z.infer<typeof JdRequirementsSchema>;

export const TailoredWorkEntrySchema = z.object({
  sourceId: z.string().min(1),
  name: z.string().min(1),
  position: z.string().min(1),
  location: z.string().optional().default(''),
  startDate: z.string().default(''),
  endDate: z.string().optional().default(''),
  summary: z.string().optional().default(''),
  highlights: z.array(z.string()).default([])
});

export const TailoredProjectEntrySchema = z.object({
  sourceId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional().default(''),
  keywords: z.array(z.string()).optional().default([]),
  url: z.string().optional().default(''),
  startDate: z.string().optional().default(''),
  endDate: z.string().optional().default(''),
  highlights: z.array(z.string()).default([])
});

export const TailoredEducationEntrySchema = z.object({
  sourceId: z.string().min(1),
  institution: z.string().min(1),
  area: z.string().optional().default(''),
  studyType: z.string().optional().default(''),
  startDate: z.string().optional().default(''),
  endDate: z.string().optional().default(''),
  score: z.string().optional().default(''),
  courses: z.array(z.string()).optional().default([])
});

export const TailorLlmOutputSchema = z.object({
  summary: z.string().default(''),
  selectedWork: z.array(TailoredWorkEntrySchema).default([]),
  selectedProjects: z.array(TailoredProjectEntrySchema).default([]),
  selectedEducation: z.array(TailoredEducationEntrySchema).default([]),
  reorderedSkills: z.array(ResumeSkillGroupSchema).default([]),
  tailoringRationale: z.string().default('')
});
export type TailorLlmOutput = z.infer<typeof TailorLlmOutputSchema>;

export const VerifierClaimStatusSchema = z.enum(['verified', 'rephrased_ok', 'flagged']);
export const VerifierSeveritySchema = z.enum(['info', 'warning', 'critical']);

export const VerifierClaimSchema = z.object({
  section: z.string().min(1),
  claim: z.string().min(1),
  sourceId: z.string().nullable().default(null),
  status: VerifierClaimStatusSchema,
  severity: VerifierSeveritySchema.default('info'),
  evidence: z.string().default(''),
  issue: z.string().default('')
});
export type VerifierClaim = z.infer<typeof VerifierClaimSchema>;

export const LlmVerifierOutputSchema = z.object({
  claims: z.array(VerifierClaimSchema).default([]),
  overallNotes: z.string().default('')
});
export type LlmVerifierOutput = z.infer<typeof LlmVerifierOutputSchema>;

export const VerifierReportSchema = z.object({
  passed: z.boolean(),
  deterministicPassed: z.boolean(),
  llmVerifierPassed: z.boolean(),
  totalClaimsChecked: z.number().int().min(0),
  unsupportedClaimCount: z.number().int().min(0),
  immutableFieldViolations: z.number().int().min(0),
  unsupportedClaimRate: z.number().min(0).max(1),
  claims: z.array(VerifierClaimSchema).default([]),
  overallNotes: z.string().default('')
});
export type VerifierReport = z.infer<typeof VerifierReportSchema>;

export const ResumeBulletDiffSchema = z.object({
  before: z.string().nullable(),
  after: z.string().nullable(),
  changeType: z.enum(['unchanged', 'rephrased', 'added', 'removed'])
});

export const ResumeSectionDiffSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(['kept', 'reordered', 'omitted']),
  masterIndex: z.number().int(),
  tailoredIndex: z.number().int().nullable(),
  bulletDiffs: z.array(ResumeBulletDiffSchema).default([])
});

export const ResumeDiffSummarySchema = z.object({
  summaryChanged: z.boolean(),
  summaryBefore: z.string(),
  summaryAfter: z.string(),
  workDiffs: z.array(ResumeSectionDiffSchema).default([]),
  projectDiffs: z.array(ResumeSectionDiffSchema).default([]),
  skillsBefore: z.array(z.string()).default([]),
  skillsAfter: z.array(z.string()).default([]),
  skillsReordered: z.boolean().default(false),
  skillsDropped: z.array(z.string()).default([]),
  skillsAdded: z.array(z.string()).default([])
});
export type ResumeDiffSummary = z.infer<typeof ResumeDiffSummarySchema>;

export const AtsCheckSeveritySchema = z.enum(['pass', 'warn', 'fail']);
export type AtsCheckSeverity = z.infer<typeof AtsCheckSeveritySchema>;

export const AtsParseabilityCheckSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: AtsCheckSeveritySchema,
  detail: z.string()
});
export type AtsParseabilityCheck = z.infer<typeof AtsParseabilityCheckSchema>;

export const AtsSectionQualitySchema = z.object({
  totalBullets: z.number().int().min(0),
  quantifiedBullets: z.number().int().min(0),
  strongVerbBullets: z.number().int().min(0),
  avgBulletLength: z.number().min(0),
  issues: z.array(z.string()).default([])
});
export type AtsSectionQuality = z.infer<typeof AtsSectionQualitySchema>;

export const AtsScoreReportSchema = z.object({
  overallScore: z.number().int().min(0).max(100),
  keywordScore: z.number().int().min(0).max(100),
  mustHaveCoverage: z.number().int().min(0).max(100),
  parseabilityScore: z.number().int().min(0).max(100),
  impactScore: z.number().int().min(0).max(100),
  matchedMustHave: z.array(z.string()).default([]),
  missingMustHave: z.array(z.string()).default([]),
  matchedNiceToHave: z.array(z.string()).default([]),
  missingNiceToHave: z.array(z.string()).default([]),
  matchedKeywords: z.array(z.string()).default([]),
  missingKeywords: z.array(z.string()).default([]),
  parseabilityChecks: z.array(AtsParseabilityCheckSchema).default([]),
  sectionQuality: AtsSectionQualitySchema,
  recommendations: z.array(z.string()).default([])
});
export type AtsScoreReport = z.infer<typeof AtsScoreReportSchema>;

export const AtsScoreRequestSchema = z
  .object({
    resumeVersionId: z.string().uuid().optional(),
    profileVariantId: z.string().uuid().optional(),
    jsonResume: JsonResumeSchema.optional(),
    jobId: z.string().uuid().optional(),
    customJob: z
      .object({
        title: z.string().min(1).max(200),
        companyName: z.string().max(200).optional().default(''),
        description: z.string().min(20).max(40_000)
      })
      .optional()
  })
  .refine((data) => Boolean(data.jobId || data.customJob || data.resumeVersionId), {
    message: 'Supply resumeVersionId, jobId, or customJob to compute ATS score.'
  });
export type AtsScoreRequest = z.infer<typeof AtsScoreRequestSchema>;

export const ResumeVersionRecordSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  jobId: z.string().uuid().nullable(),
  profileVariantId: z.string().uuid().nullable().default(null),
  parentProfileVersion: z.number().int().min(1),
  versionNumber: z.number().int().min(1),
  label: z.string(),
  jdRequirements: JdRequirementsSchema,
  tailoredJsonResume: JsonResumeSchema,
  diffSummary: ResumeDiffSummarySchema,
  verifierReport: VerifierReportSchema,
  verifierPassed: z.boolean(),
  templateId: ResumeTemplateIdSchema.default('ats-classic'),
  typstSource: z.string().nullable().default(null),
  pdfStoragePath: z.string().nullable().default(null),
  pdfEngine: z.enum(['typst', 'builtin-ats-pdf']).default('builtin-ats-pdf'),
  provider: LlmProviderIdSchema.nullable().default(null),
  model: z.string().nullable().default(null),
  createdAt: z.string()
});
export type ResumeVersionRecord = z.infer<typeof ResumeVersionRecordSchema>;

export const TailorResumeRequestSchema = z
  .object({
    jobId: z.string().uuid().optional(),
    profileVariantId: z.string().uuid().optional(),
    customJob: z
      .object({
        title: z.string().min(2).max(200),
        companyName: z.string().min(1).max(200),
        description: z.string().min(30).max(40_000)
      })
      .optional(),
    label: z.string().trim().min(1).max(160).optional(),
    templateId: ResumeTemplateIdSchema.default('ats-classic'),
    autoRepairFlagged: z.boolean().default(true),
    aiMode: AiQualityModeSchema.optional()
  })
  .refine((data) => Boolean(data.jobId || data.customJob), {
    message: 'Either jobId or customJob must be supplied.'
  });
export type TailorResumeRequest = z.infer<typeof TailorResumeRequestSchema>;
