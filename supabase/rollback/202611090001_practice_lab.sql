-- Rollback for 202611090001_practice_lab.sql. Destructive: removes Practice Lab data.
drop view if exists public.practice_progress;
drop trigger if exists practice_challenges_set_updated_at on public.practice_challenges;
drop function if exists public.set_practice_challenge_updated_at();
drop table if exists public.practice_attempts;
drop table if exists public.practice_challenges;
