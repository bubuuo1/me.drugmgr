begin;

create table private.care_space_invite_email_global_limits (
  claim_date date primary key,
  claim_count integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint care_space_invite_email_global_count_valid
    check (claim_count between 0 and 400)
);

create table private.care_space_invite_email_recipient_limits (
  recipient_email text not null,
  claim_date date not null,
  claim_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (recipient_email, claim_date),
  constraint care_space_invite_email_recipient_normalized
    check (recipient_email = lower(btrim(recipient_email))),
  constraint care_space_invite_email_recipient_count_valid
    check (claim_count between 0 and 5)
);

alter table private.care_space_invite_email_global_limits enable row level security;
alter table private.care_space_invite_email_recipient_limits enable row level security;

revoke all on table private.care_space_invite_email_global_limits
  from public, anon, authenticated;
revoke all on table private.care_space_invite_email_recipient_limits
  from public, anon, authenticated;
grant all on table private.care_space_invite_email_global_limits to service_role;
grant all on table private.care_space_invite_email_recipient_limits to service_role;

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
  global_count integer;
  sender_count integer;
  recipient_count integer;
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

  insert into private.care_space_invite_email_global_limits (
    claim_date,
    claim_count
  ) values (
    selected_day,
    0
  )
  on conflict (claim_date) do nothing;

  select global_limit.claim_count into global_count
    from private.care_space_invite_email_global_limits as global_limit
    where global_limit.claim_date = selected_day
    for update;

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

  select sender_limit.claim_count into sender_count
    from private.care_space_invite_email_sender_limits as sender_limit
    where sender_limit.sender_user_id = caller_id
      and sender_limit.claim_date = selected_day
    for update;

  insert into private.care_space_invite_email_recipient_limits (
    recipient_email,
    claim_date,
    claim_count
  ) values (
    selected_invite.email,
    selected_day,
    0
  )
  on conflict (recipient_email, claim_date) do nothing;

  select recipient_limit.claim_count into recipient_count
    from private.care_space_invite_email_recipient_limits as recipient_limit
    where recipient_limit.recipient_email = selected_invite.email
      and recipient_limit.claim_date = selected_day
    for update;

  select invite_limit.last_claimed_at into last_claimed_at
    from private.care_space_invite_email_limits as invite_limit
    where invite_limit.invite_id = p_invite_id;

  if last_claimed_at is not null
    and last_claimed_at > now() - interval '1 minute'
  then
    return 'cooldown';
  end if;
  if global_count >= 400 then
    return 'global_limit';
  end if;
  if sender_count >= 50 then
    return 'daily_limit';
  end if;
  if recipient_count >= 5 then
    return 'recipient_limit';
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

  update private.care_space_invite_email_global_limits as global_limit
    set claim_count = global_limit.claim_count + 1,
        updated_at = now()
    where global_limit.claim_date = selected_day;

  update private.care_space_invite_email_sender_limits as sender_limit
    set claim_count = sender_limit.claim_count + 1,
        updated_at = now()
    where sender_limit.sender_user_id = caller_id
      and sender_limit.claim_date = selected_day;

  update private.care_space_invite_email_recipient_limits as recipient_limit
    set claim_count = recipient_limit.claim_count + 1,
        updated_at = now()
    where recipient_limit.recipient_email = selected_invite.email
      and recipient_limit.claim_date = selected_day;

  delete from private.care_space_invite_email_global_limits as global_limit
    where global_limit.claim_date < selected_day - 31;
  delete from private.care_space_invite_email_sender_limits as sender_limit
    where sender_limit.claim_date < selected_day - 31;
  delete from private.care_space_invite_email_recipient_limits as recipient_limit
    where recipient_limit.claim_date < selected_day - 31;

  return 'claimed';
end;
$$;

revoke all on function public.claim_care_space_invite_email_send(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_care_space_invite_email_send(uuid)
  to authenticated;

commit;
