-- ============================================================================
-- ContractHunter — sourcing_portals
--
-- Government contracting websites to search directly (federal / state / county),
-- shown on the "Helpful Links" page. Read by signed-in users; written by the
-- discovery agent using the service_role key (upsert on portal_url).
-- ============================================================================

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
