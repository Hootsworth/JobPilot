import { describe, expect, it } from 'vitest';
import { parseCompanyBoardUrl } from '../discovery/board-url-parser.js';

describe('parseCompanyBoardUrl', () => {
  it('parses Greenhouse, Lever, Ashby, SmartRecruiters, and Workable public board URLs', () => {
    expect(parseCompanyBoardUrl('https://boards.greenhouse.io/razorpay')).toMatchObject({
      sourceType: 'greenhouse',
      slug: 'razorpay',
      displayName: 'Razorpay',
      regionFocus: 'india',
      enabled: true
    });

    expect(parseCompanyBoardUrl('https://job-boards.eu.greenhouse.io/embed/job_board?for=cred-club')).toMatchObject({
      sourceType: 'greenhouse',
      slug: 'cred-club',
      displayName: 'Cred Club'
    });

    expect(parseCompanyBoardUrl('https://jobs.lever.co/meesho/some-job-id')).toMatchObject({
      sourceType: 'lever',
      slug: 'meesho',
      displayName: 'Meesho'
    });

    expect(
      parseCompanyBoardUrl('https://jobs.ashbyhq.com/linear', {
        displayName: 'Linear Inc',
        regionFocus: 'global'
      })
    ).toMatchObject({
      sourceType: 'ashby',
      slug: 'linear',
      displayName: 'Linear Inc',
      regionFocus: 'global'
    });

    expect(parseCompanyBoardUrl('https://careers.smartrecruiters.com/Visa')).toMatchObject({
      sourceType: 'smartrecruiters',
      slug: 'Visa',
      displayName: 'Visa'
    });

    expect(parseCompanyBoardUrl('https://apply.workable.com/postman/')).toMatchObject({
      sourceType: 'workable',
      slug: 'postman',
      displayName: 'Postman'
    });
  });

  it('rejects unsupported, non-HTTP, or internal host URLs', () => {
    expect(parseCompanyBoardUrl('http://127.0.0.1/greenhouse/test')).toBeNull();
    expect(parseCompanyBoardUrl('https://localhost:3000/jobs/acme')).toBeNull();
    expect(parseCompanyBoardUrl('https://example.com/careers')).toBeNull();
    expect(parseCompanyBoardUrl('ftp://boards.greenhouse.io/acme')).toBeNull();
    expect(parseCompanyBoardUrl('https://jobs.lever.co/')).toBeNull();
  });
});
