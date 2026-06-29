-- ════════════════════════════════════════════════════════════════
-- Mission Control — telemetry layer (a SEPARATE Supabase project, NOT
-- your production database). GitHub remains the source of truth.
-- ════════════════════════════════════════════════════════════════

create table if not exists public.fleet_tasks (
  issue           integer primary key,
  state           text not null,
  title           text,
  branch          text,
  model           text,
  pr_url          text,
  review_verdict  text,
  error           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.fleet_events (
  id      bigint generated always as identity primary key,
  issue   integer not null,
  state   text not null,
  data    jsonb,
  ts      timestamptz not null default now()
);
create index if not exists fleet_events_issue_idx on public.fleet_events (issue, ts desc);

-- RLS on, NO anon SELECT policy: the dashboard reads server-side behind
-- the mc_session cookie (see /api/board). Nothing is publicly readable.
-- The fleet writes with the service-role/dedicated role (bypasses RLS).
alter table public.fleet_tasks  enable row level security;
alter table public.fleet_events enable row level security;

-- updated_at-trigger.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists fleet_tasks_updated_at on public.fleet_tasks;
create trigger fleet_tasks_updated_at before update on public.fleet_tasks
  for each row execute function public.set_updated_at();
