begin;

revoke all on function public.claim_care_space_invite_email_send(uuid)
  from public, anon, authenticated;

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

  return public.claim_care_space_invite_email_send(p_invite_id);
end;
$$;

revoke all on function public.claim_care_space_invite_email_send(text, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_care_space_invite_email_send(text, uuid)
  to authenticated;

commit;
