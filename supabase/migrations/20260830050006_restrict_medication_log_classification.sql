begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- A writer may explicitly reclassify a log as extra or connect it to a real
-- schedule, but may not manufacture the null/false sentinel that is reserved
-- for a schedule removed by the schedule foreign key.
create or replace function public.reclassify_medication_log(
  p_care_space_id uuid,
  p_log_id uuid,
  p_schedule_id uuid,
  p_is_extra boolean,
  p_update_taken_at boolean,
  p_taken_at timestamptz,
  p_update_quantity boolean,
  p_quantity numeric,
  p_update_note boolean,
  p_note text
)
returns public.medication_logs
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  selected_log public.medication_logs;
begin
  if caller_id is null then
    raise insufficient_privilege using message = 'authentication required';
  end if;
  if p_care_space_id is null or p_log_id is null or p_is_extra is null then
    raise not_null_violation
      using message = 'care space, log and classification are required';
  end if;
  if p_update_taken_at is null
    or p_update_quantity is null
    or p_update_note is null
  then
    raise not_null_violation using message = 'update flags are required';
  end if;
  if not private.can_mutate_care_records(p_care_space_id) then
    raise insufficient_privilege using message = 'care record writer required';
  end if;

  select log.* into selected_log
    from public.medication_logs as log
    where log.id = p_log_id
      and log.care_space_id = p_care_space_id
      and log.deleted_at is null
    for update;
  if not found then
    raise no_data_found using message = 'medication log not found';
  end if;

  if p_schedule_id is null and not p_is_extra then
    raise check_violation
      using message = 'only a deleted schedule may retain scheduled classification without schedule_id';
  end if;
  if p_schedule_id is not null and p_is_extra then
    raise check_violation using message = 'scheduled medication log cannot be extra';
  end if;
  if p_schedule_id is not null and not exists (
    select 1
      from public.medication_schedules as schedule
      where schedule.id = p_schedule_id
        and schedule.care_space_id = p_care_space_id
        and schedule.medication_id = selected_log.medication_id
  ) then
    raise foreign_key_violation
      using message = 'schedule_id does not belong to medication log';
  end if;
  if p_update_taken_at and p_taken_at is null then
    raise not_null_violation using message = 'taken_at is required';
  end if;
  if p_update_quantity and p_quantity is null then
    raise not_null_violation using message = 'quantity is required';
  end if;

  update public.medication_logs as log
    set schedule_id = p_schedule_id,
        is_extra = p_is_extra,
        taken_at = case
          when p_update_taken_at then p_taken_at
          else log.taken_at
        end,
        quantity = case
          when p_update_quantity then p_quantity
          else log.quantity
        end,
        note = case
          when p_update_note then p_note
          else log.note
        end
    where log.id = selected_log.id
      and log.care_space_id = selected_log.care_space_id
    returning log.* into selected_log;

  return selected_log;
end;
$$;

-- Remove any broad UPDATE grant first, retain ordinary edit/undo columns, and
-- require the checked RPC for schedule_id/is_extra changes.
revoke update on table public.medication_logs from authenticated;
revoke update (medication_id, schedule_id, is_extra)
  on table public.medication_logs from authenticated;
grant update (taken_at, quantity, note, deleted_at)
  on table public.medication_logs to authenticated;

revoke all on function public.reclassify_medication_log(
  uuid, uuid, uuid, boolean, boolean, timestamptz, boolean, numeric, boolean, text
) from public, anon, authenticated;
grant execute on function public.reclassify_medication_log(
  uuid, uuid, uuid, boolean, boolean, timestamptz, boolean, numeric, boolean, text
) to authenticated;

commit;
