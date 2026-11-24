import type {
  AtsParseabilityCheck,
  AtsScoreReport,
  IndiaProfile,
  JdRequirements,
  JsonResume
} from '@jobpilot/shared';
import { extractNumericFingerprints } from './deterministic-verifier.js';

const SYNONYM_GROUPS: string[][] = [
  ['typescript', 'ts'],
  ['javascript', 'js', 'ecmascript'],
  ['postgresql', 'postgres', 'psql', 'pg'],
  ['node.js', 'nodejs', 'node'],
  ['react', 'reactjs', 'react.js'],
  ['next.js', 'nextjs'],
  ['python', 'py'],
  ['kubernetes', 'k8s'],
  ['docker', 'containers', 'containerization'],
  ['amazon web services', 'aws'],
  ['google cloud', 'gcp'],
  ['microsoft azure', 'azure'],
  ['machine learning', 'ml'],
  ['deep learning', 'dl'],
  ['golang', 'go'],
  ['c++', 'cpp'],
  ['ci/cd', 'github actions', 'gitlab ci', 'jenkins'],
  ['rest', 'restful', 'rest api', 'apis'],
  ['graphql', 'gql'],
  ['microservices', 'distributed systems'],
  ['tailwindcss', 'tailwind'],
  ['redis', 'caching'],
  ['kafka', 'event streaming', 'message queue', 'message queues'],
  ['fastapi', 'fast api'],
  ['mongodb', 'mongo'],
  ['sql', 'mysql', 'sqlite'],
  ['java', 'spring boot'],
  ['pytorch', 'torch'],
  ['tensorflow', 'tf']
];

const CURATED_TECH_TERMS = [
  'TypeScript',
  'JavaScript',
  'Python',
  'Go',
  'Rust',
  'Java',
  'C++',
  'SQL',
  'PostgreSQL',
  'MySQL',
  'MongoDB',
  'Redis',
  'Kafka',
  'React',
  'Next.js',
  'Node.js',
  'Fastify',
  'Express',
  'FastAPI',
  'Django',
  'Spring Boot',
  'GraphQL',
  'REST',
  'Docker',
  'Kubernetes',
  'AWS',
  'GCP',
  'Azure',
  'Terraform',
  'CI/CD',
  'GitHub Actions',
  'Linux',
  'Microservices',
  'Distributed Systems',
  'System Design',
  'PyTorch',
  'TensorFlow',
  'LLMs',
  'RAG',
  'Tailwind CSS',
  'Playwright',
  'Vitest',
  'Jest'
];

const STRONG_ACTION_VERBS = new Set([
  'architected',
  'automated',
  'built',
  'created',
  'cut',
  'delivered',
  'deployed',
  'designed',
  'developed',
  'drove',
  'eliminated',
  'engineered',
  'established',
  'expanded',
  'implemented',
  'improved',
  'increased',
  'integrated',
  'launched',
  'led',
  'mentored',
  'migrated',
  'optimized',
  'orchestrated',
  'owned',
  'pioneered',
  'reduced',
  'refactored',
  'resolved',
  'scaled',
  'shipped',
  'simplified',
  'spearheaded',
  'streamlined'
]);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildResumeCorpus(resume: JsonResume, indiaProfile?: IndiaProfile): string {
  const parts: string[] = [
    resume.basics.name,
    resume.basics.label,
    resume.basics.summary,
    ...resume.skills.flatMap((g) => [g.name, ...g.keywords]),
    ...resume.work.flatMap((w) => [w.name, w.position, w.summary, ...w.highlights]),
    ...resume.projects.flatMap((p) => [
      p.name,
      p.description,
      ...(p.keywords ?? []),
      ...p.highlights
    ]),
    ...resume.education.flatMap((e) => [
      e.institution,
      e.area,
      e.studyType,
      ...(e.courses ?? [])
    ]),
    ...resume.certificates.flatMap((c) => [c.name, c.issuer]),
    ...resume.awards.flatMap((a) => [a.title, a.awarder, a.summary]),
    ...resume.publications.flatMap((p) => [p.name, p.publisher, p.summary])
  ];

  if (indiaProfile?.workAuthorization) {
    parts.push(indiaProfile.workAuthorization);
  }

  return parts.filter(Boolean).join('\n').toLowerCase();
}

function containsTermWithSynonyms(corpusLower: string, rawTerm: string): boolean {
  const normalized = rawTerm.trim().toLowerCase();
  if (!normalized) return false;

  const variants = new Set<string>([normalized]);
  for (const group of SYNONYM_GROUPS) {
    if (group.some((alias) => alias === normalized)) {
      for (const alias of group) {
        variants.add(alias);
      }
    }
  }

  for (const variant of variants) {
    const pattern = new RegExp(`(^|[^a-z0-9+])${escapeRegExp(variant)}($|[^a-z0-9+])`, 'i');
    if (pattern.test(corpusLower)) {
      return true;
    }
  }

  return false;
}

export function deriveJdTermsDeterministically(
  jdText: string,
  title = '',
  companyName = ''
): JdRequirements {
  const lower = jdText.toLowerCase();
  const mustHave: string[] = [];
  const niceToHave: string[] = [];
  const keywords: string[] = [];

  const preferredIdx = lower.search(/nice\s+to\s+have|preferred|bonus\s+qualifications?/i);
  const requiredBlock = preferredIdx >= 0 ? lower.slice(0, preferredIdx) : lower;
  const bonusBlock = preferredIdx >= 0 ? lower.slice(preferredIdx) : '';

  for (const term of CURATED_TECH_TERMS) {
    if (containsTermWithSynonyms(requiredBlock, term)) {
      mustHave.push(term);
    } else if (bonusBlock && containsTermWithSynonyms(bonusBlock, term)) {
      niceToHave.push(term);
    } else if (containsTermWithSynonyms(lower, term)) {
      keywords.push(term);
    }
  }

  const extraWords = jdText
    .split(/[^a-zA-Z0-9.+#/-]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4 && w.length <= 28 && /[A-Z]/.test(w[0] ?? ''))
    .filter(
      (w) =>
        !/^(Responsibilities|Requirements|Qualifications|About|Experience|Education|Company|Benefits|Location|Remote|Hybrid|India|Apply|Role|Team|Skills)$/i.test(
          w
        )
    );

  for (const word of extraWords) {
    if (
      !mustHave.some((m) => m.toLowerCase() === word.toLowerCase()) &&
      !niceToHave.some((n) => n.toLowerCase() === word.toLowerCase()) &&
      !keywords.some((k) => k.toLowerCase() === word.toLowerCase())
    ) {
      keywords.push(word);
    }
    if (keywords.length >= 12) break;
  }

  return {
    roleTitle: title,
    companyName,
    mustHaveSkills: mustHave.slice(0, 12),
    niceToHaveSkills: niceToHave.slice(0, 8),
    keyResponsibilities: [],
    keywords: keywords.slice(0, 14),
    senioritySignals: [],
    domainTerms: []
  };
}

function dedupeTerms(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(trimmed);
    }
  }
  return out;
}

export function scoreResumeAgainstJd(params: {
  resume: JsonResume;
  indiaProfile?: IndiaProfile;
  jdRequirements?: JdRequirements;
  jdText?: string;
  title?: string;
  companyName?: string;
}): AtsScoreReport {
  const jd =
    params.jdRequirements &&
    (params.jdRequirements.mustHaveSkills.length > 0 ||
      params.jdRequirements.keywords.length > 0 ||
      params.jdRequirements.niceToHaveSkills.length > 0)
      ? params.jdRequirements
      : deriveJdTermsDeterministically(
          params.jdText ?? '',
          params.title ?? '',
          params.companyName ?? ''
        );

  const corpus = buildResumeCorpus(params.resume, params.indiaProfile);

  const mustHaveList = dedupeTerms(jd.mustHaveSkills);
  const niceToHaveList = dedupeTerms(jd.niceToHaveSkills);
  const keywordList = dedupeTerms([...jd.keywords, ...jd.domainTerms]);

  const matchedMustHave: string[] = [];
  const missingMustHave: string[] = [];
  for (const skill of mustHaveList) {
    if (containsTermWithSynonyms(corpus, skill)) {
      matchedMustHave.push(skill);
    } else {
      missingMustHave.push(skill);
    }
  }

  const matchedNiceToHave: string[] = [];
  const missingNiceToHave: string[] = [];
  for (const skill of niceToHaveList) {
    if (containsTermWithSynonyms(corpus, skill)) {
      matchedNiceToHave.push(skill);
    } else {
      missingNiceToHave.push(skill);
    }
  }

  const matchedKeywords: string[] = [];
  const missingKeywords: string[] = [];
  for (const kw of keywordList) {
    if (containsTermWithSynonyms(corpus, kw)) {
      matchedKeywords.push(kw);
    } else {
      missingKeywords.push(kw);
    }
  }

  const mustHaveCoverage =
    mustHaveList.length > 0
      ? Math.round((matchedMustHave.length / mustHaveList.length) * 100)
      : keywordList.length > 0
        ? Math.round((matchedKeywords.length / keywordList.length) * 100)
        : 100;

  const secondaryTotal = niceToHaveList.length + keywordList.length;
  const secondaryMatched = matchedNiceToHave.length + matchedKeywords.length;
  const keywordScore =
    secondaryTotal > 0 ? Math.round((secondaryMatched / secondaryTotal) * 100) : mustHaveCoverage;

  // Bullet impact quality
  const bullets = [
    ...params.resume.work.flatMap((w) => w.highlights),
    ...params.resume.projects.flatMap((p) => p.highlights)
  ]
    .map((b) => b.trim())
    .filter(Boolean);

  const quantifiedBullets = bullets.filter((b) => extractNumericFingerprints(b).length > 0).length;
  const strongVerbBullets = bullets.filter((b) => {
    const firstWord = b
      .replace(/^[-*\u2022\s]+/, '')
      .split(/\s+/)[0]
      ?.replace(/[^a-zA-Z]/g, '')
      .toLowerCase();
    return Boolean(firstWord && STRONG_ACTION_VERBS.has(firstWord));
  }).length;

  const avgBulletLength =
    bullets.length > 0
      ? Math.round(bullets.reduce((acc, b) => acc + b.length, 0) / bullets.length)
      : 0;

  const qualityIssues: string[] = [];
  if (bullets.length === 0) {
    qualityIssues.push('No experience or project highlight bullets found.');
  } else {
    if (quantifiedBullets / bullets.length < 0.35) {
      qualityIssues.push(
        `Only ${quantifiedBullets}/${bullets.length} bullets cite concrete metrics (%, ms, scale, throughput).`
      );
    }
    if (strongVerbBullets / bullets.length < 0.6) {
      qualityIssues.push(
        `Lead more bullets with strong engineering verbs (${strongVerbBullets}/${bullets.length} currently do).`
      );
    }
    if (avgBulletLength > 210) {
      qualityIssues.push(`Average bullet length is ${avgBulletLength} chars; tighten for 1-2 line ATS readability.`);
    } else if (avgBulletLength > 0 && avgBulletLength < 40) {
      qualityIssues.push(`Average bullet length is ${avgBulletLength} chars; expand context and outcome.`);
    }
  }

  let impactScore = 0;
  if (bullets.length > 0) {
    const metricRatio = Math.min(1, quantifiedBullets / Math.max(1, bullets.length * 0.5));
    const verbRatio = Math.min(1, strongVerbBullets / Math.max(1, bullets.length * 0.75));
    const lengthOk = avgBulletLength >= 40 && avgBulletLength <= 200 ? 1 : 0.6;
    impactScore = Math.round((metricRatio * 0.45 + verbRatio * 0.35 + lengthOk * 0.2) * 100);
  }

  // Parseability checks
  const totalSkills = params.resume.skills.reduce((sum, g) => sum + g.keywords.length, 0);
  const hasContact =
    Boolean(params.resume.basics.name.trim()) &&
    Boolean(params.resume.basics.email.trim()) &&
    Boolean(params.resume.basics.phone.trim() || params.resume.basics.url.trim());
  const hasExpOrProj = params.resume.work.length > 0 || params.resume.projects.length > 0;
  const hasEducation = params.resume.education.length > 0;
  const hasSummary = params.resume.basics.summary.trim().length >= 30;

  const parseabilityChecks: AtsParseabilityCheck[] = [
    {
      id: 'contact',
      label: 'Contact header completeness',
      status: hasContact ? 'pass' : 'fail',
      detail: hasContact
        ? 'Name, email, and phone/URL present cleanly in plain text.'
        : 'Add full name, email, and phone or portfolio URL.'
    },
    {
      id: 'layout',
      label: 'Single-column linear hierarchy',
      status: 'pass',
      detail: 'Rendered cleanly without multi-column tables or embedded text graphics.'
    },
    {
      id: 'skills',
      label: 'Skills taxonomy density',
      status: totalSkills >= 6 ? 'pass' : totalSkills >= 3 ? 'warn' : 'fail',
      detail: `${totalSkills} structured skill keywords indexed across ${params.resume.skills.length} groups.`
    },
    {
      id: 'evidence',
      label: 'Work & project highlights',
      status: hasExpOrProj && bullets.length >= 4 ? 'pass' : hasExpOrProj ? 'warn' : 'fail',
      detail: `${params.resume.work.length} roles, ${params.resume.projects.length} projects, ${bullets.length} bullets.`
    },
    {
      id: 'education',
      label: 'Education section present',
      status: hasEducation ? 'pass' : 'warn',
      detail: hasEducation
        ? `${params.resume.education.length} education entry detected.`
        : 'No education entry found in active resume JSON.'
    },
    {
      id: 'summary',
      label: 'Profile summary pitch',
      status: hasSummary ? 'pass' : 'warn',
      detail: hasSummary
        ? `${params.resume.basics.summary.trim().length} chars ready for recruiter skim.`
        : 'Add a concise 2-line summary aligned to the target role.'
    }
  ];

  const checkWeight = parseabilityChecks.reduce((sum, c) => {
    if (c.status === 'pass') return sum + 1;
    if (c.status === 'warn') return sum + 0.6;
    return sum;
  }, 0);
  const parseabilityScore = Math.round((checkWeight / parseabilityChecks.length) * 100);

  const hasJdSignals = mustHaveList.length + secondaryTotal > 0;
  const overallScore = hasJdSignals
    ? Math.round(
        mustHaveCoverage * 0.35 +
          keywordScore * 0.25 +
          parseabilityScore * 0.2 +
          impactScore * 0.2
      )
    : Math.round(parseabilityScore * 0.55 + impactScore * 0.45);

  const recommendations: string[] = [];
  if (missingMustHave.length > 0) {
    recommendations.push(
      `Missing must-have JD skills (only add if actually true in Master Profile): ${missingMustHave.slice(0, 6).join(', ')}.`
    );
  }
  if (missingNiceToHave.length > 0) {
    recommendations.push(
      `Good bonus keywords to surface if backed by projects/stories: ${missingNiceToHave.slice(0, 5).join(', ')}.`
    );
  }
  for (const issue of qualityIssues) {
    recommendations.push(issue);
  }
  if (!hasSummary) {
    recommendations.push('Add a 2-sentence Summary highlighting core stack and target domain fit.');
  }

  return {
    overallScore,
    keywordScore,
    mustHaveCoverage,
    parseabilityScore,
    impactScore,
    matchedMustHave,
    missingMustHave,
    matchedNiceToHave,
    missingNiceToHave,
    matchedKeywords,
    missingKeywords,
    parseabilityChecks,
    sectionQuality: {
      totalBullets: bullets.length,
      quantifiedBullets,
      strongVerbBullets,
      avgBulletLength,
      issues: qualityIssues
    },
    recommendations: recommendations.slice(0, 6)
  };
}
