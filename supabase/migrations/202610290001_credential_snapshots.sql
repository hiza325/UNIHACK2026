-- Additive only. No historical names are inferred or backfilled.
begin;
alter table public.learning_credentials
  add column recipient_name_snapshot text,
  add column subject_snapshot text,
  add column snapshot_version smallint,
  add column snapshot_captured_at timestamptz,
  add column evaluation_id uuid references public.learning_evaluations(id) on delete restrict,
  add constraint credential_snapshot_complete check (
    (snapshot_version is null and recipient_name_snapshot is null and subject_snapshot is null
      and snapshot_captured_at is null and evaluation_id is null)
    or
    (snapshot_version is not null and snapshot_version = 1
      and recipient_name_snapshot is not null and char_length(btrim(recipient_name_snapshot)) between 1 and 200
      and subject_snapshot is not null and char_length(btrim(subject_snapshot)) between 1 and 120
      and snapshot_captured_at is not null and evaluation_id is not null
      and source = 'ai-evaluation' and is_test = false and skill = subject_snapshot)
  );

create function public.protect_credential_snapshot()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.source = 'ai-evaluation' and new.snapshot_version is null then
      raise exception 'Official issuance requires a snapshot' using errcode = '23514';
    end if;
    if new.snapshot_version is not null and not exists (
      select 1 from public.learning_evaluations e
      where e.id = new.evaluation_id and e.learner_id = new.learner_id
        and e.status = 'pass' and e.credential_eligible = true
    ) then
      raise exception 'Snapshot evaluation ownership or eligibility mismatch' using errcode = '23514';
    end if;
  else
    -- Also prevents opportunistic backfills of legacy records through ordinary UPDATE.
    if row(new.recipient_name_snapshot, new.subject_snapshot, new.snapshot_version,
           new.snapshot_captured_at, new.evaluation_id)
       is distinct from row(old.recipient_name_snapshot, old.subject_snapshot, old.snapshot_version,
                            old.snapshot_captured_at, old.evaluation_id) then
      raise exception 'Credential snapshot is immutable' using errcode = '23514';
    end if;
    if old.snapshot_version is not null and (
      row(new.id, new.learner_id, new.credential_code, new.credential_id_hash, new.evidence_hash,
          new.title, new.skill, new.source, new.is_test, new.created_by, new.assessment_score, new.network, new.chain_id)
      is distinct from
      row(old.id, old.learner_id, old.credential_code, old.credential_id_hash, old.evidence_hash,
          old.title, old.skill, old.source, old.is_test, old.created_by, old.assessment_score, old.network, old.chain_id)
      or (old.issued_at is not null and new.issued_at is distinct from old.issued_at)
    ) then
      raise exception 'Issued identity and metadata are immutable' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger learning_credentials_protect_snapshot
before insert or update on public.learning_credentials
for each row execute function public.protect_credential_snapshot();

comment on column public.learning_credentials.snapshot_captured_at is
  'Server metadata capture before transaction submission; NOT the on-chain issue timestamp.';
comment on column public.learning_credentials.evaluation_id is
  'Verified evidence reference. RESTRICT prevents deleting evidence for a snapshot. Existing auth.users CASCADE policy is unchanged.';
commit;
