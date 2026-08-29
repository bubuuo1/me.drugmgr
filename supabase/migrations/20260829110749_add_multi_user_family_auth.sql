-- Add authenticated multi-user care spaces, family sharing, and isolated push targets.
-- Existing medicine records are intentionally left in an unclaimed legacy care space.

begin;

create extension if not exists "pgcrypto";
create schema if not exists private;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '사용자',
  avatar_url text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_valid check (
    display_name = btrim(display_name)
    and char_length(display_name) between 1 and 100
  ),
  constraint profiles_avatar_url_valid check (
    avatar_url is null or char_length(avatar_url) <= 2048
  )
);

create table public.care_spaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid null references auth.users(id) on delete set null
    default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint care_spaces_name_valid check (
    name = btrim(name) and char_length(name) between 1 and 100
  )
);

create table public.care_space_members (
  care_space_id uuid not null
    references public.care_spaces(id) on delete cascade,
  user_id uuid not null
    references public.profiles(user_id) on delete cascade,
  role text not null,
  invited_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (care_space_id, user_id),
  constraint care_space_members_role_valid check (
    role in ('owner', 'caregiver', 'viewer')
  )
);

create index care_space_members_user_space_idx
  on public.care_space_members (user_id, care_space_id);
create index care_space_members_owner_idx
  on public.care_space_members (care_space_id, user_id)
  where role = 'owner';
create index care_space_members_invited_by_idx
  on public.care_space_members (invited_by)
  where invited_by is not null;

create table public.care_space_invites (
  id uuid primary key default gen_random_uuid(),
  care_space_id uuid not null
    references public.care_spaces(id) on delete cascade,
  email text not null,
  role text not null default 'caregiver',
  status text not null default 'pending',
  invited_by uuid not null references auth.users(id) on delete restrict,
  accepted_by uuid null references auth.users(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  responded_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint care_space_invites_email_valid check (
    email = lower(btrim(email))
    and char_length(email) between 3 and 320
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  constraint care_space_invites_role_valid check (
    role in ('caregiver', 'viewer')
  ),
  constraint care_space_invites_status_valid check (
    status in ('pending', 'accepted', 'declined', 'revoked', 'expired')
  ),
  constraint care_space_invites_expiry_valid check (expires_at > created_at),
  constraint care_space_invites_response_valid check (
    (status = 'pending' and responded_at is null and accepted_by is null)
    or (status = 'accepted' and responded_at is not null)
    or (status in ('declined', 'revoked', 'expired')
      and responded_at is not null and accepted_by is null)
  )
);

create unique index care_space_invites_pending_email_unique
  on public.care_space_invites (care_space_id, email)
  where status = 'pending';
create index care_space_invites_space_status_idx
  on public.care_space_invites (care_space_id, status, created_at desc);
create index care_space_invites_pending_expiry_idx
  on public.care_space_invites (expires_at)
  where status = 'pending';
create index care_space_invites_recipient_pending_idx
  on public.care_space_invites (email, created_at desc)
  where status = 'pending';

create or replace function private.is_care_space_member(p_care_space_id uuid)
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
  );
$$;

create or replace function private.is_care_space_owner(p_care_space_id uuid)
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
        and member.role = 'owner'
  );
$$;

create or replace function private.can_mutate_care_records(p_care_space_id uuid)
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

create or replace function private.shares_care_space(p_other_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
      from public.care_space_members as mine
      join public.care_space_members as theirs
        on theirs.care_space_id = mine.care_space_id
      where mine.user_id = (select auth.uid())
        and theirs.user_id = p_other_user_id
  );
$$;

revoke all on function private.is_care_space_member(uuid)
  from public, anon, authenticated;
revoke all on function private.is_care_space_owner(uuid)
  from public, anon, authenticated;
revoke all on function private.can_mutate_care_records(uuid)
  from public, anon, authenticated;
revoke all on function private.shares_care_space(uuid)
  from public, anon, authenticated;
grant execute on function private.is_care_space_member(uuid) to authenticated;
grant execute on function private.is_care_space_owner(uuid) to authenticated;
grant execute on function private.can_mutate_care_records(uuid) to authenticated;
grant execute on function private.shares_care_space(uuid) to authenticated;

create or replace function private.set_audit_actor()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    if caller_id is not null then
      new.created_by := caller_id;
      new.updated_by := caller_id;
    end if;
  elsif caller_id is not null then
    new.created_by := old.created_by;
    new.updated_by := caller_id;
  end if;
  return new;
end;
$$;

create or replace function private.add_care_space_creator_as_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is not null then
    insert into public.care_space_members (
      care_space_id,
      user_id,
      role
    ) values (
      new.id,
      new.created_by,
      'owner'
    )
    on conflict (care_space_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

create or replace function private.handle_medicine_app_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_display_name text;
  selected_avatar_url text;
begin
  selected_display_name := nullif(
    left(
      btrim(
        coalesce(
          new.raw_user_meta_data ->> 'full_name',
          new.raw_user_meta_data ->> 'name',
          ''
        )
      ),
      100
    ),
    ''
  );
  selected_avatar_url := nullif(
    left(btrim(coalesce(new.raw_user_meta_data ->> 'avatar_url', '')), 2048),
    ''
  );

  insert into public.profiles (user_id, display_name, avatar_url)
  values (new.id, coalesce(selected_display_name, '사용자'), selected_avatar_url)
  on conflict (user_id) do nothing;

  if not exists (
    select 1
      from public.care_space_members as member
      where member.user_id = new.id and member.role = 'owner'
  ) then
    insert into public.care_spaces (name, created_by)
    values (
      left(
        case
          when selected_display_name is null then '내 복약 기록'
          else selected_display_name || '의 복약 기록'
        end,
        100
      ),
      new.id
    );
  end if;

  return new;
end;
$$;

revoke all on function private.set_audit_actor()
  from public, anon, authenticated;
revoke all on function private.add_care_space_creator_as_owner()
  from public, anon, authenticated;
revoke all on function private.handle_medicine_app_new_user()
  from public, anon, authenticated;

create trigger care_spaces_add_creator_as_owner
  after insert on public.care_spaces
  for each row execute function private.add_care_space_creator_as_owner();

drop trigger if exists medicine_app_on_auth_user_created on auth.users;
create trigger medicine_app_on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_medicine_app_new_user();

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger care_spaces_set_updated_at
  before update on public.care_spaces
  for each row execute function public.set_updated_at();
create trigger care_space_members_set_updated_at
  before update on public.care_space_members
  for each row execute function public.set_updated_at();
create trigger care_space_invites_set_updated_at
  before update on public.care_space_invites
  for each row execute function public.set_updated_at();

-- Preserve every pre-auth medicine row without assigning it to the first login.
insert into public.care_spaces (
  id,
  name,
  created_by
) values (
  '00000000-0000-4000-8000-000000000100',
  '기존 데이터 (미지정)',
  null
);

-- Backfill users that existed before this migration. This creates empty personal
-- spaces only; it never adds the legacy prescriptions to those spaces.
insert into public.profiles (user_id, display_name, avatar_url)
select
  auth_user.id,
  coalesce(nullif(
    left(
      btrim(
        coalesce(
          auth_user.raw_user_meta_data ->> 'full_name',
          auth_user.raw_user_meta_data ->> 'name',
          ''
        )
      ),
      100
    ),
    ''
  ), '사용자'),
  nullif(
    left(
      btrim(coalesce(auth_user.raw_user_meta_data ->> 'avatar_url', '')),
      2048
    ),
    ''
  )
from auth.users as auth_user
on conflict (user_id) do nothing;

insert into public.care_spaces (name, created_by)
select
  left(
    case
      when nullif(
        btrim(
          coalesce(
            auth_user.raw_user_meta_data ->> 'full_name',
            auth_user.raw_user_meta_data ->> 'name',
            ''
          )
        ),
        ''
      ) is null then '내 복약 기록'
      else nullif(
        btrim(
          coalesce(
            auth_user.raw_user_meta_data ->> 'full_name',
            auth_user.raw_user_meta_data ->> 'name',
            ''
          )
        ),
        ''
      ) || '의 복약 기록'
    end,
    100
  ),
  auth_user.id
from auth.users as auth_user
where not exists (
  select 1
    from public.care_space_members as member
    where member.user_id = auth_user.id and member.role = 'owner'
);

alter table public.medications
  add column care_space_id uuid null,
  add column created_by uuid null references auth.users(id) on delete set null,
  add column updated_by uuid null references auth.users(id) on delete set null;
alter table public.medication_schedules
  add column care_space_id uuid null,
  add column created_by uuid null references auth.users(id) on delete set null,
  add column updated_by uuid null references auth.users(id) on delete set null;
alter table public.medication_logs
  add column care_space_id uuid null,
  add column created_by uuid null references auth.users(id) on delete set null,
  add column updated_by uuid null references auth.users(id) on delete set null;
alter table public.daily_status
  add column care_space_id uuid null,
  add column created_by uuid null references auth.users(id) on delete set null,
  add column updated_by uuid null references auth.users(id) on delete set null;

update public.medications
  set care_space_id = '00000000-0000-4000-8000-000000000100';
update public.medication_schedules
  set care_space_id = '00000000-0000-4000-8000-000000000100';
update public.medication_logs
  set care_space_id = '00000000-0000-4000-8000-000000000100';
update public.daily_status
  set care_space_id = '00000000-0000-4000-8000-000000000100';

alter table public.medications alter column care_space_id set not null;
alter table public.medication_schedules alter column care_space_id set not null;
alter table public.medication_logs alter column care_space_id set not null;
alter table public.daily_status alter column care_space_id set not null;

drop index if exists public.medications_name_unique;
alter table public.medication_schedules
  drop constraint if exists medication_schedules_medication_time_unique;
alter table public.daily_status
  drop constraint if exists daily_status_date_unique;
alter table public.medication_logs
  drop constraint if exists medication_logs_client_request_id_unique;

alter table public.medications
  add constraint medications_care_space_id_fkey
    foreign key (care_space_id) references public.care_spaces(id) on delete cascade,
  add constraint medications_id_care_space_unique unique (id, care_space_id);
create unique index medications_care_space_name_unique
  on public.medications (care_space_id, lower(name));

alter table public.medication_schedules
  add constraint medication_schedules_care_space_id_fkey
    foreign key (care_space_id) references public.care_spaces(id) on delete cascade,
  add constraint medication_schedules_id_care_space_unique
    unique (id, care_space_id),
  add constraint medication_schedules_medication_care_space_fkey
    foreign key (medication_id, care_space_id)
    references public.medications(id, care_space_id)
    on update restrict on delete restrict,
  add constraint medication_schedules_medication_time_unique
    unique (care_space_id, medication_id, time);

alter table public.medication_logs
  add constraint medication_logs_care_space_id_fkey
    foreign key (care_space_id) references public.care_spaces(id) on delete cascade,
  add constraint medication_logs_medication_care_space_fkey
    foreign key (medication_id, care_space_id)
    references public.medications(id, care_space_id)
    on update restrict on delete restrict,
  add constraint medication_logs_schedule_care_space_fkey
    foreign key (schedule_id, care_space_id)
    references public.medication_schedules(id, care_space_id)
    on update restrict on delete set null (schedule_id),
  add constraint medication_logs_care_space_client_request_id_unique
    unique (care_space_id, client_request_id);

alter table public.daily_status
  add constraint daily_status_care_space_id_fkey
    foreign key (care_space_id) references public.care_spaces(id) on delete cascade,
  add constraint daily_status_care_space_date_unique
    unique (care_space_id, date);

create index medications_care_space_active_idx
  on public.medications (care_space_id, created_at)
  where active;
create index medication_schedules_care_space_active_time_idx
  on public.medication_schedules (care_space_id, time)
  where active;
create index medication_logs_care_space_taken_at_idx
  on public.medication_logs (care_space_id, taken_at desc)
  where deleted_at is null;
create index medication_logs_care_space_schedule_taken_at_idx
  on public.medication_logs (care_space_id, schedule_id, taken_at)
  where schedule_id is not null and deleted_at is null;
create index medication_logs_care_space_id_idx
  on public.medication_logs (care_space_id);
create index medication_logs_medication_care_space_idx
  on public.medication_logs (medication_id, care_space_id);
create index daily_status_care_space_date_idx
  on public.daily_status (care_space_id, date desc);

create trigger medications_set_audit_actor
  before insert or update on public.medications
  for each row execute function private.set_audit_actor();
create trigger medication_schedules_set_audit_actor
  before insert or update on public.medication_schedules
  for each row execute function private.set_audit_actor();
create trigger medication_logs_set_audit_actor
  before insert or update on public.medication_logs
  for each row execute function private.set_audit_actor();
create trigger daily_status_set_audit_actor
  before insert or update on public.daily_status
  for each row execute function private.set_audit_actor();

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
        and medication.care_space_id = new.care_space_id;

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

alter table public.profiles enable row level security;
alter table public.care_spaces enable row level security;
alter table public.care_space_members enable row level security;
alter table public.care_space_invites enable row level security;

drop policy if exists medications_anon_select on public.medications;
drop policy if exists medications_anon_insert on public.medications;
drop policy if exists medications_anon_update on public.medications;
drop policy if exists medication_schedules_anon_select on public.medication_schedules;
drop policy if exists medication_schedules_anon_insert on public.medication_schedules;
drop policy if exists medication_schedules_anon_update on public.medication_schedules;
drop policy if exists medication_schedules_anon_delete on public.medication_schedules;
drop policy if exists medication_logs_anon_select on public.medication_logs;
drop policy if exists medication_logs_anon_insert on public.medication_logs;
drop policy if exists medication_logs_anon_update on public.medication_logs;
drop policy if exists daily_status_anon_select on public.daily_status;
drop policy if exists daily_status_anon_insert on public.daily_status;
drop policy if exists daily_status_anon_update on public.daily_status;
drop policy if exists daily_status_anon_delete on public.daily_status;

create policy profiles_authenticated_select
  on public.profiles for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.shares_care_space(user_id))
  );
create policy profiles_authenticated_update
  on public.profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy care_spaces_member_select
  on public.care_spaces for select to authenticated
  using ((select private.is_care_space_member(id)));
create policy care_spaces_authenticated_insert
  on public.care_spaces for insert to authenticated
  with check (created_by = (select auth.uid()));
create policy care_spaces_owner_update
  on public.care_spaces for update to authenticated
  using ((select private.is_care_space_owner(id)))
  with check ((select private.is_care_space_owner(id)));

create policy care_space_members_member_select
  on public.care_space_members for select to authenticated
  using ((select private.is_care_space_member(care_space_id)));
create policy care_space_invites_owner_select
  on public.care_space_invites for select to authenticated
  using ((select private.is_care_space_owner(care_space_id)));
create policy medications_member_select
  on public.medications for select to authenticated
  using ((select private.is_care_space_member(care_space_id)));
create policy medications_owner_insert
  on public.medications for insert to authenticated
  with check ((select private.is_care_space_owner(care_space_id)));
create policy medications_owner_update
  on public.medications for update to authenticated
  using ((select private.is_care_space_owner(care_space_id)))
  with check ((select private.is_care_space_owner(care_space_id)));

create policy medication_schedules_member_select
  on public.medication_schedules for select to authenticated
  using ((select private.is_care_space_member(care_space_id)));
create policy medication_schedules_owner_insert
  on public.medication_schedules for insert to authenticated
  with check ((select private.is_care_space_owner(care_space_id)));
create policy medication_schedules_owner_update
  on public.medication_schedules for update to authenticated
  using ((select private.is_care_space_owner(care_space_id)))
  with check ((select private.is_care_space_owner(care_space_id)));
create policy medication_schedules_owner_delete
  on public.medication_schedules for delete to authenticated
  using ((select private.is_care_space_owner(care_space_id)));

create policy medication_logs_member_select
  on public.medication_logs for select to authenticated
  using ((select private.is_care_space_member(care_space_id)));
create policy medication_logs_caregiver_insert
  on public.medication_logs for insert to authenticated
  with check ((select private.can_mutate_care_records(care_space_id)));
create policy medication_logs_caregiver_update
  on public.medication_logs for update to authenticated
  using ((select private.can_mutate_care_records(care_space_id)))
  with check ((select private.can_mutate_care_records(care_space_id)));

create policy daily_status_member_select
  on public.daily_status for select to authenticated
  using ((select private.is_care_space_member(care_space_id)));
create policy daily_status_caregiver_insert
  on public.daily_status for insert to authenticated
  with check ((select private.can_mutate_care_records(care_space_id)));
create policy daily_status_caregiver_update
  on public.daily_status for update to authenticated
  using ((select private.can_mutate_care_records(care_space_id)))
  with check ((select private.can_mutate_care_records(care_space_id)));
create policy daily_status_caregiver_delete
  on public.daily_status for delete to authenticated
  using ((select private.can_mutate_care_records(care_space_id)));

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.care_spaces from anon, authenticated;
revoke all on table public.care_space_members from anon, authenticated;
revoke all on table public.care_space_invites from anon, authenticated;
revoke all on table public.medications from anon, authenticated;
revoke all on table public.medication_schedules from anon, authenticated;
revoke all on table public.medication_logs from anon, authenticated;
revoke all on table public.daily_status from anon, authenticated;

grant usage on schema public to authenticated, anon;
grant usage on schema public, private to service_role;
grant select on table public.profiles to authenticated;
grant update (display_name, avatar_url) on table public.profiles to authenticated;

grant select on table public.care_spaces to authenticated;
grant insert (name) on table public.care_spaces to authenticated;
grant update (name) on table public.care_spaces to authenticated;

grant select on table public.care_space_members to authenticated;
grant select on table public.care_space_invites to authenticated;

grant select on table public.medications to authenticated;
grant insert (care_space_id, name, unit, active, quantity_options)
  on table public.medications to authenticated;
grant update (name, unit, active, quantity_options)
  on table public.medications to authenticated;

grant select on table public.medication_schedules to authenticated;
grant insert (care_space_id, medication_id, time, active)
  on table public.medication_schedules to authenticated;
grant update (time, active)
  on table public.medication_schedules to authenticated;
grant delete on table public.medication_schedules to authenticated;

grant select on table public.medication_logs to authenticated;
grant insert (
  care_space_id,
  client_request_id,
  medication_id,
  schedule_id,
  taken_at,
  quantity,
  note,
  is_extra
) on table public.medication_logs to authenticated;
grant update (
  medication_id,
  schedule_id,
  taken_at,
  quantity,
  note,
  is_extra,
  deleted_at
) on table public.medication_logs to authenticated;

grant select on table public.daily_status to authenticated;
grant insert (
  care_space_id,
  date,
  fatigue,
  strength,
  breathing,
  eye_symptom,
  note
) on table public.daily_status to authenticated;
grant update (date, fatigue, strength, breathing, eye_symptom, note)
  on table public.daily_status to authenticated;
grant delete on table public.daily_status to authenticated;

-- New projects may not expose tables automatically; keep service-role access explicit.
grant all on table public.profiles to service_role;
grant all on table public.care_spaces to service_role;
grant all on table public.care_space_members to service_role;
grant all on table public.care_space_invites to service_role;
grant all on table public.medications to service_role;
grant all on table public.medication_schedules to service_role;
grant all on table public.medication_logs to service_role;
grant all on table public.daily_status to service_role;

create or replace function public.create_care_space_invite(
  p_care_space_id uuid,
  p_email text,
  p_role text default 'caregiver',
  p_expires_at timestamptz default (now() + interval '7 days')
)
returns public.care_space_invites
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  normalized_email text := lower(btrim(p_email));
  selected_invite public.care_space_invites;
begin
  if caller_id is null then
    raise insufficient_privilege using message = 'authentication required';
  end if;
  if not private.is_care_space_owner(p_care_space_id) then
    raise insufficient_privilege using message = 'care space owner required';
  end if;
  if normalized_email is null
    or char_length(normalized_email) not between 3 and 320
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  then
    raise check_violation using message = 'invalid invite email';
  end if;
  if p_role is null or p_role not in ('caregiver', 'viewer') then
    raise check_violation using message = 'invalid invite role';
  end if;
  if p_expires_at is null or p_expires_at <= now() then
    raise check_violation using message = 'invite expiry must be in the future';
  end if;

  update public.care_space_invites as invite
    set status = 'expired',
        responded_at = now(),
        accepted_by = null
    where invite.care_space_id = p_care_space_id
      and invite.email = normalized_email
      and invite.status = 'pending'
      and invite.expires_at <= now();

  insert into public.care_space_invites (
    care_space_id,
    email,
    role,
    status,
    invited_by,
    expires_at
  ) values (
    p_care_space_id,
    normalized_email,
    p_role,
    'pending',
    caller_id,
    p_expires_at
  )
  on conflict (care_space_id, email) where status = 'pending'
  do update set
    role = excluded.role,
    invited_by = excluded.invited_by,
    expires_at = excluded.expires_at
  returning * into selected_invite;

  return selected_invite;
end;
$$;

create or replace function public.get_pending_care_space_invites()
returns table (
  id uuid,
  care_space_id uuid,
  email text,
  role text,
  status text,
  invited_by uuid,
  accepted_by uuid,
  expires_at timestamptz,
  responded_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  care_space_name text,
  inviter_display_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_email text;
begin
  if caller_id is null then
    raise insufficient_privilege using message = 'authentication required';
  end if;

  select lower(btrim(auth_user.email)) into caller_email
    from auth.users as auth_user
    where auth_user.id = caller_id
      and auth_user.email_confirmed_at is not null;
  if caller_email is null then
    raise insufficient_privilege using message = 'verified account email required';
  end if;

  return query
    select
      invite.id,
      invite.care_space_id,
      invite.email,
      invite.role,
      invite.status,
      invite.invited_by,
      invite.accepted_by,
      invite.expires_at,
      invite.responded_at,
      invite.created_at,
      invite.updated_at,
      care_space.name,
      coalesce(inviter.display_name, '사용자')
    from public.care_space_invites as invite
    join public.care_spaces as care_space
      on care_space.id = invite.care_space_id
    left join public.profiles as inviter
      on inviter.user_id = invite.invited_by
    where invite.email = caller_email
      and invite.status = 'pending'
      and invite.expires_at > now()
    order by invite.created_at desc;
end;
$$;

create or replace function public.accept_care_space_invite(p_invite_id uuid)
returns public.care_space_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_email text;
  caller_email_confirmed_at timestamptz;
  selected_invite public.care_space_invites;
  selected_member public.care_space_members;
begin
  if caller_id is null then
    raise insufficient_privilege using message = 'authentication required';
  end if;

  select lower(auth_user.email), auth_user.email_confirmed_at
    into caller_email, caller_email_confirmed_at
    from auth.users as auth_user
    where auth_user.id = caller_id;

  if caller_email is null or caller_email_confirmed_at is null then
    raise insufficient_privilege using message = 'verified account email required';
  end if;

  select invite.* into selected_invite
    from public.care_space_invites as invite
    where invite.id = p_invite_id
    for update;

  if not found then
    raise no_data_found using message = 'invite not found';
  end if;
  if selected_invite.email <> caller_email then
    raise insufficient_privilege using message = 'invite recipient mismatch';
  end if;

  if selected_invite.status = 'accepted'
    and selected_invite.accepted_by = caller_id
  then
    select member.* into selected_member
      from public.care_space_members as member
      where member.care_space_id = selected_invite.care_space_id
        and member.user_id = caller_id;
    if found then
      return selected_member;
    end if;
  end if;

  if selected_invite.status <> 'pending' then
    raise check_violation using message = 'invite is not pending';
  end if;
  if selected_invite.expires_at <= now() then
    raise check_violation using message = 'invite has expired';
  end if;

  insert into public.care_space_members (
    care_space_id,
    user_id,
    role,
    invited_by
  ) values (
    selected_invite.care_space_id,
    caller_id,
    selected_invite.role,
    selected_invite.invited_by
  )
  on conflict (care_space_id, user_id) do nothing;

  update public.care_space_invites as invite
    set status = 'accepted',
        accepted_by = caller_id,
        responded_at = now()
    where invite.id = selected_invite.id;

  select member.* into selected_member
    from public.care_space_members as member
    where member.care_space_id = selected_invite.care_space_id
      and member.user_id = caller_id;
  return selected_member;
end;
$$;

create or replace function public.decline_care_space_invite(p_invite_id uuid)
returns public.care_space_invites
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_email text;
  caller_email_confirmed_at timestamptz;
  selected_invite public.care_space_invites;
begin
  if caller_id is null then
    raise insufficient_privilege using message = 'authentication required';
  end if;

  select lower(auth_user.email), auth_user.email_confirmed_at
    into caller_email, caller_email_confirmed_at
    from auth.users as auth_user
    where auth_user.id = caller_id;
  if caller_email is null or caller_email_confirmed_at is null then
    raise insufficient_privilege using message = 'verified account email required';
  end if;

  select invite.* into selected_invite
    from public.care_space_invites as invite
    where invite.id = p_invite_id
    for update;
  if not found then
    raise no_data_found using message = 'invite not found';
  end if;
  if selected_invite.email <> caller_email then
    raise insufficient_privilege using message = 'invite recipient mismatch';
  end if;
  if selected_invite.status = 'declined' then
    return selected_invite;
  end if;
  if selected_invite.status <> 'pending' then
    raise check_violation using message = 'invite is not pending';
  end if;
  if selected_invite.expires_at <= now() then
    raise check_violation using message = 'invite has expired';
  end if;

  update public.care_space_invites as invite
    set status = 'declined',
        accepted_by = null,
        responded_at = now()
    where invite.id = selected_invite.id
    returning invite.* into selected_invite;
  return selected_invite;
end;
$$;

create or replace function public.revoke_care_space_invite(p_invite_id uuid)
returns public.care_space_invites
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  selected_invite public.care_space_invites;
begin
  if caller_id is null then
    raise insufficient_privilege using message = 'authentication required';
  end if;

  select invite.* into selected_invite
    from public.care_space_invites as invite
    where invite.id = p_invite_id
    for update;
  if not found then
    raise no_data_found using message = 'invite not found';
  end if;
  if not private.is_care_space_owner(selected_invite.care_space_id) then
    raise insufficient_privilege using message = 'care space owner required';
  end if;
  if selected_invite.status = 'revoked' then
    return selected_invite;
  end if;
  if selected_invite.status <> 'pending' then
    raise check_violation using message = 'invite is not pending';
  end if;

  update public.care_space_invites as invite
    set status = 'revoked',
        accepted_by = null,
        responded_at = now()
    where invite.id = selected_invite.id
    returning invite.* into selected_invite;
  return selected_invite;
end;
$$;

create or replace function public.remove_care_space_member(
  p_care_space_id uuid,
  p_user_id uuid
)
returns public.care_space_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  selected_member public.care_space_members;
begin
  if caller_id is null then
    raise insufficient_privilege using message = 'authentication required';
  end if;
  if not private.is_care_space_owner(p_care_space_id) then
    raise insufficient_privilege using message = 'care space owner required';
  end if;

  select member.* into selected_member
    from public.care_space_members as member
    where member.care_space_id = p_care_space_id
      and member.user_id = p_user_id
    for update;
  if not found then
    raise no_data_found using message = 'care space member not found';
  end if;
  if selected_member.role = 'owner' then
    raise check_violation using message = 'owner membership cannot be removed';
  end if;

  delete from public.care_space_members as member
    where member.care_space_id = selected_member.care_space_id
      and member.user_id = selected_member.user_id;
  return selected_member;
end;
$$;

revoke all on function public.create_care_space_invite(uuid, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.get_pending_care_space_invites()
  from public, anon, authenticated;
revoke all on function public.accept_care_space_invite(uuid)
  from public, anon, authenticated;
revoke all on function public.decline_care_space_invite(uuid)
  from public, anon, authenticated;
revoke all on function public.revoke_care_space_invite(uuid)
  from public, anon, authenticated;
revoke all on function public.remove_care_space_member(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.create_care_space_invite(uuid, text, text, timestamptz)
  to authenticated;
grant execute on function public.get_pending_care_space_invites()
  to authenticated;
grant execute on function public.accept_care_space_invite(uuid)
  to authenticated;
grant execute on function public.decline_care_space_invite(uuid)
  to authenticated;
grant execute on function public.revoke_care_space_invite(uuid)
  to authenticated;
grant execute on function public.remove_care_space_member(uuid, uuid)
  to authenticated;

-- Existing anonymous subscriptions cannot be assigned to a user safely. Keep
-- them for audit/retry history, but disable them until the same endpoint/auth
-- key is explicitly reclaimed by an authenticated user.
alter table private.push_subscriptions
  add column user_id uuid null references auth.users(id) on delete cascade;

update private.push_subscriptions
  set disabled_at = coalesce(disabled_at, now())
  where user_id is null;

alter table private.push_subscriptions
  add constraint push_subscriptions_active_owner_valid check (
    user_id is not null or disabled_at is not null
  ),
  add constraint push_subscriptions_id_user_unique unique (id, user_id);

create index push_subscriptions_user_active_idx
  on private.push_subscriptions (user_id, last_seen_at desc)
  where disabled_at is null;
create index push_subscriptions_user_id_idx
  on private.push_subscriptions (user_id)
  where user_id is not null;

create table private.push_subscription_spaces (
  subscription_id uuid not null,
  user_id uuid not null,
  care_space_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (subscription_id, care_space_id),
  constraint push_subscription_spaces_subscription_user_fkey
    foreign key (subscription_id, user_id)
    references private.push_subscriptions(id, user_id) on delete cascade,
  constraint push_subscription_spaces_member_fkey
    foreign key (care_space_id, user_id)
    references public.care_space_members(care_space_id, user_id) on delete cascade
);

create index push_subscription_spaces_space_user_idx
  on private.push_subscription_spaces (care_space_id, user_id, subscription_id);
create index push_subscription_spaces_user_idx
  on private.push_subscription_spaces (user_id, subscription_id);

alter table private.push_subscription_spaces enable row level security;
revoke all on table private.push_subscription_spaces
  from public, anon, authenticated;
grant all on table private.push_subscriptions to service_role;
grant all on table private.push_subscription_spaces to service_role;
grant all on table private.push_deliveries to service_role;

alter table private.push_deliveries add column care_space_id uuid null;
update private.push_deliveries as delivery
  set care_space_id = schedule.care_space_id
  from public.medication_schedules as schedule
  where schedule.id = delivery.schedule_id;
alter table private.push_deliveries alter column care_space_id set not null;
alter table private.push_deliveries
  drop constraint if exists push_deliveries_schedule_id_fkey,
  add constraint push_deliveries_schedule_care_space_fkey
    foreign key (schedule_id, care_space_id)
    references public.medication_schedules(id, care_space_id) on delete cascade;

create index push_deliveries_space_schedule_idx
  on private.push_deliveries (care_space_id, schedule_id);

drop function if exists public.register_push_subscription(
  text, text, text, text, timestamptz
);
drop function if exists public.unregister_push_subscription(text, text, text);
drop function if exists public.get_push_subscription_for_test(text, text, text);

create or replace function public.register_push_subscription(
  p_dispatch_secret text,
  p_care_space_id uuid,
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_expiration_time timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  selected_subscription_id uuid;
begin
  if caller_id is null then
    raise insufficient_privilege using message = 'authentication required';
  end if;
  if not private.push_dispatch_secret_matches(p_dispatch_secret) then
    raise insufficient_privilege using message = 'invalid push dispatch secret';
  end if;
  if not private.is_care_space_member(p_care_space_id) then
    raise insufficient_privilege using message = 'active care space membership required';
  end if;

  if p_endpoint is null
    or char_length(p_endpoint) not between 1 and 2048
    or octet_length(p_endpoint) > 2048
    or (
      p_endpoint !~ '^https://(fcm\.googleapis\.com|web\.push\.apple\.com|updates\.push\.services\.mozilla\.com)/'
      and p_endpoint !~ '^https://[^/]+\.notify\.windows\.com/'
    ) then
    raise check_violation using message = 'unsupported push endpoint';
  end if;
  if p_p256dh is null
    or char_length(p_p256dh) not between 8 and 512
    or p_p256dh !~ '^[A-Za-z0-9_-]+={0,2}$'
    or octet_length(
      decode(
        translate(rtrim(p_p256dh, '='), '-_', '+/') ||
          repeat('=', (4 - char_length(rtrim(p_p256dh, '=')) % 4) % 4),
        'base64'
      )
    ) <> 65 then
    raise check_violation using message = 'invalid p256dh key';
  end if;
  if p_auth is null
    or char_length(p_auth) not between 8 and 512
    or p_auth !~ '^[A-Za-z0-9_-]+={0,2}$'
    or octet_length(
      decode(
        translate(rtrim(p_auth, '='), '-_', '+/') ||
          repeat('=', (4 - char_length(rtrim(p_auth, '=')) % 4) % 4),
        'base64'
      )
    ) <> 16 then
    raise check_violation using message = 'invalid auth key';
  end if;

  insert into private.push_subscriptions (
    user_id,
    endpoint,
    p256dh,
    auth,
    expiration_time,
    disabled_at,
    last_seen_at
  ) values (
    caller_id,
    p_endpoint,
    p_p256dh,
    p_auth,
    p_expiration_time,
    null,
    now()
  )
  on conflict (endpoint) do update set
    user_id = excluded.user_id,
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    expiration_time = excluded.expiration_time,
    disabled_at = null,
    last_seen_at = now()
    where private.push_subscriptions.auth = excluded.auth
      and (
        private.push_subscriptions.user_id = caller_id
        or (
          private.push_subscriptions.user_id is null
          and private.push_subscriptions.disabled_at is not null
        )
      )
  returning id into selected_subscription_id;

  if selected_subscription_id is null then
    raise insufficient_privilege using message = 'push subscription owner mismatch';
  end if;

  insert into private.push_subscription_spaces (
    subscription_id,
    user_id,
    care_space_id
  ) values (
    selected_subscription_id,
    caller_id,
    p_care_space_id
  )
  on conflict (subscription_id, care_space_id) do nothing;

  return true;
end;
$$;

create or replace function public.unregister_push_subscription(
  p_dispatch_secret text,
  p_care_space_id uuid,
  p_endpoint text,
  p_auth text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  selected_subscription_id uuid;
  removed_target boolean := false;
begin
  if caller_id is null then
    raise insufficient_privilege using message = 'authentication required';
  end if;
  if not private.push_dispatch_secret_matches(p_dispatch_secret) then
    raise insufficient_privilege using message = 'invalid push dispatch secret';
  end if;
  if not private.is_care_space_member(p_care_space_id) then
    raise insufficient_privilege using message = 'active care space membership required';
  end if;

  select subscription.id into selected_subscription_id
    from private.push_subscriptions as subscription
    where subscription.user_id = caller_id
      and subscription.endpoint = p_endpoint
      and subscription.auth = p_auth
    for update;

  if not found then
    return false;
  end if;

  delete from private.push_subscription_spaces as target
    where target.subscription_id = selected_subscription_id
      and target.user_id = caller_id
      and target.care_space_id = p_care_space_id;
  removed_target := found;

  if not exists (
    select 1
      from private.push_subscription_spaces as target
      where target.subscription_id = selected_subscription_id
  ) then
    update private.push_subscriptions as subscription
      set disabled_at = coalesce(subscription.disabled_at, now())
      where subscription.id = selected_subscription_id;
  end if;

  return removed_target;
end;
$$;

create or replace function public.get_push_subscription_for_test(
  p_dispatch_secret text,
  p_care_space_id uuid,
  p_endpoint text,
  p_auth text
)
returns table (
  care_space_id uuid,
  endpoint text,
  p256dh text,
  auth text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
begin
  if caller_id is null then
    raise insufficient_privilege using message = 'authentication required';
  end if;
  if not private.push_dispatch_secret_matches(p_dispatch_secret) then
    raise insufficient_privilege using message = 'invalid push dispatch secret';
  end if;
  if not private.is_care_space_member(p_care_space_id) then
    raise insufficient_privilege using message = 'active care space membership required';
  end if;

  return query
  select
    target.care_space_id,
    subscription.endpoint,
    subscription.p256dh,
    subscription.auth
    from private.push_subscriptions as subscription
    join private.push_subscription_spaces as target
      on target.subscription_id = subscription.id
      and target.user_id = subscription.user_id
    join public.care_space_members as member
      on member.care_space_id = target.care_space_id
      and member.user_id = target.user_id
    where subscription.user_id = caller_id
      and target.care_space_id = p_care_space_id
      and subscription.endpoint = p_endpoint
      and subscription.auth = p_auth
      and subscription.disabled_at is null
      and (
        subscription.expiration_time is null
        or subscription.expiration_time > now()
      )
    limit 1;
end;
$$;

revoke all on function public.register_push_subscription(
  text, uuid, text, text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.unregister_push_subscription(
  text, uuid, text, text
) from public, anon, authenticated;
revoke all on function public.get_push_subscription_for_test(
  text, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.register_push_subscription(
  text, uuid, text, text, text, timestamptz
) to authenticated;
grant execute on function public.unregister_push_subscription(
  text, uuid, text, text
) to authenticated;
grant execute on function public.get_push_subscription_for_test(
  text, uuid, text, text
) to authenticated;

create or replace function private.push_delivery_is_sendable(
  p_delivery_id uuid,
  p_now timestamptz
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select p_now is not null and exists (
    select 1
      from private.push_deliveries as delivery
      join private.push_subscriptions as subscription
        on subscription.id = delivery.subscription_id
      join private.push_subscription_spaces as target
        on target.subscription_id = subscription.id
        and target.user_id = subscription.user_id
        and target.care_space_id = delivery.care_space_id
      join public.care_space_members as member
        on member.care_space_id = target.care_space_id
        and member.user_id = target.user_id
      join public.medication_schedules as schedule
        on schedule.id = delivery.schedule_id
        and schedule.care_space_id = delivery.care_space_id
      join public.medications as medication
        on medication.id = schedule.medication_id
        and medication.care_space_id = schedule.care_space_id
      where delivery.id = p_delivery_id
        and delivery.scheduled_for >
          date_trunc('minute', p_now) - interval '5 minutes'
        and delivery.scheduled_for <= date_trunc('minute', p_now)
        and (delivery.scheduled_for at time zone 'Asia/Seoul')::date =
          (p_now at time zone 'Asia/Seoul')::date
        and subscription.user_id is not null
        and subscription.disabled_at is null
        and (
          subscription.expiration_time is null
          or subscription.expiration_time > p_now
        )
        and schedule.active
        and medication.active
        and delivery.scheduled_for >= (
          (
            (delivery.scheduled_for at time zone 'Asia/Seoul')::date +
            schedule.time
          ) at time zone 'Asia/Seoul'
        )
        and mod(
          extract(
            epoch from (
              delivery.scheduled_for -
              (
                (
                  (delivery.scheduled_for at time zone 'Asia/Seoul')::date +
                  schedule.time
                ) at time zone 'Asia/Seoul'
              )
            )
          )::numeric,
          300
        ) = 0
        and not exists (
          select 1
            from public.medication_logs as log
            where log.care_space_id = delivery.care_space_id
              and log.schedule_id = delivery.schedule_id
              and log.deleted_at is null
              and log.taken_at >= (
                (delivery.scheduled_for at time zone 'Asia/Seoul')::date::timestamp
                  at time zone 'Asia/Seoul'
              )
              and log.taken_at < (
                (
                  (delivery.scheduled_for at time zone 'Asia/Seoul')::date + 1
                )::timestamp at time zone 'Asia/Seoul'
              )
        )
  );
$$;

revoke all on function private.push_delivery_is_sendable(uuid, timestamptz)
  from public, anon, authenticated;

create or replace function public.claim_due_push_notifications(
  p_dispatch_secret text,
  p_now timestamptz
)
returns table (
  delivery_id uuid,
  attempt_count smallint,
  endpoint text,
  p256dh text,
  auth text,
  title text,
  body text,
  url text,
  tag text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_now is null then
    raise null_value_not_allowed using message = 'p_now is required';
  end if;
  if not private.push_dispatch_secret_matches(p_dispatch_secret) then
    raise insufficient_privilege using message = 'invalid push dispatch secret';
  end if;

  update private.push_deliveries as delivery
    set status = 'skipped',
        error_code = null,
        response_status = null
    where delivery.status in ('pending', 'failed')
      and delivery.scheduled_for >
        date_trunc('minute', p_now) - interval '5 minutes'
      and delivery.scheduled_for <= date_trunc('minute', p_now)
      and not private.push_delivery_is_sendable(delivery.id, p_now);

  return query
  with bounds as (
    select
      date_trunc('minute', p_now) - interval '3 minutes' as lower_bound,
      date_trunc('minute', p_now) as upper_bound,
      (p_now at time zone 'Asia/Seoul')::date as schedule_date,
      (
        ((p_now at time zone 'Asia/Seoul')::date + 1)::timestamp
      ) at time zone 'Asia/Seoul' as day_ends_at
  ),
  daily_schedules as (
    select
      subscription.id as subscription_id,
      target.care_space_id,
      schedule.id as schedule_id,
      schedule.medication_id,
      medication.name as medication_name,
      schedule.time as schedule_time,
      bounds.schedule_date,
      bounds.lower_bound,
      bounds.upper_bound,
      bounds.day_ends_at,
      (
        bounds.schedule_date + schedule.time
      ) at time zone 'Asia/Seoul' as first_scheduled_for
      from private.push_subscriptions as subscription
      join private.push_subscription_spaces as target
        on target.subscription_id = subscription.id
        and target.user_id = subscription.user_id
      join public.care_space_members as member
        on member.care_space_id = target.care_space_id
        and member.user_id = target.user_id
      join public.medication_schedules as schedule
        on schedule.care_space_id = target.care_space_id
      join public.medications as medication
        on medication.id = schedule.medication_id
        and medication.care_space_id = schedule.care_space_id
      cross join bounds
      where subscription.user_id is not null
        and subscription.disabled_at is null
        and (
          subscription.expiration_time is null
          or subscription.expiration_time > p_now
        )
        and schedule.active
        and medication.active
  ),
  candidate_times as (
    select
      base.subscription_id,
      base.care_space_id,
      base.schedule_id,
      base.medication_id,
      base.medication_name,
      base.schedule_time,
      base.schedule_date,
      base.lower_bound,
      base.upper_bound,
      base.day_ends_at,
      base.first_scheduled_for +
        floor(
          extract(epoch from (base.upper_bound - base.first_scheduled_for)) / 300
        )::integer * interval '5 minutes' as scheduled_for
      from daily_schedules as base
      where base.first_scheduled_for <= base.upper_bound
  ),
  due as (
    select candidate.*
      from candidate_times as candidate
      where candidate.scheduled_for >= candidate.lower_bound
        and candidate.scheduled_for <= candidate.upper_bound
        and candidate.scheduled_for < candidate.day_ends_at
        and not exists (
          select 1
            from public.medication_logs as log
            where log.care_space_id = candidate.care_space_id
              and log.schedule_id = candidate.schedule_id
              and log.deleted_at is null
              and log.taken_at >= (
                candidate.schedule_date::timestamp at time zone 'Asia/Seoul'
              )
              and log.taken_at < candidate.day_ends_at
        )
  ),
  inserted as (
    insert into private.push_deliveries as new_delivery (
      subscription_id,
      care_space_id,
      schedule_id,
      scheduled_for,
      status,
      attempt_count,
      attempted_at
    )
    select
      due.subscription_id,
      due.care_space_id,
      due.schedule_id,
      due.scheduled_for,
      'pending',
      1,
      p_now
      from due
    on conflict (subscription_id, schedule_id, scheduled_for) do nothing
    returning
      new_delivery.id,
      new_delivery.subscription_id,
      new_delivery.care_space_id,
      new_delivery.schedule_id,
      new_delivery.scheduled_for,
      new_delivery.status,
      new_delivery.attempt_count
  ),
  claimable as (
    select delivery.id
      from private.push_deliveries as delivery
      join private.push_subscriptions as subscription
        on subscription.id = delivery.subscription_id
      join public.medication_schedules as schedule
        on schedule.id = delivery.schedule_id
        and schedule.care_space_id = delivery.care_space_id
      join public.medications as medication
        on medication.id = schedule.medication_id
        and medication.care_space_id = schedule.care_space_id
      cross join bounds
      where delivery.status in ('pending', 'failed')
        and delivery.scheduled_for >
          bounds.lower_bound - interval '2 minutes'
        and delivery.scheduled_for <= bounds.upper_bound
        and (delivery.scheduled_for at time zone 'Asia/Seoul')::date =
          bounds.schedule_date
        and delivery.attempt_count < 3
        and (
          delivery.attempted_at is null
          or delivery.attempted_at <= p_now - interval '45 seconds'
        )
        and subscription.disabled_at is null
        and (
          subscription.expiration_time is null
          or subscription.expiration_time > p_now
        )
        and schedule.active
        and medication.active
        and private.push_delivery_is_sendable(delivery.id, p_now)
      order by delivery.scheduled_for, delivery.id
      for update of delivery skip locked
  ),
  reclaimed as (
    update private.push_deliveries as delivery
      set status = 'pending',
          attempt_count = delivery.attempt_count + 1,
          attempted_at = p_now,
          response_status = null,
          error_code = null
      from claimable
      where delivery.id = claimable.id
      returning
        delivery.id,
        delivery.subscription_id,
        delivery.care_space_id,
        delivery.schedule_id,
        delivery.scheduled_for,
        delivery.attempt_count
  ),
  claimed as (
    select
      inserted.id,
      inserted.subscription_id,
      inserted.care_space_id,
      inserted.schedule_id,
      inserted.scheduled_for,
      inserted.attempt_count
      from inserted
      where inserted.status = 'pending'
    union all
    select
      reclaimed.id,
      reclaimed.subscription_id,
      reclaimed.care_space_id,
      reclaimed.schedule_id,
      reclaimed.scheduled_for,
      reclaimed.attempt_count
      from reclaimed
  )
  select
    claimed.id,
    claimed.attempt_count,
    subscription.endpoint,
    subscription.p256dh,
    subscription.auth,
    care_space.name || ' · ' ||
      to_char(schedule.time, 'HH24:MI') || ' ' || medication.name || ' 예정',
    '투약 기록을 확인해 주세요.',
    '/log?med=' || schedule.medication_id::text ||
      '&schedule=' || schedule.id::text ||
      '&space=' || claimed.care_space_id::text,
    'schedule-' || replace(schedule.id::text, '-', '') || '-' ||
      to_char(claimed.scheduled_for at time zone 'Asia/Seoul', 'YYYYMMDD')
    from claimed
    join private.push_subscriptions as subscription
      on subscription.id = claimed.subscription_id
    join public.care_spaces as care_space
      on care_space.id = claimed.care_space_id
    join public.medication_schedules as schedule
      on schedule.id = claimed.schedule_id
      and schedule.care_space_id = claimed.care_space_id
    join public.medications as medication
      on medication.id = schedule.medication_id
      and medication.care_space_id = schedule.care_space_id
    order by claimed.scheduled_for, claimed.id;
end;
$$;

create or replace function public.prepare_push_delivery_for_send(
  p_dispatch_secret text,
  p_delivery_id uuid,
  p_attempt_count smallint,
  p_now timestamptz
)
returns table (
  delivery_id uuid,
  attempt_count smallint,
  endpoint text,
  p256dh text,
  auth text,
  title text,
  body text,
  url text,
  tag text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_delivery_id is null
    or p_attempt_count is null
    or p_attempt_count < 1
    or p_now is null
  then
    raise null_value_not_allowed
      using message = 'delivery preparation values are required';
  end if;
  if not private.push_dispatch_secret_matches(p_dispatch_secret) then
    raise insufficient_privilege using message = 'invalid push dispatch secret';
  end if;

  return query
  with locked_delivery as (
    select
      delivery.id,
      delivery.subscription_id,
      delivery.care_space_id,
      delivery.schedule_id,
      delivery.scheduled_for,
      delivery.attempt_count
      from private.push_deliveries as delivery
      where delivery.id = p_delivery_id
        and delivery.status = 'pending'
        and delivery.attempt_count = p_attempt_count
      for update
  ),
  valid_delivery as (
    select
      locked.id,
      locked.subscription_id,
      locked.care_space_id,
      locked.schedule_id,
      locked.scheduled_for,
      locked.attempt_count
      from locked_delivery as locked
      where private.push_delivery_is_sendable(locked.id, p_now)
  ),
  skipped as (
    update private.push_deliveries as delivery
      set status = 'skipped',
          error_code = null,
          response_status = null
      from locked_delivery as locked
      where delivery.id = locked.id
        and not exists (select 1 from valid_delivery)
      returning delivery.id
  )
  select
    valid.id,
    valid.attempt_count,
    subscription.endpoint,
    subscription.p256dh,
    subscription.auth,
    care_space.name || ' · ' ||
      to_char(schedule.time, 'HH24:MI') || ' ' || medication.name || ' 예정',
    '투약 기록을 확인해 주세요.',
    '/log?med=' || schedule.medication_id::text ||
      '&schedule=' || schedule.id::text ||
      '&space=' || valid.care_space_id::text,
    'schedule-' || replace(schedule.id::text, '-', '') || '-' ||
      to_char(valid.scheduled_for at time zone 'Asia/Seoul', 'YYYYMMDD')
    from valid_delivery as valid
    join private.push_subscriptions as subscription
      on subscription.id = valid.subscription_id
    join public.care_spaces as care_space
      on care_space.id = valid.care_space_id
    join public.medication_schedules as schedule
      on schedule.id = valid.schedule_id
      and schedule.care_space_id = valid.care_space_id
    join public.medications as medication
      on medication.id = schedule.medication_id
      and medication.care_space_id = schedule.care_space_id
    where not exists (select 1 from skipped);
end;
$$;

-- The completion API keeps the original attempt token/idempotency behavior.
create or replace function public.complete_push_delivery(
  p_dispatch_secret text,
  p_delivery_id uuid,
  p_attempt_count smallint,
  p_success boolean,
  p_response_status integer default null,
  p_error_code text default null,
  p_disable_subscription boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_subscription_id uuid;
begin
  if p_attempt_count is null or p_attempt_count < 1 or p_success is null then
    raise null_value_not_allowed using message = 'delivery attempt result is required';
  end if;
  if not private.push_dispatch_secret_matches(p_dispatch_secret) then
    raise insufficient_privilege using message = 'invalid push dispatch secret';
  end if;

  update private.push_deliveries
    set status = case when p_success then 'accepted' else 'failed' end,
        response_status = p_response_status,
        error_code = p_error_code,
        accepted_at = case when p_success then now() else null end
    where id = p_delivery_id
      and status = 'pending'
      and attempt_count = p_attempt_count
    returning subscription_id into selected_subscription_id;

  if not found then
    return false;
  end if;

  update private.push_subscriptions
    set disabled_at = case
          when p_disable_subscription then coalesce(disabled_at, now())
          else disabled_at
        end,
        last_success_at = case when p_success then now() else last_success_at end,
        last_failure_at = case when p_success then last_failure_at else now() end
    where id = selected_subscription_id;
  return true;
end;
$$;

revoke all on function public.claim_due_push_notifications(text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.prepare_push_delivery_for_send(
  text, uuid, smallint, timestamptz
) from public, anon, authenticated;
revoke all on function public.complete_push_delivery(
  text, uuid, smallint, boolean, integer, text, boolean
) from public, anon, authenticated;

-- Dispatch workers still authenticate with the Vault-backed secret. The user
-- registration/test APIs above are deliberately not granted to anon.
grant execute on function public.claim_due_push_notifications(text, timestamptz)
  to anon;
grant execute on function public.prepare_push_delivery_for_send(
  text, uuid, smallint, timestamptz
) to anon;
grant execute on function public.complete_push_delivery(
  text, uuid, smallint, boolean, integer, text, boolean
) to anon;

commit;
