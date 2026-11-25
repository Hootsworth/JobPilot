import { z } from 'zod';
import { IndiaProfileSchema } from './india-profile.js';
import { JsonResumeSchema } from './json-resume.js';

export const WorkModePreferenceSchema = z.enum(['remote', 'hybrid', 'onsite']);
export const SeniorityLevelSchema = z.enum([
  'intern',
  'fresher',
  'junior',
  'mid',
  'senior',
  'staff',
  'lead',
  'manager'
]);

export const SavedJobSearchSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(80),
  q: z.string().max(120).optional(),
  country: z.string().max(10).optional(),
  workMode: WorkModePreferenceSchema.optional(),
  seniority: SeniorityLevelSchema.optional(),
  source: z.string().max(40).optional(),
  minSalaryLpa: z.number().min(0).max(500).nullable().optional(),
  onlyPassed: z.boolean().default(true),
  sortBy: z.enum(['match_score', 'recent', 'salary_lpa']).default('match_score'),
  createdAt: z.string(),
  lastCheckedAt: z.string().optional()
});
export type SavedJobSearch = z.infer<typeof SavedJobSearchSchema>;

export const CreateSavedJobSearchRequestSchema = z.object({
  name: z.string().min(1).max(80),
  q: z.string().max(120).optional(),
  country: z.string().max(10).optional(),
  workMode: WorkModePreferenceSchema.optional(),
  seniority: SeniorityLevelSchema.optional(),
  source: z.string().max(40).optional(),
  minSalaryLpa: z.number().min(0).max(500).nullable().optional(),
  onlyPassed: z.boolean().default(true),
  sortBy: z.enum(['match_score', 'recent', 'salary_lpa']).default('match_score')
});
export type CreateSavedJobSearchRequest = z.infer<typeof CreateSavedJobSearchRequestSchema>;

export const SavedJobSearchWithCountsSchema = SavedJobSearchSchema.extend({
  matchCount: z.number().int().min(0),
  newCount: z.number().int().min(0)
});
export type SavedJobSearchWithCounts = z.infer<typeof SavedJobSearchWithCountsSchema>;

export const SearchPreferencesSchema = z.object({
  targetRoles: z.array(z.string()).default([]),
  workModes: z.array(WorkModePreferenceSchema).default(['remote', 'hybrid', 'onsite']),
  seniorityLevels: z.array(SeniorityLevelSchema).default(['intern', 'fresher', 'junior']),
  countries: z.array(z.string()).default(['IN']),
  minSalaryLpa: z.number().min(0).max(500).nullable().default(null),
  minExperienceYears: z.number().min(0).max(50).nullable().default(null),
  maxExperienceYears: z.number().min(0).max(50).nullable().default(null),
  savedSearches: z.array(SavedJobSearchSchema).max(20).default([])
});

export type SearchPreferences = z.infer<typeof SearchPreferencesSchema>;

export const MasterProfileSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  activeProfileVersion: z.number().int().min(1),
  jsonResume: JsonResumeSchema,
  indiaProfile: IndiaProfileSchema,
  searchPreferences: SearchPreferencesSchema,
  sourceResumeStoragePath: z.string().nullable(),
  embeddingModel: z.string().nullable(),
  embeddingModelVersion: z.string().nullable(),
  embeddedAt: z.string().nullable(),
  telemetryOptIn: z.boolean(),
  onboardingCompletedAt: z.string().nullable(),
  updatedAt: z.string()
});

export type MasterProfile = z.infer<typeof MasterProfileSchema>;

export const UpdateProfileRequestSchema = z.object({
  fullName: z.string().min(1).max(200).optional(),
  email: z.string().email().or(z.literal('')).optional(),
  phone: z.string().max(40).optional(),
  jsonResume: JsonResumeSchema.optional(),
  indiaProfile: IndiaProfileSchema.optional(),
  searchPreferences: SearchPreferencesSchema.optional(),
  telemetryOptIn: z.boolean().optional(),
  markOnboardingComplete: z.boolean().optional()
});

export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequestSchema>;

export const StoryMetricSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
  unit: z.string().optional().default('')
});
export type StoryMetric = z.infer<typeof StoryMetricSchema>;

export const StoryCategorySchema = z.enum([
  'project',
  'leadership',
  'incident',
  'optimization',
  'academic',
  'hackathon',
  'other'
]);

export const ProfileStorySchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  title: z.string().min(1).max(200),
  category: StoryCategorySchema.default('project'),
  situation: z.string().default(''),
  task: z.string().default(''),
  action: z.string().default(''),
  result: z.string().default(''),
  metrics: z.array(StoryMetricSchema).default([]),
  skillsUsed: z.array(z.string()).default([]),
  linkedExperienceId: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type ProfileStory = z.infer<typeof ProfileStorySchema>;

export const UpsertStoryRequestSchema = z.object({
  title: z.string().min(1).max(200),
  category: StoryCategorySchema.default('project'),
  situation: z.string().default(''),
  task: z.string().default(''),
  action: z.string().default(''),
  result: z.string().default(''),
  metrics: z.array(StoryMetricSchema).default([]),
  skillsUsed: z.array(z.string()).default([]),
  linkedExperienceId: z.string().nullable().optional()
});

export type UpsertStoryRequest = z.infer<typeof UpsertStoryRequestSchema>;

export const SavedAnswerSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  questionKey: z.string().min(1).max(120),
  questionPattern: z.string().min(1).max(400),
  answer: z.string().min(1),
  tags: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type SavedAnswer = z.infer<typeof SavedAnswerSchema>;

export const UpsertSavedAnswerRequestSchema = z.object({
  questionKey: z.string().min(1).max(120),
  questionPattern: z.string().min(1).max(400),
  answer: z.string().min(1),
  tags: z.array(z.string()).default([])
});

export type UpsertSavedAnswerRequest = z.infer<typeof UpsertSavedAnswerRequestSchema>;

export const COMMON_QUESTION_TEMPLATES = [
  {
    questionKey: 'why_this_company',
    questionPattern: 'Why do you want to work at this company / role?',
    placeholder:
      'Focus on engineering ownership, product scale, and specific technical problems from your projects.',
    tags: ['motivation', 'general']
  },
  {
    questionKey: 'ctc_expectation_india',
    questionPattern: 'What is your current and expected CTC (LPA)?',
    placeholder:
      'Open to competitive market compensation aligned with role scope; baseline expectation is X LPA.',
    tags: ['india', 'compensation']
  },
  {
    questionKey: 'notice_period_india',
    questionPattern: 'What is your notice period and earliest joining date?',
    placeholder: 'Available immediately (fresher) / 30 days notice (negotiable / buyout possible).',
    tags: ['india', 'availability']
  },
  {
    questionKey: 'challenging_bug_or_system',
    questionPattern: 'Describe a challenging technical problem you solved recently.',
    placeholder: 'Summarize context, root cause diagnosis, tradeoffs considered, and measured impact.',
    tags: ['technical', 'behavioral']
  },
  {
    questionKey: 'work_authorization_relocation',
    questionPattern: 'Are you legally authorized to work and willing to relocate?',
    placeholder: 'Authorized to work in India; open to relocating to Bengaluru / Hyderabad / Pune.',
    tags: ['eligibility', 'relocation']
  }
] as const;

export const ParsedResumeOutputSchema = z.object({
  fullName: z.string().default(''),
  email: z.string().default(''),
  phone: z.string().default(''),
  jsonResume: JsonResumeSchema,
  extractedIndiaSignals: z
    .object({
      collegeName: z.string().optional(),
      degree: z.string().optional(),
      branch: z.string().optional(),
      graduationYear: z.number().int().nullable().optional(),
      cgpa: z.number().nullable().optional(),
      cgpaScale: z.number().optional(),
      tenthPercentage: z.number().nullable().optional(),
      twelfthPercentage: z.number().nullable().optional(),
      isFresher: z.boolean().optional(),
      preferredCities: z.array(z.string()).optional()
    })
    .default({}),
  extractionNotes: z.array(z.string()).default([])
});

export type ParsedResumeOutput = z.infer<typeof ParsedResumeOutputSchema>;
