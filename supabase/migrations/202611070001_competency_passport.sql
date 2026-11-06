-- Pending approval. Additive only; do not run on Production in Phase 1.
begin;
create table public.competency_evidence (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.learning_sessions(id),
  submission_id uuid not null references public.learning_submissions(id),
  challenge_id text not null check (length(challenge_id) between 1 and 100),
  situation text not null check (situation in ('reasoning_error','evidence','scenario','method_correction','decision')),
  rubric_version text not null check (rubric_version = 'competency-v1'),
  ratings jsonb not null,
  valid boolean not null default false,
  independent boolean not null default false,
  reviewer_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(learner_id,challenge_id),
  unique(learner_id,session_id),
  check (challenge_id = session_id::text),
  check (reviewer_id <> learner_id)
);
create function public.validate_competency_evidence() returns trigger language plpgsql set search_path=public as $$
declare skill text; rating jsonb;
begin
  if not exists(select 1 from learning_submissions s join learning_sessions l on l.id=s.session_id where s.id=new.submission_id and s.session_id=new.session_id and s.learner_id=new.learner_id and l.learner_id=new.learner_id and l.status='completed' and s.analysis_state='analyzed') then
    raise exception 'Evidence source must be a completed owned learning submission';
  end if;
  if jsonb_typeof(new.ratings) <> 'object' or (select count(*) from jsonb_object_keys(new.ratings)) <> 5 then raise exception 'Five rubric ratings required'; end if;
  foreach skill in array array['critical','problem','correction','reasoning','independent'] loop
    rating := new.ratings->skill;
    if rating is null or jsonb_typeof(rating->'score') is distinct from 'number' or (rating->>'score')::numeric not in (0,25,50,75,100) or jsonb_typeof(rating->'reason') is distinct from 'string' or coalesce(length(trim(rating->>'reason')),0) not between 10 and 1600 then raise exception 'Invalid rubric rating'; end if;
  end loop;
  return new;
end $$;
create trigger competency_evidence_validate before insert or update on public.competency_evidence for each row execute function public.validate_competency_evidence();
create table public.competency_attempts (
  id uuid primary key default gen_random_uuid(), learner_id uuid not null references auth.users(id) on delete cascade,
  rubric_version text not null check(rubric_version='competency-v1'), bank_version text not null check(bank_version='final-v1'),
  question_ids jsonb not null check (jsonb_typeof(question_ids)='array' and jsonb_array_length(question_ids)=5),
  answers jsonb not null default '{}' check(jsonb_typeof(answers)='object'),
  status text not null check (status in ('in_progress','submitted','needs_review','passed','failed')),
  objective_score numeric check(objective_score between 0 and 80),
  final_score numeric check(final_score between 0 and 100),
  result jsonb, review jsonb, independent boolean not null default false,
  reviewer_id uuid references auth.users(id),
  created_at timestamptz not null default now(), submitted_at timestamptz, reviewed_at timestamptz,
  check (reviewer_id is null or reviewer_id <> learner_id),
  check (status not in ('passed','failed') or (reviewer_id is not null and result is not null and final_score is not null)),
  check (status='in_progress' or (objective_score is not null and submitted_at is not null)),
  check (status <> 'passed' or (final_score>=60 and independent and coalesce((result->>'total')::numeric,-1) between 60 and 100))
);
create function public.validate_competency_attempt() returns trigger language plpgsql set search_path=public as $$
begin
  if (select count(distinct value) from jsonb_array_elements_text(new.question_ids)) <> 5
     or exists(select 1 from jsonb_array_elements_text(new.question_ids) as q(value) where value not in ('f1','f2','f3','f4','f5','f6','f7','f8','f9','f10')) then
    raise exception 'Five distinct supported question IDs required';
  end if;
  if tg_op='INSERT' then
    if new.status <> 'in_progress' then raise exception 'Attempt must begin in_progress'; end if;
  else
    if new.learner_id<>old.learner_id or new.question_ids<>old.question_ids or new.rubric_version<>old.rubric_version or new.bank_version<>old.bank_version then
      raise exception 'Assessment identity is immutable';
    end if;
    if not ((old.status='in_progress' and new.status in ('in_progress','submitted','needs_review'))
      or (old.status='submitted' and new.status='needs_review')
      or (old.status='needs_review' and new.status in ('passed','failed'))) then
      raise exception 'Invalid assessment transition';
    end if;
    if old.status <> 'in_progress' and (new.answers<>old.answers or new.objective_score is distinct from old.objective_score) then
      raise exception 'Submitted answers and objective score are immutable';
    end if;
  end if;
  return new;
end $$;
create trigger competency_attempt_validate before insert or update on public.competency_attempts for each row execute function public.validate_competency_attempt();
create unique index competency_one_active on public.competency_attempts(learner_id) where status='in_progress';
create index competency_attempt_history on public.competency_attempts(learner_id,created_at desc);
alter table public.competency_evidence enable row level security;
alter table public.competency_attempts enable row level security;
-- Only authenticated server service-role access. Learners use ownership-filtered API.
-- Direct SELECT is also denied: submitted answers/reviewer notes are not public.
revoke all on public.competency_evidence, public.competency_attempts from public, anon, authenticated;
grant all on public.competency_evidence, public.competency_attempts to service_role;
commit;
