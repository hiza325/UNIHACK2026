-- Export avatar metadata and remove stored objects via Storage API BEFORE
-- running this rollback. This script deliberately does not delete user images.
begin;
drop function if exists public.avatar_mutate(uuid, text, text);
drop table if exists public.avatar_profiles;
commit;
