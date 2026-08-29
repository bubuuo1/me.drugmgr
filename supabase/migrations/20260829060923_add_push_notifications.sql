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
    insert into private.push_deliveries (
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
      id,
      subscription_id,
      schedule_id,
      scheduled_for,
      status,
      attempt_count
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
