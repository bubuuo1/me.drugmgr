-- PostgREST merge-duplicates upsert includes the conflict key in the UPDATE
-- column set, so anon also needs UPDATE on the immutable date key.
grant update (date) on table public.daily_status to anon;
