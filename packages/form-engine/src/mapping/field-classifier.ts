import type { CanonicalFieldKey } from '@jobpilot/shared';
import type { FieldClassificationHint, RawFormControl } from '../types.js';

interface PatternRule {
  key: CanonicalFieldKey;
  confidence: number;
  reason: string;
  patterns: RegExp[];
  controlTypes?: string[];
}

const CLASSIFICATION_RULES: PatternRule[] = [
  {
    key: 'resume_file',
    confidence: 0.96,
    reason: 'File input matching resume / CV upload',
    controlTypes: ['file'],
    patterns: [/\bresume\b/i, /\bcv\b/i, /curriculum\s*vitae/i]
  },
  {
    key: 'first_name',
    confidence: 0.95,
    reason: 'Matches first/given name prompt',
    patterns: [/first[\s_-]*name/i, /given[\s_-]*name/i, /\bfname\b/i]
  },
  {
    key: 'last_name',
    confidence: 0.95,
    reason: 'Matches last/family name prompt',
    patterns: [/last[\s_-]*name/i, /family[\s_-]*name/i, /\bsurname\b/i, /\blname\b/i]
  },
  {
    key: 'full_name',
    confidence: 0.93,
    reason: 'Matches full name prompt',
    patterns: [/full[\s_-]*name/i, /candidate[\s_-]*name/i, /your[\s_-]*name/i, /^name$/i]
  },
  {
    key: 'email',
    confidence: 0.96,
    reason: 'Matches email input or label',
    patterns: [/\be-?mail\b/i]
  },
  {
    key: 'phone',
    confidence: 0.95,
    reason: 'Matches phone / mobile input or label',
    patterns: [/\bphone\b/i, /\bmobile\b/i, /\bcontact\s*number\b/i, /\btel\b/i]
  },
  {
    key: 'linkedin_url',
    confidence: 0.96,
    reason: 'Matches LinkedIn profile URL prompt',
    patterns: [/linkedin/i]
  },
  {
    key: 'github_url',
    confidence: 0.96,
    reason: 'Matches GitHub profile URL prompt',
    patterns: [/github/i]
  },
  {
    key: 'portfolio_url',
    confidence: 0.9,
    reason: 'Matches portfolio / website URL prompt',
    patterns: [/portfolio/i, /personal\s*(website|site|url)/i, /\bwebsite\b/i]
  },
  {
    key: 'tenth_percentage',
    confidence: 0.93,
    reason: 'Matches India Class X / 10th percentage',
    patterns: [/\b10th\b/i, /\bclass\s*x\b/i, /\bssc\b/i, /matriculation/i]
  },
  {
    key: 'twelfth_percentage',
    confidence: 0.93,
    reason: 'Matches India Class XII / 12th percentage',
    patterns: [/\b12th\b/i, /\bclass\s*xii\b/i, /\bhsc\b/i, /senior\s*secondary/i]
  },
  {
    key: 'expected_ctc_lpa',
    confidence: 0.92,
    reason: 'Matches expected CTC / salary expectation',
    patterns: [
      /expected\s*(ctc|salary|compensation|pay|package)/i,
      /desired\s*(ctc|salary|compensation)/i,
      /\bectc\b/i
    ]
  },
  {
    key: 'current_ctc_lpa',
    confidence: 0.92,
    reason: 'Matches current / present CTC or salary',
    patterns: [
      /(?:current|present)\s*(ctc|salary|compensation|pay|package)/i,
      /\bcctc\b/i
    ]
  },
  {
    key: 'notice_period_days',
    confidence: 0.92,
    reason: 'Matches notice period / joining availability',
    patterns: [/notice\s*period/i, /serving\s*notice/i, /how\s*soon\s*can\s*you\s*(join|start)/i]
  },
  {
    key: 'willing_to_relocate',
    confidence: 0.91,
    reason: 'Matches relocation willingness',
    patterns: [/willing\s*to\s*relocate/i, /\brelocat/i]
  },
  {
    key: 'preferred_cities',
    confidence: 0.9,
    reason: 'Matches preferred work city / hub',
    patterns: [/preferred\s*(city|cities|work\s*location|hub|office)/i]
  },
  {
    key: 'requires_sponsorship',
    confidence: 0.92,
    reason: 'Matches visa sponsorship question',
    patterns: [/sponsor(?:ship)?/i, /\bvisa\b/i, /require.*employment\s*authorization/i]
  },
  {
    key: 'work_authorization',
    confidence: 0.9,
    reason: 'Matches legal work authorization prompt',
    patterns: [/authorized\s*to\s*work/i, /work\s*authorization/i, /eligible\s*to\s*work/i]
  },
  {
    key: 'active_backlogs',
    confidence: 0.9,
    reason: 'Matches India academic active backlogs check',
    patterns: [/active\s*backlog/i, /\bbacklogs?\b/i, /\barrears\b/i]
  },
  {
    key: 'is_fresher',
    confidence: 0.88,
    reason: 'Matches fresher / new graduate status',
    patterns: [/\bfresher\b/i, /\bnew\s*grad/i, /recent\s*graduate/i]
  },
  {
    key: 'cgpa',
    confidence: 0.92,
    reason: 'Matches CGPA / GPA academic score',
    patterns: [/\bcgpa\b/i, /\bgpa\b/i, /cumulative\s*grade/i]
  },
  {
    key: 'graduation_year',
    confidence: 0.9,
    reason: 'Matches graduation / passing year',
    patterns: [/graduation\s*year/i, /year\s*of\s*passing/i, /passing\s*year/i, /grad\s*year/i]
  },
  {
    key: 'school',
    confidence: 0.9,
    reason: 'Matches college / university name',
    patterns: [/\buniversity\b/i, /\bcollege\b/i, /\bschool\b/i, /\binstitution\b/i]
  },
  {
    key: 'degree',
    confidence: 0.89,
    reason: 'Matches academic degree',
    patterns: [/\bdegree\b/i, /highest\s*qualification/i]
  },
  {
    key: 'major',
    confidence: 0.89,
    reason: 'Matches academic major / branch / discipline',
    patterns: [/\bmajor\b/i, /\bbranch\b/i, /field\s*of\s*study/i, /\bdiscipline\b/i, /\bstream\b/i]
  },
  {
    key: 'current_company',
    confidence: 0.88,
    reason: 'Matches current employer / company',
    patterns: [/current\s*company/i, /current\s*employer/i, /current\s*organization/i, /\borg\b/i]
  },
  {
    key: 'current_title',
    confidence: 0.88,
    reason: 'Matches current role / title',
    patterns: [/current\s*(title|role|designation|position)/i]
  },
  {
    key: 'years_of_experience',
    confidence: 0.89,
    reason: 'Matches total years of experience',
    patterns: [/years?\s*of\s*(?:relevant\s*)?experience/i, /\btotal\s*experience\b/i, /\byoe\b/i]
  },
  {
    key: 'location_city',
    confidence: 0.88,
    reason: 'Matches current city / location prompt',
    patterns: [/\bcurrent\s*city\b/i, /\bcity\b/i, /\blocation\b/i, /where\s*are\s*you\s*located/i]
  },
  {
    key: 'cover_letter',
    confidence: 0.85,
    reason: 'Matches cover letter or general additional notes prompt',
    patterns: [/cover\s*letter/i, /additional\s*information/i]
  }
];

export function classifyFormField(
  raw: RawFormControl,
  adapterHint?: FieldClassificationHint | null
): FieldClassificationHint {
  if (adapterHint) return adapterHint;

  // Input type shortcuts
  if (raw.controlType === 'email') {
    return { canonicalKey: 'email', confidence: 0.96, reason: 'HTML input[type="email"]' };
  }
  if (raw.controlType === 'tel') {
    return { canonicalKey: 'phone', confidence: 0.95, reason: 'HTML input[type="tel"]' };
  }

  // Autocomplete hints
  const ac = raw.autocomplete.toLowerCase();
  if (ac.includes('given-name')) {
    return { canonicalKey: 'first_name', confidence: 0.96, reason: 'autocomplete="given-name"' };
  }
  if (ac.includes('family-name')) {
    return { canonicalKey: 'last_name', confidence: 0.96, reason: 'autocomplete="family-name"' };
  }
  if (ac === 'name') {
    return { canonicalKey: 'full_name', confidence: 0.95, reason: 'autocomplete="name"' };
  }
  if (ac.includes('email')) {
    return { canonicalKey: 'email', confidence: 0.96, reason: 'autocomplete="email"' };
  }
  if (ac.includes('tel')) {
    return { canonicalKey: 'phone', confidence: 0.95, reason: 'autocomplete="tel"' };
  }

  const haystack = `${raw.label} | ${raw.name} | ${raw.id} | ${raw.placeholder}`;

  for (const rule of CLASSIFICATION_RULES) {
    if (rule.controlTypes && !rule.controlTypes.includes(raw.controlType)) continue;
    if (rule.patterns.some((re) => re.test(haystack))) {
      return {
        canonicalKey: rule.key,
        confidence: rule.confidence,
        reason: rule.reason
      };
    }
  }

  if (
    raw.controlType === 'textarea' ||
    /\b(why|describe|tell\s*us|what\s*excites|project|explain|motivation)\b/i.test(raw.label)
  ) {
    return {
      canonicalKey: 'custom_question',
      confidence: 0.72,
      reason: 'Open-ended custom application question'
    };
  }

  return {
    canonicalKey: 'unknown',
    confidence: 0,
    reason: 'No deterministic mapping matched'
  };
}
