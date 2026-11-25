import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createSupabaseAuthVerifier } from './plugins/auth.js';
import { parseEncryptionKey } from './services/crypto.js';
import { JobSyncService } from './services/job-sync.js';
import { SupabaseDataStore } from './store/supabase-store.js';

function loadEnvIfPresent() {
  if (typeof process.loadEnvFile !== 'function') return;
  for (const candidate of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
    if (existsSync(candidate)) {
      try {
        process.loadEnvFile(candidate);
      } catch {
        // Ignore unreadable or malformed local env files
      }
    }
  }
}

function describeSupabaseKey(key: string): string {
  if (key.startsWith('sb_secret_')) return 'secret (sb_secret_)';
  if (key.startsWith('sb_publishable_')) return 'publishable (sb_publishable_)';
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as {
        role?: string;
      };
      return `legacy ${payload.role ?? 'unknown'} JWT`;
    } catch {
      return 'unrecognized JWT';
    }
  }
  return 'unrecognized format';
}

async function main() {
  loadEnvIfPresent();
  const config = loadConfig();

  if (!config.supabaseUrl || !config.supabasePublishableKey || !config.supabaseSecretKey) {
    throw new Error(
      'Missing SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY (sb_publishable_...), or SUPABASE_SECRET_KEY (sb_secret_...) environment variables.'
    );
  }

  const secretKind = describeSupabaseKey(config.supabaseSecretKey);
  const publishableKind = describeSupabaseKey(config.supabasePublishableKey);
  console.log(
    `Supabase keys: server key = ${secretKind}, auth key = ${publishableKind}, url = ${config.supabaseUrl}`
  );
  if (secretKind !== 'secret (sb_secret_)' && secretKind !== 'legacy service_role JWT') {
    throw new Error(
      `SUPABASE_SECRET_KEY must be a secret key (sb_secret_...) or legacy service_role key, but it looks like: ${secretKind}. ` +
        'Copy the Secret key from Supabase -> Project Settings -> API Keys. If SUPABASE_SERVICE_ROLE_KEY is also set in Render, remove or correct it.'
    );
  }

  try {
    parseEncryptionKey(config.appEncryptionKey);
  } catch {
    throw new Error(
      'Missing or invalid APP_ENCRYPTION_KEY. Set a 64-character hex string (32 bytes for AES-256-GCM), e.g. generated via `openssl rand -hex 32`.'
    );
  }

  const store = new SupabaseDataStore(config.supabaseUrl, config.supabaseSecretKey);
  const authVerifier = createSupabaseAuthVerifier(config.supabaseUrl, config.supabasePublishableKey);
  const jobSync = new JobSyncService({ store, config });

  const app = await buildApp({
    config,
    store,
    authVerifier,
    jobSync
  });

  await app.listen({ port: config.port, host: config.host });

  if (config.autoSyncIntervalHours > 0) {
    const startupTimer = setTimeout(() => {
      void jobSync.syncNow({ mode: 'full', force: false }).catch((err) => {
        console.warn('Initial background job sync failed:', err);
      });
    }, 15_000);
    startupTimer.unref();

    const intervalMs = config.autoSyncIntervalHours * 60 * 60 * 1000;
    const timer = setInterval(() => {
      void jobSync.syncNow({ mode: 'full', force: false }).catch((err) => {
        console.warn('Scheduled background job sync failed:', err);
      });
    }, intervalMs);
    timer.unref();
  }
}

main().catch((err) => {
  console.error('Failed to start JobPilot API server:', err);
  process.exit(1);
});
