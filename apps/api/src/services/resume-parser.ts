import { extractText, getDocumentProxy } from 'unpdf';
import {
  ParsedResumeOutputSchema,
  type ParsedResumeOutput
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
  const result = await extractText(pdf, { mergePages: true });
  const text = typeof result.text === 'string' ? result.text.trim() : '';

  if (text.length < 40) {
    throw new ResumeParseError(
      'Could not extract selectable text from this PDF (it may be scanned or image-only). Please upload a text-based PDF resume.',
      422
    );
  }

  return {
    text,
    totalPages: result.totalPages
  };
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
    'You are an accurate resume parser that outputs JSON Resume + Indian academic/employment signals.',
    'STRICT GROUNDING RULES:',
    '1. Extract ONLY facts explicitly present in the provided resume text.',
    '2. NEVER invent companies, dates, job titles, GPAs, percentages, metrics, or skills.',
    '3. Assign deterministic IDs like "work-1", "edu-1", "proj-1" to work, education, and projects items.',
    '4. If a field is absent, leave it empty ("") or null/[] as defined by the schema.',
    '5. Normalize India signals when present (e.g. CGPA + cgpaScale 10 or 4, 10th/12th percentages, collegeName, degree, branch, graduationYear, fresher status).'
  ].join('\n');

  const userPrompt = [
    'Parse the following extracted resume text into the structured JSON schema:',
    '',
    '--- RESUME TEXT START ---',
    truncatedText,
    '--- RESUME TEXT END ---'
  ].join('\n');

  const llmResult = await params.provider.generateStructured({
    schema: ParsedResumeOutputSchema,
    schemaName: 'parsed_resume_output',
    systemPrompt,
    userPrompt,
    model: params.model,
    temperature: 0,
    maxTokens: 4096,
    taskType: 'resume_parse'
  });

  return {
    parsed: ensureStableIds(llmResult.data),
    extractedTextLength: text.length,
    totalPages,
    modelUsed: llmResult.model,
    latencyMs: llmResult.latencyMs
  };
}
