-- 투약 관리 앱 스키마
-- docs/06-database.md 기준

create extension if not exists "pgcrypto";

-- 1. medications (약 기본 정보)
create table if not exists public.medications (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  unit text not null default '정',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. medication_schedules (복용 예정 정보)
create table if not exists public.medication_schedules (
  id uuid primary key default gen_random_uuid(),
  medication_id uuid not null references public.medications(id) on delete cascade,
  time time not null,
  default_quantity integer not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. medication_logs (실제 복용 기록) - 과거 기록은 수정/삭제 시에만 변경
create table if not exists public.medication_logs (
  id uuid primary key default gen_random_uuid(),
  medication_id uuid not null references public.medications(id) on delete cascade,
  schedule_id uuid null references public.medication_schedules(id) on delete set null,
  taken_at timestamptz not null default now(),
  quantity integer not null check (quantity > 0),
  note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 4. daily_status (하루 상태)
create table if not exists public.daily_status (
  id uuid primary key default gen_random_uuid(),
  date date not null unique,
  fatigue text null,
  strength text null,
  breathing text null,
  eye_symptom text null,
  note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 인덱스 (docs/06-database.md §6)
create index if not exists idx_medication_logs_taken_at on public.medication_logs (taken_at);
create index if not exists idx_medication_logs_medication_id on public.medication_logs (medication_id);
create index if not exists idx_daily_status_date on public.daily_status (date);

-- 시드 데이터: 메스티논 / 소론도
insert into public.medications (name, unit, active)
values ('메스티논', '정', true), ('소론도', '정', true)
on conflict do nothing;

-- updated_at 자동 갱신 트리거
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_medications_updated_at on public.medications;
create trigger trg_medications_updated_at
  before update on public.medications
  for each row execute function public.set_updated_at();

drop trigger if exists trg_medication_schedules_updated_at on public.medication_schedules;
create trigger trg_medication_schedules_updated_at
  before update on public.medication_schedules
  for each row execute function public.set_updated_at();

drop trigger if exists trg_medication_logs_updated_at on public.medication_logs;
create trigger trg_medication_logs_updated_at
  before update on public.medication_logs
  for each row execute function public.set_updated_at();

drop trigger if exists trg_daily_status_updated_at on public.daily_status;
create trigger trg_daily_status_updated_at
  before update on public.daily_status
  for each row execute function public.set_updated_at();

-- RLS: 로그인 없는 개인 앱 데모. (docs/07-security.md)
-- 아직 인증/토큰 도입 전이라 anon에게 CRUD를 허용한다.
-- 서비스/보안 강화 시 이 정책을 반드시 교체한다. service_role key는 클라이언트에 넣지 않는다.
alter table public.medications enable row level security;
alter table public.medication_schedules enable row level security;
alter table public.medication_logs enable row level security;
alter table public.daily_status enable row level security;

create policy "anon select medications" on public.medications for select using (true);
create policy "anon insert medications" on public.medications for insert with check (true);
create policy "anon update medications" on public.medications for update using (true);
create policy "anon delete medications" on public.medications for delete using (true);

create policy "anon all medication_schedules" on public.medication_schedules for all using (true) with check (true);
create policy "anon all medication_logs" on public.medication_logs for all using (true) with check (true);
create policy "anon all daily_status" on public.daily_status for all using (true) with check (true);

grant usage on schema public to anon;
grant all on all tables in schema public to anon;