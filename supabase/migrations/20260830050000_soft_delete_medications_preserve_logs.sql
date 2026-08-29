begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.medications
  add column if not exists deleted_at timestamptz null;

alter table public.medications
  drop constraint if exists medications_deleted_inactive;
alter table public.medications
  add constraint medications_deleted_inactive
  check (deleted_at is null or not active)
  not valid;
alter table public.medications
  validate constraint medications_deleted_inactive;

drop index if exists public.medications_care_space_name_unique;
create unique index medications_care_space_name_unique
  on public.medications (care_space_id, lower(name))
  where deleted_at is null;
create index if not exists medications_care_space_visible_idx
  on public.medications (care_space_id, created_at)
  where deleted_at is null;

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
  elsif new.schedule_id is distinct from old.schedule_id then
    if new.is_extra then
      new.schedule_time := null;
    else
      new.schedule_time := old.schedule_time;
    end if;
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

drop policy if exists medication_schedules_member_select
  on public.medication_schedules;
create policy medication_schedules_member_select
  on public.medication_schedules for select to authenticated
  using (
    (select private.is_care_space_member(care_space_id))
    and exists (
      select 1
        from public.medications as medication
        where medication.id = medication_schedules.medication_id
          and medication.care_space_id = medication_schedules.care_space_id
          and medication.deleted_at is null
    )
  );

drop policy if exists medication_schedules_owner_insert
  on public.medication_schedules;
create policy medication_schedules_owner_insert
  on public.medication_schedules for insert to authenticated
  with check (
    (select private.is_care_space_owner(care_space_id))
    and exists (
      select 1
        from public.medications as medication
        where medication.id = medication_schedules.medication_id
          and medication.care_space_id = medication_schedules.care_space_id
          and medication.deleted_at is null
    )
  );

drop policy if exists medication_schedules_owner_update
  on public.medication_schedules;
create policy medication_schedules_owner_update
  on public.medication_schedules for update to authenticated
  using ((select private.is_care_space_owner(care_space_id)))
  with check (
    (select private.is_care_space_owner(care_space_id))
    and exists (
      select 1
        from public.medications as medication
        where medication.id = medication_schedules.medication_id
          and medication.care_space_id = medication_schedules.care_space_id
          and medication.deleted_at is null
    )
  );

grant update (deleted_at) on table public.medications to authenticated;

create or replace function public.soft_delete_medication(
  p_care_space_id uuid,
  p_medication_id uuid
)
returns public.medications
language plpgsql
security invoker
set search_path = ''
as $$
declare
  selected_medication public.medications;
begin
  if (select auth.uid()) is null then
    raise insufficient_privilege using message = 'authentication required';
  end if;
  if not private.is_care_space_owner(p_care_space_id) then
    raise insufficient_privilege using message = 'care space owner required';
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

commit;
