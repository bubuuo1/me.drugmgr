begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- btrim(text) only strips regular spaces by default. Replace the constraint so
-- tabs, newlines and other whitespace-only notes cannot create an empty row.
alter table public.daily_status
  drop constraint daily_status_has_content;

alter table public.daily_status
  add constraint daily_status_has_content
  check (
    fatigue is not null
    or strength is not null
    or breathing is not null
    or eye_symptom is not null
    or (note is not null and note ~ '[^[:space:]]')
  );

commit;
