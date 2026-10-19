-- ============================================================================
-- ContractHunter — full setup for a FRESH Supabase project (one paste, one run).
--
-- Combines migrations 001 + 003 + 004 (sample data from 002 is left out) and
-- adds the optional sourcing_portals.search_url column the scraper already
-- prefers when present. Idempotent: safe to re-run.
--
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> Run.
-- ============================================================================

-- 1. Reference schema (only created if the table does not already exist) -------
create table if not exists public.contract_opportunities (
  id                  uuid primary key default gen_random_uuid(),
  notice_id           text unique,
  title               text not null,
  agency              text,
  value               numeric,
  posted_date         date,
  response_deadline   timestamptz,
  sam_link            text,
  relevance_score     numeric not null default 0,
  summary             text,
  keywords            text[],
  naics_codes         text[],
  set_aside           text,
  customer_fit_notes  text,
  raw_data            jsonb,
  status              text default 'new',
  created_at          timestamptz not null default now()
);

-- 2. Indexes ------------------------------------------------------------------
-- Dashboard sorts by relevance_score (desc) filtered to >= 65.
create index if not exists contract_opportunities_relevance_idx
  on public.contract_opportunities (relevance_score desc);

-- "Days left" / deadline ordering.
create index if not exists contract_opportunities_deadline_idx
  on public.contract_opportunities (response_deadline);

-- Optional filtering by workflow status.
create index if not exists contract_opportunities_status_idx
  on public.contract_opportunities (status);

-- 3. Row Level Security -------------------------------------------------------
alter table public.contract_opportunities enable row level security;

-- Allow any authenticated user (this app has exactly one) to read every row.
-- The agent that writes rows should use the service-role key, which bypasses
-- RLS — so no INSERT/UPDATE policy is needed for the dashboard to work.
drop policy if exists "Authenticated users can read opportunities"
  on public.contract_opportunities;

create policy "Authenticated users can read opportunities"
  on public.contract_opportunities
  for select
  to authenticated
  using (true);

alter table public.contract_opportunities
  add column if not exists notice_type  text,        -- e.g. "Solicitation", "Sources Sought"
  add column if not exists poc_name     text,        -- contracting officer name
  add column if not exists poc_email    text,        -- contracting officer email
  add column if not exists requirements text[];      -- short bullet list of key requirements

-- At-a-glance bid info: process, fast contact, competition (migration 005).
alter table public.contract_opportunities
  add column if not exists questions_deadline      timestamptz,
  add column if not exists submission_method       text,
  add column if not exists submission_instructions text,
  add column if not exists poc_phone               text,
  add column if not exists place_of_performance    text,
  add column if not exists incumbent               text,
  add column if not exists interested_vendors      text[],
  add column if not exists interested_vendors_url  text;

create table if not exists public.sourcing_portals (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  state           text,
  portal_type     text,            -- 'federal' | 'state' | 'county' | 'aggregator' | 'other'
  portal_url      text not null unique,
  notes           text,
  search_keywords text[],
  last_checked    timestamptz,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

create index if not exists sourcing_portals_type_idx   on public.sourcing_portals (portal_type);
create index if not exists sourcing_portals_state_idx  on public.sourcing_portals (state);
create index if not exists sourcing_portals_active_idx on public.sourcing_portals (is_active);

-- Row Level Security: signed-in users can read; the agent writes via service_role.
alter table public.sourcing_portals enable row level security;

drop policy if exists "Authenticated users can read sourcing portals"
  on public.sourcing_portals;

create policy "Authenticated users can read sourcing portals"
  on public.sourcing_portals
  for select
  to authenticated
  using (true);

-- Starter set of verified national portals (idempotent).
insert into public.sourcing_portals (name, state, portal_type, portal_url, notes, search_keywords, is_active)
values
  ('SAM.gov', null, 'federal', 'https://sam.gov',
   'Primary U.S. federal contract opportunities (System for Award Management).',
   array['federal','solicitations','opportunities'], true),
  ('GSA eLibrary', null, 'federal', 'https://www.gsaelibrary.gsa.gov',
   'GSA Multiple Award Schedule contract holders and contract numbers.',
   array['GSA','schedules','MAS'], true),
  ('USAspending.gov', null, 'federal', 'https://www.usaspending.gov',
   'Federal award and spending data — research buyers and incumbents.',
   array['spending','awards','research'], true),
  ('FPDS', null, 'federal', 'https://www.fpds.gov',
   'Federal Procurement Data System — detailed federal contract actions.',
   array['procurement','data','awards'], true)
on conflict (portal_url) do nothing;

-- Optional pre-built keyword search per portal; the Firecrawl scraper scrapes
-- this instead of portal_url when it is set.
alter table public.sourcing_portals
  add column if not exists search_url text;

-- Known-good LIMS search (was in the old database).
insert into public.sourcing_portals (name, state, portal_type, portal_url, notes, search_keywords, is_active)
values
  ('HigherGov', null, 'aggregator', 'https://www.highergov.com/opportunity/?q=LIMS',
   'Pre-built LIMS opportunity search across federal/state/local.',
   array['LIMS','laboratory information management'], true)
on conflict (portal_url) do nothing;

-- ============================================================================
-- 006: pipeline, agent run log, change log, agent ideas, user settings.
-- Owner-only RLS. Owner id a406af97-3677-473d-b338-2eb89e906260 is the
-- production user; replace it if you rebuild on a new project.
-- ============================================================================
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
select id from auth.users where id = 'a406af97-3677-473d-b338-2eb89e906260'
on conflict (user_id) do nothing;

-- 9. Row Level Security: owner only (sign-ups are still on) --------------------------
alter table public.opportunity_pipeline enable row level security;
alter table public.opportunity_changes  enable row level security;
alter table public.agent_runs           enable row level security;
alter table public.agent_ideas          enable row level security;
alter table public.user_settings        enable row level security;

-- Pipeline and settings: full access for the owner.
drop policy if exists "Owner reads pipeline" on public.opportunity_pipeline;
create policy "Owner reads pipeline" on public.opportunity_pipeline
  for select to authenticated
  using ((select auth.uid()) = 'a406af97-3677-473d-b338-2eb89e906260'::uuid);
drop policy if exists "Owner adds to pipeline" on public.opportunity_pipeline;
create policy "Owner adds to pipeline" on public.opportunity_pipeline
  for insert to authenticated
  with check ((select auth.uid()) = 'a406af97-3677-473d-b338-2eb89e906260'::uuid);
drop policy if exists "Owner updates pipeline" on public.opportunity_pipeline;
create policy "Owner updates pipeline" on public.opportunity_pipeline
  for update to authenticated
  using ((select auth.uid()) = 'a406af97-3677-473d-b338-2eb89e906260'::uuid)
  with check ((select auth.uid()) = 'a406af97-3677-473d-b338-2eb89e906260'::uuid);
drop policy if exists "Owner removes from pipeline" on public.opportunity_pipeline;
create policy "Owner removes from pipeline" on public.opportunity_pipeline
  for delete to authenticated
  using ((select auth.uid()) = 'a406af97-3677-473d-b338-2eb89e906260'::uuid);

drop policy if exists "Owner reads settings" on public.user_settings;
create policy "Owner reads settings" on public.user_settings
  for select to authenticated
  using ((select auth.uid()) = 'a406af97-3677-473d-b338-2eb89e906260'::uuid and user_id = (select auth.uid()));
drop policy if exists "Owner adds settings" on public.user_settings;
create policy "Owner adds settings" on public.user_settings
  for insert to authenticated
  with check ((select auth.uid()) = 'a406af97-3677-473d-b338-2eb89e906260'::uuid and user_id = (select auth.uid()));
drop policy if exists "Owner updates settings" on public.user_settings;
create policy "Owner updates settings" on public.user_settings
  for update to authenticated
  using ((select auth.uid()) = 'a406af97-3677-473d-b338-2eb89e906260'::uuid and user_id = (select auth.uid()))
  with check ((select auth.uid()) = 'a406af97-3677-473d-b338-2eb89e906260'::uuid and user_id = (select auth.uid()));
drop policy if exists "Owner removes settings" on public.user_settings;
create policy "Owner removes settings" on public.user_settings
  for delete to authenticated
  using ((select auth.uid()) = 'a406af97-3677-473d-b338-2eb89e906260'::uuid and user_id = (select auth.uid()));

-- Written only by the agent endpoint (service connection); the owner reads them.
drop policy if exists "Owner reads changes" on public.opportunity_changes;
create policy "Owner reads changes" on public.opportunity_changes
  for select to authenticated
  using ((select auth.uid()) = 'a406af97-3677-473d-b338-2eb89e906260'::uuid);
drop policy if exists "Owner reads agent runs" on public.agent_runs;
create policy "Owner reads agent runs" on public.agent_runs
  for select to authenticated
  using ((select auth.uid()) = 'a406af97-3677-473d-b338-2eb89e906260'::uuid);

-- Ideas: the owner reads them and approves, dismisses or replies.
drop policy if exists "Owner reads ideas" on public.agent_ideas;
create policy "Owner reads ideas" on public.agent_ideas
  for select to authenticated
  using ((select auth.uid()) = 'a406af97-3677-473d-b338-2eb89e906260'::uuid);
drop policy if exists "Owner decides ideas" on public.agent_ideas;
create policy "Owner decides ideas" on public.agent_ideas
  for update to authenticated
  using ((select auth.uid()) = 'a406af97-3677-473d-b338-2eb89e906260'::uuid)
  with check ((select auth.uid()) = 'a406af97-3677-473d-b338-2eb89e906260'::uuid);

-- Approved portal ideas become sourcing portals.
drop policy if exists "Owner adds portals" on public.sourcing_portals;
create policy "Owner adds portals" on public.sourcing_portals
  for insert to authenticated
  with check ((select auth.uid()) = 'a406af97-3677-473d-b338-2eb89e906260'::uuid);

-- Owner-only reads (replaces the "any signed-in user" policies created above).
drop policy if exists "Authenticated users can read opportunities" on public.contract_opportunities;
drop policy if exists "Owner reads opportunities" on public.contract_opportunities;
create policy "Owner reads opportunities" on public.contract_opportunities
  for select to authenticated
  using ((select auth.uid()) = 'a406af97-3677-473d-b338-2eb89e906260'::uuid);

drop policy if exists "Authenticated users can read sourcing portals" on public.sourcing_portals;
drop policy if exists "Owner reads sourcing portals" on public.sourcing_portals;
create policy "Owner reads sourcing portals" on public.sourcing_portals
  for select to authenticated
  using ((select auth.uid()) = 'a406af97-3677-473d-b338-2eb89e906260'::uuid);
