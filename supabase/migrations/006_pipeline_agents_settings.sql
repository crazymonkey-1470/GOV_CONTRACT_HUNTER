-- ContractHunter v2: pipeline, agent run log, change log, agent ideas, user settings.
-- Additive only: no drops, no deletes. Every new table has RLS limited to the owner.
-- Applied to the live project as migration "pipeline_agents_settings".
--
-- Owner (the only user): a406af97-3677-473d-b338-2eb89e906260 (hello@quant-agents.org).
-- If you rebuild on a new project, replace that id everywhere below.

-- 1. Extensions --------------------------------------------------------------
create extension if not exists pg_trgm with schema extensions;  -- title similarity (duplicate guard)
create extension if not exists pg_cron;                          -- hourly daily-brief trigger
create extension if not exists pg_net with schema extensions;    -- HTTP calls from the database

-- 2. Award fields, filled in by agents through "changes" -----------------------
alter table public.contract_opportunities
  add column if not exists awardee      text,
  add column if not exists award_amount numeric,
  add column if not exists award_date   date;

comment on column public.contract_opportunities.awardee is 'Who won the award, once announced';
comment on column public.contract_opportunities.award_amount is 'Award amount in USD, once announced';
comment on column public.contract_opportunities.award_date is 'Date the award was announced';

-- 3. Shared trigger: keep updated_at current ------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- 4. Pipeline: one row per opportunity the owner has acted on -------------------
-- status is null when the owner only marked fit or ran the bid check.
create table if not exists public.opportunity_pipeline (
  opportunity_id uuid primary key references public.contract_opportunities(id) on delete cascade,
  status         text check (status in ('saved', 'pursuing', 'submitted', 'won', 'lost', 'no_bid')),
  notes          text,
  fit            text check (fit in ('good', 'bad')),
  fit_reason     text,
  bid_check      jsonb,
  decision       text check (decision in ('go', 'no_go')),
  updated_at     timestamptz not null default now()
);
create index if not exists opportunity_pipeline_status_idx on public.opportunity_pipeline (status);

create or replace trigger opportunity_pipeline_updated_at
  before update on public.opportunity_pipeline
  for each row execute function public.set_updated_at();

-- 5. Change log: amendments, cancellations and awards reported by agents ----------
create table if not exists public.opportunity_changes (
  id             uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.contract_opportunities(id) on delete cascade,
  field          text not null,
  old_value      jsonb,
  new_value      jsonb,
  source_url     text,
  note           text,
  agent          text,
  created_at     timestamptz not null default now()
);
create index if not exists opportunity_changes_opportunity_idx
  on public.opportunity_changes (opportunity_id, created_at desc);

-- 6. Agent runs: one row per run report ------------------------------------------
create table if not exists public.agent_runs (
  id              uuid primary key default gen_random_uuid(),
  agent           text not null,
  started_at      timestamptz,
  finished_at     timestamptz not null default now(),
  portals_checked text[] not null default '{}',
  searches        text[] not null default '{}',
  received        int not null default 0,
  inserted        int not null default 0,
  enriched        int not null default 0,
  rejected        int not null default 0,
  notes           text
);
create index if not exists agent_runs_agent_finished_idx on public.agent_runs (agent, finished_at desc);

-- 7. Agent ideas: suggestions the owner approves, dismisses or answers ------------
create table if not exists public.agent_ideas (
  id                uuid primary key default gen_random_uuid(),
  agent             text,
  type              text not null check (type in (
                      'portal', 'keyword', 'pattern', 'teaming', 'recompete',
                      'forecast', 'subcontract', 'question', 'other')),
  title             text not null,
  details           text,
  url               text,
  related_notice_id text,
  status            text not null default 'new' check (status in ('new', 'approved', 'dismissed')),
  reply             text,
  created_at        timestamptz not null default now(),
  decided_at        timestamptz
);
create index if not exists agent_ideas_status_idx on public.agent_ideas (status, created_at desc);

-- 8. User settings: eligibility, search terms, visit and brief timestamps ----------
create table if not exists public.user_settings (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  eligibility   text[] not null default '{SDVOSB,VOSB,"Small Business"}',
  search_terms  text[] not null default '{}',
  last_seen_at  timestamptz,
  last_brief_at timestamptz
);
insert into public.user_settings (user_id)
values ('a406af97-3677-473d-b338-2eb89e906260')
on conflict (user_id) do nothing;

-- 9. Row Level Security: owner only (sign-ups are still on) --------------------------
alter table public.opportunity_pipeline enable row level security;
alter table public.opportunity_changes  enable row level security;
alter table public.agent_runs           enable row level security;
alter table public.agent_ideas          enable row level security;
alter table public.user_settings        enable row level security;

-- Pipeline and settings: full access for the owner.
create policy "Owner reads pipeline" on public.opportunity_pipeline
  for select to authenticated
  using ((select auth.uid()) = 'a406af97-3677-473d-b338-2eb89e906260'::uuid);
create policy "Owner adds to pipeline" on public.opportunity_pipeline
  for insert to authenticated
  with check ((select auth.uid()) = 'a406af97-3677-473d-b338-2eb89e906260'::uuid);
create policy "Owner updates pipeline" on public.opportunity_pipeline
  for update to authenticated
  using ((select auth.uid()) = 'a406af97-3677-473d-b338-2eb89e906260'::uuid)
  with check ((select auth.uid()) = 'a406af97-3677-473d-b338-2eb89e906260'::uuid);
create policy "Owner removes from pipeline" on public.opportunity_pipeline
  for delete to authenticated
  using ((select auth.uid()) = 'a406af97-3677-473d-b338-2eb89e906260'::uuid);

create policy "Owner reads settings" on public.user_settings
  for select to authenticated
  using ((select auth.uid()) = 'a406af97-3677-473d-b338-2eb89e906260'::uuid and user_id = (select auth.uid()));
create policy "Owner adds settings" on public.user_settings
  for insert to authenticated
  with check ((select auth.uid()) = 'a406af97-3677-473d-b338-2eb89e906260'::uuid and user_id = (select auth.uid()));
create policy "Owner updates settings" on public.user_settings
  for update to authenticated
  using ((select auth.uid()) = 'a406af97-3677-473d-b338-2eb89e906260'::uuid and user_id = (select auth.uid()))
  with check ((select auth.uid()) = 'a406af97-3677-473d-b338-2eb89e906260'::uuid and user_id = (select auth.uid()));
create policy "Owner removes settings" on public.user_settings
  for delete to authenticated
  using ((select auth.uid()) = 'a406af97-3677-473d-b338-2eb89e906260'::uuid and user_id = (select auth.uid()));

-- Written only by the agent endpoint (service connection); the owner reads them.
create policy "Owner reads changes" on public.opportunity_changes
  for select to authenticated
  using ((select auth.uid()) = 'a406af97-3677-473d-b338-2eb89e906260'::uuid);
create policy "Owner reads agent runs" on public.agent_runs
  for select to authenticated
  using ((select auth.uid()) = 'a406af97-3677-473d-b338-2eb89e906260'::uuid);

-- Ideas: the owner reads them and approves, dismisses or replies.
create policy "Owner reads ideas" on public.agent_ideas
  for select to authenticated
  using ((select auth.uid()) = 'a406af97-3677-473d-b338-2eb89e906260'::uuid);
create policy "Owner decides ideas" on public.agent_ideas
  for update to authenticated
  using ((select auth.uid()) = 'a406af97-3677-473d-b338-2eb89e906260'::uuid)
  with check ((select auth.uid()) = 'a406af97-3677-473d-b338-2eb89e906260'::uuid);

-- Approved portal ideas become sourcing portals.
create policy "Owner adds portals" on public.sourcing_portals
  for insert to authenticated
  with check ((select auth.uid()) = 'a406af97-3677-473d-b338-2eb89e906260'::uuid);

-- Tighten the existing read policies from "any signed-in user" to the owner.
alter policy "Authenticated users can read opportunities" on public.contract_opportunities
  to authenticated
  using ((select auth.uid()) = 'a406af97-3677-473d-b338-2eb89e906260'::uuid);
alter policy "Authenticated users can read opportunities" on public.contract_opportunities
  rename to "Owner reads opportunities";

alter policy "Authenticated users can read sourcing portals" on public.sourcing_portals
  to authenticated
  using ((select auth.uid()) = 'a406af97-3677-473d-b338-2eb89e906260'::uuid);
alter policy "Authenticated users can read sourcing portals" on public.sourcing_portals
  rename to "Owner reads sourcing portals";
