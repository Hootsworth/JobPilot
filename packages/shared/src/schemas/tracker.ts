import { z } from 'zod';

export const ApplicationStatusSchema = z.enum([
  'saved',
  'applied',
  'interview',
  'offer',
  'rejected',
  'withdrawn'
]);
export type ApplicationStatus = z.infer<typeof ApplicationStatusSchema>;

export const ApplicationEventRecordSchema = z.object({
  id: z.string(),
  applicationId: z.string(),
  userId: z.string(),
  eventType: z.string(),
  payload: z.record(z.unknown()).default({}),
  createdAt: z.string()
});
export type ApplicationEventRecord = z.infer<typeof ApplicationEventRecordSchema>;

export const ApplicationJobSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  companyName: z.string(),
  locationRaw: z.string().nullable(),
  sourceType: z.string(),
  sourceUrl: z.string(),
  applyUrl: z.string().nullable(),
  salaryMinLpa: z.number().nullable(),
  salaryMaxLpa: z.number().nullable()
});
export type ApplicationJobSummary = z.infer<typeof ApplicationJobSummarySchema>;

export const ApplicationResumeSummarySchema = z.object({
  id: z.string(),
  versionNumber: z.number().int(),
  label: z.string(),
  verifierPassed: z.boolean(),
  templateId: z.string()
});
export type ApplicationResumeSummary = z.infer<typeof ApplicationResumeSummarySchema>;

export const ApplicationRecordSchema = z.object({
  id: z.string(),
  userId: z.string(),
  jobId: z.string(),
  resumeVersionId: z.string().nullable(),
  status: ApplicationStatusSchema,
  appliedAt: z.string().nullable(),
  nextFollowUpAt: z.string().nullable(),
  followUpNote: z.string().default(''),
  salaryOffered: z.string().default(''),
  notes: z.string().default(''),
  sourceChannel: z.string().default('web'),
  createdAt: z.string(),
  updatedAt: z.string(),
  job: ApplicationJobSummarySchema,
  resumeVersion: ApplicationResumeSummarySchema.nullable()
});
export type ApplicationRecord = z.infer<typeof ApplicationRecordSchema>;

export const CreateManualApplicationRequestSchema = z.object({
  title: z.string().trim().min(1).max(240),
  companyName: z.string().trim().min(1).max(200),
  sourceUrl: z.string().url().optional(),
  locationRaw: z.string().max(200).optional(),
  status: ApplicationStatusSchema.default('applied'),
  resumeVersionId: z.string().uuid().nullable().optional(),
  nextFollowUpAt: z.string().nullable().optional(),
  followUpNote: z.string().max(500).optional(),
  salaryOffered: z.string().max(120).optional(),
  notes: z.string().max(4000).optional()
});
export type CreateManualApplicationRequest = z.infer<
  typeof CreateManualApplicationRequestSchema
>;

export const UpdateApplicationRequestSchema = z.object({
  status: ApplicationStatusSchema.optional(),
  resumeVersionId: z.string().uuid().nullable().optional(),
  appliedAt: z.string().nullable().optional(),
  nextFollowUpAt: z.string().nullable().optional(),
  followUpNote: z.string().max(500).optional(),
  salaryOffered: z.string().max(120).optional(),
  notes: z.string().max(4000).optional()
});
export type UpdateApplicationRequest = z.infer<typeof UpdateApplicationRequestSchema>;
