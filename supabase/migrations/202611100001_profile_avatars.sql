-- Local-only preparation. Apply to an approved project separately.
begin;
create table if not exists public.avatar_profiles (
  learner_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{"key":null,"pending":[],"started":{},"retired":[],"events":[]}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.avatar_profiles enable row level security;
revoke all on public.avatar_profiles from anon, authenticated;
grant all on public.avatar_profiles to service_role;

-- No client Storage policies: only the authenticated application server may
-- access this private bucket. Set AVATAR_STORAGE_BUCKET=profile-avatars.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('profile-avatars', 'profile-avatars', false, 5242880, array['image/webp'])
on conflict (id) do nothing;

create or replace function public.avatar_mutate(owner_id uuid, operation text, object_key text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s jsonb;
  old_key text;
  cutoff bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  events jsonb;
  stale_key text;
begin
  if object_key is not null and (split_part(object_key, '/', 1) <> owner_id::text
    or object_key !~ '^[0-9a-f-]+/[0-9a-f-]{36}\.webp$') then
    raise exception 'AVATAR_INVALID_KEY';
  end if;
  insert into public.avatar_profiles(learner_id) values(owner_id) on conflict do nothing;
  select state into s from public.avatar_profiles where learner_id = owner_id for update;
  if operation = 'rate' then
    select coalesce(jsonb_agg(value), '[]'::jsonb) into events
      from jsonb_array_elements(s->'events') where value::text::bigint > cutoff - 600000;
    if jsonb_array_length(events) >= 10 then raise exception 'AVATAR_RATE_LIMITED'; end if;
    s := jsonb_set(s, '{events}', events || to_jsonb(cutoff));
  elsif operation = 'enqueue' and object_key is not null then
    s := jsonb_set(s, '{pending}', (s->'pending') || to_jsonb(object_key));
    s := jsonb_set(s, array['started', object_key], to_jsonb(cutoff));
  elsif operation = 'activate' then
    old_key := s->>'key';
    if object_key is not null and not (s->'pending' ? object_key) then raise exception 'AVATAR_INVALID_KEY'; end if;
    if object_key is not null and coalesce((s->'started'->>object_key)::bigint, 0) <= cutoff - 600000 then raise exception 'AVATAR_INVALID_KEY'; end if;
    if old_key is not null and old_key is distinct from object_key then
      s := jsonb_set(s, '{retired}', (s->'retired') || to_jsonb(old_key));
    end if;
    s := jsonb_set(s, '{key}', coalesce(to_jsonb(object_key), 'null'::jsonb));
    if object_key is not null then s := jsonb_set(s, '{pending}', (s->'pending') - object_key); end if;
    if object_key is not null then s := jsonb_set(s, '{started}', (s->'started') - object_key); end if;
  elsif operation = 'expire' then
    for stale_key in select value from jsonb_array_elements_text(s->'pending')
      where coalesce((s->'started'->>value)::bigint, 0) <= cutoff - 600000 loop
      s := jsonb_set(s, '{retired}', (s->'retired') || to_jsonb(stale_key));
      s := jsonb_set(s, '{pending}', (s->'pending') - stale_key);
      s := jsonb_set(s, '{started}', (s->'started') - stale_key);
    end loop;
  elsif operation = 'clean' and object_key is distinct from s->>'key' then
    s := jsonb_set(s, '{pending}', (s->'pending') - object_key);
    s := jsonb_set(s, '{retired}', (s->'retired') - object_key);
    s := jsonb_set(s, '{started}', (s->'started') - object_key);
  else raise exception 'AVATAR_INVALID_OPERATION';
  end if;
  update public.avatar_profiles set state = s, updated_at = now() where learner_id = owner_id;
  return s;
end;
$$;
revoke all on function public.avatar_mutate(uuid, text, text) from public, anon, authenticated;
grant execute on function public.avatar_mutate(uuid, text, text) to service_role;
commit;
