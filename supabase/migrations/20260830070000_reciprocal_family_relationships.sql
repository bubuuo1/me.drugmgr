begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.care_space_invites
  add column reciprocal_management boolean not null default false;

-- ALTER TABLE already holds the invite table lock used by legacy accept
-- calls. Drain membership writers in the same invite -> membership order
-- before installing triggers or reading the backfill snapshot.
lock table public.care_space_members in exclusive mode;

-- The previous UI described pending requests as one-way. Reusing one as a
-- reciprocal request would expose health records without the new consent.
update public.care_space_invites
  set status = 'revoked',
      accepted_by = null,
      inviter_caregiver_care_space_id = null,
      responded_at = now()
  where status = 'pending';

create table private.family_relationships (
  id uuid primary key default gen_random_uuid(),
  user_a_id uuid not null references auth.users(id) on delete restrict,
  user_b_id uuid not null references auth.users(id) on delete restrict,
  created_from_invite_id uuid null
    references public.care_space_invites(id) on delete set null,
  started_at timestamptz not null default now(),
  reciprocal_started_at timestamptz null,
  reciprocal_granted_by uuid null references auth.users(id) on delete set null,
  ended_at timestamptz null,
  ended_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint family_relationships_user_order_valid check (
    user_a_id::text < user_b_id::text
  ),
  constraint family_relationships_end_valid check (
    (ended_at is null and ended_by is null) or ended_at is not null
  ),
  constraint family_relationships_reciprocal_audit_valid check (
    (reciprocal_started_at is null and reciprocal_granted_by is null)
    or reciprocal_started_at is not null
  )
);

create unique index family_relationships_active_pair_unique
  on private.family_relationships (user_a_id, user_b_id)
  where ended_at is null;
create index family_relationships_user_a_active_idx
  on private.family_relationships (user_a_id, started_at desc)
  where ended_at is null;
create index family_relationships_user_b_active_idx
  on private.family_relationships (user_b_id, started_at desc)
  where ended_at is null;

create table private.family_relationship_accesses (
  id uuid primary key default gen_random_uuid(),
  relationship_id uuid not null
    references private.family_relationships(id) on delete restrict,
  care_space_id uuid not null
    references public.care_spaces(id) on delete restrict,
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  grantee_user_id uuid not null references auth.users(id) on delete restrict,
  grant_invite_id uuid null
    references public.care_space_invites(id) on delete set null,
  previous_role text not null,
  previous_invited_by uuid null references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz null,
  ended_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint family_relationship_accesses_users_distinct check (
    owner_user_id <> grantee_user_id
  ),
  constraint family_relationship_accesses_previous_role_valid check (
    previous_role in ('none', 'viewer', 'caregiver', 'unknown')
  ),
  constraint family_relationship_accesses_end_valid check (
    (ended_at is null and ended_by is null) or ended_at is not null
  )
);

create unique index family_relationship_accesses_active_edge_unique
  on private.family_relationship_accesses (care_space_id, grantee_user_id)
  where ended_at is null;
create unique index family_relationship_accesses_active_direction_unique
  on private.family_relationship_accesses (
    relationship_id,
    owner_user_id,
    grantee_user_id
  ) where ended_at is null;
create index family_relationship_accesses_relationship_active_idx
  on private.family_relationship_accesses (
    relationship_id,
    care_space_id,
    grantee_user_id
  ) where ended_at is null;
create index family_relationship_accesses_owner_active_idx
  on private.family_relationship_accesses (owner_user_id, relationship_id)
  where ended_at is null;
create index family_relationship_accesses_grantee_active_idx
  on private.family_relationship_accesses (grantee_user_id, relationship_id)
  where ended_at is null;
create index family_relationship_accesses_grant_invite_idx
  on private.family_relationship_accesses (grant_invite_id)
  where grant_invite_id is not null;

create trigger family_relationships_set_updated_at
  before update on private.family_relationships
  for each row execute function public.set_updated_at();
create trigger family_relationship_accesses_set_updated_at
  before update on private.family_relationship_accesses
  for each row execute function public.set_updated_at();

alter table private.family_relationships enable row level security;
alter table private.family_relationship_accesses enable row level security;
revoke all on table private.family_relationships
  from public, anon, authenticated;
revoke all on table private.family_relationship_accesses
  from public, anon, authenticated;
grant all on table private.family_relationships to service_role;
grant all on table private.family_relationship_accesses to service_role;

create or replace function private.protect_family_relationship_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from private.family_relationship_accesses as access
    where access.care_space_id = old.care_space_id
      and access.grantee_user_id = old.user_id
      and access.ended_at is null
  ) then
    raise check_violation using message = 'end family relationship before changing membership';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger care_space_members_protect_family_relationship
  before update or delete on public.care_space_members
  for each row execute function private.protect_family_relationship_membership();

create or replace function private.validate_family_relationship_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_relationship private.family_relationships;
begin
  select relationship.* into selected_relationship
    from private.family_relationships as relationship
    where relationship.id = new.relationship_id;
  if not found then
    raise foreign_key_violation using message = 'family relationship not found';
  end if;
  if new.owner_user_id not in (
    selected_relationship.user_a_id,
    selected_relationship.user_b_id
  ) or new.grantee_user_id not in (
    selected_relationship.user_a_id,
    selected_relationship.user_b_id
  ) then
    raise check_violation using message = 'relationship access participants mismatch';
  end if;
  if new.ended_at is null and selected_relationship.ended_at is not null then
    raise check_violation using message = 'ended relationship cannot grant access';
  end if;
  if not exists (
    select 1
    from public.care_space_members as member
    where member.care_space_id = new.care_space_id
      and member.user_id = new.owner_user_id
      and member.role = 'owner'
  ) then
    raise insufficient_privilege using message = 'relationship access owner required';
  end if;
  return new;
end;
$$;

create trigger family_relationship_accesses_validate
  before insert or update on private.family_relationship_accesses
  for each row execute function private.validate_family_relationship_access();

create or replace function private.add_family_relationship_access(
  p_relationship_id uuid,
  p_care_space_id uuid,
  p_owner_user_id uuid,
  p_grantee_user_id uuid,
  p_grant_invite_id uuid default null
)
returns private.family_relationship_accesses
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_relationship private.family_relationships;
  previous_member public.care_space_members;
  selected_access private.family_relationship_accesses;
  previous_role text := 'none';
begin
  select relationship.* into selected_relationship
    from private.family_relationships as relationship
    where relationship.id = p_relationship_id
    for update;
  if not found or selected_relationship.ended_at is not null then
    raise check_violation using message = 'active family relationship required';
  end if;
  if p_owner_user_id = p_grantee_user_id
    or p_owner_user_id not in (
      selected_relationship.user_a_id,
      selected_relationship.user_b_id
    )
    or p_grantee_user_id not in (
      selected_relationship.user_a_id,
      selected_relationship.user_b_id
    )
  then
    raise check_violation using message = 'relationship access participants mismatch';
  end if;
  if not exists (
    select 1
    from public.care_space_members as member
    where member.care_space_id = p_care_space_id
      and member.user_id = p_owner_user_id
      and member.role = 'owner'
  ) then
    raise insufficient_privilege using message = 'relationship access owner required';
  end if;
  if exists (
    select 1
    from private.family_relationship_accesses as access
    where access.relationship_id = p_relationship_id
      and access.owner_user_id = p_owner_user_id
      and access.grantee_user_id = p_grantee_user_id
      and access.ended_at is null
  ) then
    raise check_violation using message = 'relationship access already exists';
  end if;
  if exists (
    select 1
    from private.family_relationship_accesses as access
    where access.care_space_id = p_care_space_id
      and access.grantee_user_id = p_grantee_user_id
      and access.ended_at is null
  ) then
    raise check_violation using message = 'care space access belongs to another active relationship';
  end if;

  select member.* into previous_member
    from public.care_space_members as member
    where member.care_space_id = p_care_space_id
      and member.user_id = p_grantee_user_id
    for update;
  if found then
    if previous_member.role = 'owner' then
      raise check_violation using message = 'relationship participant already owns care space';
    end if;
    previous_role := previous_member.role;
  end if;

  insert into public.care_space_members (
    care_space_id,
    user_id,
    role,
    invited_by
  ) values (
    p_care_space_id,
    p_grantee_user_id,
    'caregiver',
    p_owner_user_id
  )
  on conflict (care_space_id, user_id) do update
    set role = 'caregiver',
        invited_by = case
          when care_space_members.role = 'viewer' then excluded.invited_by
          else care_space_members.invited_by
        end,
        updated_at = now()
    where care_space_members.role <> 'owner';

  insert into private.family_relationship_accesses (
    relationship_id,
    care_space_id,
    owner_user_id,
    grantee_user_id,
    grant_invite_id,
    previous_role,
    previous_invited_by
  ) values (
    p_relationship_id,
    p_care_space_id,
    p_owner_user_id,
    p_grantee_user_id,
    p_grant_invite_id,
    previous_role,
    previous_member.invited_by
  )
  returning * into selected_access;
  return selected_access;
end;
$$;

create or replace function private.end_family_relationship_access(
  p_access_id uuid,
  p_ended_by uuid
)
returns private.family_relationship_accesses
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_access private.family_relationship_accesses;
  selected_member public.care_space_members;
begin
  select access.* into selected_access
    from private.family_relationship_accesses as access
    where access.id = p_access_id
    for update;
  if not found then
    raise no_data_found using message = 'family relationship access not found';
  end if;
  if selected_access.ended_at is not null then
    return selected_access;
  end if;

  -- End the tracked edge first. The membership trigger then permits only this
  -- relationship-ending transaction to remove or restore the member row.
  update private.family_relationship_accesses as access
    set ended_at = now(),
        ended_by = p_ended_by
    where access.id = selected_access.id
    returning * into selected_access;

  select member.* into selected_member
    from public.care_space_members as member
    where member.care_space_id = selected_access.care_space_id
      and member.user_id = selected_access.grantee_user_id
    for update;
  if found and selected_member.role <> 'owner' then
    if selected_access.previous_role = 'none' then
      delete from public.care_space_members as member
        where member.care_space_id = selected_access.care_space_id
          and member.user_id = selected_access.grantee_user_id
          and member.role = 'caregiver'
          and member.invited_by = selected_access.owner_user_id;
    elsif selected_access.previous_role in ('viewer', 'caregiver') then
      update public.care_space_members as member
        set role = selected_access.previous_role,
            invited_by = selected_access.previous_invited_by
        where member.care_space_id = selected_access.care_space_id
          and member.user_id = selected_access.grantee_user_id
          and member.role <> 'owner';
    end if;
    -- An unknown pre-existing role cannot be safely removed or restored.
  end if;
  return selected_access;
end;
$$;

revoke all on function private.protect_family_relationship_membership()
  from public, anon, authenticated;
revoke all on function private.validate_family_relationship_access()
  from public, anon, authenticated;
revoke all on function private.add_family_relationship_access(
  uuid, uuid, uuid, uuid, uuid
) from public, anon, authenticated;
revoke all on function private.end_family_relationship_access(uuid, uuid)
  from public, anon, authenticated;

-- Keep only accepted invite edges whose membership still exists. Historical
-- accepted rows with a removed membership do not become active again. Exact
-- accept-transaction timestamps prove that the remaining membership was newly
-- created by that invite; otherwise its prior role is conservatively unknown.
with accepted_edges as (
  select
    invite.id as invite_id,
    least(invite.invited_by::text, invite.accepted_by::text)::uuid as user_a_id,
    greatest(invite.invited_by::text, invite.accepted_by::text)::uuid as user_b_id,
    case
      when invite.inviter_caregiver_care_space_id is null
        then invite.invited_by
      else invite.accepted_by
    end as owner_user_id,
    case
      when invite.inviter_caregiver_care_space_id is null
        then invite.accepted_by
      else invite.invited_by
    end as grantee_user_id,
    coalesce(
      invite.inviter_caregiver_care_space_id,
      invite.care_space_id
    ) as care_space_id,
    coalesce(invite.responded_at, invite.updated_at) as accepted_at
  from public.care_space_invites as invite
  where invite.status = 'accepted'
    and invite.accepted_by is not null
),
valid_edges as (
  select
    edge.*,
    grantee_member.created_at as member_created_at,
    grantee_member.updated_at as member_updated_at,
    grantee_member.invited_by as member_invited_by
  from accepted_edges as edge
  join public.care_space_members as owner_member
    on owner_member.care_space_id = edge.care_space_id
    and owner_member.user_id = edge.owner_user_id
    and owner_member.role = 'owner'
  join public.care_space_members as grantee_member
    on grantee_member.care_space_id = edge.care_space_id
    and grantee_member.user_id = edge.grantee_user_id
    and grantee_member.role = 'caregiver'
),
deduplicated_edges as (
  select distinct on (
    edge.user_a_id,
    edge.user_b_id,
    edge.owner_user_id,
    edge.grantee_user_id
  )
    edge.*
  from valid_edges as edge
  order by edge.user_a_id, edge.user_b_id,
    edge.owner_user_id, edge.grantee_user_id,
    edge.accepted_at desc, edge.invite_id desc
),
active_pairs as (
  select
    edge.user_a_id,
    edge.user_b_id,
    min(edge.accepted_at) as started_at,
    (array_agg(edge.invite_id order by edge.accepted_at desc))[1]
      as created_from_invite_id
  from deduplicated_edges as edge
  group by edge.user_a_id, edge.user_b_id
)
insert into private.family_relationships (
  user_a_id,
  user_b_id,
  created_from_invite_id,
  started_at
)
select
  pair.user_a_id,
  pair.user_b_id,
  pair.created_from_invite_id,
  pair.started_at
from active_pairs as pair;

with accepted_edges as (
  select
    invite.id as invite_id,
    least(invite.invited_by::text, invite.accepted_by::text)::uuid as user_a_id,
    greatest(invite.invited_by::text, invite.accepted_by::text)::uuid as user_b_id,
    case
      when invite.inviter_caregiver_care_space_id is null
        then invite.invited_by
      else invite.accepted_by
    end as owner_user_id,
    case
      when invite.inviter_caregiver_care_space_id is null
        then invite.accepted_by
      else invite.invited_by
    end as grantee_user_id,
    coalesce(
      invite.inviter_caregiver_care_space_id,
      invite.care_space_id
    ) as care_space_id,
    coalesce(invite.responded_at, invite.updated_at) as accepted_at
  from public.care_space_invites as invite
  where invite.status = 'accepted'
    and invite.accepted_by is not null
),
valid_edges as (
  select
    edge.*,
    grantee_member.created_at as member_created_at,
    grantee_member.updated_at as member_updated_at,
    grantee_member.invited_by as member_invited_by
  from accepted_edges as edge
  join public.care_space_members as owner_member
    on owner_member.care_space_id = edge.care_space_id
    and owner_member.user_id = edge.owner_user_id
    and owner_member.role = 'owner'
  join public.care_space_members as grantee_member
    on grantee_member.care_space_id = edge.care_space_id
    and grantee_member.user_id = edge.grantee_user_id
    and grantee_member.role = 'caregiver'
),
deduplicated_edges as (
  select distinct on (
    edge.user_a_id,
    edge.user_b_id,
    edge.owner_user_id,
    edge.grantee_user_id
  )
    edge.*
  from valid_edges as edge
  order by edge.user_a_id, edge.user_b_id,
    edge.owner_user_id, edge.grantee_user_id,
    edge.accepted_at desc, edge.invite_id desc
)
insert into private.family_relationship_accesses (
  relationship_id,
  care_space_id,
  owner_user_id,
  grantee_user_id,
  grant_invite_id,
  previous_role,
  previous_invited_by,
  started_at
)
select
  relationship.id,
  edge.care_space_id,
  edge.owner_user_id,
  edge.grantee_user_id,
  edge.invite_id,
  case
    when edge.member_created_at = edge.accepted_at
      and edge.member_updated_at = edge.accepted_at
      and edge.member_invited_by = edge.owner_user_id
      then 'none'
    else 'unknown'
  end,
  null,
  edge.accepted_at
from deduplicated_edges as edge
join private.family_relationships as relationship
  on relationship.user_a_id = edge.user_a_id
  and relationship.user_b_id = edge.user_b_id
  and relationship.ended_at is null;

create or replace function public.get_family_relationships()
returns table (
  id uuid,
  other_user_id uuid,
  other_display_name text,
  caller_can_manage_other_records boolean,
  other_can_manage_caller_records boolean,
  manageable_care_space_id uuid,
  manageable_care_space_name text,
  caller_shared_care_space_id uuid,
  caller_shared_care_space_name text,
  can_upgrade_to_reciprocal boolean,
  started_at timestamptz
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

  return query
    select
      relationship.id,
      case
        when relationship.user_a_id = caller_id then relationship.user_b_id
        else relationship.user_a_id
      end as other_user_id,
      coalesce(other_profile.display_name, '사용자') as other_display_name,
      caller_access.id is not null as caller_can_manage_other_records,
      other_access.id is not null as other_can_manage_caller_records,
      caller_access.care_space_id as manageable_care_space_id,
      manageable_space.name as manageable_care_space_name,
      other_access.care_space_id as caller_shared_care_space_id,
      caller_space.name as caller_shared_care_space_name,
      caller_access.id is not null and other_access.id is null
        as can_upgrade_to_reciprocal,
      relationship.started_at
    from private.family_relationships as relationship
    left join public.profiles as other_profile
      on other_profile.user_id = case
        when relationship.user_a_id = caller_id then relationship.user_b_id
        else relationship.user_a_id
      end
    left join private.family_relationship_accesses as caller_access
      on caller_access.relationship_id = relationship.id
      and caller_access.grantee_user_id = caller_id
      and caller_access.owner_user_id = case
        when relationship.user_a_id = caller_id then relationship.user_b_id
        else relationship.user_a_id
      end
      and caller_access.ended_at is null
    left join private.family_relationship_accesses as other_access
      on other_access.relationship_id = relationship.id
      and other_access.owner_user_id = caller_id
      and other_access.grantee_user_id = case
        when relationship.user_a_id = caller_id then relationship.user_b_id
        else relationship.user_a_id
      end
      and other_access.ended_at is null
    left join public.care_spaces as manageable_space
      on manageable_space.id = caller_access.care_space_id
    left join public.care_spaces as caller_space
      on caller_space.id = other_access.care_space_id
    where relationship.ended_at is null
      and caller_id in (relationship.user_a_id, relationship.user_b_id)
    order by relationship.started_at desc;
end;
$$;

create or replace function public.create_care_space_invite(
  p_care_space_id uuid,
  p_email text,
  p_reciprocal_management boolean,
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
  recipient_id uuid;
  normalized_email text := lower(btrim(p_email));
  selected_invite public.care_space_invites;
  pair_user_a_id uuid;
  pair_user_b_id uuid;
begin
  if caller_id is null then
    raise insufficient_privilege using message = 'authentication required';
  end if;
  if p_reciprocal_management is distinct from true then
    raise check_violation using message = 'reciprocal management consent required';
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

  select auth_user.id into recipient_id
    from auth.users as auth_user
    where lower(btrim(auth_user.email)) = normalized_email
      and auth_user.email_confirmed_at is not null
    order by auth_user.created_at
    limit 1;
  if recipient_id is not null then
    pair_user_a_id := least(caller_id::text, recipient_id::text)::uuid;
    pair_user_b_id := greatest(caller_id::text, recipient_id::text)::uuid;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        pair_user_a_id::text || ':' || pair_user_b_id::text,
        0
      )
    );
    if exists (
      select 1
      from private.family_relationships as relationship
      where relationship.user_a_id = pair_user_a_id
        and relationship.user_b_id = pair_user_b_id
        and relationship.ended_at is null
    ) then
      raise check_violation using message = 'active family relationship already exists';
    end if;
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
    reciprocal_management,
    status,
    invited_by,
    expires_at
  ) values (
    p_care_space_id,
    normalized_email,
    'caregiver',
    true,
    'pending',
    caller_id,
    p_expires_at
  )
  on conflict (care_space_id, email) where status = 'pending'
  do update set
    role = 'caregiver',
    reciprocal_management = true,
    invited_by = excluded.invited_by,
    expires_at = excluded.expires_at
  returning * into selected_invite;
  return selected_invite;
end;
$$;

-- Old clients cannot state reciprocal consent. Keep their signature as a
-- fail-safe during the rolling deployment.
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
begin
  raise check_violation using message = 'reciprocal management consent required';
end;
$$;

create or replace function public.accept_care_space_invite(
  p_invite_id uuid,
  p_inviter_caregiver_care_space_id uuid,
  p_reciprocal_management boolean
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
  preselected_invite public.care_space_invites;
  selected_invite public.care_space_invites;
  selected_member public.care_space_members;
  selected_relationship private.family_relationships;
  pair_user_a_id uuid;
  pair_user_b_id uuid;
begin
  if caller_id is null then
    raise insufficient_privilege using message = 'authentication required';
  end if;
  if p_reciprocal_management is distinct from true then
    raise check_violation using message = 'reciprocal management consent required';
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

  -- Read first without a row lock so every path can acquire the pair lock
  -- before the invite row lock. All mutable fields are revalidated below.
  select invite.* into preselected_invite
    from public.care_space_invites as invite
    where invite.id = p_invite_id;
  if not found then
    raise no_data_found using message = 'invite not found';
  end if;
  if preselected_invite.email <> caller_email then
    raise insufficient_privilege using message = 'invite recipient mismatch';
  end if;
  if preselected_invite.invited_by = caller_id then
    raise check_violation using message = 'cannot accept own management request';
  end if;

  pair_user_a_id := least(
    preselected_invite.invited_by::text,
    caller_id::text
  )::uuid;
  pair_user_b_id := greatest(
    preselected_invite.invited_by::text,
    caller_id::text
  )::uuid;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      pair_user_a_id::text || ':' || pair_user_b_id::text,
      0
    )
  );

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
  if selected_invite.invited_by <> preselected_invite.invited_by
    or selected_invite.invited_by = caller_id
  then
    raise check_violation using message = 'invite participants changed';
  end if;
  if selected_invite.role <> 'caregiver' then
    raise check_violation using message = 'management request role must be caregiver';
  end if;
  if selected_invite.reciprocal_management is distinct from true then
    raise check_violation using message = 'invite does not include reciprocal consent';
  end if;

  if selected_invite.status = 'accepted'
    and selected_invite.accepted_by = caller_id
  then
    if selected_invite.inviter_caregiver_care_space_id is distinct from
      p_inviter_caregiver_care_space_id
    then
      raise check_violation using message = 'accepted care space mismatch';
    end if;
    select relationship.* into selected_relationship
      from private.family_relationships as relationship
      where relationship.user_a_id = pair_user_a_id
        and relationship.user_b_id = pair_user_b_id
        and relationship.created_from_invite_id = selected_invite.id
        and relationship.ended_at is null;
    select member.* into selected_member
      from public.care_space_members as member
      where member.care_space_id = selected_invite.inviter_caregiver_care_space_id
        and member.user_id = selected_invite.invited_by
        and member.role = 'caregiver';
    if selected_relationship.id is not null
      and selected_member.user_id is not null
      and (
        select count(*)
        from private.family_relationship_accesses as access
        where access.relationship_id = selected_relationship.id
          and access.ended_at is null
      ) = 2
    then
      return selected_member;
    end if;
    raise no_data_found using message = 'accepted reciprocal relationship not found';
  end if;
  if selected_invite.status <> 'pending' then
    raise check_violation using message = 'invite is not pending';
  end if;
  if selected_invite.expires_at <= now() then
    raise check_violation using message = 'invite has expired';
  end if;
  if exists (
    select 1
    from private.family_relationships as relationship
    where relationship.user_a_id = pair_user_a_id
      and relationship.user_b_id = pair_user_b_id
      and relationship.ended_at is null
  ) then
    raise check_violation using message = 'active family relationship already exists';
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

  insert into private.family_relationships (
    user_a_id,
    user_b_id,
    created_from_invite_id,
    reciprocal_started_at,
    reciprocal_granted_by
  ) values (
    pair_user_a_id,
    pair_user_b_id,
    selected_invite.id,
    now(),
    caller_id
  ) returning * into selected_relationship;

  perform private.add_family_relationship_access(
    selected_relationship.id,
    p_inviter_caregiver_care_space_id,
    caller_id,
    selected_invite.invited_by,
    selected_invite.id
  );
  perform private.add_family_relationship_access(
    selected_relationship.id,
    selected_invite.care_space_id,
    selected_invite.invited_by,
    caller_id,
    selected_invite.id
  );

  update public.care_space_invites as invite
    set status = 'accepted',
        accepted_by = caller_id,
        inviter_caregiver_care_space_id = p_inviter_caregiver_care_space_id,
        responded_at = now()
    where invite.id = selected_invite.id;

  select member.* into selected_member
    from public.care_space_members as member
    where member.care_space_id = p_inviter_caregiver_care_space_id
      and member.user_id = selected_invite.invited_by;
  if not found then
    raise no_data_found using message = 'reciprocal caregiver membership not found';
  end if;
  return selected_member;
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
begin
  raise check_violation using message = 'reciprocal management consent required';
end;
$$;

create or replace function public.accept_care_space_invite(p_invite_id uuid)
returns public.care_space_members
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise check_violation using message = 'reciprocal management consent required';
end;
$$;

create or replace function public.upgrade_family_relationship_to_reciprocal(
  p_relationship_id uuid,
  p_caller_care_space_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  selected_relationship private.family_relationships;
  other_user_id uuid;
begin
  if caller_id is null then
    raise insufficient_privilege using message = 'authentication required';
  end if;
  if p_caller_care_space_id is null then
    raise not_null_violation using message = 'caller care space is required';
  end if;

  select relationship.* into selected_relationship
    from private.family_relationships as relationship
    where relationship.id = p_relationship_id
    for update;
  if not found then
    raise no_data_found using message = 'family relationship not found';
  end if;
  if selected_relationship.ended_at is not null then
    raise check_violation using message = 'family relationship is not active';
  end if;
  if caller_id = selected_relationship.user_a_id then
    other_user_id := selected_relationship.user_b_id;
  elsif caller_id = selected_relationship.user_b_id then
    other_user_id := selected_relationship.user_a_id;
  else
    raise insufficient_privilege using message = 'family relationship participant required';
  end if;
  if not exists (
    select 1
    from private.family_relationship_accesses as access
    where access.relationship_id = selected_relationship.id
      and access.owner_user_id = other_user_id
      and access.grantee_user_id = caller_id
      and access.ended_at is null
  ) then
    raise check_violation using message = 'one-way family access required';
  end if;
  if exists (
    select 1
    from private.family_relationship_accesses as access
    where access.relationship_id = selected_relationship.id
      and access.owner_user_id = caller_id
      and access.grantee_user_id = other_user_id
      and access.ended_at is null
  ) then
    return selected_relationship.id;
  end if;

  perform private.add_family_relationship_access(
    selected_relationship.id,
    p_caller_care_space_id,
    caller_id,
    other_user_id,
    null
  );
  update private.family_relationships as relationship
    set reciprocal_started_at = now(),
        reciprocal_granted_by = caller_id
    where relationship.id = selected_relationship.id;
  return selected_relationship.id;
end;
$$;

create or replace function public.end_family_relationship(
  p_relationship_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  selected_relationship private.family_relationships;
  selected_access record;
begin
  if caller_id is null then
    raise insufficient_privilege using message = 'authentication required';
  end if;

  select relationship.* into selected_relationship
    from private.family_relationships as relationship
    where relationship.id = p_relationship_id
    for update;
  if not found then
    raise no_data_found using message = 'family relationship not found';
  end if;
  if caller_id not in (
    selected_relationship.user_a_id,
    selected_relationship.user_b_id
  ) then
    raise insufficient_privilege using message = 'family relationship participant required';
  end if;
  if selected_relationship.ended_at is not null then
    return selected_relationship.id;
  end if;

  for selected_access in
    select access.id
    from private.family_relationship_accesses as access
    where access.relationship_id = selected_relationship.id
      and access.ended_at is null
    order by access.care_space_id, access.grantee_user_id
    for update
  loop
    perform private.end_family_relationship_access(
      selected_access.id,
      caller_id
    );
  end loop;

  update private.family_relationships as relationship
    set ended_at = now(),
        ended_by = caller_id
    where relationship.id = selected_relationship.id;
  return selected_relationship.id;
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
  if exists (
    select 1
    from private.family_relationship_accesses as access
    where access.care_space_id = p_care_space_id
      and access.grantee_user_id = p_user_id
      and access.ended_at is null
  ) then
    raise check_violation using message = 'end family relationship instead';
  end if;
  delete from public.care_space_members as member
    where member.care_space_id = selected_member.care_space_id
      and member.user_id = selected_member.user_id;
  return selected_member;
end;
$$;

revoke all on function public.get_family_relationships()
  from public, anon, authenticated;
revoke all on function public.create_care_space_invite(
  uuid, text, boolean, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.create_care_space_invite(
  uuid, text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.accept_care_space_invite(uuid, uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.accept_care_space_invite(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.accept_care_space_invite(uuid)
  from public, anon, authenticated;
revoke all on function public.upgrade_family_relationship_to_reciprocal(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.end_family_relationship(uuid)
  from public, anon, authenticated;
revoke all on function public.remove_care_space_member(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.get_family_relationships()
  to authenticated;
grant execute on function public.create_care_space_invite(
  uuid, text, boolean, text, timestamptz
) to authenticated;
grant execute on function public.accept_care_space_invite(uuid, uuid, boolean)
  to authenticated;
grant execute on function public.upgrade_family_relationship_to_reciprocal(uuid, uuid)
  to authenticated;
grant execute on function public.end_family_relationship(uuid)
  to authenticated;
grant execute on function public.remove_care_space_member(uuid, uuid)
  to authenticated;

commit;
