import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { MemoryDataStore } from '../store/memory-store.js';

function buildTwoColumnLinkedinPdf(): Buffer {
  const ops: string[] = [];
  const pushText = (x: number, y: number, text: string) => {
    const safe = text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    ops.push(`BT /F1 10 Tf 1 0 0 1 ${x} ${y} Tm (${safe}) Tj ET`);
  };

  // Left sidebar (x = 40 < 195)
  pushText(40, 760, 'Contact');
  pushText(40, 742, 'www.linkedin.com/in/aarav-sharma');
  pushText(40, 710, 'Top Skills');
  pushText(40, 692, 'TypeScript');
  pushText(40, 676, 'PostgreSQL');
  pushText(40, 660, 'Docker');
  pushText(40, 630, 'Certifications');
  pushText(40, 612, 'AWS Certified Developer');

  // Right main column (x = 220 >= 195)
  pushText(220, 760, 'Aarav Sharma');
  pushText(220, 742, 'Senior Backend Engineer');
  pushText(220, 724, 'Bengaluru, India');
  pushText(220, 692, 'Summary');
  pushText(220, 674, 'Distributed backend developer focused on Node.js and Postgres.');
  pushText(220, 640, 'Experience');
  pushText(220, 620, 'FinGrid Systems');
  pushText(220, 604, 'Backend Engineer');
  pushText(220, 588, 'Jan 2023 - Present (2 years)');
  pushText(220, 570, '- Cut checkout p95 latency by 38% via Redis read-through cache.');
  pushText(220, 535, 'Education');
  pushText(220, 515, 'NIT Trichy');
  pushText(220, 499, 'B.Tech · Computer Science (2018 - 2022)');

  const stream = ops.join('\n');
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj',
    '2 0 obj\n<< /Type /Pages /Kids [4 0 R] /Count 1 >>\nendobj',
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj',
    '4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>\nendobj',
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream\nendobj`
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${obj}\n`;
  }
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

describe('Phase 7 Expansion API routes (#1, #2, #6, #8, #9)', () => {
  async function createTestApp(customFetch?: typeof fetch) {
    const store = new MemoryDataStore();
    const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const app = await buildApp({
      config: loadConfig({
        NODE_ENV: 'test',
        APP_ENCRYPTION_KEY: randomBytes(32).toString('hex')
      }),
      store,
      authVerifier: {
        verifyToken: async (jwt) =>
          jwt === 'valid-jwt' ? { id: userId, email: 'aarav@example.com', fullName: 'Aarav Sharma' } : null
      },
      fetchImpl: customFetch,
      enableLogger: false
    });
    return { app, store, userId };
  }

  it('manages profile variants CRUD, syncs default variant to master profile, and prevents deleting last variant', async () => {
    const { app } = await createTestApp();
    const headers = { authorization: 'Bearer valid-jwt' };

    const listRes1 = await app.inject({ method: 'GET', url: '/api/profiles/variants', headers });
    expect(listRes1.statusCode).toBe(200);
    const initialVariants = listRes1.json();
    expect(initialVariants).toHaveLength(1);
    expect(initialVariants[0].isDefault).toBe(true);

    // Cannot delete last variant
    const delLast = await app.inject({
      method: 'DELETE',
      url: `/api/profiles/variants/${initialVariants[0].id}`,
      headers
    });
    expect(delLast.statusCode).toBe(400);

    // Upgrade to Pro (allows up to 3 profile variants) before creating a second variant
    const upgradeRes = await app.inject({
      method: 'POST',
      url: '/api/billing/checkout',
      headers,
      payload: { kind: 'plan', planId: 'pro', currency: 'INR' }
    });
    expect(upgradeRes.statusCode).toBe(200);

    // Create a second variant marked default with backend-specific skills
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/profiles/variants',
      headers,
      payload: {
        name: 'Backend Go/Node',
        targetRole: 'Backend Software Engineer',
        isDefault: true,
        jsonResume: {
          basics: {
            name: 'Aarav Sharma',
            label: 'Backend Software Engineer',
            email: 'aarav@example.com',
            summary: 'Backend systems engineer working on Node.js, PostgreSQL, and Go.'
          },
          skills: [
            { name: 'Backend', level: '', keywords: ['TypeScript', 'Node.js', 'PostgreSQL', 'Docker', 'Redis', 'Go'] }
          ],
          work: [
            {
              id: 'w-1',
              name: 'FinGrid',
              position: 'Backend Engineer',
              startDate: '2024-01',
              endDate: 'Present',
              highlights: ['Cut checkout latency by 38% via PostgreSQL read replicas and Redis.']
            }
          ]
        }
      }
    });
    expect(createRes.statusCode).toBe(201);
    const backendVariant = createRes.json();
    expect(backendVariant.isDefault).toBe(true);
    expect(backendVariant.slug).toBe('backend-go-node');

    // Confirm parent /api/profile synced with new active default variant
    const profileRes = await app.inject({ method: 'GET', url: '/api/profile', headers });
    expect(profileRes.statusCode).toBe(200);
    expect(profileRes.json().jsonResume.basics.label).toBe('Backend Software Engineer');

    // Delete first variant cleanly now that 2 exist
    const delFirst = await app.inject({
      method: 'DELETE',
      url: `/api/profiles/variants/${initialVariants[0].id}`,
      headers
    });
    expect(delFirst.statusCode).toBe(200);
    await app.close();
  });

  it('imports GitHub public repos and 2-column LinkedIn PDF exports cleanly', async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/users/aarav')) {
        return new Response(
          JSON.stringify({
            login: 'aarav',
            name: 'Aarav Sharma',
            bio: 'Distributed systems builder',
            location: 'Bengaluru',
            html_url: 'https://github.com/aarav'
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify([
          {
            id: 101,
            name: 'fast-queue',
            full_name: 'aarav/fast-queue',
            html_url: 'https://github.com/aarav/fast-queue',
            description: 'High-throughput Postgres SKIP LOCKED job queue',
            fork: false,
            archived: false,
            stargazers_count: 142,
            forks_count: 19,
            language: 'TypeScript',
            topics: ['postgresql', 'queue', 'nodejs'],
            created_at: '2024-03-01T00:00:00Z',
            pushed_at: '2026-01-10T00:00:00Z'
          }
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    };

    const { app } = await createTestApp(mockFetch);
    const headers = { authorization: 'Bearer valid-jwt' };

    const ghRes = await app.inject({
      method: 'POST',
      url: '/api/profile/import/github',
      headers,
      payload: { username: 'aarav', maxRepos: 5 }
    });
    expect(ghRes.statusCode).toBe(200);
    const ghBody = ghRes.json();
    expect(ghBody.source).toBe('github');
    expect(ghBody.projects).toHaveLength(1);
    expect(ghBody.projects[0].name).toBe('fast-queue');
    expect(ghBody.stats.starsTotal).toBe(142);

    // LinkedIn 2-column PDF multipart upload
    const pdfBuf = buildTwoColumnLinkedinPdf();
    const boundary = '----JobPilotTestBoundary';
    const partHeader = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="Profile.pdf"\r\nContent-Type: application/pdf\r\n\r\n`
    );
    const partFooter = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([partHeader, pdfBuf, partFooter]);

    const liRes = await app.inject({
      method: 'POST',
      url: '/api/profile/import/linkedin-pdf',
      headers: {
        authorization: 'Bearer valid-jwt',
        'content-type': `multipart/form-data; boundary=${boundary}`
      },
      payload: body
    });
    expect(liRes.statusCode).toBe(200);
    const liBody = liRes.json();
    expect(liBody.fullName).toBe('Aarav Sharma');
    expect(liBody.work.length).toBeGreaterThanOrEqual(1);
    expect(liBody.education.length).toBeGreaterThanOrEqual(1);
    expect(liBody.skills[0].keywords).toEqual(
      expect.arrayContaining(['TypeScript', 'PostgreSQL', 'Docker'])
    );
    expect(liBody.certificates[0].name).toContain('AWS Certified Developer');

    await app.close();
  });

  it('computes instant ATS score, generates & updates cover letters with inline PDF, and links coverLetterId on tracker apps', async () => {
    const { app } = await createTestApp();
    const headers = { authorization: 'Bearer valid-jwt' };

    await app.inject({
      method: 'PUT',
      url: '/api/profile',
      headers,
      payload: {
        fullName: 'Aarav Sharma',
        email: 'aarav@example.com',
        phone: '+91-9876543210',
        jsonResume: {
          basics: {
            name: 'Aarav Sharma',
            label: 'Backend Engineer',
            email: 'aarav@example.com',
            phone: '+91-9876543210',
            summary: 'Backend software engineer shipping Node.js and PostgreSQL APIs.'
          },
          skills: [
            { name: 'Stack', level: '', keywords: ['TypeScript', 'Node.js', 'PostgreSQL', 'Docker', 'Redis', 'REST'] }
          ],
          work: [
            {
              id: 'work-1',
              name: 'FinGrid',
              position: 'Backend Engineer',
              startDate: '2024-01',
              endDate: 'Present',
              highlights: ['Reduced p95 checkout latency by 38% across 50k requests/day using Redis.']
            }
          ]
        }
      }
    });

    // 1. Deterministic ATS Score endpoint
    const atsRes = await app.inject({
      method: 'POST',
      url: '/api/resumes/ats-score',
      headers,
      payload: {
        customJob: {
          title: 'Backend Engineer',
          companyName: 'Razorpay',
          description: 'Requirements: TypeScript, Node.js, PostgreSQL, Kubernetes. Nice to have: Redis.'
        }
      }
    });
    expect(atsRes.statusCode).toBe(200);
    const ats = atsRes.json();
    expect(ats.matchedMustHave).toEqual(expect.arrayContaining(['TypeScript', 'Node.js', 'PostgreSQL']));
    expect(ats.missingMustHave).toContain('Kubernetes');

    // 2. Generate cover letter (works even without BYOK LLM key via deterministic grounded mode)
    const clRes = await app.inject({
      method: 'POST',
      url: '/api/cover-letters/generate',
      headers,
      payload: {
        customJob: {
          title: 'Backend Engineer',
          companyName: 'Razorpay',
          description: 'Build distributed payments APIs using TypeScript, PostgreSQL, and Redis.'
        },
        tone: 'concise-technical'
      }
    });
    expect(clRes.statusCode).toBe(201);
    const cl = clRes.json();
    expect(cl.verifierPassed).toBe(true);
    expect(cl.plainText).toContain('Razorpay');

    // 3. Inline PDF disposition check
    const inlinePdfRes = await app.inject({
      method: 'GET',
      url: `/api/cover-letters/${cl.id}/pdf?disposition=inline`,
      headers
    });
    expect(inlinePdfRes.statusCode).toBe(200);
    expect(inlinePdfRes.headers['content-disposition']).toMatch(/^inline;/);
    expect(inlinePdfRes.rawPayload.subarray(0, 5).toString('ascii')).toBe('%PDF-');

    // 4. Patch cover letter text
    const patchClRes = await app.inject({
      method: 'PATCH',
      url: `/api/cover-letters/${cl.id}`,
      headers,
      payload: {
        label: 'Razorpay — Edited v1',
        plainText: `${cl.plainText}\n\nThank you again for reviewing my application.`
      }
    });
    expect(patchClRes.statusCode).toBe(200);
    expect(patchClRes.json().label).toBe('Razorpay — Edited v1');

    // 5. Link cover letter onto tracker application
    const appRes = await app.inject({
      method: 'POST',
      url: '/api/applications',
      headers,
      payload: {
        title: 'Backend Engineer',
        companyName: 'Razorpay',
        status: 'applied',
        coverLetterId: cl.id
      }
    });
    expect(appRes.statusCode).toBe(201);
    const appBody = appRes.json();
    expect(appBody.coverLetterId).toBe(cl.id);
    expect(appBody.coverLetter.label).toBe('Razorpay — Edited v1');

    await app.close();
  });
});
