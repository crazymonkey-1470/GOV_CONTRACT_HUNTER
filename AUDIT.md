# ContractHunter — Full Project Audit & Session Handoff

_Written 2026-07-07 ~23:30 UTC. Purpose: bring any collaborator (human or
Claude session) fully up to speed on the LIMS scraper go-live effort: what
exists, what was verified, what broke, what was fixed, and what remains._

---

## 1. What this project is

**ContractHunter** finds U.S. government contract opportunities for
**Laboratory Information Management Systems (LIMS)** work and shows the best
ones on a dashboard. Three parts:

| Part | Tech | Where it lives | Status |
|---|---|---|---|
| Dashboard | Next.js + Supabase auth (`app/`, `lib/`, `components/`) | this repo; predates this effort | untouched |
| Database | Supabase project `dalqfausqngygwbrphyy` ("TheSmallBusiness.AI", us-east-1) | cloud | untouched (verified, no migrations added) |
| **Scraper** | Python 3.12 (`scraper/`, `tests/`) | this repo, branch `claude/contracthunter-lims-verify-bz8q1u` | **built this session; deployed on Railway** |

The scraper pulls from two sources into `contract_opportunities`:
- **SAM.gov Opportunities v2 API** (federal notices) — the primary source
- **Firecrawl** (self-hosted) scraping non-SAM portals listed in `sourcing_portals`

## 2. Ground rules in force (from the sprint brief — do not relax)

1. **Additive-only.** No changes to existing Supabase tables/migrations. A new
   column (e.g. `search_url` on `sourcing_portals`) requires explicit approval.
2. **No fabrication.** Every stored value traces to a real API response;
   unknown fields stay `null`. No simulated results presented as live runs.
3. **Never loosen the relevance gate** (score ≥ 65 to insert, matching the
   dashboard's `MIN_RELEVANCE_SCORE`). Recall may be widened (bigger date
   window, more search queries); the gate itself may not.

## 3. Database facts (verified live via Supabase MCP on 2026-07-07)

- `contract_opportunities`: 21 columns; scraper writes 19 of them (not `id`,
  `created_at`). **`notice_id` has a UNIQUE constraint**
  (`contract_opportunities_notice_id_key`) → dedup requires no migration.
  Types: `keywords`/`naics_codes`/`requirements` = `text[]`; `raw_data` =
  `jsonb`; `posted_date` = `date`; `response_deadline` = `timestamptz`;
  `relevance_score` = `numeric NOT NULL`; `status` defaults `'new'`.
- `sourcing_portals`: 37 rows (federal/state/county portals, most with
  `search_keywords` containing "LIMS"). `portal_url` UNIQUE. **No `search_url`
  column exists** — `firecrawl_client._portal_target_url` prefers it if ever
  added, else falls back to `portal_url`.
- Table row count at audit time: 48 opportunities (6 `status='sample'` demo
  rows + 42 pre-existing from earlier work). **Zero scraper-inserted rows yet**
  (see §6 — SAM quota).
- The dashboard shows rows with score ≥ 65, sorted by score desc
  (`lib/types.ts`, `lib/contracts.ts`).

## 4. Scraper architecture (`scraper/`)

| File | Role |
|---|---|
| `config.py` | Env names + `require()` with placeholder rejection (never echoes secrets); LIMS term lists (core primary / contextual primary / secondary / software-context); NAICS set; `SAM_SEARCH_QUERIES` (sent as v2 `title=` filters — **the public API has no free-text `q`**); thresholds |
| `sam_api.py` | SAM v2 client: title search w/ pagination + truncation notice, per-notice description fetch (description is a URL), normalization to real fields only, retry w/ backoff, **quota-429 (code 900804) → `SamQuotaError`, aborts run, latches `quota_exhausted`** |
| `scoring.py` | Deterministic gate. Core LIMS term in title = 65 (decisive). Desc-only primary = 40. Extra primaries +10 (cap 20). Secondary +5 (cap 20). NAICS +10. Contextual terms ("specimen tracking" etc.) count only with software context — courier RFPs can't qualify. Also `extract_requirements` / `build_summary` (pure excerpting) and `contains_primary_term` (link filtering) |
| `db.py` | PostgREST client, service-role key. `COLUMN_MAP` (verified vs live schema: zero diffs). Insert = `on_conflict=notice_id` + `Prefer: resolution=ignore-duplicates,return=representation`; returns representation, or `None` if body unusable. URL normalization: strips `/rest/v1` suffix, prepends missing `https://` |
| `firecrawl_client.py` | Firecrawl `/v1/scrape` client (URL scheme normalization); `extract_listing_links` (markdown links whose real anchor/URL carries a LIMS signal); `_portal_target_url` |
| `enrichment.py` | Optional Anthropic `customer_fit_notes` (only when `ANTHROPIC_API_KEY` set): grounded-only prompt, thinking disabled, `stop_reason` checked (truncated → discarded) |
| `run.py` | Orchestration. **Default run = BOTH pipelines** (SAM then Firecrawl, independent errors — SAM quota loss can't block portal scraping). `--sam-only` / `--firecrawl` / `--dry-run` / `--portal-limit` (or `PORTAL_LIMIT` env). SAM flow: search → **dedup against DB before description fetches** (quota-safe; failed dedup aborts inserts) → score → insert → attribute from representation (conflict rows = duplicates, never "inserted") → re-query fallback only if body unusable. Lookback auto-widens 14→30→60→90 when a window yields nothing. Firecrawl flow: pick best portal (search-style URL preferred → HigherGov first) → scrape → extract LIMS listing links → scrape each detail page → gate → insert with deterministic `FC-<sha256[:16]>` id → dedup on rerun. Ends with per-pipeline `RUN SUMMARY`; exit 1 if any errors (Railway surfaces it) |

**Tests:** 39, all passing (`python -m unittest discover -s tests`).
`test_scraper.py` = unit; `test_integration_stub.py` = end-to-end over real
HTTP against in-process stub SAM/PostgREST/Firecrawl on 127.0.0.1 (first run
inserts, second dedups, firecrawl inserts/dedups, dry-run writes nothing,
combined mode exits 0; stub asserts wire contracts).

## 5. Deployment (Railway — the decided path)

- **Scraper service**: this repo, branch `claude/contracthunter-lims-verify-bz8q1u`.
  Config: either config-as-code `railway.scraper.json` (Dockerfile build +
  cron + restart NEVER) or UI-set start command `python -m scraper.run` +
  cron `0 11 * * *` + restart Never. `Dockerfile.scraper` = python:3.12-slim,
  `PYTHONUNBUFFERED=1`.
- **Env vars** on the service: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`,
  `SAM_API_KEY`, `FIRECRAWL_URL`, `FIRECRAWL_API_KEY` (self-hosted → any
  `fc-` value), optional `ANTHROPIC_API_KEY`, `LOOKBACK_DAYS`, `PORTAL_LIMIT`.
- **Firecrawl service**: user's self-hosted Firecrawl at
  `https://firecrawlmine-production.up.railway.app` — confirmed reachable and
  scraping (returned real content 2026-07-07 23:18 UTC).
- The Claude Code sandbox **cannot** reach api.sam.gov / supabase.co / portals
  (org egress policy, CONNECT 403) — all live runs happen on Railway; the
  Claude session verifies DB state afterward via the Supabase MCP connection.

## 6. Live-run timeline (all on 2026-07-07, UTC) — errors were real, each produced a fix

| Run | Result | Root cause | Fix (commit) |
|---|---|---|---|
| build fail | Railpack "no start command" | service wasn't reading `railway.scraper.json` | user set config/start command |
| ~22:3x | `CONFIG ERROR: Missing SAM_API_KEY`, exit 2 | Railway variables not set | user added variables |
| 22:41 | 429 ×24 (6 queries × 4 retries) | **SAM daily quota already exhausted before the run**; old code retried a dead quota | `7f5d915` quota-429 aborts after 1 request |
| 22:53 | single quota error, clean abort | quota still locked (resets **2026-07-08 00:00 UTC**) | working as intended |
| 23:00 | SAM quota + `PGRST125 Invalid path` on portals | `SUPABASE_URL` variable included `/rest/v1/`; client appended it again | `2a42cef` URL suffix normalization |
| 23:04 | portals listed OK; firecrawl leg hung then exited | `FIRECRAWL_URL` had **no scheme** (bare hostname) | `e64242e` prepend `https://` |
| 23:18 | **Firecrawl end-to-end success, 0 errors**: scraped HigherGov `?q=LIMS`, got **285 chars**, honestly reported "no extractable listings" | HigherGov is JS-rendered and login-gates search results — static scrape sees a shell | diagnostic excerpt logging added; see §7 |

**SAM quota context:** the key was throttled before our first run (pre-run
usage elsewhere + old retry burn). Personal non-federal SAM keys ≈ 10
requests/day; entity-associated ≈ 1,000/day. **Recommended: associate the
SAM.gov account with the registered entity and regenerate the key.** Daily
cost of a run ≈ 6 searches + 1 description fetch per new candidate notice.

## 7. Step 6 finding + proposed `search_url` values (per sprint: proposals, user adds)

HigherGov's landing search yields no static content (285 chars). Options, in
order of leverage:

1. **Check the Firecrawl deployment has JS rendering.** Self-hosted Firecrawl
   only renders JavaScript when its Playwright service is deployed and
   `PLAYWRIGHT_MICROSERVICE_URL` is set. A single-service Railway deploy
   usually lacks it → static fetch only. Adding it may unlock many JS portals
   at once (HigherGov search results will still be login-gated, though).
2. **Candidate pre-built search URLs to verify in a browser** (confirm results
   render without login, then update the portal rows):
   - Texas ESBD keyword search: `https://www.txsmartbuy.gov/esbd?keyword=LIMS`
   - BidBanana: `https://bidbanana.thebidlab.com/search/LIMS`
   - Ohio: `https://procure.ohio.gov/proc/searchResults.asp?keyword=LIMS` (verify format)
   - Verification method: open in a private browser window; if listings are
     visible, `curl -s <url> | grep -i lims` — if grep hits, static scraping works.
3. **Update rows** via Supabase SQL editor (data change, not schema):
   `update sourcing_portals set portal_url='<verified search url>' where name='...';`
   (or approve a `search_url` column migration — the code already prefers it).

## 8. Sprint step status

| Step | Status |
|---|---|
| 0 code exists | ✅ (built from scratch; no zip existed) |
| 1 COLUMN_MAP vs live schema | ✅ zero diffs; unique index already present |
| 2 data types | ✅ |
| 3 env | ✅ (Railway variables; sandbox `.env` gitignored) |
| 4 live SAM run ≥1 insert | ⏳ **blocked only by quota clock — run after 2026-07-08 00:00 UTC** |
| 5 dedup proof | ⏳ run twice after quota reset |
| 6 firecrawl proof | ✅ **real request succeeded; page yielded nothing extractable; said so plainly; proposals in §7** |
| 7 handoff | ✅ this file + GO_LIVE.md |

## 9. Open items (owner: user)

- [ ] After 00:00 UTC: trigger run → paste `RUN SUMMARY` (Step 4), run again (Step 5)
- [ ] Entity-associate the SAM.gov account; regenerate key; update Railway var
- [ ] Verify + apply one or more §7 search URLs; optionally add Playwright to Firecrawl
- [ ] **Rotate** `SUPABASE_SERVICE_KEY` and `SAM_API_KEY` (both were pasted into chat)
- [ ] Clean up: `Test` portal row (`https://example.com`); optionally the 6 `status='sample'` rows
- [ ] Decide whether to merge `claude/contracthunter-lims-verify-bz8q1u` → main

## 10. Orientation for a fresh Claude session

- Work happens on branch `claude/contracthunter-lims-verify-bz8q1u`; commits
  `6bf1a6a..HEAD` are this effort (see `git log --oneline`).
- Run tests: `python -m unittest discover -s tests` (39 tests, no network).
- The Supabase MCP connection can read the live DB (project
  `dalqfausqngygwbrphyy`) — use it to verify inserts after Railway runs.
- The sandbox has NO egress to sam.gov/supabase/portals — don't attempt live
  runs locally; don't "fix" that by disabling the proxy.
- Respect §2 ground rules; the scoring gate and anti-fabrication rules are
  load-bearing decisions, not defaults.
- Downstream ideas discussed but NOT built: "Hermes" agent integration for
  triage (write `customer_fit_notes` / advance `status` on `status='new'`
  rows; never write opportunity rows or touch `relevance_score`), portal
  discovery agents, NAICS-sweep recall expansion (needs the 1,000/day key).
