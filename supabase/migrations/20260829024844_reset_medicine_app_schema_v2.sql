-- 투약 관리 앱: 단일 익명 사용자를 위한 reset 스키마
-- 주의: 아래 스크립트는 기존 네 테이블과 데이터를 명시적으로 삭제한다.

begin;

drop table if exists public.medication_logs cascade;
drop table if exists public.daily_status cascade;
drop table if exists public.medication_schedules cascade;
drop table if exists public.medications cascade;
drop function if exists public.set_medication_log_snapshot() cascade;
drop function if exists public.set_updated_at() cascade;

create extension if not exists "pgcrypto";

create table public.medications (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  unit text not null default '정',
  active boolean not null default true,
  quantity_options jsonb not null default '[1,2,3,4]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint medications_name_valid check (
    name = btrim(name) and char_length(name) between 1 and 100
  ),
  constraint medications_unit_valid check (
    unit = btrim(unit) and char_length(unit) <= 20
  ),
  constraint medications_quantity_options_valid check (
    jsonb_typeof(quantity_options) = 'array'
    and jsonb_array_length(quantity_options) <= 50
    and not jsonb_path_exists(
      quantity_options,
      '$[*] ? (@.type() != "number" || @ <= 0 || @ > 1000)'
    )
  )
);

create unique index medications_name_unique
  on public.medications (lower(name));
create index medications_active_idx
  on public.medications (created_at)
  where active;

create table public.medication_schedules (
  id uuid primary key default gen_random_uuid(),
  medication_id uuid not null
    references public.medications(id) on update restrict on delete restrict,
  time time(0) without time zone not null,
  default_quantity numeric(8,3) not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint medication_schedules_quantity_valid check (
    default_quantity > 0 and default_quantity <= 1000
  ),
  constraint medication_schedules_medication_time_unique
    unique (medication_id, time)
);

create index medication_schedules_medication_id_idx
  on public.medication_schedules (medication_id);
create index medication_schedules_active_time_idx
  on public.medication_schedules (time)
  where active;

create table public.medication_logs (
  id uuid primary key default gen_random_uuid(),
  client_request_id uuid not null,
  medication_id uuid not null
    references public.medications(id) on update restrict on delete restrict,
  schedule_id uuid null
    references public.medication_schedules(id) on update restrict on delete set null,
  medication_name text not null,
  medication_unit text not null,
  schedule_time time(0) without time zone null,
  taken_at timestamptz not null default now(),
  quantity numeric(8,3) not null,
  note text null,
  is_extra boolean not null,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint medication_logs_client_request_id_unique unique (client_request_id),
  constraint medication_logs_quantity_valid check (quantity > 0 and quantity <= 1000),
  constraint medication_logs_name_snapshot_valid check (
    char_length(medication_name) between 1 and 100
  ),
  constraint medication_logs_unit_snapshot_valid check (
    char_length(medication_unit) <= 20
  ),
  constraint medication_logs_note_valid check (
    note is null or char_length(note) <= 2000
  ),
  constraint medication_logs_extra_schedule_valid check (
    not is_extra or schedule_id is null
  )
);

create index medication_logs_active_taken_at_idx
  on public.medication_logs (taken_at desc)
  where deleted_at is null;
create index medication_logs_active_medication_taken_at_idx
  on public.medication_logs (medication_id, taken_at desc)
  where deleted_at is null;
create index medication_logs_schedule_id_idx
  on public.medication_logs (schedule_id)
  where schedule_id is not null;
create index medication_logs_deleted_at_idx
  on public.medication_logs (deleted_at desc)
  where deleted_at is not null;

create table public.daily_status (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  fatigue text null,
  strength text null,
  breathing text null,
  eye_symptom text null,
  note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_status_date_unique unique (date),
  constraint daily_status_fatigue_valid check (
    fatigue is null or fatigue in ('좋음', '보통', '나쁨')
  ),
  constraint daily_status_strength_valid check (
    strength is null or strength in ('좋음', '보통', '나쁨')
  ),
  constraint daily_status_breathing_valid check (
    breathing is null or breathing in ('편안함', '평소와 다름')
  ),
  constraint daily_status_eye_symptom_valid check (
    eye_symptom is null or eye_symptom in ('없음', '있음')
  ),
  constraint daily_status_note_valid check (
    note is null or char_length(note) <= 2000
  )
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

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
  if tg_op = 'INSERT' or new.medication_id is distinct from old.medication_id then
    select medication.name, medication.unit
      into selected_medication_name, selected_medication_unit
      from public.medications as medication
      where medication.id = new.medication_id;

    if not found then
      raise foreign_key_violation using message = 'medication_id does not exist';
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
      where schedule.id = new.schedule_id;

    if not found then
      raise foreign_key_violation using message = 'schedule_id does not exist';
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
    -- A user turning a record into an extra dose clears the schedule snapshot.
    -- FK ON DELETE SET NULL keeps is_extra=false and therefore preserves it.
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

create trigger medications_set_updated_at
  before update on public.medications
  for each row execute function public.set_updated_at();
create trigger medication_schedules_set_updated_at
  before update on public.medication_schedules
  for each row execute function public.set_updated_at();
create trigger medication_logs_set_snapshot
  before insert or update on public.medication_logs
  for each row execute function public.set_medication_log_snapshot();
create trigger medication_logs_set_updated_at
  before update on public.medication_logs
  for each row execute function public.set_updated_at();
create trigger daily_status_set_updated_at
  before update on public.daily_status
  for each row execute function public.set_updated_at();

insert into public.medications (id, name, unit, active, quantity_options)
values
  ('00000000-0000-4000-8000-000000000001', '메스티논', '정', true, '[0.5,1,1.5,2]'::jsonb),
  ('00000000-0000-4000-8000-000000000002', '소론도', '정', true, '[1,2,3,4,5,6,7,8]'::jsonb),
  ('00000000-0000-4000-8000-000000000003', '셉트린정', '', true, '[]'::jsonb);

alter table public.medications enable row level security;
alter table public.medication_schedules enable row level security;
alter table public.medication_logs enable row level security;
alter table public.daily_status enable row level security;

create policy medications_anon_select
  on public.medications for select to anon using (true);
create policy medications_anon_insert
  on public.medications for insert to anon with check (true);
create policy medications_anon_update
  on public.medications for update to anon using (true) with check (true);

create policy medication_schedules_anon_select
  on public.medication_schedules for select to anon using (true);
create policy medication_schedules_anon_insert
  on public.medication_schedules for insert to anon with check (true);
create policy medication_schedules_anon_update
  on public.medication_schedules for update to anon using (true) with check (true);
create policy medication_schedules_anon_delete
  on public.medication_schedules for delete to anon using (true);

create policy medication_logs_anon_select
  on public.medication_logs for select to anon using (true);
create policy medication_logs_anon_insert
  on public.medication_logs for insert to anon with check (true);
create policy medication_logs_anon_update
  on public.medication_logs for update to anon using (true) with check (true);

create policy daily_status_anon_select
  on public.daily_status for select to anon using (true);
create policy daily_status_anon_insert
  on public.daily_status for insert to anon with check (true);
create policy daily_status_anon_update
  on public.daily_status for update to anon using (true) with check (true);
create policy daily_status_anon_delete
  on public.daily_status for delete to anon using (true);

revoke all on table public.medications from anon, authenticated;
revoke all on table public.medication_schedules from anon, authenticated;
revoke all on table public.medication_logs from anon, authenticated;
revoke all on table public.daily_status from anon, authenticated;

grant usage on schema public to anon;
grant select on table public.medications to anon;
grant insert (name, unit, active, quantity_options)
  on table public.medications to anon;
grant update (name, unit, active, quantity_options)
  on table public.medications to anon;

grant select on table public.medication_schedules to anon;
grant insert (medication_id, time, default_quantity, active)
  on table public.medication_schedules to anon;
grant update (medication_id, time, default_quantity, active)
  on table public.medication_schedules to anon;
grant delete on table public.medication_schedules to anon;

grant select on table public.medication_logs to anon;
grant insert (
  client_request_id,
  medication_id,
  schedule_id,
  taken_at,
  quantity,
  note,
  is_extra
) on table public.medication_logs to anon;
grant update (
  medication_id,
  schedule_id,
  taken_at,
  quantity,
  note,
  is_extra,
  deleted_at
) on table public.medication_logs to anon;

grant select on table public.daily_status to anon;
grant insert (date, fatigue, strength, breathing, eye_symptom, note)
  on table public.daily_status to anon;
grant update (fatigue, strength, breathing, eye_symptom, note)
  on table public.daily_status to anon;
grant delete on table public.daily_status to anon;

revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.set_medication_log_snapshot() from public, anon, authenticated;

commit;
