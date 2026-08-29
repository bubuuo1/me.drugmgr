-- A schedule's medication is immutable so historical logs can never point to
-- a schedule that was later reassigned to another medication.
revoke update (medication_id) on table public.medication_schedules from anon;
