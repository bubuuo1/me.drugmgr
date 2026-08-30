begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- This validates existing rows without changing or deleting any health record.
-- If an earlier environment still contains an empty legacy row, validation must
-- fail so that an operator can review that row explicitly.
alter table public.daily_status
  validate constraint daily_status_has_content;

commit;
