import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SeedBoardSchema, type SeedBoard } from '@jobpilot/shared';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const SEED_FILE_URL = new URL('../../../../data/seed-boards.json', import.meta.url);

function loadEmbeddedSeedBoards(): unknown[] {
  const candidates = [
    SEED_FILE_URL,
    resolve(MODULE_DIR, '../../../../data/seed-boards.json'),
    resolve(process.cwd(), 'data/seed-boards.json'),
    resolve(process.cwd(), '../../data/seed-boards.json')
  ];
  for (const candidate of candidates) {
    try {
      const text = readFileSync(candidate, 'utf8');
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Try next candidate path
    }
  }
  return [];
}

const FALLBACK_RAW_BOARDS: Array<Record<string, unknown>> = [
  { sourceType: 'greenhouse', slug: 'razorpaysoftwareprivatelimited', displayName: 'Razorpay', regionFocus: 'india', careersUrl: 'https://razorpay.com/jobs/', refreshTier: 'high_volume', enabled: true },
  { sourceType: 'greenhouse', slug: 'browserstack', displayName: 'BrowserStack', regionFocus: 'india', careersUrl: 'https://www.browserstack.com/careers', refreshTier: 'high_volume', enabled: true },
  { sourceType: 'greenhouse', slug: 'postman', displayName: 'Postman', regionFocus: 'hybrid', careersUrl: 'https://www.postman.com/company/careers/', refreshTier: 'high_volume', enabled: true },
  { sourceType: 'greenhouse', slug: 'chargebee', displayName: 'Chargebee', regionFocus: 'hybrid', careersUrl: 'https://www.chargebee.com/company/careers/', refreshTier: 'high_volume', enabled: true },
  { sourceType: 'greenhouse', slug: 'clevertap', displayName: 'CleverTap', regionFocus: 'india', careersUrl: 'https://clevertap.com/careers/', refreshTier: 'high_volume', enabled: true },
  { sourceType: 'greenhouse', slug: 'phonepe', displayName: 'PhonePe', regionFocus: 'india', careersUrl: 'https://www.phonepe.com/careers/', refreshTier: 'high_volume', enabled: true },
  { sourceType: 'greenhouse', slug: 'groww', displayName: 'Groww', regionFocus: 'india', careersUrl: 'https://groww.in/careers', refreshTier: 'high_volume', enabled: true },
  { sourceType: 'greenhouse', slug: 'meesho', displayName: 'Meesho', regionFocus: 'india', careersUrl: 'https://www.meesho.io/jobs', refreshTier: 'high_volume', enabled: true },
  { sourceType: 'greenhouse', slug: 'freshworks', displayName: 'Freshworks', regionFocus: 'india', careersUrl: 'https://www.freshworks.com/company/careers/', refreshTier: 'high_volume', enabled: true },
  { sourceType: 'greenhouse', slug: 'stripe', displayName: 'Stripe', regionFocus: 'hybrid', careersUrl: 'https://stripe.com/jobs', refreshTier: 'high_volume', enabled: true },
  { sourceType: 'greenhouse', slug: 'databricks', displayName: 'Databricks', regionFocus: 'hybrid', careersUrl: 'https://www.databricks.com/company/careers', refreshTier: 'high_volume', enabled: true },
  { sourceType: 'lever', slug: 'atlassian', displayName: 'Atlassian', regionFocus: 'hybrid', careersUrl: 'https://www.atlassian.com/company/careers', refreshTier: 'high_volume', enabled: true },
  { sourceType: 'lever', slug: 'cred', displayName: 'CRED', regionFocus: 'india', careersUrl: 'https://careers.cred.club/', refreshTier: 'high_volume', enabled: true },
  { sourceType: 'lever', slug: 'swiggy', displayName: 'Swiggy', regionFocus: 'india', careersUrl: 'https://careers.swiggy.com/', refreshTier: 'high_volume', enabled: true },
  { sourceType: 'lever', slug: 'paytm', displayName: 'Paytm', regionFocus: 'india', careersUrl: 'https://paytm.com/careers/', refreshTier: 'high_volume', enabled: true },
  { sourceType: 'ashby', slug: 'notion', displayName: 'Notion', regionFocus: 'hybrid', careersUrl: 'https://www.notion.so/careers', refreshTier: 'high_volume', enabled: true },
  { sourceType: 'ashby', slug: 'openai', displayName: 'OpenAI', regionFocus: 'global', careersUrl: 'https://openai.com/careers', refreshTier: 'high_volume', enabled: true },
  { sourceType: 'workable', slug: 'keka', displayName: 'Keka HR', regionFocus: 'india', careersUrl: 'https://www.keka.com/careers', refreshTier: 'high_volume', enabled: true },
  { sourceType: 'smartrecruiters', slug: 'Visa', displayName: 'Visa', regionFocus: 'hybrid', careersUrl: 'https://corporate.visa.com/en/jobs/', refreshTier: 'high_volume', enabled: true },
  { sourceType: 'smartrecruiters', slug: 'servicenow', displayName: 'ServiceNow', regionFocus: 'hybrid', careersUrl: 'https://careers.servicenow.com/', refreshTier: 'high_volume', enabled: true },
  {
    sourceType: 'workday',
    slug: 'nvidia:NVIDIAExternalCareerSite',
    displayName: 'NVIDIA',
    regionFocus: 'hybrid',
    careersUrl: 'https://www.nvidia.com/en-in/about-nvidia/careers/',
    refreshTier: 'high_volume',
    workday: { host: 'nvidia.wd5.myworkdayjobs.com', tenant: 'nvidia', site: 'NVIDIAExternalCareerSite' },
    enabled: true
  },
  {
    sourceType: 'workday',
    slug: 'salesforce:External_Career_Site',
    displayName: 'Salesforce',
    regionFocus: 'hybrid',
    careersUrl: 'https://careers.salesforce.com/',
    refreshTier: 'high_volume',
    workday: { host: 'salesforce.wd12.myworkdayjobs.com', tenant: 'salesforce', site: 'External_Career_Site' },
    enabled: true
  }
];

function parseBoards(rawItems: unknown[]): SeedBoard[] {
  const boards: SeedBoard[] = [];
  for (const item of rawItems) {
    const parsed = SeedBoardSchema.safeParse(item);
    if (parsed.success) boards.push(parsed.data);
  }
  return boards;
}

const loadedDefault = parseBoards(loadEmbeddedSeedBoards());
export const DEFAULT_SEED_BOARDS: SeedBoard[] =
  loadedDefault.length > 0 ? loadedDefault : parseBoards(FALLBACK_RAW_BOARDS);

/**
 * Load the curated company registry from `data/seed-boards.json` (or a custom JSON path),
 * falling back to `DEFAULT_SEED_BOARDS` when the file is unavailable.
 */
export function loadCompanyRegistry(customPath?: string): SeedBoard[] {
  const candidates = customPath
    ? [resolve(customPath)]
    : [
        resolve(process.cwd(), 'data/seed-boards.json'),
        resolve(process.cwd(), '../../data/seed-boards.json'),
        resolve(MODULE_DIR, '../../../../data/seed-boards.json')
      ];

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8'));
      if (Array.isArray(raw)) {
        const parsed = parseBoards(raw).filter((b) => b.enabled);
        if (parsed.length > 0) return parsed;
      }
    } catch {
      // Fall back cleanly if JSON cannot be read
    }
  }

  return DEFAULT_SEED_BOARDS.filter((b) => b.enabled);
}
