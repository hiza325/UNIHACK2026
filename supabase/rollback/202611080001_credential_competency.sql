-- Rollback for 202611080001 and 202611080002
begin;
drop index if exists public.learning_credentials_competency_assessment_unique;
alter table public.learning_credentials drop column if exists metadata;
commit;
