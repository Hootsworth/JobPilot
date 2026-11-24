export function pluralize(count: number, singular: string, plural?: string): string {
  const form = count === 1 ? singular : (plural ?? `${singular}s`);
  return `${count} ${form}`;
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return 'Not synced yet';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return 'Recently';
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

const SOURCE_LABELS: Record<string, string> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  workable: 'Workable',
  smartrecruiters: 'SmartRecruiters',
  workday: 'Workday',
  adzuna: 'Adzuna',
  jooble: 'Jooble',
  remotive: 'Remotive',
  arbeitnow: 'Arbeitnow',
  remoteok: 'RemoteOK',
  himalayas: 'Himalayas',
  jobicy: 'Jobicy',
  themuse: 'The Muse',
  hackernews: 'Hacker News',
  jsearch: 'JSearch',
  naukri: 'Naukri',
  foundit: 'Foundit',
  internshala: 'Internshala',
  instahyre: 'Instahyre',
  wellfound: 'Wellfound',
  linkedin: 'LinkedIn',
  extension_capture: 'Extension',
  manual: 'Manual'
};

export function formatSourceLabel(sourceType: string): string {
  return SOURCE_LABELS[sourceType.toLowerCase()] ?? sourceType;
}

export function formatWorkMode(mode: string | null | undefined): string | null {
  switch (mode?.toLowerCase()) {
    case 'remote':
      return 'Remote';
    case 'hybrid':
      return 'Hybrid';
    case 'onsite':
      return 'On-site';
    default:
      return null;
  }
}

export function formatSeniority(level: string | null | undefined): string | null {
  switch (level?.toLowerCase()) {
    case 'intern':
      return 'Intern';
    case 'fresher':
      return 'Fresher';
    case 'junior':
      return 'Junior';
    case 'mid':
      return 'Mid-level';
    case 'senior':
      return 'Senior';
    case 'staff':
      return 'Staff';
    case 'lead':
      return 'Lead';
    case 'manager':
      return 'Manager';
    default:
      return null;
  }
}

const TASK_LABELS: Record<string, string> = {
  job_match_rerank: 'Job matching',
  resume_parse: 'Resume parsing',
  resume_tailor: 'Resume tailoring',
  resume_verify: 'Resume verification',
  cover_letter_generate: 'Cover letter',
  cover_letter: 'Cover letter',
  extension_draft_answers: 'Form answer drafting',
  extension_fallback_fill: 'Form autofill',
  provider_test: 'Provider check',
  linkedin_pdf_parse: 'LinkedIn PDF import'
};

export function formatTaskLabel(taskType: string): string {
  const mapped = TASK_LABELS[taskType.toLowerCase()];
  if (mapped) return mapped;
  return taskType
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

const TEMPLATE_LABELS: Record<string, string> = {
  why_this_company: 'Why this company',
  ctc_expectation_india: 'Expected CTC',
  notice_period_india: 'Notice period',
  challenging_bug_or_system: 'Technical challenge',
  work_authorization_relocation: 'Work authorization & relocation'
};

export function formatTemplateLabel(questionKey: string): string {
  const mapped = TEMPLATE_LABELS[questionKey];
  if (mapped) return mapped;
  const cleaned = questionKey.replace(/_/g, ' ');
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
