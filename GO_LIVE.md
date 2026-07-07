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

## DECISION: everything runs on Railway

The sandbox network stays closed; Railway is the execution environment for
Steps 4–6 and for the daily cron. Your first manual Railway run **is** the
Step 4 live proof; re-triggering it immediately gives the Step 5 dedup proof;
one `--firecrawl` run gives the Step 6 proof. Paste the logs back into the
session and the assistant will verify the inserted rows against Supabase
(read access via MCP) and close out the sprint.

## Railway runbook (owner: you)

### A. Deploy Firecrawl first (its own service)

1. In your Railway project, deploy your self-hosted Firecrawl repo (it ships a
   `RAILWAY.md`). Minimum env: `PORT=3002`, `HOST=0.0.0.0`,
   `USE_DB_AUTHENTICATION=false`, `BULL_AUTH_KEY=<anything>`.
2. Note its URL for the scraper:
   - Same Railway project (recommended): use **private networking** —
     `http://<firecrawl-service-name>.railway.internal:3002` (not exposed to
     the internet, no egress fees).
   - Different project / public: generate a public domain and use
     `https://<firecrawl-domain>`.

### B. Create the scraper service (this repo)

1. New service → Deploy from GitHub repo → `crazymonkey-1470/GOV_CONTRACT_HUNTER`,
   branch `claude/contracthunter-lims-verify-bz8q1u` (or merge it to main first
   and use main).
2. Service → Settings → **Config-as-code file: `railway.scraper.json`** — this
   wires up the `Dockerfile.scraper` build, cron `0 11 * * *` (11:00 UTC daily),
   and restart policy NEVER (required for cron: the container runs once and exits).
3. Service → Variables:

   | Variable | Value |
   |---|---|
   | `SUPABASE_URL` | `https://dalqfausqngygwbrphyy.supabase.co` (base URL, **no** `/rest/v1/`) |
   | `SUPABASE_SERVICE_KEY` | service_role key (rotate the one pasted in chat first — see D) |
   | `SAM_API_KEY` | your SAM.gov key |
   | `FIRECRAWL_URL` | from step A.2 |
   | `FIRECRAWL_API_KEY` | `fc-self-hosted` |
   | `ANTHROPIC_API_KEY` | optional — blank disables fit-note enrichment |
   | `LOOKBACK_DAYS` | optional, default 14 (auto-widens to 90 if a window is empty) |

4. Confirm the service's cron shows `0 11 * * *`.

### C. Run the live proofs (Steps 4–6)

1. **Step 4:** trigger one manual deploy/run. Logs must end with a
   `RUN SUMMARY (SAM.gov)` showing `Inserted (new) >= 1` with real notice IDs
   and `Errors: 0`. Exit code 0.
2. **Step 5:** trigger a second run immediately. `Inserted (new): 0` and the
   same notice IDs listed under `Skipped (duplicate)`.
3. **Step 6:** run the firecrawl mode once — either temporarily set the
   service's Custom Start Command to
   `python -m scraper.run --firecrawl --portal-limit 1` and trigger a run
   (then clear it), or run it from any machine with the same env. The summary
   reports either inserted `FC-` rows or, plainly, that nothing was extractable
   (then add `search_url` values — see below).
4. Paste all three RUN SUMMARY blocks back into the Claude session for
   independent verification against the database.

### D. After go-live

- [ ] **Rotate** the Supabase service_role key (Supabase → Project Settings →
  API → regenerate) and the SAM key (sam.gov → Account Details) — both were
  pasted into a chat session. Update the Railway variables with the new values.
- [ ] Delete the `Test` portal row (`https://example.com`) from
  `sourcing_portals` if it wasn't intentional.
- [ ] Optionally remove the six `status='sample'` demo rows:
  `delete from contract_opportunities where status = 'sample';`

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
