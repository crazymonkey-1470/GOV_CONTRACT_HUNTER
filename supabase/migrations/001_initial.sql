-- ============================================================================
-- ContractHunter — database setup
--
-- The `contract_opportunities` table is expected to already exist (it is
-- populated by the upstream AI agent). This migration is written to be SAFE to
-- run against an existing project: every statement is idempotent. It:
--   1. Creates the table only if it is missing (reference schema).
--   2. Adds indexes that speed up the dashboard query.
--   3. Enables Row Level Security so the public anon key cannot read data
--      unless the request carries a valid signed-in session.
--
-- Run it in: Supabase Dashboard -> SQL Editor -> New query -> Run.
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
