begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.daily_status
  add constraint daily_status_has_content
  check (
    fatigue is not null
    or strength is not null
    or breathing is not null
    or eye_symptom is not null
    or nullif(btrim(note), '') is not null
  )
  not valid;

-- Existing empty legacy rows must be reviewed and explicitly deleted rather than
-- changed by this migration. NOT VALID still rejects new or updated empty rows.

revoke update (medication_id)
  on table public.medication_logs from authenticated;

create or replace function public.set_medication_log_snapshot()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  selected_medication_name text;
  selected_medication_unit text;
  selected_schedule_medication_id uuid;
  selected_schedule_time time(0) without time zone;
begin
  if tg_op = 'UPDATE' and new.care_space_id is distinct from old.care_space_id then
    raise check_violation using message = 'care_space_id cannot be changed';
  end if;

  if tg_op = 'INSERT' or new.medication_id is distinct from old.medication_id then
    select medication.name, medication.unit
      into selected_medication_name, selected_medication_unit
      from public.medications as medication
      where medication.id = new.medication_id
        and medication.care_space_id = new.care_space_id
        and medication.deleted_at is null;
    if not found then
      raise foreign_key_violation
        using message = 'medication_id does not belong to care_space_id';
    end if;
    new.medication_name := selected_medication_name;
    new.medication_unit := selected_medication_unit;
  else
    new.medication_name := old.medication_name;
    new.medication_unit := old.medication_unit;
  end if;

  if new.schedule_id is not null then
    if new.is_extra then
      raise check_violation using message = 'scheduled medication log cannot be extra';
    end if;
    select schedule.medication_id, schedule.time
      into selected_schedule_medication_id, selected_schedule_time
      from public.medication_schedules as schedule
      where schedule.id = new.schedule_id
        and schedule.care_space_id = new.care_space_id;
    if not found then
      raise foreign_key_violation
        using message = 'schedule_id does not belong to care_space_id';
    end if;
    if selected_schedule_medication_id <> new.medication_id then
      raise check_violation using message = 'schedule_id does not belong to medication_id';
    end if;
    if tg_op = 'INSERT' or new.schedule_id is distinct from old.schedule_id then
      new.schedule_time := selected_schedule_time;
    else
      new.schedule_time := old.schedule_time;
    end if;
  elsif tg_op = 'INSERT' then
    if not new.is_extra then
      raise check_violation using message = 'log without schedule_id must be extra';
    end if;
    new.schedule_time := null;
  elsif new.is_extra then
    new.schedule_time := null;
  else
    new.schedule_time := old.schedule_time;
  end if;

  if tg_op = 'UPDATE' then
    new.client_request_id := old.client_request_id;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

commit;
