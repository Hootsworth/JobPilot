import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import {
  buildProfileEmbeddingText,
  EMBEDDING_MODEL_NAME,
  EMBEDDING_MODEL_VERSION,
  LocalBgeEmbedder,
  sha256Text
} from '@jobpilot/embeddings';
import { IndiaProfileSchema, JsonResumeSchema } from '@jobpilot/shared';
import { buildJobEmbeddingText } from '../connectors/base.js';

function loadEnvIfPresent() {
  if (typeof process.loadEnvFile !== 'function') return;
  for (const p of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
    if (existsSync(p)) {
      try {
        process.loadEnvFile(p);
      } catch {
        // ignore
      }
    }
  }
}

async function main() {
  loadEnvIfPresent();
  const supabaseUrl = process.env['SUPABASE_URL']?.trim();
  const secretKey = (
    process.env['SUPABASE_SECRET_KEY'] ?? process.env['SUPABASE_SERVICE_ROLE_KEY']
  )?.trim();
  if (!supabaseUrl || !secretKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY (sb_secret_...)');
  }

  const supabase = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const embedder = new LocalBgeEmbedder({ batchSize: 16 });
  const batchLimit = Number.parseInt(process.env['EMBED_LIMIT'] ?? '300', 10);

  // 1. Batch embed active jobs missing vectors or using an older model/version
  const { data: jobs, error: jobsErr } = await supabase
    .from('jobs')
    .select('id, title, company_name, location_raw, work_mode, seniority, extracted_skills, description_clean, embedding_model, embedding_model_version')
    .eq('is_active', true)
    .or(
      `embedding.is.null,embedding_model.neq.${EMBEDDING_MODEL_NAME},embedding_model_version.neq.${EMBEDDING_MODEL_VERSION}`
    )
    .limit(batchLimit);

  if (jobsErr) throw new Error(`Failed to load unembedded jobs: ${jobsErr.message}`);

  const jobRows = (jobs ?? []) as Array<Record<string, unknown>>;
  let jobsEmbedded = 0;

  if (jobRows.length > 0) {
    const texts = jobRows.map((r) =>
      buildJobEmbeddingText({
        title: String(r['title'] ?? ''),
        companyName: String(r['company_name'] ?? ''),
        locationRaw: (r['location_raw'] as string | null) ?? null,
        workMode: (r['work_mode'] as string | null) ?? null,
        seniority: (r['seniority'] as string | null) ?? null,
        extractedSkills: Array.isArray(r['extracted_skills'])
          ? (r['extracted_skills'] as string[])
          : [],
        descriptionClean: (r['description_clean'] as string | null) ?? null
      })
    );

    const vectors = await embedder.embedDocuments(texts, 16);
    for (let i = 0; i < jobRows.length; i++) {
      const row = jobRows[i]!;
      const vec = vectors[i];
      if (!vec) continue;
      await supabase
        .from('jobs')
        .update({
          embedding: `[${vec.vector.join(',')}]`,
          embedding_model: vec.model,
          embedding_model_version: vec.version,
          embedded_at: new Date().toISOString()
        })
        .eq('id', String(row['id']));
      jobsEmbedded++;
    }
  }

  // 2. Embed changed profiles
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, json_resume, india_profile, profile_text_hash, embedding_model, embedding_model_version')
    .limit(200);

  let profilesEmbedded = 0;
  for (const p of (profiles ?? []) as Array<Record<string, unknown>>) {
    const jsonResume = JsonResumeSchema.parse(p['json_resume'] ?? {});
    const indiaProfile = IndiaProfileSchema.parse(p['india_profile'] ?? {});
    const text = buildProfileEmbeddingText(jsonResume, indiaProfile);
    if (!text) continue;
    const hash = sha256Text(text);
    const sameHash = p['profile_text_hash'] === hash;
    const sameModel =
      p['embedding_model'] === EMBEDDING_MODEL_NAME &&
      p['embedding_model_version'] === EMBEDDING_MODEL_VERSION;
    if (sameHash && sameModel) continue;

    const [vec] = await embedder.embedDocuments([text], 1);
    if (!vec) continue;
    await supabase
      .from('profiles')
      .update({
        profile_text_hash: hash,
        embedding: `[${vec.vector.join(',')}]`,
        embedding_model: vec.model,
        embedding_model_version: vec.version,
        embedded_at: new Date().toISOString()
      })
      .eq('id', String(p['id']));
    profilesEmbedded++;
  }

  console.log(
    'JobPilot batch embeddings finished:',
    JSON.stringify({ jobsEmbedded, profilesEmbedded })
  );
}

main().catch((err) => {
  console.error('JobPilot batch embedding failed:', err);
  process.exit(1);
});
