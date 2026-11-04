-- Disposable local/CI bootstrap for the Supabase-managed prerequisites used by
-- the PARADOX AI migrations. NEVER run this against Production or Staging.
--
-- Creates the auth schema/table, the Supabase roles, and auth.uid() so the
-- repository migrations can be applied to a plain PostgreSQL 17 instance.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'create role anon nologin noinherit';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'create role authenticated nologin noinherit';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'create role service_role nologin noinherit bypassrls';
  end if;
end $$;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  app_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Minimal equivalent of Supabase's auth.uid() for local/CI checks.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;
