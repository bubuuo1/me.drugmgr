begin;

create table private.care_space_invite_email_limits (
  invite_id uuid primary key
    references public.care_space_invites(id) on delete cascade,
  last_claimed_at timestamptz not null
);

create table private.care_space_invite_email_sender_limits (
  sender_user_id uuid not null
    references auth.users(id) on delete cascade,
  claim_date date not null,
  claim_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (sender_user_id, claim_date),
  constraint care_space_invite_email_sender_count_valid
    check (claim_count between 0 and 50)
);

alter table private.care_space_invite_email_limits enable row level security;
alter table private.care_space_invite_email_sender_limits enable row level security;

revoke all on table private.care_space_invite_email_limits
  from public, anon, authenticated;
revoke all on table private.care_space_invite_email_sender_limits
  from public, anon, authenticated;
grant all on table private.care_space_invite_email_limits to service_role;
grant all on table private.care_space_invite_email_sender_limits to service_role;

create or replace function public.claim_care_space_invite_email_send(
  p_invite_id uuid
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  selected_invite public.care_space_invites;
  selected_day date := (now() at time zone 'Asia/Seoul')::date;
  daily_count integer;
  last_claimed_at timestamptz;
begin
  if caller_id is null then
    raise insufficient_privilege using message = 'authentication required';
  end if;

  select invite.* into selected_invite
    from public.care_space_invites as invite
    where invite.id = p_invite_id
    for update;

  if not found
    or selected_invite.invited_by <> caller_id
    or not private.is_care_space_owner(selected_invite.care_space_id)
  then
    raise insufficient_privilege using message = 'care space owner required';
  end if;
  if selected_invite.status <> 'pending' then
    return 'not_pending';
  end if;
  if selected_invite.expires_at <= now() then
    return 'expired';
  end if;

  insert into private.care_space_invite_email_sender_limits (
    sender_user_id,
    claim_date,
    claim_count
  ) values (
    caller_id,
    selected_day,
    0
  )
  on conflict (sender_user_id, claim_date) do nothing;

  select sender_limit.claim_count into daily_count
    from private.care_space_invite_email_sender_limits as sender_limit
    where sender_limit.sender_user_id = caller_id
      and sender_limit.claim_date = selected_day
    for update;

  select invite_limit.last_claimed_at into last_claimed_at
    from private.care_space_invite_email_limits as invite_limit
    where invite_limit.invite_id = p_invite_id;

  if last_claimed_at is not null
    and last_claimed_at > now() - interval '1 minute'
  then
    return 'cooldown';
  end if;
  if daily_count >= 50 then
    return 'daily_limit';
  end if;

  insert into private.care_space_invite_email_limits (
    invite_id,
    last_claimed_at
  ) values (
    p_invite_id,
    now()
  )
  on conflict (invite_id) do update
    set last_claimed_at = excluded.last_claimed_at;

  update private.care_space_invite_email_sender_limits as sender_limit
    set claim_count = sender_limit.claim_count + 1,
        updated_at = now()
    where sender_limit.sender_user_id = caller_id
      and sender_limit.claim_date = selected_day;

  delete from private.care_space_invite_email_sender_limits as sender_limit
    where sender_limit.sender_user_id = caller_id
      and sender_limit.claim_date < selected_day - 31;

  return 'claimed';
end;
$$;

revoke all on function public.claim_care_space_invite_email_send(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_care_space_invite_email_send(uuid)
  to authenticated;

create or replace function public.unregister_all_push_subscriptions_for_endpoint(
  p_dispatch_secret text,
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
begin
  if caller_id is null then
    raise insufficient_privilege using message = 'authentication required';
  end if;
  if not private.push_dispatch_secret_matches(p_dispatch_secret) then
    raise insufficient_privilege using message = 'invalid push dispatch secret';
  end if;
  if p_endpoint is null
    or char_length(p_endpoint) not between 1 and 2048
    or octet_length(p_endpoint) > 2048
  then
    raise check_violation using message = 'invalid push endpoint';
  end if;
  if p_auth is null
    or char_length(p_auth) not between 8 and 512
  then
    raise check_violation using message = 'invalid auth key';
  end if;

  select subscription.id into selected_subscription_id
    from private.push_subscriptions as subscription
    where subscription.user_id = caller_id
      and subscription.endpoint = p_endpoint
      and subscription.auth = p_auth
    for update;

  if not found then
    return true;
  end if;

  delete from private.push_subscription_spaces as target
    where target.subscription_id = selected_subscription_id
      and target.user_id = caller_id;

  update private.push_subscriptions as subscription
    set disabled_at = coalesce(subscription.disabled_at, now())
    where subscription.id = selected_subscription_id
      and subscription.user_id = caller_id;

  return true;
end;
$$;

revoke all on function public.unregister_all_push_subscriptions_for_endpoint(
  text,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.unregister_all_push_subscriptions_for_endpoint(
  text,
  text,
  text
) to authenticated;

commit;
