-- Create one reminder occurrence every five minutes until the matching
-- schedule is recorded for that Korea calendar date.
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
      date_trunc('minute', p_now) as upper_bound,
      (p_now at time zone 'Asia/Seoul')::date as schedule_date,
      (
        ((p_now at time zone 'Asia/Seoul')::date + 1)::timestamp
      ) at time zone 'Asia/Seoul' as day_ends_at
  ),
  daily_schedules as (
    select
      subscription.id as subscription_id,
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
      cross join public.medication_schedules as schedule
      join public.medications as medication on medication.id = schedule.medication_id
      cross join bounds
      where subscription.disabled_at is null
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
            where log.schedule_id = candidate.schedule_id
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
      'pending',
      1,
      p_now
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
