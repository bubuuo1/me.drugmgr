-- 투약 관리 앱: Google Auth 사용자별 격리와 가족 공유를 포함한 최종 스키마
-- 주의: 이 파일은 앱 테이블을 재생성한다. 운영 데이터 변경에는 migrations를 사용한다.

begin;

drop trigger if exists medicine_app_on_auth_user_created on auth.users;

drop table if exists private.push_deliveries cascade;
drop table if exists private.push_subscription_spaces cascade;
drop table if exists private.push_subscriptions cascade;
drop table if exists private.care_space_invite_email_recipient_limits cascade;
drop table if exists private.care_space_invite_email_global_limits cascade;
drop table if exists private.care_space_invite_email_sender_limits cascade;
drop table if exists private.care_space_invite_email_limits cascade;
drop table if exists private.family_relationship_accesses cascade;
drop table if exists private.family_relationships cascade;
drop table if exists public.medication_schedule_outcomes cascade;
drop table if exists public.medication_logs cascade;
drop table if exists public.daily_status cascade;
drop table if exists public.medication_schedules cascade;
drop table if exists public.medications cascade;
drop table if exists public.care_space_invites cascade;
drop table if exists public.care_space_members cascade;
drop table if exists public.care_spaces cascade;
drop table if exists public.profiles cascade;

drop function if exists private.push_dispatch_secret_matches(text) cascade;
drop function if exists private.push_delivery_is_sendable(uuid, timestamptz) cascade;
drop function if exists private.is_care_space_member(uuid) cascade;
drop function if exists private.is_care_space_owner(uuid) cascade;
drop function if exists private.can_manage_medication_settings(uuid) cascade;
drop function if exists private.can_mutate_care_records(uuid) cascade;
drop function if exists private.shares_care_space(uuid) cascade;
drop function if exists private.is_verified_invite_recipient(text) cascade;
drop function if exists private.set_audit_actor() cascade;
drop function if exists private.add_care_space_creator_as_owner() cascade;
drop function if exists private.handle_medicine_app_new_user() cascade;
drop function if exists private.protect_family_relationship_membership() cascade;
drop function if exists private.validate_family_relationship_access() cascade;
drop function if exists private.add_family_relationship_access(
  uuid, uuid, uuid, uuid, uuid
) cascade;
drop function if exists private.end_family_relationship_access(uuid, uuid) cascade;
drop function if exists public.create_care_space_invite(uuid, text, text, timestamptz) cascade;
drop function if exists public.create_care_space_invite(
  uuid, text, boolean, text, timestamptz
) cascade;
drop function if exists public.get_pending_care_space_invites() cascade;
drop function if exists public.get_family_relationships() cascade;
drop function if exists public.accept_care_space_invite(uuid) cascade;
drop function if exists public.accept_care_space_invite(uuid, uuid) cascade;
drop function if exists public.accept_care_space_invite(uuid, uuid, boolean) cascade;
drop function if exists public.decline_care_space_invite(uuid) cascade;
drop function if exists public.revoke_care_space_invite(uuid) cascade;
drop function if exists public.remove_care_space_member(uuid, uuid) cascade;
drop function if exists public.upgrade_family_relationship_to_reciprocal(
  uuid, uuid
) cascade;
drop function if exists public.end_family_relationship(uuid) cascade;
drop function if exists public.soft_delete_medication(uuid, uuid) cascade;
drop function if exists public.reclassify_medication_log(
  uuid, uuid, uuid, boolean, boolean, timestamptz, boolean, numeric, boolean, text
) cascade;
drop function if exists public.upsert_daily_status(
  uuid, date, text, text, text, text, text
) cascade;
drop function if exists public.claim_care_space_invite_email_send(uuid) cascade;
drop function if exists public.claim_care_space_invite_email_send(text, uuid) cascade;
drop function if exists public.register_push_subscription(text, text, text, timestamptz) cascade;
drop function if exists public.register_push_subscription(text, text, text, text, timestamptz) cascade;
drop function if exists public.register_push_subscription(
  text, uuid, text, text, text, timestamptz
) cascade;
drop function if exists public.unregister_push_subscription(text) cascade;
drop function if exists public.unregister_push_subscription(text, text, text) cascade;
drop function if exists public.unregister_push_subscription(text, uuid, text, text) cascade;
drop function if exists public.unregister_all_push_subscriptions_for_endpoint(
  text, text, text
) cascade;
drop function if exists public.get_push_subscription_for_test(text, text) cascade;
drop function if exists public.get_push_subscription_for_test(text, text, text) cascade;
drop function if exists public.get_push_subscription_for_test(text, uuid, text, text) cascade;
drop function if exists public.claim_due_push_notifications(text, timestamptz) cascade;
drop function if exists public.prepare_push_delivery_for_send(
  text, uuid, smallint, timestamptz
) cascade;
drop function if exists public.complete_push_delivery(
  text, uuid, boolean, integer, text, boolean
) cascade;
drop function if exists public.complete_push_delivery(
  text, uuid, smallint, boolean, integer, text, boolean
) cascade;
drop function if exists public.set_medication_log_snapshot() cascade;
drop function if exists public.set_medication_schedule_outcome_snapshot() cascade;
drop function if exists public.set_updated_at() cascade;

create extension if not exists "pgcrypto";
create extension if not exists pg_cron;
create extension if not exists pg_net;

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
  reciprocal_management boolean not null default false,
  inviter_caregiver_care_space_id uuid null
    references public.care_spaces(id) on delete restrict,
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
    or (status in ('declined', 'revoked', 'expired')
      and responded_at is not null
      and accepted_by is null
      and inviter_caregiver_care_space_id is null)
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
create index care_space_invites_inviter_caregiver_space_idx
  on public.care_space_invites (inviter_caregiver_care_space_id)
  where inviter_caregiver_care_space_id is not null;
create index care_space_invites_recipient_pending_idx
  on public.care_space_invites (email, created_at desc)
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
create index family_relationships_created_invite_idx
  on private.family_relationships (created_from_invite_id)
  where created_from_invite_id is not null;
create index family_relationships_reciprocal_granted_by_idx
  on private.family_relationships (reciprocal_granted_by)
  where reciprocal_granted_by is not null;
create index family_relationships_ended_by_idx
  on private.family_relationships (ended_by)
  where ended_by is not null;

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
create index family_relationship_accesses_previous_invited_by_idx
  on private.family_relationship_accesses (previous_invited_by)
  where previous_invited_by is not null;
create index family_relationship_accesses_ended_by_idx
  on private.family_relationship_accesses (ended_by)
  where ended_by is not null;

create table public.medications (
  id uuid primary key default gen_random_uuid(),
  care_space_id uuid not null
    references public.care_spaces(id) on delete cascade,
  name text not null,
  unit text not null default '정',
  active boolean not null default true,
  deleted_at timestamptz null,
  quantity_options jsonb not null default '[1,2,3,4]'::jsonb,
  created_by uuid null references auth.users(id) on delete set null,
  updated_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint medications_id_care_space_unique unique (id, care_space_id),
  constraint medications_name_valid check (
    name = btrim(name) and char_length(name) between 1 and 100
  ),
  constraint medications_unit_valid check (
    unit = btrim(unit) and char_length(unit) <= 20
  ),
  constraint medications_deleted_inactive check (
    deleted_at is null or not active
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

create unique index medications_care_space_name_unique
  on public.medications (care_space_id, lower(name))
  where deleted_at is null;
create index medications_active_idx
  on public.medications (created_at) where active;
create index medications_care_space_active_idx
  on public.medications (care_space_id, created_at) where active;
create index medications_care_space_visible_idx
  on public.medications (care_space_id, created_at)
  where deleted_at is null;

create table public.medication_schedules (
  id uuid primary key default gen_random_uuid(),
  care_space_id uuid not null
    references public.care_spaces(id) on delete cascade,
  medication_id uuid not null
    constraint medication_schedules_medication_id_fkey
    references public.medications(id) on update restrict on delete restrict,
  time time(0) without time zone not null,
  active boolean not null default true,
  created_by uuid null references auth.users(id) on delete set null,
  updated_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint medication_schedules_id_care_space_unique
    unique (id, care_space_id),
  constraint medication_schedules_medication_care_space_fkey
    foreign key (medication_id, care_space_id)
    references public.medications(id, care_space_id)
    on update restrict on delete restrict,
  constraint medication_schedules_medication_time_unique
    unique (care_space_id, medication_id, time)
);

create index medication_schedules_medication_id_idx
  on public.medication_schedules (medication_id);
create index medication_schedules_active_time_idx
  on public.medication_schedules (time) where active;
create index medication_schedules_care_space_active_time_idx
  on public.medication_schedules (care_space_id, time) where active;

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

create table public.medication_logs (
  id uuid primary key default gen_random_uuid(),
  care_space_id uuid not null
    references public.care_spaces(id) on delete cascade,
  client_request_id uuid not null,
  medication_id uuid not null
    constraint medication_logs_medication_id_fkey
    references public.medications(id) on update restrict on delete restrict,
  schedule_id uuid null
    constraint medication_logs_schedule_id_fkey
    references public.medication_schedules(id)
    on update restrict on delete set null,
  medication_name text not null,
  medication_unit text not null,
  schedule_time time(0) without time zone null,
  taken_at timestamptz not null default now(),
  quantity numeric(8,3) not null,
  note text null,
  is_extra boolean not null,
  deleted_at timestamptz null,
  created_by uuid null references auth.users(id) on delete set null,
  updated_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint medication_logs_care_space_client_request_id_unique
    unique (care_space_id, client_request_id),
  constraint medication_logs_medication_care_space_fkey
    foreign key (medication_id, care_space_id)
    references public.medications(id, care_space_id)
    on update restrict on delete restrict,
  constraint medication_logs_schedule_care_space_fkey
    foreign key (schedule_id, care_space_id)
    references public.medication_schedules(id, care_space_id)
    on update restrict on delete set null (schedule_id),
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
  on public.medication_logs (taken_at desc) where deleted_at is null;
create index medication_logs_active_medication_taken_at_idx
  on public.medication_logs (medication_id, taken_at desc)
  where deleted_at is null;
create index medication_logs_schedule_id_idx
  on public.medication_logs (schedule_id)
  where schedule_id is not null;
create index medication_logs_deleted_at_idx
  on public.medication_logs (deleted_at desc)
  where deleted_at is not null;
create index medication_logs_schedule_taken_at_idx
  on public.medication_logs (schedule_id, taken_at)
  where schedule_id is not null and deleted_at is null;
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

create table public.daily_status (
  id uuid primary key default gen_random_uuid(),
  care_space_id uuid not null
    references public.care_spaces(id) on delete cascade,
  date date not null,
  fatigue text null,
  strength text null,
  breathing text null,
  eye_symptom text null,
  note text null,
  created_by uuid null references auth.users(id) on delete set null,
  updated_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_status_care_space_date_unique unique (care_space_id, date),
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
  ),
  constraint daily_status_has_content check (
    fatigue is not null
    or strength is not null
    or breathing is not null
    or eye_symptom is not null
    or (note is not null and note ~ '[^[:space:]]')
  )
);

create index daily_status_care_space_date_idx
  on public.daily_status (care_space_id, date desc);

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

create table private.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null references auth.users(id) on delete cascade,
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
  constraint push_subscriptions_id_user_unique unique (id, user_id),
  constraint push_subscriptions_active_owner_valid check (
    user_id is not null or disabled_at is not null
  ),
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

create table private.push_deliveries (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null
    references private.push_subscriptions(id) on delete cascade,
  care_space_id uuid not null,
  schedule_id uuid not null,
  scheduled_for timestamptz not null,
  status text not null,
  attempt_count smallint not null default 0,
  response_status integer null,
  error_code text null,
  attempted_at timestamptz null,
  accepted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_deliveries_schedule_care_space_fkey
    foreign key (schedule_id, care_space_id)
    references public.medication_schedules(id, care_space_id) on delete cascade,
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
create index push_deliveries_space_schedule_idx
  on private.push_deliveries (care_space_id, schedule_id);

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
  end if;

  return selected_access;
end;
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

create or replace function private.can_manage_medication_settings(
  p_care_space_id uuid
)
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
        and medication.care_space_id = new.care_space_id
        and medication.deleted_at is null;
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
  elsif new.is_extra then
    new.schedule_time := null;
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

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger care_spaces_set_updated_at
  before update on public.care_spaces
  for each row execute function public.set_updated_at();
create trigger care_spaces_add_creator_as_owner
  after insert on public.care_spaces
  for each row execute function private.add_care_space_creator_as_owner();
create trigger care_space_members_set_updated_at
  before update on public.care_space_members
  for each row execute function public.set_updated_at();
create trigger care_space_members_protect_family_relationship
  before update or delete on public.care_space_members
  for each row execute function private.protect_family_relationship_membership();
create trigger care_space_invites_set_updated_at
  before update on public.care_space_invites
  for each row execute function public.set_updated_at();
create trigger family_relationships_set_updated_at
  before update on private.family_relationships
  for each row execute function public.set_updated_at();
create trigger family_relationship_accesses_set_updated_at
  before update on private.family_relationship_accesses
  for each row execute function public.set_updated_at();
create trigger family_relationship_accesses_validate
  before insert or update on private.family_relationship_accesses
  for each row execute function private.validate_family_relationship_access();
create trigger medications_set_audit_actor
  before insert or update on public.medications
  for each row execute function private.set_audit_actor();
create trigger medications_set_updated_at
  before update on public.medications
  for each row execute function public.set_updated_at();
create trigger medication_schedules_set_audit_actor
  before insert or update on public.medication_schedules
  for each row execute function private.set_audit_actor();
create trigger medication_schedules_set_updated_at
  before update on public.medication_schedules
  for each row execute function public.set_updated_at();
create trigger medication_schedule_outcomes_set_audit_actor
  before insert or update on public.medication_schedule_outcomes
  for each row execute function private.set_audit_actor();
create trigger medication_schedule_outcomes_set_snapshot
  before insert or update on public.medication_schedule_outcomes
  for each row execute function public.set_medication_schedule_outcome_snapshot();
create trigger medication_schedule_outcomes_set_updated_at
  before update on public.medication_schedule_outcomes
  for each row execute function public.set_updated_at();
create trigger medication_logs_set_audit_actor
  before insert or update on public.medication_logs
  for each row execute function private.set_audit_actor();
create trigger medication_logs_set_snapshot
  before insert or update on public.medication_logs
  for each row execute function public.set_medication_log_snapshot();
create trigger medication_logs_set_updated_at
  before update on public.medication_logs
  for each row execute function public.set_updated_at();
create trigger daily_status_set_audit_actor
  before insert or update on public.daily_status
  for each row execute function private.set_audit_actor();
create trigger daily_status_set_updated_at
  before update on public.daily_status
  for each row execute function public.set_updated_at();
create trigger push_subscriptions_set_updated_at
  before update on private.push_subscriptions
  for each row execute function public.set_updated_at();
create trigger push_deliveries_set_updated_at
  before update on private.push_deliveries
  for each row execute function public.set_updated_at();

create trigger medicine_app_on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_medicine_app_new_user();

-- Existing Auth users receive empty personal spaces. No prescription rows are seeded.
insert into public.profiles (user_id, display_name, avatar_url)
select
  auth_user.id,
  coalesce(
    nullif(
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
    ),
    '사용자'
  ),
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

revoke all on function public.set_updated_at()
  from public, anon, authenticated;
revoke all on function public.set_medication_log_snapshot()
  from public, anon, authenticated;
revoke all on function public.set_medication_schedule_outcome_snapshot()
  from public, anon, authenticated;
revoke all on function private.is_care_space_member(uuid)
  from public, anon, authenticated;
revoke all on function private.is_care_space_owner(uuid)
  from public, anon, authenticated;
revoke all on function private.can_mutate_care_records(uuid)
  from public, anon, authenticated;
revoke all on function private.can_manage_medication_settings(uuid)
  from public, anon, authenticated;
revoke all on function private.shares_care_space(uuid)
  from public, anon, authenticated;
revoke all on function private.set_audit_actor()
  from public, anon, authenticated;
revoke all on function private.add_care_space_creator_as_owner()
  from public, anon, authenticated;
revoke all on function private.handle_medicine_app_new_user()
  from public, anon, authenticated;
grant execute on function private.is_care_space_member(uuid) to authenticated;
grant execute on function private.is_care_space_owner(uuid) to authenticated;
grant execute on function private.can_mutate_care_records(uuid) to authenticated;
grant execute on function private.can_manage_medication_settings(uuid)
  to authenticated;
grant execute on function private.shares_care_space(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.care_spaces enable row level security;
alter table public.care_space_members enable row level security;
alter table public.care_space_invites enable row level security;
alter table public.medications enable row level security;
alter table public.medication_schedules enable row level security;
alter table public.medication_schedule_outcomes enable row level security;
alter table public.medication_logs enable row level security;
alter table public.daily_status enable row level security;
alter table private.care_space_invite_email_limits enable row level security;
alter table private.family_relationships enable row level security;
alter table private.family_relationship_accesses enable row level security;
alter table private.care_space_invite_email_sender_limits enable row level security;
alter table private.care_space_invite_email_global_limits enable row level security;
alter table private.care_space_invite_email_recipient_limits enable row level security;
alter table private.push_subscriptions enable row level security;
alter table private.push_subscription_spaces enable row level security;
alter table private.push_deliveries enable row level security;

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
create policy medications_manager_insert
  on public.medications for insert to authenticated
  with check ((select private.can_manage_medication_settings(care_space_id)));
create policy medications_manager_update
  on public.medications for update to authenticated
  using ((select private.can_manage_medication_settings(care_space_id)))
  with check ((select private.can_manage_medication_settings(care_space_id)));

create policy medication_schedules_member_select
  on public.medication_schedules for select to authenticated
  using (
    (select private.is_care_space_member(care_space_id))
    and exists (
      select 1
        from public.medications as medication
        where medication.id = medication_schedules.medication_id
          and medication.care_space_id = medication_schedules.care_space_id
          and medication.deleted_at is null
    )
  );
create policy medication_schedules_manager_insert
  on public.medication_schedules for insert to authenticated
  with check (
    (select private.can_manage_medication_settings(care_space_id))
    and exists (
      select 1
        from public.medications as medication
        where medication.id = medication_schedules.medication_id
          and medication.care_space_id = medication_schedules.care_space_id
          and medication.deleted_at is null
    )
  );
create policy medication_schedules_manager_update
  on public.medication_schedules for update to authenticated
  using ((select private.can_manage_medication_settings(care_space_id)))
  with check (
    (select private.can_manage_medication_settings(care_space_id))
    and exists (
      select 1
        from public.medications as medication
        where medication.id = medication_schedules.medication_id
          and medication.care_space_id = medication_schedules.care_space_id
          and medication.deleted_at is null
    )
  );
create policy medication_schedules_manager_delete
  on public.medication_schedules for delete to authenticated
  using ((select private.can_manage_medication_settings(care_space_id)));

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
revoke all on table public.medication_schedule_outcomes from anon, authenticated;
revoke all on table public.medication_logs from anon, authenticated;
revoke all on table public.daily_status from anon, authenticated;
revoke all on table private.family_relationships
  from public, anon, authenticated;
revoke all on table private.family_relationship_accesses
  from public, anon, authenticated;
revoke all on table private.care_space_invite_email_limits
  from public, anon, authenticated;
revoke all on table private.care_space_invite_email_sender_limits
  from public, anon, authenticated;
revoke all on table private.care_space_invite_email_global_limits
  from public, anon, authenticated;
revoke all on table private.care_space_invite_email_recipient_limits
  from public, anon, authenticated;
revoke all on table private.push_subscriptions from public, anon, authenticated;
revoke all on table private.push_subscription_spaces from public, anon, authenticated;
revoke all on table private.push_deliveries from public, anon, authenticated;

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
  taken_at,
  quantity,
  note,
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
grant update (fatigue, strength, breathing, eye_symptom, note)
  on table public.daily_status to authenticated;
grant delete on table public.daily_status to authenticated;

-- New projects may not expose tables automatically; keep service-role access explicit.
grant all on table public.profiles to service_role;
grant all on table public.care_spaces to service_role;
grant all on table public.care_space_members to service_role;
grant all on table public.care_space_invites to service_role;
grant all on table public.medications to service_role;
grant all on table public.medication_schedules to service_role;
grant all on table public.medication_schedule_outcomes to service_role;
grant all on table public.medication_logs to service_role;
grant all on table public.daily_status to service_role;
grant all on table private.care_space_invite_email_limits to service_role;
grant all on table private.family_relationships to service_role;
grant all on table private.family_relationship_accesses to service_role;
grant all on table private.care_space_invite_email_sender_limits to service_role;
grant all on table private.care_space_invite_email_global_limits to service_role;
grant all on table private.care_space_invite_email_recipient_limits to service_role;
grant all on table private.push_subscriptions to service_role;
grant all on table private.push_subscription_spaces to service_role;
grant all on table private.push_deliveries to service_role;

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

create or replace function public.get_pending_care_space_invites()
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
        inviter_caregiver_care_space_id = null,
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
        inviter_caregiver_care_space_id = null,
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

create or replace function public.soft_delete_medication(
  p_care_space_id uuid,
  p_medication_id uuid
)
returns public.medications
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_medication public.medications;
begin
  if (select auth.uid()) is null then
    raise insufficient_privilege using message = 'authentication required';
  end if;
  if not private.can_manage_medication_settings(p_care_space_id) then
    raise insufficient_privilege using message = 'medication manager required';
  end if;

  select medication.* into selected_medication
    from public.medications as medication
    where medication.id = p_medication_id
      and medication.care_space_id = p_care_space_id
      and medication.deleted_at is null
    for update;
  if not found then
    raise no_data_found using message = 'medication not found';
  end if;

  update public.medication_schedules as schedule
    set active = false
    where schedule.care_space_id = p_care_space_id
      and schedule.medication_id = p_medication_id
      and schedule.active;

  update public.medications as medication
    set active = false,
        deleted_at = now()
    where medication.id = p_medication_id
      and medication.care_space_id = p_care_space_id
      and medication.deleted_at is null
    returning medication.* into selected_medication;

  return selected_medication;
end;
$$;

create or replace function public.reclassify_medication_log(
  p_care_space_id uuid,
  p_log_id uuid,
  p_schedule_id uuid,
  p_is_extra boolean,
  p_update_taken_at boolean,
  p_taken_at timestamptz,
  p_update_quantity boolean,
  p_quantity numeric,
  p_update_note boolean,
  p_note text
)
returns public.medication_logs
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  selected_log public.medication_logs;
begin
  if caller_id is null then
    raise insufficient_privilege using message = 'authentication required';
  end if;
  if p_care_space_id is null or p_log_id is null or p_is_extra is null then
    raise not_null_violation
      using message = 'care space, log and classification are required';
  end if;
  if p_update_taken_at is null
    or p_update_quantity is null
    or p_update_note is null
  then
    raise not_null_violation using message = 'update flags are required';
  end if;
  if not private.can_mutate_care_records(p_care_space_id) then
    raise insufficient_privilege using message = 'care record writer required';
  end if;

  select log.* into selected_log
    from public.medication_logs as log
    where log.id = p_log_id
      and log.care_space_id = p_care_space_id
      and log.deleted_at is null
    for update;
  if not found then
    raise no_data_found using message = 'medication log not found';
  end if;

  if p_schedule_id is null and not p_is_extra then
    raise check_violation
      using message = 'only a deleted schedule may retain scheduled classification without schedule_id';
  end if;
  if p_schedule_id is not null and p_is_extra then
    raise check_violation using message = 'scheduled medication log cannot be extra';
  end if;
  if p_schedule_id is not null and not exists (
    select 1
      from public.medication_schedules as schedule
      where schedule.id = p_schedule_id
        and schedule.care_space_id = p_care_space_id
        and schedule.medication_id = selected_log.medication_id
  ) then
    raise foreign_key_violation
      using message = 'schedule_id does not belong to medication log';
  end if;
  if p_update_taken_at and p_taken_at is null then
    raise not_null_violation using message = 'taken_at is required';
  end if;
  if p_update_quantity and p_quantity is null then
    raise not_null_violation using message = 'quantity is required';
  end if;

  update public.medication_logs as log
    set schedule_id = p_schedule_id,
        is_extra = p_is_extra,
        taken_at = case
          when p_update_taken_at then p_taken_at
          else log.taken_at
        end,
        quantity = case
          when p_update_quantity then p_quantity
          else log.quantity
        end,
        note = case
          when p_update_note then p_note
          else log.note
        end
    where log.id = selected_log.id
      and log.care_space_id = selected_log.care_space_id
    returning log.* into selected_log;

  return selected_log;
end;
$$;

create or replace function public.upsert_daily_status(
  p_care_space_id uuid,
  p_date date,
  p_fatigue text,
  p_strength text,
  p_breathing text,
  p_eye_symptom text,
  p_note text
)
returns public.daily_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  selected_status public.daily_status;
begin
  if caller_id is null then
    raise insufficient_privilege using message = 'authentication required';
  end if;
  if p_care_space_id is null or p_date is null then
    raise not_null_violation using message = 'care space and date are required';
  end if;
  if not private.can_mutate_care_records(p_care_space_id) then
    raise insufficient_privilege using message = 'care record writer required';
  end if;

  insert into public.daily_status (
    care_space_id,
    date,
    fatigue,
    strength,
    breathing,
    eye_symptom,
    note
  ) values (
    p_care_space_id,
    p_date,
    p_fatigue,
    p_strength,
    p_breathing,
    p_eye_symptom,
    p_note
  )
  on conflict (care_space_id, date) do update
    set fatigue = excluded.fatigue,
        strength = excluded.strength,
        breathing = excluded.breathing,
        eye_symptom = excluded.eye_symptom,
        note = excluded.note
  returning * into selected_status;

  return selected_status;
end;
$$;

revoke all on function public.create_care_space_invite(uuid, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.get_pending_care_space_invites()
  from public, anon, authenticated;
revoke all on function public.accept_care_space_invite(uuid)
  from public, anon, authenticated;
revoke all on function public.accept_care_space_invite(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.decline_care_space_invite(uuid)
  from public, anon, authenticated;
revoke all on function public.revoke_care_space_invite(uuid)
  from public, anon, authenticated;
revoke all on function public.remove_care_space_member(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.soft_delete_medication(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.reclassify_medication_log(
  uuid, uuid, uuid, boolean, boolean, timestamptz, boolean, numeric, boolean, text
) from public, anon, authenticated;
revoke all on function public.upsert_daily_status(
  uuid, date, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.create_care_space_invite(uuid, text, text, timestamptz)
  to authenticated;
grant execute on function public.get_pending_care_space_invites()
  to authenticated;
grant execute on function public.accept_care_space_invite(uuid) to authenticated;
grant execute on function public.accept_care_space_invite(uuid, uuid)
  to authenticated;
grant execute on function public.decline_care_space_invite(uuid) to authenticated;
grant execute on function public.revoke_care_space_invite(uuid) to authenticated;
grant execute on function public.remove_care_space_member(uuid, uuid)
  to authenticated;
grant execute on function public.soft_delete_medication(uuid, uuid)
  to authenticated;
grant execute on function public.reclassify_medication_log(
  uuid, uuid, uuid, boolean, boolean, timestamptz, boolean, numeric, boolean, text
) to authenticated;
grant execute on function public.upsert_daily_status(
  uuid, date, text, text, text, text, text
) to authenticated;

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

revoke all on function private.push_dispatch_secret_matches(text)
  from public, anon, authenticated;

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
grant execute on function public.claim_due_push_notifications(text, timestamptz)
  to anon;
grant execute on function public.prepare_push_delivery_for_send(
  text, uuid, smallint, timestamptz
) to anon;
grant execute on function public.complete_push_delivery(
  text, uuid, smallint, boolean, integer, text, boolean
) to anon;

create or replace function public.claim_care_space_invite_email_send(
  p_dispatch_secret text,
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
  if not private.push_dispatch_secret_matches(p_dispatch_secret) then
    raise insufficient_privilege using message = 'invalid invite dispatch secret';
  end if;
  if not exists (
    select 1
      from auth.users as app_user
      where app_user.id = caller_id
        and app_user.is_anonymous is false
        and app_user.email_confirmed_at is not null
  ) then
    raise insufficient_privilege using message = 'verified permanent user required';
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

revoke all on function public.claim_care_space_invite_email_send(text, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_care_space_invite_email_send(text, uuid)
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
    set user_id = null,
        disabled_at = coalesce(subscription.disabled_at, now())
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

revoke all on function private.protect_family_relationship_membership()
  from public, anon, authenticated;
revoke all on function private.validate_family_relationship_access()
  from public, anon, authenticated;
revoke all on function private.add_family_relationship_access(
  uuid, uuid, uuid, uuid, uuid
) from public, anon, authenticated;
revoke all on function private.end_family_relationship_access(uuid, uuid)
  from public, anon, authenticated;
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
