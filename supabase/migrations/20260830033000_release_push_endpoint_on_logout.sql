begin;

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

commit;
