import { z } from 'zod';
import { LlmProviderIdSchema } from './llm.js';
import { JdRequirementsSchema, VerifierReportSchema } from './resume-tailor.js';

export const CoverLetterToneSchema = z.enum([
  'concise-technical',
  'executive',
  'founder-note'
]);
export type CoverLetterTone = z.infer<typeof CoverLetterToneSchema>;

export const CoverLetterContentSchema = z.object({
  salutation: z.string().default('Dear Hiring Team,'),
  openingHook: z.string().default(''),
  bodyParagraphs: z.array(z.string()).default([]),
  closing: z.string().default(''),
  signature: z.string().default(''),
  selectedStoryIds: z.array(z.string()).default([]),
  highlightedAchievements: z.array(z.string()).default([])
});
export type CoverLetterContent = z.infer<typeof CoverLetterContentSchema>;

export const CoverLetterLlmOutputSchema = z.object({
  salutation: z.string(),
  openingHook: z.string(),
  bodyParagraphs: z.array(z.string()),
  closing: z.string(),
  selectedStoryIds: z.array(z.string()),
  highlightedAchievements: z.array(z.string()),
  rationale: z.string()
});
export type CoverLetterLlmOutput = z.infer<typeof CoverLetterLlmOutputSchema>;

export const CoverLetterRecordSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  jobId: z.string().uuid().nullable(),
  profileVariantId: z.string().uuid().nullable().default(null),
  parentProfileVersion: z.number().int().min(1),
  versionNumber: z.number().int().min(1),
  label: z.string(),
  companyName: z.string(),
  roleTitle: z.string(),
  tone: CoverLetterToneSchema.default('concise-technical'),
  jdRequirements: JdRequirementsSchema,
  content: CoverLetterContentSchema,
  plainText: z.string(),
  verifierReport: VerifierReportSchema,
  verifierPassed: z.boolean(),
  typstSource: z.string().nullable().default(null),
  pdfStoragePath: z.string().nullable().default(null),
  pdfEngine: z.enum(['typst', 'builtin-ats-pdf']).default('builtin-ats-pdf'),
  provider: LlmProviderIdSchema.nullable().default(null),
  model: z.string().nullable().default(null),
  createdAt: z.string()
});
export type CoverLetterRecord = z.infer<typeof CoverLetterRecordSchema>;

export const GenerateCoverLetterRequestSchema = z
  .object({
    jobId: z.string().uuid().optional(),
    profileVariantId: z.string().uuid().optional(),
    customJob: z
      .object({
        title: z.string().min(2).max(200),
        companyName: z.string().min(1).max(200),
        description: z.string().min(20).max(40_000)
      })
      .optional(),
    tone: CoverLetterToneSchema.default('concise-technical'),
    label: z.string().trim().min(1).max(160).optional(),
    customInstructions: z.string().max(600).optional(),
    autoRepairFlagged: z.boolean().default(true)
  })
  .refine((data) => Boolean(data.jobId || data.customJob), {
    message: 'Either jobId or customJob must be supplied.'
  });
export type GenerateCoverLetterRequest = z.infer<
  typeof GenerateCoverLetterRequestSchema
>;

export const UpdateCoverLetterRequestSchema = z.object({
  label: z.string().trim().min(1).max(160).optional(),
  content: CoverLetterContentSchema.optional(),
  plainText: z.string().min(20).max(12000).optional()
});
export type UpdateCoverLetterRequest = z.infer<typeof UpdateCoverLetterRequestSchema>;
