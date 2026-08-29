-- 투약 관리 앱: 단일 익명 사용자를 위한 reset 스키마
-- 주의: 아래 스크립트는 기존 앱 테이블과 푸시 구독 데이터를 명시적으로 삭제한다.

begin;

create schema if not exists private;
drop table if exists private.push_deliveries cascade;
drop table if exists private.push_subscriptions cascade;
drop function if exists private.push_dispatch_secret_matches(text) cascade;
drop function if exists public.register_push_subscription(
  text, text, text, timestamptz
) cascade;
drop function if exists public.register_push_subscription(
  text, text, text, text, timestamptz
) cascade;
drop function if exists public.unregister_push_subscription(text) cascade;
drop function if exists public.unregister_push_subscription(text, text, text) cascade;
drop function if exists public.get_push_subscription_for_test(text, text) cascade;
drop function if exists public.get_push_subscription_for_test(
  text, text, text
) cascade;
drop function if exists public.claim_due_push_notifications(
  text, timestamptz
) cascade;
drop function if exists public.complete_push_delivery(
  text, uuid, boolean, integer, text, boolean
) cascade;
drop function if exists public.complete_push_delivery(
  text, uuid, smallint, boolean, integer, text, boolean
) cascade;

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
grant update (time, default_quantity, active)
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
grant update (date, fatigue, strength, breathing, eye_symptom, note)
  on table public.daily_status to anon;
grant delete on table public.daily_status to anon;

revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.set_medication_log_snapshot() from public, anon, authenticated;

-- PWA Web Push support without authentication or offline application caching.
-- Push data lives in a non-exposed schema and is accessed through narrow RPCs.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  expiration_time timestamptz null,
  disabled_at timestamptz null,
  last_seen_at timestamptz not null default now(),
  last_success_at timestamptz null,
  last_failure_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_subscriptions_endpoint_valid check (
    char_length(endpoint) between 1 and 2048
    and octet_length(endpoint) <= 2048
  ),
  constraint push_subscriptions_p256dh_valid check (
    char_length(p256dh) between 8 and 512
  ),
  constraint push_subscriptions_auth_valid check (
    char_length(auth) between 8 and 512
  )
);

create index push_subscriptions_active_idx
  on private.push_subscriptions (last_seen_at desc)
  where disabled_at is null;

create table private.push_deliveries (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null
    references private.push_subscriptions(id) on delete cascade,
  schedule_id uuid not null
    references public.medication_schedules(id) on delete cascade,
  scheduled_for timestamptz not null,
  status text not null,
  attempt_count smallint not null default 0,
  response_status integer null,
  error_code text null,
  attempted_at timestamptz null,
  accepted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_deliveries_status_valid check (
    status in ('pending', 'accepted', 'failed', 'skipped')
  ),
  constraint push_deliveries_attempt_count_valid check (
    attempt_count between 0 and 10
  ),
  constraint push_deliveries_response_status_valid check (
    response_status is null or response_status between 100 and 599
  ),
  constraint push_deliveries_once_per_schedule unique (
    subscription_id,
    schedule_id,
    scheduled_for
  )
);

create index push_deliveries_pending_idx
  on private.push_deliveries (scheduled_for)
  where status in ('pending', 'failed');
create index push_deliveries_schedule_id_idx
  on private.push_deliveries (schedule_id);
create index medication_logs_schedule_taken_at_idx
  on public.medication_logs (schedule_id, taken_at)
  where schedule_id is not null and deleted_at is null;

alter table private.push_subscriptions enable row level security;
alter table private.push_deliveries enable row level security;
revoke all on table private.push_subscriptions from public, anon, authenticated;
revoke all on table private.push_deliveries from public, anon, authenticated;

create trigger push_subscriptions_set_updated_at
  before update on private.push_subscriptions
  for each row execute function public.set_updated_at();
create trigger push_deliveries_set_updated_at
  before update on private.push_deliveries
  for each row execute function public.set_updated_at();

create or replace function private.push_dispatch_secret_matches(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_secret is not null
    and (
      select count(*) from vault.decrypted_secrets
        where name = 'push_dispatch_secret'
    ) = 1
    and exists (
    select 1
      from vault.decrypted_secrets as secret
      where secret.name = 'push_dispatch_secret'
        and extensions.digest(secret.decrypted_secret, 'sha256') =
          extensions.digest(p_secret, 'sha256')
  );
$$;

revoke execute on function private.push_dispatch_secret_matches(text)
  from public, anon, authenticated;

create or replace function public.register_push_subscription(
  p_dispatch_secret text,
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
begin
  if not private.push_dispatch_secret_matches(p_dispatch_secret) then
    raise insufficient_privilege using message = 'invalid push dispatch secret';
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
    endpoint,
    p256dh,
    auth,
    expiration_time,
    disabled_at,
    last_seen_at
  ) values (
    p_endpoint,
    p_p256dh,
    p_auth,
    p_expiration_time,
    null,
    now()
  )
  on conflict (endpoint) do update set
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    expiration_time = excluded.expiration_time,
    disabled_at = null,
    last_seen_at = now()
    where push_subscriptions.auth = excluded.auth;
  if not found then
    raise insufficient_privilege using message = 'push subscription owner mismatch';
  end if;
  return true;
end;
$$;

create or replace function public.unregister_push_subscription(
  p_dispatch_secret text,
  p_endpoint text,
  p_auth text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.push_dispatch_secret_matches(p_dispatch_secret) then
    raise insufficient_privilege using message = 'invalid push dispatch secret';
  end if;

  update private.push_subscriptions
    set disabled_at = coalesce(disabled_at, now())
    where endpoint = p_endpoint and auth = p_auth;
  return found;
end;
$$;

create or replace function public.get_push_subscription_for_test(
  p_dispatch_secret text,
  p_endpoint text,
  p_auth text
)
returns table (endpoint text, p256dh text, auth text)
language sql
stable
security definer
set search_path = ''
as $$
  select subscription.endpoint, subscription.p256dh, subscription.auth
    from private.push_subscriptions as subscription
    where private.push_dispatch_secret_matches(p_dispatch_secret)
      and subscription.endpoint = p_endpoint
      and subscription.auth = p_auth
      and subscription.disabled_at is null
      and (
        subscription.expiration_time is null
        or subscription.expiration_time > now()
      )
    limit 1;
$$;

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
      and exists (
        select 1
          from public.medication_logs as log
          where log.schedule_id = delivery.schedule_id
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
      );

  return query
  with bounds as (
    select
      date_trunc('minute', p_now) - interval '3 minutes' as lower_bound,
      date_trunc('minute', p_now) as upper_bound
  ),
  schedule_dates as (
    select generated::date as schedule_date
      from bounds,
      lateral generate_series(
        (lower_bound at time zone 'Asia/Seoul')::date,
        (upper_bound at time zone 'Asia/Seoul')::date,
        interval '1 day'
      ) as generated
  ),
  candidate_times as (
    select
      subscription.id as subscription_id,
      schedule.id as schedule_id,
      schedule.medication_id,
      medication.name as medication_name,
      schedule.time as schedule_time,
      schedule_date.schedule_date,
      (
        schedule_date.schedule_date + schedule.time
      ) at time zone 'Asia/Seoul' as scheduled_for
      from private.push_subscriptions as subscription
      cross join public.medication_schedules as schedule
      join public.medications as medication on medication.id = schedule.medication_id
      cross join schedule_dates as schedule_date
      where subscription.disabled_at is null
        and (
          subscription.expiration_time is null
          or subscription.expiration_time > p_now
        )
        and schedule.active
        and medication.active
  ),
  due as (
    select
      candidate.*,
      exists (
        select 1
          from public.medication_logs as log
          where log.schedule_id = candidate.schedule_id
            and log.deleted_at is null
            and log.taken_at >= (
              candidate.schedule_date::timestamp at time zone 'Asia/Seoul'
            )
            and log.taken_at < (
              (candidate.schedule_date + 1)::timestamp at time zone 'Asia/Seoul'
            )
      ) as already_recorded
      from candidate_times as candidate
      cross join bounds
      where candidate.scheduled_for >= bounds.lower_bound
        and candidate.scheduled_for <= bounds.upper_bound
  ),
  inserted as (
    insert into private.push_deliveries as new_delivery (
      subscription_id,
      schedule_id,
      scheduled_for,
      status,
      attempt_count,
      attempted_at
    )
    select
      due.subscription_id,
      due.schedule_id,
      due.scheduled_for,
      case when due.already_recorded then 'skipped' else 'pending' end,
      case when due.already_recorded then 0 else 1 end,
      case when due.already_recorded then null else p_now end
      from due
    on conflict (subscription_id, schedule_id, scheduled_for) do nothing
    returning
      new_delivery.id,
      new_delivery.subscription_id,
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
      join public.medications as medication
        on medication.id = schedule.medication_id
      cross join bounds
      where delivery.status in ('pending', 'failed')
        and delivery.scheduled_for >
          bounds.lower_bound - interval '2 minutes'
        and delivery.scheduled_for <= bounds.upper_bound
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
        delivery.schedule_id,
        delivery.scheduled_for,
        delivery.attempt_count
  ),
  claimed as (
    select
      inserted.id,
      inserted.subscription_id,
      inserted.schedule_id,
      inserted.scheduled_for,
      inserted.attempt_count
      from inserted
      where inserted.status = 'pending'
    union all
    select
      reclaimed.id,
      reclaimed.subscription_id,
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
    to_char(schedule.time, 'HH24:MI') || ' ' || medication.name || ' 예정',
    '투약 기록을 확인해 주세요.',
    '/log?med=' || schedule.medication_id::text ||
      '&schedule=' || schedule.id::text,
    'schedule-' || replace(schedule.id::text, '-', '') || '-' ||
      to_char(claimed.scheduled_for at time zone 'Asia/Seoul', 'YYYYMMDD')
    from claimed
    join private.push_subscriptions as subscription
      on subscription.id = claimed.subscription_id
    join public.medication_schedules as schedule
      on schedule.id = claimed.schedule_id
    join public.medications as medication
      on medication.id = schedule.medication_id
    order by claimed.scheduled_for, claimed.id;
end;
$$;

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

  if not found then return false; end if;

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

revoke execute on function public.register_push_subscription(
  text, text, text, text, timestamptz
)
  from public, authenticated;
revoke execute on function public.unregister_push_subscription(text, text, text)
  from public, authenticated;
revoke execute on function public.get_push_subscription_for_test(text, text, text)
  from public, authenticated;
revoke execute on function public.claim_due_push_notifications(text, timestamptz)
  from public, authenticated;
revoke execute on function public.complete_push_delivery(
  text, uuid, smallint, boolean, integer, text, boolean
) from public, authenticated;

grant execute on function public.register_push_subscription(
  text, text, text, text, timestamptz
)
  to anon;
grant execute on function public.unregister_push_subscription(text, text, text)
  to anon;
grant execute on function public.get_push_subscription_for_test(text, text, text)
  to anon;
grant execute on function public.claim_due_push_notifications(text, timestamptz)
  to anon;
grant execute on function public.complete_push_delivery(
  text, uuid, smallint, boolean, integer, text, boolean
) to anon;

do $$
declare
  dispatch_url_count integer;
  dispatch_secret_count integer;
begin
  select count(*) into dispatch_url_count
    from vault.decrypted_secrets where name = 'push_dispatch_url';
  select count(*) into dispatch_secret_count
    from vault.decrypted_secrets where name = 'push_dispatch_secret';

  if dispatch_url_count <> 1 or dispatch_secret_count <> 1 then
    raise exception
      'exactly one push_dispatch_url and push_dispatch_secret Vault entry are required';
  end if;

  if exists (select 1 from cron.job where jobname = 'medicine-push-dispatch') then
    perform cron.unschedule('medicine-push-dispatch');
  end if;
  perform cron.schedule(
    'medicine-push-dispatch',
    '* * * * *',
    $job$
      select net.http_post(
        url := (
          select decrypted_secret from vault.decrypted_secrets
            where name = 'push_dispatch_url'
        ),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (
            select decrypted_secret from vault.decrypted_secrets
              where name = 'push_dispatch_secret'
          )
        ),
        body := jsonb_build_object('triggered_at', now()),
        timeout_milliseconds := 15000
      ) as request_id;
    $job$
  );
end;
$$;

commit;
