begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Medication deletion must always deactivate linked schedules in the same
-- transaction. The RPC performs explicit caller and role checks.
revoke update (deleted_at)
  on table public.medications from authenticated;

create or replace function public.soft_delete_medication(
  p_care_space_id uuid,
  p_medication_id uuid
)
returns public.medications
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_medication public.medications;
begin
  if (select auth.uid()) is null then
    raise insufficient_privilege using message = 'authentication required';
  end if;
  if not private.can_manage_medication_settings(p_care_space_id) then
    raise insufficient_privilege using message = 'medication manager required';
  end if;

  select medication.* into selected_medication
    from public.medications as medication
    where medication.id = p_medication_id
      and medication.care_space_id = p_care_space_id
      and medication.deleted_at is null
    for update;
  if not found then
    raise no_data_found using message = 'medication not found';
  end if;

  update public.medication_schedules as schedule
    set active = false
    where schedule.care_space_id = p_care_space_id
      and schedule.medication_id = p_medication_id
      and schedule.active;

  update public.medications as medication
    set active = false,
        deleted_at = now()
    where medication.id = p_medication_id
      and medication.care_space_id = p_care_space_id
      and medication.deleted_at is null
    returning medication.* into selected_medication;

  return selected_medication;
end;
$$;

revoke all on function public.soft_delete_medication(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.soft_delete_medication(uuid, uuid)
  to authenticated;

-- The date identifies a status row and must not be movable by a direct update.
-- Upsert through a checked RPC while leaving ordinary content edits RLS-bound.
revoke update (date)
  on table public.daily_status from authenticated;

create or replace function public.upsert_daily_status(
  p_care_space_id uuid,
  p_date date,
  p_fatigue text,
  p_strength text,
  p_breathing text,
  p_eye_symptom text,
  p_note text
)
returns public.daily_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  selected_status public.daily_status;
begin
  if caller_id is null then
    raise insufficient_privilege using message = 'authentication required';
  end if;
  if p_care_space_id is null or p_date is null then
    raise not_null_violation using message = 'care space and date are required';
  end if;
  if not private.can_mutate_care_records(p_care_space_id) then
    raise insufficient_privilege using message = 'care record writer required';
  end if;

  insert into public.daily_status (
    care_space_id,
    date,
    fatigue,
    strength,
    breathing,
    eye_symptom,
    note
  ) values (
    p_care_space_id,
    p_date,
    p_fatigue,
    p_strength,
    p_breathing,
    p_eye_symptom,
    p_note
  )
  on conflict (care_space_id, date) do update
    set fatigue = excluded.fatigue,
        strength = excluded.strength,
        breathing = excluded.breathing,
        eye_symptom = excluded.eye_symptom,
        note = excluded.note
  returning * into selected_status;

  return selected_status;
end;
$$;

revoke all on function public.upsert_daily_status(
  uuid, date, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.upsert_daily_status(
  uuid, date, text, text, text, text, text
) to authenticated;

commit;
