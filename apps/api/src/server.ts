import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createSupabaseAuthVerifier } from './plugins/auth.js';
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

async function main() {
  loadEnvIfPresent();
  const config = loadConfig();

  if (!config.supabaseUrl || !config.supabaseAnonKey || !config.supabaseServiceRoleKey) {
    throw new Error(
      'Missing SUPABASE_URL, SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY environment variables.'
    );
  }

  const store = new SupabaseDataStore(config.supabaseUrl, config.supabaseServiceRoleKey);
  const authVerifier = createSupabaseAuthVerifier(config.supabaseUrl, config.supabaseAnonKey);

  const app = await buildApp({
    config,
    store,
    authVerifier
  });

  await app.listen({ port: config.port, host: config.host });
}

main().catch((err) => {
  console.error('Failed to start JobPilot API server:', err);
  process.exit(1);
});
