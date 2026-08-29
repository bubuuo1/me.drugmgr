set lock_timeout = '5s';

-- Schedules only define notification times; actual quantities live in medication_logs.
alter table public.medication_schedules
  drop column if exists default_quantity;

reset lock_timeout;
