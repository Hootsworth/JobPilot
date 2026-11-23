import { z } from 'zod';

export const OfficialAtsAdapterIdSchema = z.enum(['greenhouse', 'lever', 'ashby', 'workday']);
export type OfficialAtsAdapterId = z.infer<typeof OfficialAtsAdapterIdSchema>;

export const NonApiSessionAdapterIdSchema = z.enum([
  'naukri',
  'foundit',
  'internshala',
  'instahyre',
  'wellfound',
  'linkedin'
]);
export type NonApiSessionAdapterId = z.infer<typeof NonApiSessionAdapterIdSchema>;

export const AtsAdapterIdSchema = z.enum([
  'greenhouse',
  'lever',
  'ashby',
  'workday',
  'naukri',
  'foundit',
  'internshala',
  'instahyre',
  'wellfound',
  'linkedin',
  'generic'
]);
export type AtsAdapterId = z.infer<typeof AtsAdapterIdSchema>;

export const AdapterTosRiskSchema = z.enum(['none', 'moderate', 'high']);
export type AdapterTosRisk = z.infer<typeof AdapterTosRiskSchema>;

export const CanonicalFieldKeySchema = z.enum([
  'full_name',
  'first_name',
  'last_name',
  'email',
  'phone',
  'location_city',
  'location_full',
  'linkedin_url',
  'github_url',
  'portfolio_url',
  'current_company',
  'current_title',
  'years_of_experience',
  'school',
  'degree',
  'major',
  'graduation_year',
  'cgpa',
  'tenth_percentage',
  'twelfth_percentage',
  'current_ctc_lpa',
  'expected_ctc_lpa',
  'notice_period_days',
  'willing_to_relocate',
  'preferred_cities',
  'work_authorization',
  'requires_sponsorship',
  'is_fresher',
  'active_backlogs',
  'resume_file',
  'cover_letter',
  'custom_question',
  'unknown'
]);
export type CanonicalFieldKey = z.infer<typeof CanonicalFieldKeySchema>;

export const FieldControlTypeSchema = z.enum([
  'text',
  'email',
  'tel',
  'url',
  'number',
  'textarea',
  'select',
  'combobox',
  'radio',
  'checkbox',
  'file',
  'date'
]);
export type FieldControlType = z.infer<typeof FieldControlTypeSchema>;

export const DetectedFormFieldSchema = z.object({
  fieldId: z.string().min(1),
  atsAdapter: AtsAdapterIdSchema,
  controlType: FieldControlTypeSchema,
  canonicalKey: CanonicalFieldKeySchema,
  label: z.string().default(''),
  name: z.string().default(''),
  id: z.string().default(''),
  placeholder: z.string().default(''),
  required: z.boolean().default(false),
  currentValue: z.string().default(''),
  alreadyFilled: z.boolean().default(false),
  options: z.array(z.string()).default([]),
  selectorPath: z.string().default(''),
  framePath: z.string().default('top'),
  inShadowDom: z.boolean().default(false),
  confidence: z.number().min(0).max(1),
  matchReason: z.string().default('')
});
export type DetectedFormField = z.infer<typeof DetectedFormFieldSchema>;

export const FillValueSourceSchema = z.enum([
  'profile',
  'india_profile',
  'saved_answer',
  'tailored_resume',
  'llm_draft',
  'llm_fallback',
  'user_edited',
  'unmapped'
]);
export type FillValueSource = z.infer<typeof FillValueSourceSchema>;

export const FillPlanItemSchema = z.object({
  fieldId: z.string().min(1),
  canonicalKey: CanonicalFieldKeySchema,
  label: z.string().default(''),
  controlType: FieldControlTypeSchema,
  proposedValue: z.string().default(''),
  displayValue: z.string().default(''),
  confidence: z.number().min(0).max(1),
  source: FillValueSourceSchema,
  alreadyFilled: z.boolean().default(false),
  included: z.boolean().default(true),
  skipReason: z.string().optional()
});
export type FillPlanItem = z.infer<typeof FillPlanItemSchema>;

export const FillExecutionStatusSchema = z.enum([
  'filled',
  'skipped_already_filled',
  'skipped_excluded',
  'skipped_unmapped',
  'failed'
]);
export type FillExecutionStatus = z.infer<typeof FillExecutionStatusSchema>;

export const FillExecutionItemResultSchema = z.object({
  fieldId: z.string().min(1),
  label: z.string().default(''),
  status: FillExecutionStatusSchema,
  confidence: z.number().min(0).max(1),
  appliedValue: z.string().optional(),
  error: z.string().optional()
});
export type FillExecutionItemResult = z.infer<typeof FillExecutionItemResultSchema>;

export const CapturedJobMetadataSchema = z.object({
  atsAdapter: AtsAdapterIdSchema,
  sourceUrl: z.string().url(),
  applyUrl: z.string().url().optional(),
  title: z.string().min(1).max(300),
  companyName: z.string().min(1).max(200),
  locationRaw: z.string().max(200).optional(),
  salaryText: z.string().max(120).optional(),
  descriptionClean: z.string().max(50_000).optional()
});
export type CapturedJobMetadata = z.infer<typeof CapturedJobMetadataSchema>;

export const DraftAnswerQuestionSchema = z.object({
  fieldId: z.string().min(1),
  label: z.string().min(1).max(500),
  maxLength: z.number().int().min(1).max(10_000).optional(),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional()
});
export type DraftAnswerQuestion = z.infer<typeof DraftAnswerQuestionSchema>;

export const DraftAnswersRequestSchema = z.object({
  jobTitle: z.string().min(1).max(300),
  companyName: z.string().min(1).max(200),
  jobDescription: z.string().max(30_000).optional(),
  questions: z.array(DraftAnswerQuestionSchema).min(1).max(20)
});
export type DraftAnswersRequest = z.infer<typeof DraftAnswersRequestSchema>;

export const DraftAnswerItemSchema = z.object({
  fieldId: z.string().min(1),
  answer: z.string(),
  confidence: z.number().min(0).max(1),
  source: z.enum(['saved_answer', 'llm_draft', 'unmapped']),
  rationale: z.string().default('')
});
export type DraftAnswerItem = z.infer<typeof DraftAnswerItemSchema>;

export const DraftAnswersResponseSchema = z.object({
  drafts: z.array(DraftAnswerItemSchema),
  usedLlm: z.boolean(),
  note: z.string().optional()
});
export type DraftAnswersResponse = z.infer<typeof DraftAnswersResponseSchema>;

export const CaptureExtensionJobRequestSchema = z.object({
  sourceType: z.enum([
    'greenhouse',
    'lever',
    'ashby',
    'workday',
    'naukri',
    'foundit',
    'internshala',
    'instahyre',
    'wellfound',
    'linkedin',
    'extension_capture'
  ]),
  sourceUrl: z.string().url(),
  applyUrl: z.string().url().optional(),
  title: z.string().min(1).max(300),
  companyName: z.string().min(1).max(200),
  locationRaw: z.string().max(200).optional(),
  salaryText: z.string().max(120).optional(),
  descriptionClean: z.string().max(50_000).optional(),
  resumeVersionId: z.string().uuid().optional(),
  notes: z.string().max(2000).optional()
});
export type CaptureExtensionJobRequest = z.infer<typeof CaptureExtensionJobRequestSchema>;

export const CaptureExtensionJobResponseSchema = z.object({
  jobId: z.string().uuid(),
  applicationId: z.string().uuid(),
  status: z.string(),
  resumeVersionId: z.string().uuid().nullable()
});
export type CaptureExtensionJobResponse = z.infer<typeof CaptureExtensionJobResponseSchema>;

export const FallbackFillFieldInputSchema = z.object({
  fieldId: z.string().min(1),
  label: z.string().min(1).max(500),
  controlType: FieldControlTypeSchema,
  placeholder: z.string().max(200).optional(),
  name: z.string().max(200).optional(),
  options: z.array(z.string()).max(60).optional(),
  required: z.boolean().optional(),
  maxLength: z.number().int().min(1).max(5000).optional()
});
export type FallbackFillFieldInput = z.infer<typeof FallbackFillFieldInputSchema>;

export const FallbackFillRequestSchema = z.object({
  atsAdapter: AtsAdapterIdSchema,
  jobTitle: z.string().min(1).max(300),
  companyName: z.string().min(1).max(200),
  jobDescription: z.string().max(20_000).optional(),
  fields: z.array(FallbackFillFieldInputSchema).min(1).max(30)
});
export type FallbackFillRequest = z.infer<typeof FallbackFillRequestSchema>;

export const FallbackFillSuggestionSchema = z.object({
  fieldId: z.string().min(1),
  canonicalKey: CanonicalFieldKeySchema.default('unknown'),
  proposedValue: z.string(),
  confidence: z.number().min(0).max(0.85),
  rationale: z.string().default(''),
  groundedIn: z.string().default('')
});
export type FallbackFillSuggestion = z.infer<typeof FallbackFillSuggestionSchema>;

export const FallbackFillResponseSchema = z.object({
  suggestions: z.array(FallbackFillSuggestionSchema),
  usedLlm: z.boolean(),
  note: z.string().optional()
});
export type FallbackFillResponse = z.infer<typeof FallbackFillResponseSchema>;
