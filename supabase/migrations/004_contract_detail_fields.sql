-- ============================================================================
-- ContractHunter — extra fields for the redesigned dashboard's detail drawer.
--
-- All nullable; the discovery agent populates them. The UI hides any field that
-- is null, so these are purely additive and safe to apply at any time.
-- ============================================================================

alter table public.contract_opportunities
  add column if not exists notice_type  text,        -- e.g. "Solicitation", "Sources Sought"
  add column if not exists poc_name     text,        -- contracting officer name
  add column if not exists poc_email    text,        -- contracting officer email
  add column if not exists requirements text[];      -- short bullet list of key requirements
