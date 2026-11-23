import { spawn } from 'node:child_process';
import type { IndiaProfile, JsonResume, ResumeTemplateId } from '@jobpilot/shared';

interface PdfTextLine {
  text: string;
  font: 'F1' | 'F2';
  size: number;
  x: number;
  leading: number;
  ruleAfter?: boolean;
}

function sanitizePdfText(input: string): string {
  return input
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2022/g, '*')
    .replace(/\u20B9/g, 'INR ')
    .replace(/[^\x20-\x7E]/g, ' ');
}

function escapePdfLiteral(input: string): string {
  return sanitizePdfText(input)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function wrapText(text: string, maxChars: number): string[] {
  const words = sanitizePdfText(text).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= maxChars) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Zero-dependency pure-TypeScript single-column ATS-safe PDF 1.4 renderer.
 * Used automatically whenever the native `typst` CLI binary is unavailable.
 */
export function renderBuiltinAtsPdf(
  resume: JsonResume,
  indiaProfile?: IndiaProfile,
  templateId: ResumeTemplateId = 'ats-classic'
): { pdfBuffer: Buffer; pageCount: number } {
  const isCompact = templateId === 'ats-compact';
  const marginX = isCompact ? 38 : 46;
  const pageWidth = 595.28; // A4
  const pageHeight = 841.89;
  const bodySize = isCompact ? 9.5 : 10;
  const maxBodyChars = isCompact ? 94 : 88;

  const lines: PdfTextLine[] = [];

  lines.push({
    text: resume.basics.name || 'Candidate Name',
    font: 'F2',
    size: 16,
    x: marginX,
    leading: 20
  });

  if (resume.basics.label) {
    lines.push({
      text: resume.basics.label,
      font: 'F1',
      size: 10.5,
      x: marginX,
      leading: 14
    });
  }

  const contact = [
    resume.basics.email,
    resume.basics.phone,
    resume.basics.location?.city
      ? [resume.basics.location.city, resume.basics.location.countryCode].filter(Boolean).join(', ')
      : '',
    resume.basics.url
  ]
    .filter((s): s is string => Boolean(s && s.trim()))
    .join(' | ');

  if (contact) {
    for (const line of wrapText(contact, maxBodyChars)) {
      lines.push({ text: line, font: 'F1', size: 9, x: marginX, leading: 13 });
    }
  }

  const pushHeading = (title: string) => {
    lines.push({ text: '', font: 'F1', size: 6, x: marginX, leading: 8 });
    lines.push({
      text: title.toUpperCase(),
      font: 'F2',
      size: 10.5,
      x: marginX,
      leading: 14,
      ruleAfter: true
    });
  };

  if (resume.basics.summary?.trim()) {
    pushHeading('Summary');
    for (const line of wrapText(resume.basics.summary, maxBodyChars)) {
      lines.push({ text: line, font: 'F1', size: bodySize, x: marginX, leading: bodySize + 3.5 });
    }
  }

  if (resume.skills.length > 0) {
    pushHeading('Technical Skills');
    for (const grp of resume.skills) {
      if (grp.keywords.length === 0) continue;
      for (const line of wrapText(`${grp.name}: ${grp.keywords.join(', ')}`, maxBodyChars)) {
        lines.push({ text: line, font: 'F1', size: bodySize, x: marginX, leading: bodySize + 3.5 });
      }
    }
  }

  if (resume.work.length > 0) {
    pushHeading('Experience');
    for (const w of resume.work) {
      const dates = [w.startDate, w.endDate || 'Present'].filter(Boolean).join(' - ');
      const header = `${w.position} | ${w.name}${w.location ? ` (${w.location})` : ''} [${dates}]`;
      for (const line of wrapText(header, maxBodyChars - 4)) {
        lines.push({ text: line, font: 'F2', size: bodySize, x: marginX, leading: bodySize + 4 });
      }
      if (w.summary?.trim()) {
        for (const line of wrapText(w.summary, maxBodyChars)) {
          lines.push({ text: line, font: 'F1', size: bodySize, x: marginX, leading: bodySize + 3.5 });
        }
      }
      for (const h of w.highlights) {
        const wrapped = wrapText(`- ${h}`, maxBodyChars - 2);
        wrapped.forEach((line, idx) => {
          lines.push({
            text: line,
            font: 'F1',
            size: bodySize,
            x: idx === 0 ? marginX + 8 : marginX + 16,
            leading: bodySize + 3.5
          });
        });
      }
    }
  }

  if (resume.projects.length > 0) {
    pushHeading('Projects');
    for (const p of resume.projects) {
      const stack = (p.keywords ?? []).length > 0 ? ` (${p.keywords!.join(', ')})` : '';
      const header = `${p.name}${stack}${p.url ? ` - ${p.url}` : ''}`;
      for (const line of wrapText(header, maxBodyChars - 4)) {
        lines.push({ text: line, font: 'F2', size: bodySize, x: marginX, leading: bodySize + 4 });
      }
      if (p.description?.trim()) {
        for (const line of wrapText(p.description, maxBodyChars)) {
          lines.push({ text: line, font: 'F1', size: bodySize, x: marginX, leading: bodySize + 3.5 });
        }
      }
      for (const h of p.highlights) {
        const wrapped = wrapText(`- ${h}`, maxBodyChars - 2);
        wrapped.forEach((line, idx) => {
          lines.push({
            text: line,
            font: 'F1',
            size: bodySize,
            x: idx === 0 ? marginX + 8 : marginX + 16,
            leading: bodySize + 3.5
          });
        });
      }
    }
  }

  if (resume.education.length > 0) {
    pushHeading('Education');
    for (const e of resume.education) {
      const dates = [e.startDate, e.endDate].filter(Boolean).join(' - ');
      const deg = [e.studyType, e.area].filter(Boolean).join(' in ');
      const score = e.score ? ` | Score: ${e.score}` : '';
      const row = `${e.institution}${deg ? ` - ${deg}` : ''}${score}${dates ? ` [${dates}]` : ''}`;
      for (const line of wrapText(row, maxBodyChars - 2)) {
        lines.push({ text: line, font: 'F1', size: bodySize, x: marginX, leading: bodySize + 3.5 });
      }
    }
    if (indiaProfile?.tenthPercentage != null || indiaProfile?.twelfthPercentage != null) {
      const parts = [
        indiaProfile.twelfthPercentage != null ? `Class XII: ${indiaProfile.twelfthPercentage}%` : '',
        indiaProfile.tenthPercentage != null ? `Class X: ${indiaProfile.tenthPercentage}%` : ''
      ].filter(Boolean);
      if (parts.length > 0) {
        lines.push({
          text: parts.join(' | '),
          font: 'F1',
          size: bodySize - 0.5,
          x: marginX,
          leading: bodySize + 3
        });
      }
    }
  }

  // Paginate lines across A4 pages
  const pagesContent: string[][] = [[]];
  let cursorY = pageHeight - 48;
  const minY = 42;

  for (const item of lines) {
    if (cursorY - item.leading < minY) {
      pagesContent.push([]);
      cursorY = pageHeight - 48;
    }
    const page = pagesContent[pagesContent.length - 1]!;
    if (item.text) {
      page.push(
        `BT /${item.font} ${item.size} Tf 1 0 0 1 ${item.x.toFixed(2)} ${cursorY.toFixed(2)} Tm (${escapePdfLiteral(item.text)}) Tj ET`
      );
    }
    if (item.ruleAfter) {
      const ruleY = (cursorY - 3.5).toFixed(2);
      page.push(
        `0.5 w ${marginX.toFixed(2)} ${ruleY} m ${(pageWidth - marginX).toFixed(2)} ${ruleY} l S`
      );
      cursorY -= 5;
    }
    cursorY -= item.leading;
  }

  // Build valid PDF 1.4 objects
  const objects: string[] = [];
  // 1: Catalog, 2: Pages, 3: Helvetica, 4: Helvetica-Bold
  const pageCount = pagesContent.length;
  const pageObjectIds: number[] = [];
  const nextObjStart = 5;

  for (let i = 0; i < pageCount; i++) {
    pageObjectIds.push(nextObjStart + i * 2);
  }

  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj');
  objects.push(
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>\nendobj`
  );
  objects.push('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj');
  objects.push('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj');

  for (let i = 0; i < pageCount; i++) {
    const pageObjId = nextObjStart + i * 2;
    const contentObjId = pageObjId + 1;
    const streamData = pagesContent[i]!.join('\n');
    objects.push(
      `${pageObjId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjId} 0 R >>\nendobj`
    );
    objects.push(
      `${contentObjId} 0 obj\n<< /Length ${Buffer.byteLength(streamData, 'latin1')} >>\nstream\n${streamData}\nendstream\nendobj`
    );
  }

  let pdfStr = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdfStr, 'latin1'));
    pdfStr += `${obj}\n`;
  }
  const xrefPos = Buffer.byteLength(pdfStr, 'latin1');
  pdfStr += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdfStr += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdfStr += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;

  return {
    pdfBuffer: Buffer.from(pdfStr, 'latin1'),
    pageCount
  };
}

async function compileWithTypstCli(
  typstSource: string,
  typstBin: string
): Promise<Buffer | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (buf: Buffer | null) => {
      if (!settled) {
        settled = true;
        resolve(buf);
      }
    };

    try {
      const child = spawn(typstBin, ['compile', '-', '-'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      const stdoutChunks: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
      child.stdin.on('error', () => finish(null));
      child.on('error', () => finish(null));
      child.on('close', (code) => {
        if (code === 0 && stdoutChunks.length > 0) {
          finish(Buffer.concat(stdoutChunks));
        } else {
          finish(null);
        }
      });

      child.stdin.write(typstSource, 'utf8');
      child.stdin.end();
    } catch {
      finish(null);
    }
  });
}

export async function renderAtsPdf(params: {
  typstSource: string;
  jsonResume: JsonResume;
  indiaProfile?: IndiaProfile;
  templateId?: ResumeTemplateId;
  typstBin?: string;
}): Promise<{ pdfBuffer: Buffer; engine: 'typst' | 'builtin-ats-pdf'; pageCount: number }> {
  const typstBin = params.typstBin ?? process.env['TYPST_BIN'] ?? 'typst';
  const typstBuffer = await compileWithTypstCli(params.typstSource, typstBin);
  if (typstBuffer && typstBuffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    return { pdfBuffer: typstBuffer, engine: 'typst', pageCount: 1 };
  }

  const builtin = renderBuiltinAtsPdf(
    params.jsonResume,
    params.indiaProfile,
    params.templateId ?? 'ats-classic'
  );
  return {
    pdfBuffer: builtin.pdfBuffer,
    engine: 'builtin-ats-pdf',
    pageCount: builtin.pageCount
  };
}
