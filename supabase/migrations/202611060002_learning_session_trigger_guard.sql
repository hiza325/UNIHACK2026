-- Forward-only convergence for databases that recorded the pre-fix 0001.
-- Historical timestamp repair is a separate, snapshot-scoped operator action.
begin;

create or replace trigger learning_sessions_set_updated_at
before update on public.learning_sessions
for each row
when (
  (to_jsonb(old) - 'updated_at' - 'last_activity_at')
  is distinct from
  (to_jsonb(new) - 'updated_at' - 'last_activity_at')
)
execute function public.set_learning_record_updated_at();

commit;
