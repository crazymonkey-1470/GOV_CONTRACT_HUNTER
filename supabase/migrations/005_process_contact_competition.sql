-- At-a-glance bid info for the dashboard: process, fast contact, competition.
-- All nullable and additive; existing rows and code are unaffected.
-- Applied to the live project as migration "contract_process_contact_competition_fields".
alter table public.contract_opportunities
  add column if not exists questions_deadline      timestamptz,
  add column if not exists submission_method       text,
  add column if not exists submission_instructions text,
  add column if not exists poc_phone               text,
  add column if not exists place_of_performance    text,
  add column if not exists incumbent               text,
  add column if not exists interested_vendors      text[],
  add column if not exists interested_vendors_url  text;

comment on column public.contract_opportunities.questions_deadline is 'Deadline for questions to the contracting officer';
comment on column public.contract_opportunities.submission_method is 'How responses are submitted, e.g. email to CO, SAM.gov, Bonfire portal';
comment on column public.contract_opportunities.submission_instructions is 'Short how-to-respond instructions from the notice';
comment on column public.contract_opportunities.interested_vendors is 'Publicly listed interested vendors / plan holders (bids themselves are sealed until opening)';
comment on column public.contract_opportunities.incumbent is 'Current contract holder, for recompetes';
