import { z } from 'zod';
import { IndiaProfileSchema } from './india-profile.js';
import {
  JsonResumeSchema,
  ResumeCertificateSchema,
  ResumeEducationSchema,
  ResumeLanguageSchema,
  ResumeProjectSchema,
  ResumeSkillGroupSchema,
  ResumeWorkSchema
} from './json-resume.js';

export const ProfileVariantRecordSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  slug: z.string().trim().min(1).max(100),
  targetRole: z.string().max(160).default(''),
  isDefault: z.boolean().default(false),
  jsonResume: JsonResumeSchema,
  indiaProfile: IndiaProfileSchema,
  version: z.number().int().min(1).default(1),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type ProfileVariantRecord = z.infer<typeof ProfileVariantRecordSchema>;

export const CreateProfileVariantRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  targetRole: z.string().max(160).optional().default(''),
  cloneFromVariantId: z.string().uuid().optional(),
  isDefault: z.boolean().optional().default(false),
  jsonResume: JsonResumeSchema.optional(),
  indiaProfile: IndiaProfileSchema.optional()
});
export type CreateProfileVariantRequest = z.infer<
  typeof CreateProfileVariantRequestSchema
>;

export const UpdateProfileVariantRequestSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  targetRole: z.string().max(160).optional(),
  isDefault: z.boolean().optional(),
  jsonResume: JsonResumeSchema.optional(),
  indiaProfile: IndiaProfileSchema.optional()
});
export type UpdateProfileVariantRequest = z.infer<
  typeof UpdateProfileVariantRequestSchema
>;

export const GithubImportRequestSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .transform((v) => v.replace(/^https?:\/\/github\.com\//i, '').replace(/\/.*$/, '')),
  maxRepos: z.number().int().min(1).max(20).default(8),
  includeForks: z.boolean().default(false)
});
export type GithubImportRequest = z.infer<typeof GithubImportRequestSchema>;

export const ImportPreviewCandidateSchema = z.object({
  source: z.enum(['github', 'linkedin']),
  sourceLabel: z.string(),
  fullName: z.string().optional(),
  headline: z.string().optional(),
  locationCity: z.string().optional(),
  summary: z.string().optional(),
  githubUrl: z.string().optional(),
  linkedinUrl: z.string().optional(),
  skills: z.array(ResumeSkillGroupSchema).default([]),
  work: z.array(ResumeWorkSchema).default([]),
  projects: z.array(ResumeProjectSchema).default([]),
  education: z.array(ResumeEducationSchema).default([]),
  certificates: z.array(ResumeCertificateSchema).default([]),
  languages: z.array(ResumeLanguageSchema).default([]),
  warnings: z.array(z.string()).default([]),
  stats: z.object({
    reposFetched: z.number().int().min(0).default(0),
    starsTotal: z.number().int().min(0).default(0),
    pagesParsed: z.number().int().min(0).default(0)
  })
});
export type ImportPreviewCandidate = z.infer<typeof ImportPreviewCandidateSchema>;
