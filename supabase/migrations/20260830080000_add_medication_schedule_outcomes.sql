begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.medication_schedule_outcomes (
  id uuid primary key default gen_random_uuid(),
  care_space_id uuid not null
    constraint medication_schedule_outcomes_care_space_id_fkey
    references public.care_spaces(id) on delete cascade,
  client_request_id uuid not null,
  medication_id uuid not null
    constraint medication_schedule_outcomes_medication_id_fkey
    references public.medications(id) on update restrict on delete restrict,
  schedule_id uuid null
    constraint medication_schedule_outcomes_schedule_id_fkey
    references public.medication_schedules(id)
    on update restrict on delete set null,
  medication_name text not null,
  medication_unit text not null,
  schedule_time time(0) without time zone not null,
  scheduled_date date not null,
  outcome text not null,
  note text null,
  deleted_at timestamptz null,
  created_by uuid null references auth.users(id) on delete set null,
  updated_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint medication_schedule_outcomes_care_space_client_request_unique
    unique (care_space_id, client_request_id),
  constraint medication_schedule_outcomes_medication_care_space_fkey
    foreign key (medication_id, care_space_id)
    references public.medications(id, care_space_id)
    on update restrict on delete restrict,
  constraint medication_schedule_outcomes_schedule_care_space_fkey
    foreign key (schedule_id, care_space_id)
    references public.medication_schedules(id, care_space_id)
    on update restrict on delete set null (schedule_id),
  constraint medication_schedule_outcomes_name_snapshot_valid check (
    char_length(medication_name) between 1 and 100
  ),
  constraint medication_schedule_outcomes_unit_snapshot_valid check (
    char_length(medication_unit) <= 20
  ),
  constraint medication_schedule_outcomes_value_valid check (
    outcome in ('not_taken', 'medication_unavailable')
  ),
  constraint medication_schedule_outcomes_note_valid check (
    note is null or char_length(note) <= 2000
  )
);

create unique index medication_schedule_outcomes_active_occurrence_unique
  on public.medication_schedule_outcomes (
    care_space_id,
    schedule_id,
    scheduled_date
  )
  where schedule_id is not null and deleted_at is null;
create index medication_schedule_outcomes_active_date_idx
  on public.medication_schedule_outcomes (care_space_id, scheduled_date, schedule_time)
  where deleted_at is null;
create index medication_schedule_outcomes_medication_care_space_idx
  on public.medication_schedule_outcomes (medication_id, care_space_id);
create index medication_schedule_outcomes_schedule_care_space_idx
  on public.medication_schedule_outcomes (schedule_id, care_space_id)
  where schedule_id is not null;

create or replace function public.set_medication_schedule_outcome_snapshot()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  selected_medication_id uuid;
  selected_medication_name text;
  selected_medication_unit text;
  selected_schedule_time time(0) without time zone;
begin
  if tg_op = 'INSERT' then
    if new.schedule_id is null then
      raise not_null_violation using message = 'schedule_id is required';
    end if;

    select
      medication.id,
      medication.name,
      medication.unit,
      schedule.time
      into
        selected_medication_id,
        selected_medication_name,
        selected_medication_unit,
        selected_schedule_time
      from public.medication_schedules as schedule
      join public.medications as medication
        on medication.id = schedule.medication_id
        and medication.care_space_id = schedule.care_space_id
      where schedule.id = new.schedule_id
        and schedule.care_space_id = new.care_space_id
        and medication.deleted_at is null;
    if not found then
      raise foreign_key_violation
        using message = 'schedule_id does not belong to care_space_id';
    end if;

    new.medication_id := selected_medication_id;
    new.medication_name := selected_medication_name;
    new.medication_unit := selected_medication_unit;
    new.schedule_time := selected_schedule_time;
  else
    if new.care_space_id is distinct from old.care_space_id then
      raise check_violation using message = 'care_space_id cannot be changed';
    end if;
    if new.schedule_id is distinct from old.schedule_id
      and new.schedule_id is not null
    then
      raise check_violation using message = 'schedule_id cannot be changed';
    end if;

    new.client_request_id := old.client_request_id;
    new.medication_id := old.medication_id;
    new.medication_name := old.medication_name;
    new.medication_unit := old.medication_unit;
    new.schedule_time := old.schedule_time;
    new.scheduled_date := old.scheduled_date;
    new.created_at := old.created_at;
  end if;

  return new;
end;
$$;

create trigger medication_schedule_outcomes_set_audit_actor
  before insert or update on public.medication_schedule_outcomes
  for each row execute function private.set_audit_actor();
create trigger medication_schedule_outcomes_set_snapshot
  before insert or update on public.medication_schedule_outcomes
  for each row execute function public.set_medication_schedule_outcome_snapshot();
create trigger medication_schedule_outcomes_set_updated_at
  before update on public.medication_schedule_outcomes
  for each row execute function public.set_updated_at();

alter table public.medication_schedule_outcomes enable row level security;

create policy medication_schedule_outcomes_member_select
  on public.medication_schedule_outcomes for select to authenticated
  using ((select private.is_care_space_member(care_space_id)));
create policy medication_schedule_outcomes_caregiver_insert
  on public.medication_schedule_outcomes for insert to authenticated
  with check ((select private.can_mutate_care_records(care_space_id)));
create policy medication_schedule_outcomes_caregiver_update
  on public.medication_schedule_outcomes for update to authenticated
  using ((select private.can_mutate_care_records(care_space_id)))
  with check ((select private.can_mutate_care_records(care_space_id)));

revoke all on function public.set_medication_schedule_outcome_snapshot()
  from public, anon, authenticated;
revoke all on table public.medication_schedule_outcomes from anon, authenticated;
grant select on table public.medication_schedule_outcomes to authenticated;
grant insert (
  care_space_id,
  client_request_id,
  schedule_id,
  scheduled_date,
  outcome,
  note
) on table public.medication_schedule_outcomes to authenticated;
grant update (outcome, note, deleted_at)
  on table public.medication_schedule_outcomes to authenticated;
grant all on table public.medication_schedule_outcomes to service_role;

-- The current push functions are replaced below without changing their public
-- signatures. They additionally treat an explicit schedule outcome as a reason
-- to stop reminders for that schedule and Korean calendar date.

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
        and not exists (
          select 1
            from public.medication_schedule_outcomes as outcome
            where outcome.care_space_id = delivery.care_space_id
              and outcome.schedule_id = delivery.schedule_id
              and outcome.scheduled_date =
                (delivery.scheduled_for at time zone 'Asia/Seoul')::date
              and outcome.deleted_at is null
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
      (((p_now at time zone 'Asia/Seoul')::date + 1)::timestamp)
        at time zone 'Asia/Seoul' as day_ends_at
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
      (bounds.schedule_date + schedule.time)
        at time zone 'Asia/Seoul' as first_scheduled_for
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
        and not exists (
          select 1
            from public.medication_schedule_outcomes as outcome
            where outcome.care_space_id = candidate.care_space_id
              and outcome.schedule_id = candidate.schedule_id
              and outcome.scheduled_date = candidate.schedule_date
              and outcome.deleted_at is null
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
        and delivery.scheduled_for > bounds.lower_bound - interval '2 minutes'
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
      from inserted where inserted.status = 'pending'
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
      '&date=' ||
        to_char(
          claimed.scheduled_for at time zone 'Asia/Seoul',
          'YYYY-MM-DD'
        ) ||
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
      '&date=' ||
        to_char(
          valid.scheduled_for at time zone 'Asia/Seoul',
          'YYYY-MM-DD'
        ) ||
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

commit;
