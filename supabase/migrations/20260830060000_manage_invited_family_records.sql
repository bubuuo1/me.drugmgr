begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.care_space_invites
  add column inviter_caregiver_care_space_id uuid null
    references public.care_spaces(id) on delete restrict;

create index care_space_invites_inviter_caregiver_space_idx
  on public.care_space_invites (inviter_caregiver_care_space_id)
  where inviter_caregiver_care_space_id is not null;

-- Earlier pending rows described the opposite sharing direction. Do not
-- reinterpret them as consent to expose the recipient's health records.
update public.care_space_invites
  set status = 'revoked',
      responded_at = now(),
      accepted_by = null,
      inviter_caregiver_care_space_id = null
  where status = 'pending';

alter table public.care_space_invites
  drop constraint care_space_invites_response_valid,
  add constraint care_space_invites_response_valid check (
    (
      status = 'pending'
      and responded_at is null
      and accepted_by is null
      and inviter_caregiver_care_space_id is null
    )
    or (
      status = 'accepted'
      and responded_at is not null
    )
    or (
      status in ('declined', 'revoked', 'expired')
      and responded_at is not null
      and accepted_by is null
      and inviter_caregiver_care_space_id is null
    )
  );

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
  caller_email text;
  normalized_email text := lower(btrim(p_email));
  selected_invite public.care_space_invites;
begin
  if caller_id is null then
    raise insufficient_privilege using message = 'authentication required';
  end if;
  if not private.is_care_space_owner(p_care_space_id) then
    raise insufficient_privilege using message = 'care space owner required';
  end if;
  select lower(btrim(auth_user.email)) into caller_email
    from auth.users as auth_user
    where auth_user.id = caller_id
      and auth_user.email_confirmed_at is not null;
  if caller_email is null then
    raise insufficient_privilege using message = 'verified account email required';
  end if;
  if normalized_email is null
    or char_length(normalized_email) not between 3 and 320
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  then
    raise check_violation using message = 'invalid invite email';
  end if;
  if normalized_email = caller_email then
    raise check_violation using message = 'cannot request access to own records';
  end if;
  if p_role is distinct from 'caregiver' then
    raise check_violation using message = 'management request role must be caregiver';
  end if;
  if p_expires_at is null or p_expires_at <= now() then
    raise check_violation using message = 'invite expiry must be in the future';
  end if;

  update public.care_space_invites as invite
    set status = 'expired',
        responded_at = now(),
        accepted_by = null,
        inviter_caregiver_care_space_id = null
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
    'caregiver',
    'pending',
    caller_id,
    p_expires_at
  )
  on conflict (care_space_id, email) where status = 'pending'
  do update set
    role = 'caregiver',
    invited_by = excluded.invited_by,
    expires_at = excluded.expires_at
  returning * into selected_invite;

  return selected_invite;
end;
$$;

drop function if exists public.get_pending_care_space_invites();

create function public.get_pending_care_space_invites()
returns table (
  id uuid,
  email text,
  role text,
  status text,
  expires_at timestamptz,
  created_at timestamptz,
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
      invite.email,
      invite.role,
      invite.status,
      invite.expires_at,
      invite.created_at,
      coalesce(inviter.display_name, '사용자')
    from public.care_space_invites as invite
    left join public.profiles as inviter
      on inviter.user_id = invite.invited_by
    where invite.email = caller_email
      and invite.status = 'pending'
      and invite.expires_at > now()
    order by invite.created_at desc;
end;
$$;

create or replace function public.accept_care_space_invite(
  p_invite_id uuid,
  p_inviter_caregiver_care_space_id uuid
)
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
  if p_inviter_caregiver_care_space_id is null then
    raise not_null_violation using message = 'managed care space is required';
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
  if selected_invite.invited_by = caller_id then
    raise check_violation using message = 'cannot accept own management request';
  end if;
  if selected_invite.role <> 'caregiver' then
    raise check_violation using message = 'management request role must be caregiver';
  end if;

  if selected_invite.status = 'accepted'
    and selected_invite.accepted_by = caller_id
  then
    if selected_invite.inviter_caregiver_care_space_id
      is distinct from p_inviter_caregiver_care_space_id
    then
      raise check_violation using message = 'accepted care space cannot change';
    end if;
    select member.* into selected_member
      from public.care_space_members as member
      where member.care_space_id = p_inviter_caregiver_care_space_id
        and member.user_id = selected_invite.invited_by;
    if found then
      return selected_member;
    end if;
    raise no_data_found using message = 'accepted caregiver membership not found';
  end if;
  if selected_invite.status <> 'pending' then
    raise check_violation using message = 'invite is not pending';
  end if;
  if selected_invite.expires_at <= now() then
    raise check_violation using message = 'invite has expired';
  end if;
  if not exists (
    select 1
      from public.care_space_members as member
      where member.care_space_id = selected_invite.care_space_id
        and member.user_id = selected_invite.invited_by
        and member.role = 'owner'
  ) then
    raise insufficient_privilege using message = 'invite owner is no longer available';
  end if;
  if not exists (
    select 1
      from public.care_space_members as member
      where member.care_space_id = p_inviter_caregiver_care_space_id
        and member.user_id = caller_id
        and member.role = 'owner'
  ) then
    raise insufficient_privilege using message = 'recipient must own managed care space';
  end if;
  if exists (
    select 1
      from public.care_space_members as member
      where member.care_space_id = p_inviter_caregiver_care_space_id
        and member.user_id = selected_invite.invited_by
        and member.role = 'owner'
  ) then
    raise check_violation using message = 'requester already owns managed care space';
  end if;

  insert into public.care_space_members (
    care_space_id,
    user_id,
    role,
    invited_by
  ) values (
    p_inviter_caregiver_care_space_id,
    selected_invite.invited_by,
    'caregiver',
    caller_id
  )
  on conflict (care_space_id, user_id) do update
    set role = excluded.role,
        invited_by = excluded.invited_by,
        updated_at = now()
    where care_space_members.role <> 'owner'
  returning * into selected_member;

  if selected_member is null then
    select member.* into selected_member
      from public.care_space_members as member
      where member.care_space_id = p_inviter_caregiver_care_space_id
        and member.user_id = selected_invite.invited_by;
  end if;
  if selected_member is null then
    raise no_data_found using message = 'caregiver membership was not created';
  end if;

  update public.care_space_invites as invite
    set status = 'accepted',
        accepted_by = caller_id,
        inviter_caregiver_care_space_id = p_inviter_caregiver_care_space_id,
        responded_at = now()
    where invite.id = selected_invite.id;

  return selected_member;
end;
$$;

-- Older clients cannot express the recipient's explicit target-space consent.
-- Keep the old signature callable during the rolling app deployment, but never
-- infer a health-record target on the recipient's behalf.
create or replace function public.accept_care_space_invite(p_invite_id uuid)
returns public.care_space_members
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.accept_care_space_invite(p_invite_id, null);
end;
$$;

revoke all on function public.get_pending_care_space_invites()
  from public, anon, authenticated;
revoke all on function public.create_care_space_invite(uuid, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.accept_care_space_invite(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.accept_care_space_invite(uuid)
  from public, anon, authenticated;
grant execute on function public.get_pending_care_space_invites()
  to authenticated;
grant execute on function public.create_care_space_invite(uuid, text, text, timestamptz)
  to authenticated;
grant execute on function public.accept_care_space_invite(uuid, uuid)
  to authenticated;
grant execute on function public.accept_care_space_invite(uuid)
  to authenticated;

commit;
