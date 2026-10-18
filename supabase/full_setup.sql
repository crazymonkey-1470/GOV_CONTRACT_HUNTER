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
