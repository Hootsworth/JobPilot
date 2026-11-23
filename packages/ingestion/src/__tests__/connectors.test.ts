import { describe, expect, it, vi } from 'vitest';
import {
  fetchAdzunaIndia,
  fetchArbeitnowFeed,
  fetchAshbyBoard,
  fetchGreenhouseBoard,
  fetchJoobleIndia,
  fetchJSearchOptional,
  fetchLeverBoard,
  fetchRemoteOkFeed,
  fetchRemotiveFeed,
  fetchWorkableBoard,
  PoliteHttpClient
} from '../index.js';
import { HostRateLimiter } from '../http/rate-limiter.js';

function createMockHttp(routes: Record<string, unknown>) {
  const fetchFn = vi.fn(async (url: string) => {
    for (const [pattern, payload] of Object.entries(routes)) {
      if (url.includes(pattern)) {
        return new Response(JSON.stringify(payload), { status: 200 });
      }
    }
    return new Response('not found', { status: 404 });
  });

  return new PoliteHttpClient({
    fetchFn,
    respectRobots: false,
    rateLimiter: new HostRateLimiter({ defaultMinIntervalMs: 0, sleepFn: async () => {} })
  });
}

describe('@jobpilot/ingestion official connectors', () => {
  it('parses Greenhouse, Lever, Ashby, and Workable public JSON boards', async () => {
    const http = createMockHttp({
      'boards-api.greenhouse.io': {
        jobs: [
          {
            id: 11,
            title: 'Software Engineer Intern',
            absolute_url: 'https://boards.greenhouse.io/demo/jobs/11',
            location: { name: 'Bengaluru, India' },
            content: '<p>TypeScript and PostgreSQL internship. Stipend ₹50,000/month.</p>'
          }
        ]
      },
      'api.lever.co': [
        {
          id: 'lev-1',
          text: 'Backend Engineer (SDE-1)',
          hostedUrl: 'https://jobs.lever.co/cred/lev-1',
          applyUrl: 'https://jobs.lever.co/cred/lev-1/apply',
          workplaceType: 'hybrid',
          categories: { location: 'Bengaluru' },
          descriptionPlain: 'Build Go and Kafka microservices. 18 - 25 LPA.'
        }
      ],
      'api.ashbyhq.com': {
        jobs: [
          {
            id: 'ash-1',
            title: 'Product Engineer',
            location: 'Remote',
            isRemote: true,
            jobUrl: 'https://jobs.ashbyhq.com/linear/ash-1',
            descriptionPlain: 'React, TypeScript, GraphQL.'
          }
        ]
      },
      'apply.workable.com': {
        jobs: [
          {
            shortcode: 'WK123',
            title: 'Full Stack Developer',
            url: 'https://apply.workable.com/keka/j/WK123/',
            location: { city: 'Hyderabad', country: 'India' },
            telecommuting: false,
            description: 'Node.js, Angular, SQL.'
          }
        ]
      }
    });

    const gh = await fetchGreenhouseBoard({ slug: 'demo', companyName: 'Demo', http });
    expect(gh.jobs[0]).toMatchObject({
      sourceType: 'greenhouse',
      city: 'Bengaluru',
      seniority: 'intern',
      salaryMinLpa: 6
    });

    const lev = await fetchLeverBoard({ slug: 'cred', companyName: 'CRED', http });
    expect(lev.jobs[0]).toMatchObject({
      sourceType: 'lever',
      workMode: 'hybrid',
      seniority: 'junior',
      salaryMinLpa: 18
    });

    const ash = await fetchAshbyBoard({ slug: 'linear', companyName: 'Linear', http });
    expect(ash.jobs[0]).toMatchObject({ sourceType: 'ashby', workMode: 'remote' });

    const wk = await fetchWorkableBoard({ slug: 'keka', companyName: 'Keka', http });
    expect(wk.jobs[0]).toMatchObject({
      sourceType: 'workable',
      city: 'Hyderabad',
      countryCode: 'IN'
    });
  });

  it('parses Adzuna, Jooble, Remotive, Arbeitnow, RemoteOK, and optional JSearch', async () => {
    const http = createMockHttp({
      'api.adzuna.com': {
        results: [
          {
            id: 'a1',
            title: 'Node.js Developer',
            redirect_url: 'https://adzuna.in/a1',
            salary_min: 1_200_000,
            salary_max: 1_600_000,
            company: { display_name: 'FinTech Co' },
            location: { display_name: 'Pune, India' },
            description: 'TypeScript and Redis'
          }
        ]
      },
      'jooble.org': {
        jobs: [
          {
            id: 'j1',
            title: 'Python Backend Engineer',
            link: 'https://in.jooble.org/desc/j1',
            company: 'Cloud Startup',
            location: 'Gurugram, India',
            snippet: 'FastAPI and AWS, 10 - 14 LPA'
          }
        ]
      },
      'remotive.com': {
        jobs: [
          {
            id: 501,
            url: 'https://remotive.com/remote-jobs/501',
            title: 'Remote Full-Stack Engineer',
            company_name: 'Remote Co',
            candidate_required_location: 'Worldwide',
            tags: ['React', 'Node.js'],
            description: 'Build SaaS features.'
          }
        ]
      },
      'arbeitnow.com': {
        data: [
          {
            slug: 'arb-1',
            company_name: 'Berlin AI',
            title: 'ML Engineer',
            url: 'https://www.arbeitnow.com/jobs/arb-1',
            remote: true,
            location: 'Berlin',
            description: 'PyTorch and Python'
          }
        ]
      },
      'remoteok.com': [
        { legal: 'RemoteOK API Terms' },
        {
          id: 901,
          company: 'Global SaaS',
          position: 'Senior Platform Engineer',
          url: 'https://remoteok.com/remote-jobs/901',
          salary_min: 100_000,
          salary_max: 130_000,
          tags: ['Kubernetes', 'Go'],
          description: 'Manage k8s clusters.'
        }
      ],
      'jsearch.p.rapidapi.com': {
        data: [
          {
            job_id: 'js-1',
            employer_name: 'Rapid Org',
            job_title: 'Associate SDE',
            job_apply_link: 'https://example.com/apply/js-1',
            job_city: 'Chennai',
            job_country: 'IN',
            job_description: 'Java and Spring Boot'
          }
        ]
      }
    });

    const adz = await fetchAdzunaIndia({ appId: 'id', appKey: 'key', http });
    expect(adz.jobs[0]?.salaryMinLpa).toBe(12);

    const joo = await fetchJoobleIndia({ apiKey: 'key', http });
    expect(joo.jobs[0]?.city).toBe('Gurugram');

    const rem = await fetchRemotiveFeed({ http });
    expect(rem.jobs[0]?.workMode).toBe('remote');

    const arb = await fetchArbeitnowFeed({ http });
    expect(arb.jobs[0]?.city).toBe('Berlin');

    const rok = await fetchRemoteOkFeed({ http });
    expect(rok.jobs).toHaveLength(1);
    expect(rok.jobs[0]?.salaryMinLpa).toBe(84);

    // JSearch skipped when key missing
    const jsDisabled = await fetchJSearchOptional({ http });
    expect(jsDisabled.skippedReason).toBeTruthy();

    const jsEnabled = await fetchJSearchOptional({ rapidApiKey: 'rapid', http });
    expect(jsEnabled.jobs[0]?.city).toBe('Chennai');
  });
});
