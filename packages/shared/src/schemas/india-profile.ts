import { z } from 'zod';

export const WorkAuthorizationSchema = z.enum([
  'indian_citizen',
  'oci',
  'us_citizen',
  'green_card',
  'eu_blue_card',
  'uk_ilr',
  'requires_sponsorship',
  'other'
]);

export const InternshipStatusSchema = z.enum([
  'none',
  'seeking_internship',
  'currently_interning',
  'completed_internship',
  'ppo_holder'
]);

export const SalaryCurrencySchema = z.enum(['INR', 'USD', 'EUR', 'GBP', 'SGD', 'AED']);

export const IndiaProfileSchema = z.object({
  currentCtcLpa: z.number().min(0).max(500).nullable().default(null),
  expectedCtcLpa: z.number().min(0).max(500).nullable().default(null),
  ctcCurrency: SalaryCurrencySchema.default('INR'),
  noticePeriodDays: z.number().int().min(0).max(365).nullable().default(null),
  isServingNotice: z.boolean().default(false),
  lastWorkingDay: z.string().nullable().default(null),
  preferredCities: z.array(z.string()).default([]),
  willingToRelocate: z.boolean().default(true),
  workAuthorization: WorkAuthorizationSchema.default('indian_citizen'),
  isFresher: z.boolean().default(false),
  internshipStatus: InternshipStatusSchema.default('none'),
  graduationYear: z.number().int().min(1980).max(2035).nullable().default(null),
  cgpa: z.number().min(0).max(100).nullable().default(null),
  cgpaScale: z.number().min(4).max(100).default(10),
  collegeName: z.string().default(''),
  degree: z.string().default(''),
  branch: z.string().default(''),
  tenthPercentage: z.number().min(0).max(100).nullable().default(null),
  twelfthPercentage: z.number().min(0).max(100).nullable().default(null),
  activeBacklogs: z.number().int().min(0).max(50).default(0)
});

export type IndiaProfile = z.infer<typeof IndiaProfileSchema>;
export type WorkAuthorization = z.infer<typeof WorkAuthorizationSchema>;
export type InternshipStatus = z.infer<typeof InternshipStatusSchema>;
export type SalaryCurrency = z.infer<typeof SalaryCurrencySchema>;

export const INDIAN_TECH_HUBS = [
  'Bengaluru',
  'Hyderabad',
  'Pune',
  'Gurugram',
  'Noida',
  'Delhi NCR',
  'Mumbai',
  'Chennai',
  'Remote (India)',
  'Remote (Global)'
] as const;

export function createEmptyIndiaProfile(): IndiaProfile {
  return IndiaProfileSchema.parse({});
}
