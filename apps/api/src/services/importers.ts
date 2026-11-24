import { getDocumentProxy } from 'unpdf';
import type {
  GithubImportRequest,
  ImportPreviewCandidate,
  JsonResume,
  ResumeEducation,
  ResumeProject,
  ResumeSkillGroup,
  ResumeWork
} from '@jobpilot/shared';

type ResumeCertificate = JsonResume['certificates'][number];
type ResumeLanguage = JsonResume['languages'][number];

export class ImporterError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400
  ) {
    super(message);
    this.name = 'ImporterError';
  }
}

interface GithubUserResponse {
  login: string;
  name?: string | null;
  bio?: string | null;
  location?: string | null;
  blog?: string | null;
  html_url?: string;
}

interface GithubRepoResponse {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  homepage?: string | null;
  description?: string | null;
  fork: boolean;
  archived: boolean;
  stargazers_count: number;
  forks_count: number;
  language?: string | null;
  topics?: string[];
  pushed_at?: string;
  created_at?: string;
}

export async function importFromGithub(
  input: GithubImportRequest,
  fetchImpl: typeof fetch = fetch
): Promise<ImportPreviewCandidate> {
  const username = input.username.trim();
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'JobPilot-Profile-Importer/1.0'
  };

  const [userRes, reposRes] = await Promise.all([
    fetchImpl(`https://api.github.com/users/${encodeURIComponent(username)}`, { headers }),
    fetchImpl(
      `https://api.github.com/users/${encodeURIComponent(username)}/repos?per_page=100&sort=updated`,
      { headers }
    )
  ]);

  if (userRes.status === 404) {
    throw new ImporterError(`GitHub user "${username}" not found.`, 404);
  }
  if (!userRes.ok) {
    throw new ImporterError(`GitHub user lookup failed (${userRes.status}).`, 502);
  }
  if (!reposRes.ok) {
    throw new ImporterError(`GitHub repositories lookup failed (${reposRes.status}).`, 502);
  }

  const ghUser = (await userRes.json()) as GithubUserResponse;
  const ghRepos = (await reposRes.json()) as GithubRepoResponse[];

  const filtered = ghRepos.filter(
    (repo) => !repo.archived && (input.includeForks || !repo.fork)
  );

  const ranked = [...filtered].sort((a, b) => {
    const scoreA = a.stargazers_count * 4 + a.forks_count * 2 + (a.description ? 1 : 0);
    const scoreB = b.stargazers_count * 4 + b.forks_count * 2 + (b.description ? 1 : 0);
    if (scoreB !== scoreA) return scoreB - scoreA;
    return String(b.pushed_at ?? '').localeCompare(String(a.pushed_at ?? ''));
  });

  const selected = ranked.slice(0, input.maxRepos);
  const langCount = new Map<string, number>();
  const topicSet = new Set<string>();
  let starsTotal = 0;

  for (const repo of filtered) {
    starsTotal += repo.stargazers_count;
    if (repo.language) {
      langCount.set(repo.language, (langCount.get(repo.language) ?? 0) + 1);
    }
    for (const topic of repo.topics ?? []) {
      if (topic && topicSet.size < 16) topicSet.add(topic);
    }
  }

  const projects: ResumeProject[] = selected.map((repo) => {
    const keywords = Array.from(
      new Set(
        [repo.language ?? '', ...(repo.topics ?? [])].map((k) => k.trim()).filter(Boolean)
      )
    ).slice(0, 6);

    const highlights: string[] = [];
    if (repo.description?.trim()) {
      highlights.push(repo.description.trim());
    }
    const telemetryParts: string[] = [];
    if (repo.stargazers_count > 0) telemetryParts.push(`${repo.stargazers_count} GitHub stars`);
    if (repo.forks_count > 0) telemetryParts.push(`${repo.forks_count} forks`);
    if (repo.language) telemetryParts.push(`primary stack: ${repo.language}`);
    if (telemetryParts.length > 0) {
      highlights.push(`Open-source repository with ${telemetryParts.join(', ')}.`);
    }

    return {
      id: `gh-${repo.id}`,
      name: repo.name,
      description: repo.description?.trim() ?? '',
      highlights,
      keywords,
      startDate: repo.created_at ? repo.created_at.slice(0, 7) : '',
      endDate: repo.pushed_at ? repo.pushed_at.slice(0, 7) : '',
      url: repo.html_url,
      roles: ['Author'],
      entity: ghUser.login,
      type: 'open-source'
    };
  });

  const skills: ResumeSkillGroup[] = [];
  const topLangs = Array.from(langCount.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([lang]) => lang)
    .slice(0, 12);
  if (topLangs.length > 0) {
    skills.push({ name: 'Languages (GitHub)', level: '', keywords: topLangs });
  }
  if (topicSet.size > 0) {
    skills.push({ name: 'Ecosystem & Topics', level: '', keywords: Array.from(topicSet) });
  }

  const warnings: string[] = [];
  if (projects.length === 0) {
    warnings.push(
      `No public ${input.includeForks ? '' : 'non-fork '}repositories found for @${ghUser.login}.`
    );
  }

  return {
    source: 'github',
    sourceLabel: `github.com/${ghUser.login}`,
    fullName: ghUser.name?.trim() || undefined,
    headline: ghUser.bio?.trim() || undefined,
    locationCity: ghUser.location?.trim() || undefined,
    githubUrl: ghUser.html_url || `https://github.com/${ghUser.login}`,
    skills,
    work: [],
    projects,
    education: [],
    certificates: [],
    languages: [],
    warnings,
    stats: {
      reposFetched: filtered.length,
      starsTotal,
      pagesParsed: 0
    }
  };
}

interface PdfTextToken {
  str: string;
  x: number;
  y: number;
}

function groupPdfTokensIntoLines(tokens: PdfTextToken[]): string[] {
  if (tokens.length === 0) return [];
  const sorted = [...tokens].sort((a, b) => {
    if (Math.abs(b.y - a.y) > 3.0) return b.y - a.y;
    return a.x - b.x;
  });

  const rows: PdfTextToken[][] = [];
  for (const token of sorted) {
    const lastRow = rows[rows.length - 1];
    if (lastRow && Math.abs(lastRow[0]!.y - token.y) <= 3.2) {
      lastRow.push(token);
    } else {
      rows.push([token]);
    }
  }

  return rows
    .map((row) =>
      row
        .sort((a, b) => a.x - b.x)
        .map((t) => t.str.trim())
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter((line) => line.length > 0 && !/^Page \d+ of \d+$/i.test(line));
}

function splitSections(
  lines: string[],
  knownHeadings: RegExp[]
): Array<{ heading: string; lines: string[] }> {
  const sections: Array<{ heading: string; lines: string[] }> = [];
  let current: { heading: string; lines: string[] } = { heading: '_header', lines: [] };

  for (const line of lines) {
    const clean = line.trim();
    const matched = knownHeadings.find((re) => re.test(clean));
    if (matched) {
      sections.push(current);
      current = { heading: clean.toLowerCase(), lines: [] };
    } else {
      current.lines.push(clean);
    }
  }
  sections.push(current);
  return sections;
}

const DATE_RANGE_REGEX =
  /((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4}|\b(?:19|20)\d{2}\b)\s*[-–—to]+\s*(Present|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4}|\b(?:19|20)\d{2}\b)/i;

function parseLinkedinExperienceBlock(lines: string[]): ResumeWork[] {
  const workEntries: ResumeWork[] = [];
  let idx = 0;

  // LinkedIn format per entry typically stacks:
  // Company Name (or Title) -> Role Title -> Date Range (e.g. "May 2024 - Present (7 months)") -> optional Location -> bullet/summary lines
  for (let i = 0; i < lines.length; i++) {
    const dateMatch = lines[i]!.match(DATE_RANGE_REGEX);
    if (!dateMatch) continue;

    const startDate = dateMatch[1] ?? '';
    const endDate = dateMatch[2] ?? '';
    const lineBefore1 = i - 1 >= idx ? lines[i - 1]! : '';
    const lineBefore2 = i - 2 >= idx ? lines[i - 2]! : '';

    const companyName = lineBefore2 || lineBefore1 || 'Employer';
    const position = lineBefore2 ? lineBefore1 : 'Engineer';

    // Collect description/bullets until the next entry boundary (2 lines before next date line)
    let nextDateIdx = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      if (DATE_RANGE_REGEX.test(lines[j]!)) {
        nextDateIdx = Math.max(i + 1, j - 2);
        break;
      }
    }

    const bodyLines = lines.slice(i + 1, nextDateIdx);
    let location = '';
    const highlights: string[] = [];

    for (const b of bodyLines) {
      if (!location && highlights.length === 0 && /^[A-Za-z\s]+,\s*[A-Za-z\s]+$/.test(b) && b.length < 48) {
        location = b;
        continue;
      }
      const cleaned = b.replace(/^[•\-*\u2022]\s*/, '').trim();
      if (cleaned.length >= 6) highlights.push(cleaned);
    }

    workEntries.push({
      id: `li-work-${workEntries.length + 1}`,
      name: companyName,
      position,
      url: '',
      location,
      employmentType: 'Full-time',
      startDate,
      endDate,
      summary: '',
      highlights: highlights.slice(0, 8)
    });

    idx = nextDateIdx;
  }

  return workEntries;
}

function parseLinkedinEducationBlock(lines: string[]): ResumeEducation[] {
  const entries: ResumeEducation[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const parenYears = line.match(/\((\d{4})\s*[-–—]\s*(\d{4}|Present)\)/i) ?? line.match(DATE_RANGE_REGEX);
    if (!parenYears && i + 1 < lines.length && lines[i + 1]!.includes('·')) {
      const next = lines[i + 1]!;
      const nextDates = next.match(/\((\d{4})\s*[-–—]\s*(\d{4}|Present)\)/i) ?? next.match(DATE_RANGE_REGEX);
      const degPart = next.replace(/\(.*\)/, '').trim();
      const [studyType, area] = degPart.split('·').map((s) => s.trim());
      entries.push({
        id: `li-edu-${entries.length + 1}`,
        institution: line,
        url: '',
        area: area ?? '',
        studyType: studyType ?? '',
        startDate: nextDates?.[1] ?? '',
        endDate: nextDates?.[2] ?? '',
        score: '',
        courses: []
      });
      i += 1;
      continue;
    }

    if (parenYears) {
      const prev = i > 0 ? lines[i - 1]! : '';
      const institution = prev && !DATE_RANGE_REGEX.test(prev) ? prev : line.replace(parenYears[0], '').trim();
      const degPart = prev ? line.replace(parenYears[0], '').trim() : '';
      const [studyType, area] = degPart.split(/[·,]/).map((s) => s.trim());
      if (institution && !entries.some((e) => e.institution === institution)) {
        entries.push({
          id: `li-edu-${entries.length + 1}`,
          institution,
          url: '',
          area: area ?? '',
          studyType: studyType ?? '',
          startDate: parenYears[1] ?? '',
          endDate: parenYears[2] ?? '',
          score: '',
          courses: []
        });
      }
    }
  }
  return entries;
}

export async function parseLinkedinPdfExport(pdfBuffer: Buffer): Promise<ImportPreviewCandidate> {
  if (!pdfBuffer || pdfBuffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new ImporterError('Uploaded file does not appear to be a valid PDF.', 400);
  }

  const doc = await getDocumentProxy(new Uint8Array(pdfBuffer));
  const pagesParsed = doc.numPages;
  const sidebarTokens: PdfTextToken[] = [];
  const mainTokens: PdfTextToken[] = [];
  const SIDEBAR_SPLIT_X = 195;

  // Preserve page order using vertical offset buckets per page
  for (let p = 1; p <= pagesParsed; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();
    const pageOffsetY = (pagesParsed - p) * (viewport.height + 100);

    for (const rawItem of textContent.items) {
      if (!('str' in rawItem) || !rawItem.str.trim()) continue;
      const x = Number(rawItem.transform?.[4] ?? 0);
      const y = Number(rawItem.transform?.[5] ?? 0) + pageOffsetY;
      const token: PdfTextToken = { str: rawItem.str, x, y };
      if (x < SIDEBAR_SPLIT_X) {
        sidebarTokens.push(token);
      } else {
        mainTokens.push(token);
      }
    }
  }

  const sidebarLines = groupPdfTokensIntoLines(sidebarTokens);
  const mainLines = groupPdfTokensIntoLines(mainTokens);

  const sidebarSections = splitSections(sidebarLines, [
    /^Contact$/i,
    /^Top Skills$/i,
    /^Skills$/i,
    /^Languages$/i,
    /^Certifications$/i,
    /^Honors-Awards$/i
  ]);

  const mainSections = splitSections(mainLines, [
    /^Summary$/i,
    /^About$/i,
    /^Experience$/i,
    /^Education$/i,
    /^Projects$/i
  ]);

  const headerLines = mainSections.find((s) => s.heading === '_header')?.lines ?? [];
  const fullName = headerLines[0] || undefined;
  const headline = headerLines[1] || undefined;
  const locationCity = headerLines[2] && headerLines[2].length < 80 ? headerLines[2] : undefined;

  const summarySec = mainSections.find((s) => s.heading === 'summary' || s.heading === 'about');
  const summary = summarySec ? summarySec.lines.join(' ').trim() || undefined : undefined;

  const expSec = mainSections.find((s) => s.heading === 'experience');
  const work = expSec ? parseLinkedinExperienceBlock(expSec.lines) : [];

  const eduSec = mainSections.find((s) => s.heading === 'education');
  const education = eduSec ? parseLinkedinEducationBlock(eduSec.lines) : [];

  const skillsSec = sidebarSections.find(
    (s) => s.heading === 'top skills' || s.heading === 'skills'
  );
  const skillKeywords = (skillsSec?.lines ?? [])
    .flatMap((line) => line.split(/[,|]/))
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 45);
  const skills: ResumeSkillGroup[] =
    skillKeywords.length > 0
      ? [{ name: 'Top Skills (LinkedIn)', level: '', keywords: Array.from(new Set(skillKeywords)) }]
      : [];

  const certsSec = sidebarSections.find((s) => s.heading === 'certifications');
  const certificates: ResumeCertificate[] = (certsSec?.lines ?? [])
    .filter((l) => l.length >= 3)
    .map((name) => ({ name, date: '', issuer: 'LinkedIn Import', url: '' }));

  const langSec = sidebarSections.find((s) => s.heading === 'languages');
  const languages: ResumeLanguage[] = (langSec?.lines ?? [])
    .filter((l) => l.length >= 2)
    .map((line) => {
      const m = line.match(/^(.+?)\s*\((.+?)\)$/);
      return {
        language: m?.[1]?.trim() || line,
        fluency: m?.[2]?.trim() || ''
      };
    });

  const contactSec = sidebarSections.find((s) => s.heading === 'contact');
  const linkedinUrlLine = (contactSec?.lines ?? []).find((l) =>
    /linkedin\.com\/in\//i.test(l)
  );
  const linkedinUrl = linkedinUrlLine
    ? linkedinUrlLine.startsWith('http')
      ? linkedinUrlLine
      : `https://${linkedinUrlLine.replace(/\s*\(LinkedIn\).*$/i, '')}`
    : undefined;

  const warnings: string[] = [];
  if (work.length === 0 && education.length === 0 && skills.length === 0) {
    warnings.push(
      'Could not detect LinkedIn sections cleanly. Make sure this is LinkedIn\'s standard "Save to PDF" profile export.'
    );
  }

  return {
    source: 'linkedin',
    sourceLabel: fullName ? `LinkedIn PDF (${fullName})` : 'LinkedIn Profile PDF',
    fullName,
    headline,
    locationCity,
    summary,
    linkedinUrl,
    skills,
    work,
    projects: [],
    education,
    certificates,
    languages,
    warnings,
    stats: {
      reposFetched: 0,
      starsTotal: 0,
      pagesParsed
    }
  };
}
