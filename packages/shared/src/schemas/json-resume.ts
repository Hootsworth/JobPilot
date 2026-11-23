import { z } from 'zod';

export const ResumeLocationSchema = z.object({
  address: z.string().optional().default(''),
  postalCode: z.string().optional().default(''),
  city: z.string().optional().default(''),
  countryCode: z.string().optional().default(''),
  region: z.string().optional().default('')
});

export const ResumeSocialProfileSchema = z.object({
  network: z.string().min(1),
  username: z.string().optional().default(''),
  url: z.string().optional().default('')
});

export const ResumeBasicsSchema = z.object({
  name: z.string().default(''),
  label: z.string().optional().default(''),
  email: z.string().optional().default(''),
  phone: z.string().optional().default(''),
  url: z.string().optional().default(''),
  summary: z.string().optional().default(''),
  location: ResumeLocationSchema.optional().default({}),
  profiles: z.array(ResumeSocialProfileSchema).optional().default([])
});

export const ResumeWorkSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  position: z.string().min(1),
  url: z.string().optional().default(''),
  location: z.string().optional().default(''),
  employmentType: z.string().optional().default(''),
  startDate: z.string().default(''),
  endDate: z.string().optional().default(''),
  summary: z.string().optional().default(''),
  highlights: z.array(z.string()).default([])
});

export const ResumeEducationSchema = z.object({
  id: z.string().min(1),
  institution: z.string().min(1),
  url: z.string().optional().default(''),
  area: z.string().optional().default(''),
  studyType: z.string().optional().default(''),
  startDate: z.string().optional().default(''),
  endDate: z.string().optional().default(''),
  score: z.string().optional().default(''),
  courses: z.array(z.string()).optional().default([])
});

export const ResumeProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional().default(''),
  highlights: z.array(z.string()).default([]),
  keywords: z.array(z.string()).optional().default([]),
  startDate: z.string().optional().default(''),
  endDate: z.string().optional().default(''),
  url: z.string().optional().default(''),
  roles: z.array(z.string()).optional().default([]),
  entity: z.string().optional().default(''),
  type: z.string().optional().default('')
});

export const ResumeSkillGroupSchema = z.object({
  name: z.string().min(1),
  level: z.string().optional().default(''),
  keywords: z.array(z.string()).default([])
});

export const ResumeCertificateSchema = z.object({
  name: z.string().min(1),
  date: z.string().optional().default(''),
  issuer: z.string().optional().default(''),
  url: z.string().optional().default('')
});

export const ResumeAwardSchema = z.object({
  title: z.string().min(1),
  date: z.string().optional().default(''),
  awarder: z.string().optional().default(''),
  summary: z.string().optional().default('')
});

export const ResumePublicationSchema = z.object({
  name: z.string().min(1),
  publisher: z.string().optional().default(''),
  releaseDate: z.string().optional().default(''),
  url: z.string().optional().default(''),
  summary: z.string().optional().default('')
});

export const ResumeLanguageSchema = z.object({
  language: z.string().min(1),
  fluency: z.string().optional().default('')
});

export const JsonResumeSchema = z.object({
  basics: ResumeBasicsSchema.default({}),
  work: z.array(ResumeWorkSchema).default([]),
  education: z.array(ResumeEducationSchema).default([]),
  projects: z.array(ResumeProjectSchema).default([]),
  skills: z.array(ResumeSkillGroupSchema).default([]),
  certificates: z.array(ResumeCertificateSchema).optional().default([]),
  awards: z.array(ResumeAwardSchema).optional().default([]),
  publications: z.array(ResumePublicationSchema).optional().default([]),
  languages: z.array(ResumeLanguageSchema).optional().default([])
});

export type JsonResume = z.infer<typeof JsonResumeSchema>;
export type ResumeWork = z.infer<typeof ResumeWorkSchema>;
export type ResumeEducation = z.infer<typeof ResumeEducationSchema>;
export type ResumeProject = z.infer<typeof ResumeProjectSchema>;
export type ResumeSkillGroup = z.infer<typeof ResumeSkillGroupSchema>;

export function createEmptyJsonResume(): JsonResume {
  return JsonResumeSchema.parse({});
}
