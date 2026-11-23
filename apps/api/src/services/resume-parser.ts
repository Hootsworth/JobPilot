import { extractText, getDocumentProxy } from 'unpdf';
import { z } from 'zod';
import {
  ParsedResumeOutputSchema,
  type ParsedResumeOutput,
  type ResumeEducation,
  type ResumeProject,
  type ResumeSkillGroup
} from '@jobpilot/shared';
import type { LlmProvider } from '@jobpilot/llm';

export const MAX_RESUME_PDF_BYTES = 10 * 1024 * 1024; // 10 MB

export class ResumeParseError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = 'ResumeParseError';
    this.statusCode = statusCode;
  }
}

/**
 * Strict extraction schema without `.default([])` on major sections so Gemini `responseSchema`
 * and OpenAI `json_schema` treat `work`, `education`, `projects`, `skills`, and `extractedIndiaSignals`
 * as REQUIRED fields in constrained decoding instead of omitting them.
 */
const StrictLlmResumeExtractionSchema = z.object({
  fullName: z.string(),
  email: z.string(),
  phone: z.string(),
  jsonResume: z.object({
    basics: z.object({
      name: z.string(),
      label: z.string(),
      email: z.string(),
      phone: z.string(),
      url: z.string(),
      summary: z.string(),
      location: z.object({
        city: z.string(),
        region: z.string(),
        countryCode: z.string()
      }),
      profiles: z.array(
        z.object({
          network: z.string(),
          username: z.string(),
          url: z.string()
        })
      )
    }),
    work: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        position: z.string(),
        location: z.string(),
        employmentType: z.string(),
        startDate: z.string(),
        endDate: z.string(),
        summary: z.string(),
        highlights: z.array(z.string())
      })
    ),
    education: z.array(
      z.object({
        id: z.string(),
        institution: z.string(),
        area: z.string(),
        studyType: z.string(),
        startDate: z.string(),
        endDate: z.string(),
        score: z.string(),
        courses: z.array(z.string())
      })
    ),
    projects: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string(),
        highlights: z.array(z.string()),
        keywords: z.array(z.string()),
        startDate: z.string(),
        endDate: z.string(),
        url: z.string()
      })
    ),
    skills: z.array(
      z.object({
        name: z.string(),
        level: z.string(),
        keywords: z.array(z.string())
      })
    ),
    awards: z
      .array(
        z.object({
          title: z.string(),
          date: z.string(),
          awarder: z.string(),
          summary: z.string()
        })
      )
      .optional(),
    certificates: z
      .array(
        z.object({
          name: z.string(),
          date: z.string(),
          issuer: z.string(),
          url: z.string()
        })
      )
      .optional()
  }),
  extractedIndiaSignals: z.object({
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
  }),
  extractionNotes: z.array(z.string()).optional()
});

interface PdfTextItemLike {
  str?: string;
  transform?: number[];
  hasEOL?: boolean;
}

/**
 * Extracts text from a PDF while preserving visual line breaks using PDF.js Y-coordinates.
 * Standard `extractText(pdf, { mergePages: true })` joins all spans with spaces into a single
 * run-on line, which causes LLMs to miss EDUCATION, PROJECTS, and SKILLS boundaries.
 */
async function extractLayoutPreservingText(
  pdf: Awaited<ReturnType<typeof getDocumentProxy>>
): Promise<string> {
  const numPages = typeof pdf.numPages === 'number' ? pdf.numPages : 0;
  if (numPages <= 0 || typeof pdf.getPage !== 'function') {
    return '';
  }

  const pageTexts: string[] = [];
  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const rawItems = (content?.items ?? []) as PdfTextItemLike[];
    if (rawItems.length === 0) continue;

    // Group items into visual lines by Y coordinate (tolerance: 2.5pt)
    const lines: Array<{ y: number; items: Array<{ x: number; str: string }> }> = [];
    for (const item of rawItems) {
      const str = typeof item.str === 'string' ? item.str : '';
      if (!str.trim() && !item.hasEOL) continue;
      const transform = Array.isArray(item.transform) ? item.transform : [];
      const x = typeof transform[4] === 'number' ? transform[4] : 0;
      const y = typeof transform[5] === 'number' ? transform[5] : 0;

      let targetLine = lines.find((l) => Math.abs(l.y - y) <= 2.5);
      if (!targetLine) {
        targetLine = { y, items: [] };
        lines.push(targetLine);
      }
      targetLine.items.push({ x, str });
    }

    // Sort lines top-to-bottom (higher Y is higher on PDF page) and left-to-right within each line
    lines.sort((a, b) => b.y - a.y);
    const renderedLines = lines
      .map((line) => {
        line.items.sort((a, b) => a.x - b.x);
        return line.items
          .map((i) => i.str.trim())
          .filter(Boolean)
          .join(' ')
          .replace(/\s{2,}/g, ' ')
          .trim();
      })
      .filter(Boolean);

    if (renderedLines.length > 0) {
      pageTexts.push(renderedLines.join('\n'));
    }
  }

  return pageTexts.join('\n\n').trim();
}

export async function extractPdfTextFromBuffer(buffer: Buffer): Promise<{
  text: string;
  totalPages: number;
}> {
  if (buffer.length === 0) {
    throw new ResumeParseError('Uploaded PDF file is empty.', 400);
  }
  if (buffer.length > MAX_RESUME_PDF_BYTES) {
    throw new ResumeParseError('PDF file exceeds the 10 MB maximum size limit.', 413);
  }
  const header = buffer.subarray(0, 5).toString('ascii');
  if (header !== '%PDF-') {
    throw new ResumeParseError('Invalid file signature: expected a valid PDF document (%PDF-).', 400);
  }

  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  let layoutText = '';
  try {
    layoutText = await extractLayoutPreservingText(pdf);
  } catch {
    layoutText = '';
  }

  const fallbackResult = await extractText(pdf, { mergePages: true });
  const fallbackText = typeof fallbackResult.text === 'string' ? fallbackResult.text.trim() : '';
  const text = layoutText.length >= 40 ? layoutText : fallbackText;

  if (text.length < 40) {
    throw new ResumeParseError(
      'Could not extract selectable text from this PDF (it may be scanned or image-only). Please upload a text-based PDF resume.',
      422
    );
  }

  return {
    text,
    totalPages: fallbackResult.totalPages || pdf.numPages || 1
  };
}

const SECTION_HEADER_PATTERNS: Array<{
  section: 'education' | 'projects' | 'skills' | 'work' | 'achievements' | 'other';
  regex: RegExp;
}> = [
  {
    section: 'education',
    regex:
      /^(?:education|academic\s+details|academic\s+qualifications|academics|educational\s+qualification|scholastic\s+achievements)$/i
  },
  {
    section: 'projects',
    regex:
      /^(?:projects|key\s+projects|personal\s+projects|academic\s+projects|selected\s+projects|major\s+projects|technical\s+projects)$/i
  },
  {
    section: 'skills',
    regex:
      /^(?:skills|technical\s+skills|core\s+competencies|technologies|skills\s*&\s*interests|programming\s+skills|tech\s+stack)$/i
  },
  {
    section: 'work',
    regex:
      /^(?:experience|work\s+experience|professional\s+experience|internships|employment|positions\s+of\s+responsibility)$/i
  },
  {
    section: 'achievements',
    regex:
      /^(?:achievements|awards|honors|certifications|extracurricular|publications|coursework|relevant\s+coursework)$/i
  }
];

function splitIntoResumeSections(text: string): Record<string, string[]> {
  const sections: Record<string, string[]> = {
    header: [],
    education: [],
    projects: [],
    skills: [],
    work: [],
    achievements: []
  };

  let current = 'header';
  const rawLines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of rawLines) {
    const cleanedHeading = line.replace(/^[\s•\-–—*#|:]+|[\s•\-–—*#|:]+$/g, '').trim();
    const matched = SECTION_HEADER_PATTERNS.find(
      (p) => cleanedHeading.length <= 42 && p.regex.test(cleanedHeading)
    );
    if (matched) {
      current = matched.section;
      continue;
    }
    sections[current]?.push(line);
  }

  return sections;
}

function parseFallbackSkills(lines: string[], fullText: string): ResumeSkillGroup[] {
  const groups: ResumeSkillGroup[] = [];
  const sourceLines = lines.length > 0 ? lines : [];

  for (const line of sourceLines) {
    const cleaned = line.replace(/^[•◦▪\-*]\s*/, '').trim();
    const colonIdx = cleaned.indexOf(':');
    if (colonIdx > 0 && colonIdx < 38) {
      const category = cleaned.slice(0, colonIdx).trim();
      const rest = cleaned.slice(colonIdx + 1).trim();
      const keywords = rest
        .split(/[,|•/]+/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 1 && s.length <= 45);
      if (keywords.length > 0) {
        groups.push({ name: category, level: '', keywords });
      }
    } else {
      const tokens = cleaned
        .split(/[,|•]+/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 2 && s.length <= 40);
      if (tokens.length >= 2) {
        groups.push({
          name: groups.length === 0 ? 'Technical Skills' : `Skills ${groups.length + 1}`,
          level: '',
          keywords: tokens
        });
      }
    }
  }

  if (groups.length > 0) return groups;

  // Fallback scan for well-known CS / engineering skills in the resume text
  const knownSkills = [
    'Python',
    'JavaScript',
    'TypeScript',
    'Java',
    'C++',
    'C',
    'Go',
    'Rust',
    'SQL',
    'HTML',
    'CSS',
    'React',
    'Next.js',
    'Node.js',
    'Express',
    'FastAPI',
    'Fastify',
    'Django',
    'Flask',
    'Spring Boot',
    'Tailwind CSS',
    'PostgreSQL',
    'MySQL',
    'MongoDB',
    'Redis',
    'Supabase',
    'Firebase',
    'Docker',
    'Kubernetes',
    'AWS',
    'GCP',
    'Git',
    'Linux',
    'GraphQL',
    'PyTorch',
    'TensorFlow',
    'Scikit-learn',
    'Pandas',
    'NumPy'
  ];

  const detected = knownSkills.filter((skill) => {
    const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^a-zA-Z0-9])${escaped}(?:$|[^a-zA-Z0-9])`, 'i').test(fullText);
  });

  if (detected.length > 0) {
    return [{ name: 'Technical Skills', level: '', keywords: detected }];
  }
  return [];
}

function parseFallbackEducation(lines: string[], fullText: string): ResumeEducation[] {
  const results: ResumeEducation[] = [];
  const candidateLines =
    lines.length > 0
      ? lines
      : fullText
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) =>
            /\b(B\.?\s*Tech|B\.?\s*E\.?|M\.?\s*Tech|M\.?\s*S\.?|B\.?\s*Sc|MCA|BCA|Bachelor|Master|Indian Institute|National Institute|IIT|NIT|IIIT|BITS|University|Institute of Technology|College of Engineering|Class\s*XII|Class\s*X|12th|10th|CBSE|ICSE)\b/i.test(
              l
            )
          );

  let currentEdu: ResumeEducation | null = null;

  for (const rawLine of candidateLines) {
    const line = rawLine.replace(/^[•◦▪\-*]\s*/, '').trim();
    if (!line) continue;

    const isInstitutionOrDegree =
      /\b(Institute|University|College|School|IIT|NIT|IIIT|BITS|Vidyalaya|Academy|B\.?\s*Tech|B\.?\s*E\.?|M\.?\s*Tech|B\.?\s*Sc|M\.?\s*Sc|BCA|MCA|Bachelor|Master|Class\s*XII|Class\s*X|Senior Secondary|Secondary)\b/i.test(
        line
      );

    const scoreMatch = line.match(
      /(?:CGPA|GPA|CPI|Percentage|Score)?\s*[:\-]?\s*(\d{1,2}(?:\.\d{1,2})?\s*(?:\/\s*10|\/\s*4|%))/i
    );
    const yearRangeMatch = line.match(
      /\b((?:19|20)\d{2})\s*[–—\-to]+\s*((?:19|20)\d{2}|Present|Expected|Current)\b/i
    );
    const singleYearMatch = line.match(/\b((?:20)\d{2})\b/);
    const degreeMatch = line.match(
      /\b(B\.?\s*Tech|B\.?\s*E\.?|M\.?\s*Tech|M\.?\s*E\.?|B\.?\s*Sc|M\.?\s*Sc|BCA|MCA|MBA|Ph\.?D|Bachelor of [A-Za-z ]+|Master of [A-Za-z ]+|Class\s*XII|Class\s*X|12th|10th)\b/i
    );
    const branchMatch = line.match(
      /\b(Computer Science(?: and Engineering|\s*&\s*Engineering)?|Information Technology|Electronics(?: and Communication)?|Electrical Engineering|Mechanical Engineering|Artificial Intelligence|Data Science|Mathematics and Computing|CSE|ECE|IT)\b/i
    );

    if (isInstitutionOrDegree && (!currentEdu || /\b(Institute|University|College|School|IIT|NIT|IIIT|BITS)\b/i.test(line))) {
      if (currentEdu) {
        results.push(currentEdu);
      }
      currentEdu = {
        id: `edu-${results.length + 1}`,
        institution: line
          .replace(/\b((?:19|20)\d{2})\s*[–—\-to]+\s*((?:19|20)\d{2}|Present|Expected)\b/gi, '')
          .trim(),
        url: '',
        studyType: degreeMatch?.[1]?.trim() ?? '',
        area: branchMatch?.[1]?.trim() ?? '',
        startDate: yearRangeMatch?.[1] ?? '',
        endDate: yearRangeMatch?.[2] ?? singleYearMatch?.[1] ?? '',
        score: scoreMatch?.[1]?.trim() ?? '',
        courses: []
      };
    } else if (currentEdu) {
      if (!currentEdu.studyType && degreeMatch?.[1]) {
        currentEdu.studyType = degreeMatch[1].trim();
      }
      if (!currentEdu.area && branchMatch?.[1]) {
        currentEdu.area = branchMatch[1].trim();
      }
      if (!currentEdu.score && scoreMatch?.[1]) {
        currentEdu.score = scoreMatch[1].trim();
      }
      if (!currentEdu.startDate && yearRangeMatch?.[1]) {
        currentEdu.startDate = yearRangeMatch[1];
        currentEdu.endDate = yearRangeMatch[2] ?? currentEdu.endDate;
      } else if (!currentEdu.endDate && singleYearMatch?.[1]) {
        currentEdu.endDate = singleYearMatch[1];
      }
    }
  }

  if (currentEdu) {
    results.push(currentEdu);
  }
  return results;
}

function parseFallbackProjects(lines: string[]): ResumeProject[] {
  if (lines.length === 0) return [];
  const projects: ResumeProject[] = [];
  let current: ResumeProject | null = null;

  for (const rawLine of lines) {
    const isBullet = /^[•◦▪\-*]\s+/.test(rawLine);
    const cleaned = rawLine.replace(/^[•◦▪\-*]\s+/, '').trim();
    if (!cleaned) continue;

    // A non-bullet line or a line with "Project Name | Tech1, Tech2" starts a project
    const hasPipeOrDash = /^[^•◦▪]{3,65}\s+[|—–-]\s+.+$/.test(rawLine);
    const looksLikeProjectHeader =
      !isBullet && (hasPipeOrDash || (cleaned.length <= 75 && !cleaned.endsWith('.')));

    if (looksLikeProjectHeader) {
      if (current) projects.push(current);
      const parts = cleaned.split(/\s*[|—–]\s*/);
      const title = (parts[0] ?? cleaned).trim();
      const techPart = parts[1] ?? '';
      const keywords = techPart
        ? techPart
            .split(/[,/]+/)
            .map((k) => k.trim())
            .filter((k) => k.length > 0 && k.length <= 35)
        : [];
      current = {
        id: `proj-${projects.length + 1}`,
        name: title,
        description: '',
        highlights: [],
        keywords,
        startDate: '',
        endDate: '',
        url: '',
        roles: [],
        entity: '',
        type: ''
      };
    } else if (current) {
      current.highlights.push(cleaned);
      if (!current.description) {
        current.description = cleaned;
      }
    } else {
      current = {
        id: `proj-${projects.length + 1}`,
        name: cleaned.slice(0, 60),
        description: cleaned,
        highlights: [cleaned],
        keywords: [],
        startDate: '',
        endDate: '',
        url: '',
        roles: [],
        entity: '',
        type: ''
      };
    }
  }

  if (current) projects.push(current);
  return projects;
}

/**
 * Deterministic safety net: if the LLM omitted or returned empty arrays for
 * `education`, `projects`, `skills`, or India signals that are clearly present
 * in the extracted PDF text, supplement them deterministically.
 */
export function supplementParsedResumeFromText(
  parsed: ParsedResumeOutput,
  text: string
): ParsedResumeOutput {
  const sections = splitIntoResumeSections(text);
  const next = structuredClone(parsed);

  // 1. Contact basics fallback
  if (!next.email) {
    const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (emailMatch?.[0]) {
      next.email = emailMatch[0];
      next.jsonResume.basics.email = next.jsonResume.basics.email || emailMatch[0];
    }
  }
  if (!next.phone) {
    const phoneMatch = text.match(/(?:\+91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}/);
    if (phoneMatch?.[0]) {
      next.phone = phoneMatch[0].trim();
      next.jsonResume.basics.phone = next.jsonResume.basics.phone || next.phone;
    }
  }

  // 2. Supplement Education if empty
  if (next.jsonResume.education.length === 0) {
    const fallbackEdu = parseFallbackEducation(sections['education'] ?? [], text);
    if (fallbackEdu.length > 0) {
      next.jsonResume.education = fallbackEdu;
    }
  }

  // 3. Supplement Projects if empty
  if (next.jsonResume.projects.length === 0) {
    const fallbackProj = parseFallbackProjects(sections['projects'] ?? []);
    if (fallbackProj.length > 0) {
      next.jsonResume.projects = fallbackProj;
    }
  }

  // 4. Supplement Skills if empty
  if (next.jsonResume.skills.length === 0) {
    const fallbackSkills = parseFallbackSkills(sections['skills'] ?? [], text);
    if (fallbackSkills.length > 0) {
      next.jsonResume.skills = fallbackSkills;
    }
  }

  // 5. Supplement India signals from parsed education + regex if missing
  const primaryEdu = next.jsonResume.education[0];
  if (primaryEdu) {
    if (!next.extractedIndiaSignals.collegeName && primaryEdu.institution) {
      next.extractedIndiaSignals.collegeName = primaryEdu.institution;
    }
    if (!next.extractedIndiaSignals.degree && primaryEdu.studyType) {
      next.extractedIndiaSignals.degree = primaryEdu.studyType;
    }
    if (!next.extractedIndiaSignals.branch && primaryEdu.area) {
      next.extractedIndiaSignals.branch = primaryEdu.area;
    }
    if (next.extractedIndiaSignals.graduationYear == null && primaryEdu.endDate) {
      const yr = Number.parseInt(primaryEdu.endDate.replace(/\D/g, '').slice(-4), 10);
      if (yr >= 1990 && yr <= 2035) {
        next.extractedIndiaSignals.graduationYear = yr;
      }
    }
  }

  if (next.extractedIndiaSignals.cgpa == null) {
    const cgpaMatch = text.match(/(?:CGPA|CPI|GPA)\s*[:\-]?\s*(\d(?:\.\d{1,2})?)\s*(?:\/\s*10)?/i);
    if (cgpaMatch?.[1]) {
      const val = Number.parseFloat(cgpaMatch[1]);
      if (val > 0 && val <= 10) {
        next.extractedIndiaSignals.cgpa = val;
        next.extractedIndiaSignals.cgpaScale = val <= 4 ? 4 : 10;
      }
    }
  }

  return next;
}

function ensureStableIds(parsed: ParsedResumeOutput): ParsedResumeOutput {
  return {
    ...parsed,
    jsonResume: {
      ...parsed.jsonResume,
      work: parsed.jsonResume.work.map((w, idx) => ({
        ...w,
        id: w.id?.trim() || `work-${idx + 1}`
      })),
      education: parsed.jsonResume.education.map((e, idx) => ({
        ...e,
        id: e.id?.trim() || `edu-${idx + 1}`
      })),
      projects: parsed.jsonResume.projects.map((p, idx) => ({
        ...p,
        id: p.id?.trim() || `proj-${idx + 1}`
      }))
    }
  };
}

export async function parseResumePdfWithLlm(params: {
  buffer: Buffer;
  provider: LlmProvider;
  model?: string;
}): Promise<{
  parsed: ParsedResumeOutput;
  extractedTextLength: number;
  totalPages: number;
  modelUsed: string;
  latencyMs: number;
}> {
  const { text, totalPages } = await extractPdfTextFromBuffer(params.buffer);
  const truncatedText = text.slice(0, 28_000);

  const systemPrompt = [
    'You are an expert technical resume parser for software engineering and Indian + global university resumes.',
    'You MUST extract EVERY section present in the resume text into the JSON schema:',
    '1. `jsonResume.basics`: name, label/headline, email, phone, url, summary, location, and social profiles (GitHub, LinkedIn, Portfolio, LeetCode, Codeforces).',
    '2. `jsonResume.education`: MUST include every university, college, and school (12th/10th) entry found under Education/Academics, including institution name, studyType (e.g. B.Tech, M.Tech, Class XII), area/branch (e.g. Computer Science), startDate, endDate, score (CGPA or percentage), and courses.',
    '3. `jsonResume.projects`: MUST include every project found under Projects / Personal Projects / Academic Projects, including project name, one-line description, all bullet points in `highlights`, tech stack tools/languages in `keywords`, dates, and links.',
    '4. `jsonResume.skills`: MUST include all technical skills grouped by category (e.g. Languages, Frameworks & Libraries, Databases, Cloud & DevOps, Developer Tools, Core CS) with each individual skill inside `keywords`.',
    '5. `jsonResume.work`: MUST include all internships, full-time roles, research roles, and positions of responsibility, with company/organization `name`, `position`, `startDate`, `endDate`, and all bullet points in `highlights`.',
    '6. `extractedIndiaSignals`: populate `collegeName`, `degree`, `branch`, `graduationYear`, `cgpa` (numeric), `cgpaScale` (10 or 4), `tenthPercentage`, `twelfthPercentage`, and `isFresher`.',
    'STRICT GROUNDING: Extract only facts from the resume text. Never leave `education`, `projects`, or `skills` empty if those sections exist in the resume text.'
  ].join('\n');

  const userPrompt = [
    'Parse ALL sections (Basics, Work/Internships, Education, Projects, Technical Skills, Awards/Certifications, and India Signals) from the following resume text:',
    '',
    '--- RESUME TEXT START ---',
    truncatedText,
    '--- RESUME TEXT END ---'
  ].join('\n');

  const llmResult = await params.provider.generateStructured({
    schema: StrictLlmResumeExtractionSchema,
    schemaName: 'parsed_resume_output',
    systemPrompt,
    userPrompt,
    model: params.model,
    temperature: 0,
    maxTokens: 8192,
    taskType: 'resume_parse'
  });

  const normalized = ParsedResumeOutputSchema.parse(llmResult.data);
  const supplemented = supplementParsedResumeFromText(normalized, text);

  return {
    parsed: ensureStableIds(supplemented),
    extractedTextLength: text.length,
    totalPages,
    modelUsed: llmResult.model,
    latencyMs: llmResult.latencyMs
  };
}
