begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function private.can_manage_medication_settings(
  p_care_space_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
      from public.care_space_members as member
      where member.care_space_id = p_care_space_id
        and member.user_id = (select auth.uid())
        and member.role in ('owner', 'caregiver')
  );
$$;

revoke all on function private.can_manage_medication_settings(uuid)
  from public, anon, authenticated;
grant execute on function private.can_manage_medication_settings(uuid)
  to authenticated;

drop policy if exists medications_owner_insert on public.medications;
drop policy if exists medications_owner_update on public.medications;
drop policy if exists medications_manager_insert on public.medications;
drop policy if exists medications_manager_update on public.medications;

create policy medications_manager_insert
  on public.medications for insert to authenticated
  with check ((select private.can_manage_medication_settings(care_space_id)));
create policy medications_manager_update
  on public.medications for update to authenticated
  using ((select private.can_manage_medication_settings(care_space_id)))
  with check ((select private.can_manage_medication_settings(care_space_id)));

drop policy if exists medication_schedules_owner_insert
  on public.medication_schedules;
drop policy if exists medication_schedules_owner_update
  on public.medication_schedules;
drop policy if exists medication_schedules_owner_delete
  on public.medication_schedules;
drop policy if exists medication_schedules_manager_insert
  on public.medication_schedules;
drop policy if exists medication_schedules_manager_update
  on public.medication_schedules;
drop policy if exists medication_schedules_manager_delete
  on public.medication_schedules;

create policy medication_schedules_manager_insert
  on public.medication_schedules for insert to authenticated
  with check (
    (select private.can_manage_medication_settings(care_space_id))
    and exists (
      select 1
        from public.medications as medication
        where medication.id = medication_schedules.medication_id
          and medication.care_space_id = medication_schedules.care_space_id
          and medication.deleted_at is null
    )
  );
create policy medication_schedules_manager_update
  on public.medication_schedules for update to authenticated
  using ((select private.can_manage_medication_settings(care_space_id)))
  with check (
    (select private.can_manage_medication_settings(care_space_id))
    and exists (
      select 1
        from public.medications as medication
        where medication.id = medication_schedules.medication_id
          and medication.care_space_id = medication_schedules.care_space_id
          and medication.deleted_at is null
    )
  );
create policy medication_schedules_manager_delete
  on public.medication_schedules for delete to authenticated
  using ((select private.can_manage_medication_settings(care_space_id)));

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

commit;
