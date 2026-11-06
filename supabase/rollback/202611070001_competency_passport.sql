-- Explicit rollback only after export of competency data and approval.
begin;
drop table public.competency_attempts;
drop table public.competency_evidence;
drop function public.validate_competency_evidence();
drop function public.validate_competency_attempt();
commit;
