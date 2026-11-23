-- 0005_grants.sql
-- Explicit Data API privileges. Newer Supabase projects no longer auto-grant
-- table privileges to API roles, which surfaces as
-- "permission denied for table <name>" (SQLSTATE 42501) even with the secret key.
-- Row Level Security (migration 0002) still restricts anon/authenticated rows.

grant usage on schema public to anon, authenticated, service_role;

-- Server (secret key => service_role): full access, bypasses RLS.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Signed-in users (RLS policies decide which rows are visible).
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Apply the same to tables/functions created in the future.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
