-- Phase 3: Track which PDF engine rendered each resume version ('typst' or 'builtin-ats-pdf')
alter table public.resume_versions
  add column if not exists pdf_engine text not null default 'builtin-ats-pdf';
