import { toInrLpa, type JobSeniority, type JobWorkMode, type SalaryPeriod } from '@jobpilot/shared';

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
} {
  if (params.explicitMin != null || params.explicitMax != null) {
    const currency = (params.explicitCurrency ?? 'INR').toUpperCase();
    const period: SalaryPeriod = params.explicitPeriod ?? 'year';
    const min = params.explicitMin ?? null;
    const max = params.explicitMax ?? null;
    return {
      salaryMin: min,
      salaryMax: max,
      salaryCurrency: currency,
      salaryPeriod: period,
      salaryMinLpa: min != null ? toInrLpa(min, currency, period) : null,
      salaryMaxLpa: max != null ? toInrLpa(max, currency, period) : null
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
        salaryMaxLpa: maxLpa
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
        salaryMaxLpa: lpa
      };
    }
  }

  // 2. INR monthly stipend / salary: "₹50,000 / month" or "INR 40k/mo"
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
        salaryMaxLpa: lpa
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
        salaryMaxLpa: toInrLpa(rawMax, 'USD', 'year')
      };
    }
  }

  return {
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    salaryMinLpa: null,
    salaryMaxLpa: null
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
  { label: 'Swift', pattern: /\bswift\b/i }
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
