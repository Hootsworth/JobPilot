import {
  toInrLpa,
  type JobCareerCategory,
  type JobEmploymentType,
  type JobSeniority,
  type JobWorkMode,
  type SalaryPeriod
} from '@jobpilot/shared';

interface CityRule {
  canonical: string;
  countryCode: string;
  patterns: RegExp[];
}

const CITY_RULES: CityRule[] = [
  { canonical: 'Bengaluru', countryCode: 'IN', patterns: [/\bbengaluru\b/i, /\bbangalore\b/i, /\bblr\b/i] },
  { canonical: 'Hyderabad', countryCode: 'IN', patterns: [/\bhyderabad\b/i, /\bhyd\b/i] },
  { canonical: 'Pune', countryCode: 'IN', patterns: [/\bpune\b/i] },
  { canonical: 'Gurugram', countryCode: 'IN', patterns: [/\bgurugram\b/i, /\bgurgaon\b/i] },
  { canonical: 'Noida', countryCode: 'IN', patterns: [/\bnoida\b/i] },
  { canonical: 'Delhi NCR', countryCode: 'IN', patterns: [/\bnew delhi\b/i, /\bdelhi\b/i, /\bncr\b/i] },
  { canonical: 'Mumbai', countryCode: 'IN', patterns: [/\bmumbai\b/i, /\bnavi mumbai\b/i, /\bthane\b/i] },
  { canonical: 'Chennai', countryCode: 'IN', patterns: [/\bchennai\b/i] },
  { canonical: 'Kolkata', countryCode: 'IN', patterns: [/\bkolkata\b/i] },
  { canonical: 'Ahmedabad', countryCode: 'IN', patterns: [/\bahmedabad\b/i] },
  { canonical: 'Kochi', countryCode: 'IN', patterns: [/\bkochi\b/i, /\bcochin\b/i] },
  { canonical: 'Jaipur', countryCode: 'IN', patterns: [/\bjaipur\b/i] },
  { canonical: 'Chandigarh', countryCode: 'IN', patterns: [/\bchandigarh\b/i] },
  { canonical: 'San Francisco', countryCode: 'US', patterns: [/\bsan francisco\b/i, /\bbay area\b/i] },
  { canonical: 'New York', countryCode: 'US', patterns: [/\bnew york\b/i, /\bnyc\b/i] },
  { canonical: 'Seattle', countryCode: 'US', patterns: [/\bseattle\b/i] },
  { canonical: 'Austin', countryCode: 'US', patterns: [/\baustin\b/i] },
  { canonical: 'London', countryCode: 'GB', patterns: [/\blondon\b/i] },
  { canonical: 'Singapore', countryCode: 'SG', patterns: [/\bsingapore\b/i] },
  { canonical: 'Berlin', countryCode: 'DE', patterns: [/\bberlin\b/i] },
  { canonical: 'Dublin', countryCode: 'IE', patterns: [/\bdublin\b/i] },
  { canonical: 'Toronto', countryCode: 'CA', patterns: [/\btoronto\b/i] },
  { canonical: 'Dubai', countryCode: 'AE', patterns: [/\bdubai\b/i] }
];

const COUNTRY_PATTERNS: Array<{ code: string; pattern: RegExp }> = [
  { code: 'IN', pattern: /\bindia\b|\bkarnataka\b|\bmaharashtra\b|\btelangana\b|\btamil nadu\b|\bharyana\b|\b,\s*in\b/i },
  { code: 'US', pattern: /\bunited states\b|\busa\b|\bu\.s\.\b|\bcalifornia\b|\b,\s*us\b/i },
  { code: 'GB', pattern: /\bunited kingdom\b|\buk\b|\bengland\b/i },
  { code: 'DE', pattern: /\bgermany\b|\bdeutschland\b/i },
  { code: 'CA', pattern: /\bcanada\b/i },
  { code: 'SG', pattern: /\bsingapore\b/i },
  { code: 'AU', pattern: /\baustralia\b/i },
  { code: 'AE', pattern: /\buae\b|\bunited arab emirates\b/i },
  { code: 'NL', pattern: /\bnetherlands\b/i }
];

export function parseLocation(
  rawLocation: string | null | undefined,
  workModeHint?: string | null
): {
  locationRaw: string;
  city: string | null;
  countryCode: string | null;
  workMode: JobWorkMode;
} {
  const locationRaw = (rawLocation ?? '').trim();
  const combined = `${locationRaw} ${workModeHint ?? ''}`.trim();

  let city: string | null = null;
  let countryCode: string | null = null;

  for (const rule of CITY_RULES) {
    if (rule.patterns.some((p) => p.test(locationRaw))) {
      city = rule.canonical;
      countryCode = rule.countryCode;
      break;
    }
  }

  if (!countryCode) {
    for (const c of COUNTRY_PATTERNS) {
      if (c.pattern.test(locationRaw)) {
        countryCode = c.code;
        break;
      }
    }
  }

  let workMode: JobWorkMode = 'unknown';
  if (/\bhybrid\b/i.test(combined)) {
    workMode = 'hybrid';
  } else if (/\bremote\b|\bwork from home\b|\bwfh\b|\bdistributed\b|\banywhere\b/i.test(combined)) {
    workMode = 'remote';
  } else if (/\bon-?site\b|\bin-?office\b|\bin-?person\b/i.test(combined)) {
    workMode = 'onsite';
  } else if (city) {
    workMode = 'onsite';
  }

  return { locationRaw, city, countryCode, workMode };
}

export function inferSeniority(title: string, description: string = ''): JobSeniority {
  const t = title.toLowerCase();
  if (/\bintern\b|\binternship\b|\bsummer analyst\b/i.test(t)) return 'intern';
  if (/\bfresher\b|\bnew grad\b|\bgraduate\b|\btrainee\b|\bentry[- ]level\b|\b2025\b|\b2026\b/i.test(t)) {
    return 'fresher';
  }
  if (/\bstaff\b|\bprincipal\b|\bdistinguished\b|\barchitect\b/i.test(t)) return 'staff';
  if (/\bengineering manager\b|\bhead of\b|\bdirector\b|\bvp\b|\bmanager\b/i.test(t)) return 'manager';
  if (/\blead\b|\btech lead\b|\bteam lead\b/i.test(t)) return 'lead';
  if (/\bsenior\b|\bsr\.?\b|\bsde[- ]?3\b|\bsde[- ]?iii\b|\biii\b/i.test(t)) return 'senior';
  if (/\bjunior\b|\bjr\.?\b|\bassociate\b|\bsde[- ]?1\b|\bsde[- ]?i\b|\bl3\b/i.test(t)) return 'junior';
  if (/\bsde[- ]?2\b|\bsde[- ]?ii\b|\bii\b|\bmid[- ]level\b/i.test(t)) return 'mid';

  const d = description.slice(0, 1200).toLowerCase();
  if (/\bfreshers?\b|\b0[-–to ]+1\s*years?\b/i.test(d)) return 'fresher';
  return 'unknown';
}

export function inferEmploymentType(
  title: string,
  description: string = '',
  explicitHint?: string | null
): JobEmploymentType {
  const hint = (explicitHint ?? '').trim().toLowerCase();
  const titleLower = title.toLowerCase();
  const lead = `${titleLower} ${hint} ${description.slice(0, 600).toLowerCase()}`;

  if (/\bintern\b|\binternship\b|\bsummer analyst\b|\bapprentice\b/.test(`${titleLower} ${hint}`)) {
    return 'internship';
  }
  if (/\bcontract\b|\bfreelance\b|\bconsultant\b|\btemp\b/.test(`${titleLower} ${hint}`)) {
    return 'contract';
  }
  if (/\bpart[- ]?time\b/.test(`${titleLower} ${hint}`)) {
    return 'part_time';
  }
  if (/\bfull[- ]?time\b|\bpermanent\b|\bregular\b/.test(lead)) {
    return 'full_time';
  }
  if (/\binternship\b/.test(lead)) {
    return 'internship';
  }
  return 'unknown';
}

export function inferFresherEligibility(
  title: string,
  description: string = '',
  seniority: JobSeniority,
  expMinYears: number | null
): boolean | null {
  if (seniority === 'intern' || seniority === 'fresher') return true;
  if (['senior', 'staff', 'lead', 'manager'].includes(seniority)) return false;
  if (expMinYears != null) {
    if (expMinYears <= 1) return true;
    if (expMinYears >= 2) return false;
  }

  const combined = `${title}\n${description.slice(0, 2000)}`.toLowerCase();
  if (
    /\bfreshers?\b|\bnew grad(?:uate)?s?\b|\bcampus\b|\b2025\s*(?:grad|batch)\b|\b2026\s*(?:grad|batch)\b|\bentry[- ]level\b|\b0\s*(?:-|–|to)\s*[12]\s*(?:years?|yrs?)\b/.test(
      combined
    )
  ) {
    return true;
  }
  return null;
}

export function inferCareerCategory(
  title: string,
  skills: string[] = [],
  description: string = ''
): JobCareerCategory {
  const t = title.toLowerCase();
  const body = `${t} ${skills.join(' ').toLowerCase()} ${description.slice(0, 600).toLowerCase()}`;

  if (
    /\bcyber\s?security\b|\bsecurity engineer\b|\bappsec\b|\binfosec\b|\bsoc analyst\b|\bpenetration\b|\bvulnerability\b|\bdevsecops\b/.test(
      t
    )
  ) {
    return 'cybersecurity';
  }
  if (
    /\b(?:ai|ml|machine learning|deep learning|llm|nlp|computer vision|genai|generative ai|research scientist|ai engineer|mlops)\b/.test(
      t
    )
  ) {
    return 'ai_ml';
  }
  if (
    /\bdata scientist\b|\bdata analyst\b|\bdata engineer\b|\banalytics\b|\bbi engineer\b|\bbusiness intelligence\b|\bquantitative\b/.test(
      t
    )
  ) {
    return 'data_science';
  }
  if (/\bproduct manager\b|\bproduct management\b|\bassociate pm\b|\bapm\b|\bproduct owner\b/.test(t)) {
    return 'product_management';
  }
  if (
    /\bproduct designer\b|\bux\b|\bui\/ux\b|\bux\/ui\b|\bvisual designer\b|\binteraction designer\b|\bdesign systems\b|\buser researcher\b/.test(
      t
    )
  ) {
    return 'design_ux';
  }
  if (
    /\b(software|sde|swe|backend|front[- ]?end|full[- ]?stack|platform|devops|sre|cloud|mobile|android|ios|systems|developer|engineer)\b/.test(
      t
    )
  ) {
    return 'software_engineering';
  }

  if (/\bcybersecurity\b|\bappsec\b|\bsiem\b|\bowasp\b/.test(body)) return 'cybersecurity';
  if (/\bpytorch\b|\btensorflow\b|\bllms\b|\brag\b/.test(body)) return 'ai_ml';
  if (/\bpandas\b|\bdbt\b|\bsnowflake\b|\btableau\b|\bpower bi\b/.test(body)) return 'data_science';
  if (/\bfigma\b|\buser research\b|\bwireframing\b/.test(body)) return 'design_ux';
  return 'other';
}

export function extractExperienceYears(
  title: string,
  description: string = ''
): { minYears: number | null; maxYears: number | null } {
  const combined = `${title}\n${description.slice(0, 3000)}`;
  const rangeMatch = combined.match(
    /\b(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b/i
  );
  if (rangeMatch?.[1] && rangeMatch[2]) {
    const min = Number.parseInt(rangeMatch[1], 10);
    const max = Number.parseInt(rangeMatch[2], 10);
    if (min <= max && max <= 30) return { minYears: min, maxYears: max };
  }

  const plusMatch = combined.match(/\b(\d{1,2})\s*\+\s*(?:years?|yrs?)\b/i);
  if (plusMatch?.[1]) {
    const min = Number.parseInt(plusMatch[1], 10);
    if (min <= 30) return { minYears: min, maxYears: null };
  }

  const minMatch = combined.match(
    /(?:minimum|at least|min\.?)\s*(\d{1,2})\s*(?:years?|yrs?)/i
  );
  if (minMatch?.[1]) {
    const min = Number.parseInt(minMatch[1], 10);
    if (min <= 30) return { minYears: min, maxYears: null };
  }

  if (/\bintern\b|\bfresher\b|\bnew grad\b/i.test(title)) {
    return { minYears: 0, maxYears: 1 };
  }

  return { minYears: null, maxYears: null };
}

function parseShorthandNumber(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '').trim().toLowerCase();
  if (cleaned.endsWith('k')) {
    const n = Number.parseFloat(cleaned.slice(0, -1));
    return Number.isFinite(n) ? n * 1000 : null;
  }
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function extractSalary(params: {
  description: string;
  explicitMin?: number | null;
  explicitMax?: number | null;
  explicitCurrency?: string | null;
  explicitPeriod?: SalaryPeriod | null;
}): {
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: SalaryPeriod | null;
  salaryMinLpa: number | null;
  salaryMaxLpa: number | null;
  stipendMonthlyInr: number | null;
} {
  if (params.explicitMin != null || params.explicitMax != null) {
    const currency = (params.explicitCurrency ?? 'INR').toUpperCase();
    const period: SalaryPeriod = params.explicitPeriod ?? 'year';
    const min = params.explicitMin ?? null;
    const max = params.explicitMax ?? null;
    const stipendMonthlyInr =
      currency === 'INR' && period === 'month' ? (max ?? min) : null;
    return {
      salaryMin: min,
      salaryMax: max,
      salaryCurrency: currency,
      salaryPeriod: period,
      salaryMinLpa: min != null ? toInrLpa(min, currency, period) : null,
      salaryMaxLpa: max != null ? toInrLpa(max, currency, period) : null,
      stipendMonthlyInr
    };
  }

  const text = params.description.slice(0, 4000);

  // 1. INR LPA patterns: "12 - 18 LPA", "15 LPA", "₹12-20 Lakhs"
  const lpaRange = text.match(
    /(?:₹|INR|Rs\.?)?\s*(\d{1,3}(?:\.\d{1,2})?)\s*(?:-|–|to)\s*(\d{1,3}(?:\.\d{1,2})?)\s*(?:lpa|lakhs?\s*(?:per\s*annum|p\.?a\.?))/i
  );
  if (lpaRange?.[1] && lpaRange[2]) {
    const minLpa = Number.parseFloat(lpaRange[1]);
    const maxLpa = Number.parseFloat(lpaRange[2]);
    if (minLpa <= maxLpa && maxLpa <= 300) {
      return {
        salaryMin: minLpa * 100_000,
        salaryMax: maxLpa * 100_000,
        salaryCurrency: 'INR',
        salaryPeriod: 'year',
        salaryMinLpa: minLpa,
        salaryMaxLpa: maxLpa,
        stipendMonthlyInr: null
      };
    }
  }

  const lpaSingle = text.match(/(?:₹|INR|Rs\.?)?\s*(\d{1,3}(?:\.\d{1,2})?)\s*lpa\b/i);
  if (lpaSingle?.[1]) {
    const lpa = Number.parseFloat(lpaSingle[1]);
    if (lpa <= 300) {
      return {
        salaryMin: lpa * 100_000,
        salaryMax: lpa * 100_000,
        salaryCurrency: 'INR',
        salaryPeriod: 'year',
        salaryMinLpa: lpa,
        salaryMaxLpa: lpa,
        stipendMonthlyInr: null
      };
    }
  }

  // 2. INR monthly stipend / salary range: "₹30,000 - ₹50,000 / month" or "INR 25k-45k/mo"
  const inrMonthRange = text.match(
    /(?:₹|INR|Rs\.?)\s*([\d,]+(?:\.\d+)?k?)\s*(?:-|–|to)\s*(?:₹|INR|Rs\.?)?\s*([\d,]+(?:\.\d+)?k?)\s*(?:\/|\s*per\s*)(?:month|mo)\b/i
  );
  if (inrMonthRange?.[1] && inrMonthRange[2]) {
    const minM = parseShorthandNumber(inrMonthRange[1]);
    const maxM = parseShorthandNumber(inrMonthRange[2]);
    if (minM && maxM && minM >= 2000 && maxM >= minM && maxM <= 2_000_000) {
      return {
        salaryMin: minM,
        salaryMax: maxM,
        salaryCurrency: 'INR',
        salaryPeriod: 'month',
        salaryMinLpa: toInrLpa(minM, 'INR', 'month'),
        salaryMaxLpa: toInrLpa(maxM, 'INR', 'month'),
        stipendMonthlyInr: maxM
      };
    }
  }

  // 2b. INR single monthly stipend / salary: "₹50,000 / month" or "INR 40k/mo"
  const inrMonth = text.match(
    /(?:₹|INR|Rs\.?)\s*([\d,]+(?:\.\d+)?k?)\s*(?:\/|\s*per\s*)(?:month|mo)\b/i
  );
  if (inrMonth?.[1]) {
    const monthly = parseShorthandNumber(inrMonth[1]);
    if (monthly && monthly >= 2000 && monthly <= 2_000_000) {
      const lpa = toInrLpa(monthly, 'INR', 'month');
      return {
        salaryMin: monthly,
        salaryMax: monthly,
        salaryCurrency: 'INR',
        salaryPeriod: 'month',
        salaryMinLpa: lpa,
        salaryMaxLpa: lpa,
        stipendMonthlyInr: monthly
      };
    }
  }

  // 2c. INR annual absolute range: "₹12,00,000 - ₹18,00,000" or "INR 1000000 - 1500000"
  const inrAnnualRange = text.match(
    /(?:₹|INR|Rs\.?)\s*([\d,]{6,10})\s*(?:-|–|to)\s*(?:₹|INR|Rs\.?)?\s*([\d,]{6,10})(?:\s*(?:\/|\s*per\s*)(?:year|yr|annum|p\.?a\.?))?/i
  );
  if (inrAnnualRange?.[1] && inrAnnualRange[2]) {
    const minY = parseShorthandNumber(inrAnnualRange[1]);
    const maxY = parseShorthandNumber(inrAnnualRange[2]);
    if (minY && maxY && minY >= 150_000 && maxY >= minY && maxY <= 30_000_000) {
      return {
        salaryMin: minY,
        salaryMax: maxY,
        salaryCurrency: 'INR',
        salaryPeriod: 'year',
        salaryMinLpa: toInrLpa(minY, 'INR', 'year'),
        salaryMaxLpa: toInrLpa(maxY, 'INR', 'year'),
        stipendMonthlyInr: null
      };
    }
  }

  // 3. USD annual range: "$120,000 - $160,000" or "$120k - $150k"
  const usdRange = text.match(
    /\$\s*([\d,]+(?:\.\d+)?k?)\s*(?:-|–|to)\s*\$?\s*([\d,]+(?:\.\d+)?k?)/i
  );
  if (usdRange?.[1] && usdRange[2]) {
    const rawMin = parseShorthandNumber(usdRange[1]);
    const rawMax = parseShorthandNumber(usdRange[2]);
    if (rawMin && rawMax && rawMin >= 20_000 && rawMax >= rawMin && rawMax <= 1_500_000) {
      return {
        salaryMin: rawMin,
        salaryMax: rawMax,
        salaryCurrency: 'USD',
        salaryPeriod: 'year',
        salaryMinLpa: toInrLpa(rawMin, 'USD', 'year'),
        salaryMaxLpa: toInrLpa(rawMax, 'USD', 'year'),
        stipendMonthlyInr: null
      };
    }
  }

  return {
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    salaryMinLpa: null,
    salaryMaxLpa: null,
    stipendMonthlyInr: null
  };
}

const SKILL_CATALOG: Array<{ label: string; pattern: RegExp }> = [
  { label: 'TypeScript', pattern: /\btypescript\b/i },
  { label: 'JavaScript', pattern: /\bjavascript\b|\becmascript\b/i },
  { label: 'Python', pattern: /\bpython\b/i },
  { label: 'Java', pattern: /\bjava\b(?!script)/i },
  { label: 'Go', pattern: /\bgolang\b|\bgo\s+(?:programming|services|backend|microservices)\b/i },
  { label: 'Rust', pattern: /\brust\b/i },
  { label: 'C++', pattern: /(?:^|[\s,(/])c\+\+(?=$|[\s,.)/])/i },
  { label: 'C#', pattern: /(?:^|[\s,(/])c#(?=$|[\s,.)/])/i },
  { label: 'SQL', pattern: /\bsql\b/i },
  { label: 'React', pattern: /\breact(?:\.js|js)?\b/i },
  { label: 'Next.js', pattern: /\bnext\.?js\b/i },
  { label: 'Angular', pattern: /\bangular\b/i },
  { label: 'Vue', pattern: /\bvue(?:\.js)?\b/i },
  { label: 'Tailwind CSS', pattern: /\btailwind(?:\s*css)?\b/i },
  { label: 'Node.js', pattern: /\bnode(?:\.js|js)\b/i },
  { label: 'Fastify', pattern: /\bfastify\b/i },
  { label: 'Express', pattern: /\bexpress(?:\.js)?\b/i },
  { label: 'FastAPI', pattern: /\bfastapi\b/i },
  { label: 'Django', pattern: /\bdjango\b/i },
  { label: 'Flask', pattern: /\bflask\b/i },
  { label: 'Spring Boot', pattern: /\bspring\s*boot\b/i },
  { label: 'PostgreSQL', pattern: /\bpostgres(?:ql)?\b/i },
  { label: 'MySQL', pattern: /\bmysql\b/i },
  { label: 'MongoDB', pattern: /\bmongodb\b|\bmongo\b/i },
  { label: 'Redis', pattern: /\bredis\b/i },
  { label: 'Elasticsearch', pattern: /\belasticsearch\b/i },
  { label: 'Kafka', pattern: /\bkafka\b/i },
  { label: 'RabbitMQ', pattern: /\brabbitmq\b/i },
  { label: 'Docker', pattern: /\bdocker\b/i },
  { label: 'Kubernetes', pattern: /\bkubernetes\b|\bk8s\b/i },
  { label: 'AWS', pattern: /\baws\b|\bamazon web services\b/i },
  { label: 'GCP', pattern: /\bgcp\b|\bgoogle cloud\b/i },
  { label: 'Azure', pattern: /\bazure\b/i },
  { label: 'Terraform', pattern: /\bterraform\b/i },
  { label: 'GraphQL', pattern: /\bgraphql\b/i },
  { label: 'gRPC', pattern: /\bgrpc\b/i },
  { label: 'REST APIs', pattern: /\brest(?:ful)?\s*api/i },
  { label: 'Microservices', pattern: /\bmicroservices?\b/i },
  { label: 'System Design', pattern: /\bsystem design\b|\bdistributed systems?\b/i },
  { label: 'PyTorch', pattern: /\bpytorch\b/i },
  { label: 'TensorFlow', pattern: /\btensorflow\b/i },
  { label: 'LLMs', pattern: /\bllms?\b|\blarge language models?\b/i },
  { label: 'RAG', pattern: /\brag\b|\bretrieval[- ]augmented\b/i },
  { label: 'pgvector', pattern: /\bpgvector\b/i },
  { label: 'Linux', pattern: /\blinux\b/i },
  { label: 'Git', pattern: /\bgit\b/i },
  { label: 'CI/CD', pattern: /\bci\/cd\b|\bgithub actions\b/i },
  { label: 'Playwright', pattern: /\bplaywright\b/i },
  { label: 'Jest', pattern: /\bjest\b/i },
  { label: 'Vitest', pattern: /\bvitest\b/i },
  { label: 'Spark', pattern: /\bapache spark\b|\bpyspark\b/i },
  { label: 'Airflow', pattern: /\bairflow\b/i },
  { label: 'Snowflake', pattern: /\bsnowflake\b/i },
  { label: 'Flutter', pattern: /\bflutter\b/i },
  { label: 'React Native', pattern: /\breact native\b/i },
  { label: 'Kotlin', pattern: /\bkotlin\b/i },
  { label: 'Swift', pattern: /\bswift\b/i },
  // AI / ML & Data Science
  { label: 'Scikit-learn', pattern: /\bscikit[- ]?learn\b|\bsklearn\b/i },
  { label: 'Hugging Face', pattern: /\bhugging\s?face\b|\btransformers\b/i },
  { label: 'LangChain', pattern: /\blangchain\b|\blanggraph\b/i },
  { label: 'Computer Vision', pattern: /\bcomputer vision\b|\bopencv\b/i },
  { label: 'NLP', pattern: /\bnlp\b|\bnatural language processing\b/i },
  { label: 'MLOps', pattern: /\bmlops\b|\bmlflow\b/i },
  { label: 'CUDA', pattern: /\bcuda\b/i },
  { label: 'Pandas', pattern: /\bpandas\b/i },
  { label: 'dbt', pattern: /\bdbt\b/i },
  { label: 'Tableau', pattern: /\btableau\b/i },
  { label: 'Power BI', pattern: /\bpower\s?bi\b/i },
  { label: 'BigQuery', pattern: /\bbigquery\b/i },
  { label: 'Databricks', pattern: /\bdatabricks\b/i },
  { label: 'Looker', pattern: /\blooker\b/i },
  // Product Management
  { label: 'Product Strategy', pattern: /\bproduct strategy\b|\bproduct vision\b/i },
  { label: 'Roadmapping', pattern: /\broadmap(?:ping|s)?\b/i },
  { label: 'A/B Testing', pattern: /\ba\/b testing\b|\bexperimentation\b/i },
  { label: 'Jira', pattern: /\bjira\b/i },
  { label: 'Mixpanel', pattern: /\bmixpanel\b/i },
  { label: 'Amplitude', pattern: /\bamplitude\b/i },
  { label: 'Agile', pattern: /\bagile\b|\bscrum\b/i },
  // Design & UX
  { label: 'Figma', pattern: /\bfigma\b/i },
  { label: 'UI/UX', pattern: /\bui\/ux\b|\bux\/ui\b|\buser experience\b/i },
  { label: 'Design Systems', pattern: /\bdesign systems?\b/i },
  { label: 'Prototyping', pattern: /\bprototyping\b/i },
  { label: 'User Research', pattern: /\buser research\b|\busability testing\b/i },
  { label: 'Wireframing', pattern: /\bwirefram(?:e|ing)\b/i },
  // Cybersecurity
  { label: 'AppSec', pattern: /\bappsec\b|\bapplication security\b/i },
  { label: 'Cybersecurity', pattern: /\bcyber\s?security\b|\binfosec\b/i },
  { label: 'Penetration Testing', pattern: /\bpenetration testing\b|\bpentest(?:ing)?\b/i },
  { label: 'SIEM', pattern: /\bsiem\b|\bsplunk\b/i },
  { label: 'OWASP', pattern: /\bowasp\b/i },
  { label: 'IAM', pattern: /\biam\b|\bidentity and access management\b/i },
  { label: 'Cloud Security', pattern: /\bcloud security\b|\bdevsecops\b/i },
  { label: 'Zero Trust', pattern: /\bzero trust\b/i },
  { label: 'SOC', pattern: /\bsoc analyst\b|\bsecurity operations\b/i }
];

export function extractSkillsFromText(text: string): string[] {
  const matched: string[] = [];
  for (const item of SKILL_CATALOG) {
    if (item.pattern.test(text)) {
      matched.push(item.label);
    }
  }
  return matched;
}
