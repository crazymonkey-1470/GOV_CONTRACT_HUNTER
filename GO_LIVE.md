# ContractHunter LIMS scraper — go-live status & handoff

_Last updated: 2026-07-07 (session: scraper build + live-schema verification)._

## Verified so far (real, not simulated)

| Step | Status | Evidence |
|---|---|---|
| 0. Scraper code exists | ✅ | `scraper/` built in this repo (run.py, sam_api.py, firecrawl_client.py, scoring.py, db.py, config.py, enrichment.py) |
| 1. COLUMN_MAP vs live schema | ✅ | Live schema of `contract_opportunities` + `sourcing_portals` pulled from Supabase project `dalqfausqngygwbrphyy`; all 19 mapped columns match by name; `notice_id` UNIQUE constraint already present (`contract_opportunities_notice_id_key`) — no migration needed |
| 2. Data types | ✅ | `keywords`/`naics_codes`/`requirements` = `text[]`; `raw_data` = `jsonb`; `posted_date` = `date`; `response_deadline` = `timestamptz`; `relevance_score` = `numeric` — serialization in `db.py` matches |
| 3. .env | ✅ | Created locally (gitignored) with SUPABASE_URL, SUPABASE_SERVICE_KEY, SAM_API_KEY, FIRECRAWL_URL, FIRECRAWL_API_KEY |
| 4. Live SAM run (≥1 real insert) | ⛔ blocked | Sandbox egress policy denies `api.sam.gov` and `*.supabase.co` (CONNECT 403 from gateway) — see "Unblocking" below |
| 5. Dedup proof (2nd run, 0 inserts) | ⛔ blocked | Same egress block |
| 6. Firecrawl proof (non-SAM portal) | ⛔ blocked | Same egress block + no Docker daemon in sandbox to self-host Firecrawl |

Additional hardening completed while blocked (not a substitute for Steps 4–6):

- **Adversarial multi-agent code review** of the scraper; every confirmed
  finding fixed (SAM v2 `title` vs `q` param, dedup-before-description-fetch,
  auto-widening lookback, Firecrawl listing-follow + inserts, `--dry-run` in
  firecrawl mode, scoring calibration, secret-safe error messages).
- **31 offline tests**, including a 5-test end-to-end integration harness
  (`tests/test_integration_stub.py`) that drives the real pipeline over HTTP
  against local stub SAM/PostgREST/Firecrawl endpoints: first run inserts the
  LIMS notice and rejects a janitorial decoy; second run inserts 0 and reports
  the duplicate; Firecrawl follows only LIMS listing links, inserts a gated
  `FC-` row, dedups on rerun; dry-run writes nothing. The stub asserts contract
  details (`title` param, MM/DD/YYYY window, `on_conflict=notice_id`,
  `Prefer: resolution=ignore-duplicates`, arrays as JSON lists, jsonb objects).

## Unblocking Steps 4–6 (either path works)

**Path A — open this sandbox's network** (then the assistant runs Steps 4–6 and pastes RUN SUMMARYs):
in the Claude Code environment settings, allow these domains (or allow all):
`api.sam.gov`, `dalqfausqngygwbrphyy.supabase.co`, `www.highergov.com`, plus your Firecrawl host.

**Path B — run on Railway** (see checklist below): the scraper runs where no egress policy applies.

## YOUR open items (Step 7 — not done, owner: you)

- [ ] **Railway: create the scraper service** from this repo.
  - Service → Settings → Config-as-code file: `railway.scraper.json` (builds `Dockerfile.scraper`, sets cron + no-restart).
- [ ] **Railway: set env vars** on the service: `SUPABASE_URL` (base URL, no `/rest/v1/`), `SUPABASE_SERVICE_KEY`, `SAM_API_KEY`, `FIRECRAWL_URL`, `FIRECRAWL_API_KEY`, optional `ANTHROPIC_API_KEY`, optional `LOOKBACK_DAYS` (default 14, max 90).
- [ ] **Railway: confirm cron** shows `0 11 * * *` (11:00 UTC daily) on the service.
- [ ] **Railway: one manual run** ("Deploy" / "Run now") and check the logs end with a `RUN SUMMARY` showing ≥1 insert (first run) — Steps 4–5 can be verified there if Path A stays closed.
- [ ] **Firecrawl**: deploy your self-hosted Firecrawl (its repo has `RAILWAY.md`) and point `FIRECRAWL_URL` at its public URL; `FIRECRAWL_API_KEY=fc-self-hosted` (self-hosted skips key validation with `USE_DB_AUTHENTICATION=false`).
- [ ] Consider **rotating** the service-role key and SAM key that were pasted into chat, once live.

## Step 6 prep — proposed `search_url` values (unverified until a real scrape runs)

The live `sourcing_portals` rows are mostly bare landing pages. One already-good row:
**HigherGov** — `https://www.highergov.com/opportunity/?q=LIMS` (a pre-built LIMS search; the
scraper now prefers search-style URLs automatically).

If the Step 6 scrape of a landing page yields nothing extractable, add pre-built LIMS keyword
searches to portal rows (either replace `portal_url` or add a `search_url` column value —
`_portal_target_url` already prefers `search_url` when present; adding that column would be a
migration and needs approval first). Candidate values to verify in a browser before adding:

1. SAM.gov UI search: `https://sam.gov/search/?index=opp&keywords=laboratory%20information%20management%20system`
2. CAL eProcure event search (California): search "LIMS" at `https://caleprocure.ca.gov/pages/events-search.aspx` and copy the resulting URL
3. TXSmartBuy ESBD (Texas): search "laboratory information management" at `https://www.txsmartbuy.gov/esbd` and copy the resulting URL

## Post-run verification SQL (run in Supabase SQL editor after Step 4)

```sql
-- New rows inserted by the scraper (real SAM notices, not samples)
select notice_id, title, agency, relevance_score, posted_date, status, created_at
from contract_opportunities
where status = 'new' and raw_data->>'source' = 'SAM.gov'
order by created_at desc;
```

A second immediate run must insert 0 rows and list the same notice_ids as
`Skipped (duplicate)` in its RUN SUMMARY.
