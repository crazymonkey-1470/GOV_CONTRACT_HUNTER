# ContractHunter LIMS scraper

A small, additive Python pipeline that finds **Laboratory Information Management
System (LIMS)** government contract opportunities and writes the qualifying ones
into the existing `contract_opportunities` Supabase table.

It does **not** change any Supabase table or migration. It reads/writes the
tables the Next.js dashboard already uses.

## Modules

| File                  | Responsibility |
|-----------------------|----------------|
| `config.py`           | Env loading, LIMS term lists, NAICS set, thresholds. |
| `sam_api.py`          | Real SAM.gov Opportunities v2 client + record normalization. |
| `scoring.py`          | Deterministic LIMS relevance score (the anti-fabrication gate). |
| `db.py`               | Supabase PostgREST writes. `COLUMN_MAP` = internal key → DB column. |
| `firecrawl_client.py` | Self-hosted Firecrawl scrape client + `_portal_target_url`. |
| `enrichment.py`       | Optional Anthropic phrasing of real notice text (grounded). |
| `run.py`              | Orchestration + `RUN SUMMARY`. |

## Anti-fabrication rules (do not relax)

1. Every stored value comes from a real API response; missing fields stay `null`.
2. `relevance_score` is computed only from LIMS terms actually present in the
   SAM-provided title/description (+ real NAICS). Same input → same score.
   A core LIMS term in the title is decisive (65); "specimen/sample tracking"
   style terms only count when the text shows software/system context, so
   courier-logistics RFPs cannot qualify.
3. Only opportunities scoring `>= MIN_RELEVANCE_SCORE` (65, matching the
   dashboard) are inserted.
4. LLM enrichment (optional) may only rephrase supplied text; it adds no facts,
   and truncated responses are discarded rather than stored.

## Pipeline behavior

- **SAM**: keyword searches go through the v2 `title` parameter (the public API
  has no free-text `q`). Dedup against the DB happens **before** the per-notice
  description fetch, so quota is never spent re-fetching known notices. If a
  lookback window finds nothing LIMS-relevant, it auto-widens (14 → 30 → 60 →
  90 days) within the same run — but only while the declared `SAM_DAILY_QUOTA`
  has budget left; a spent quota skips the widening (with a warning) instead
  of burning guaranteed 429s. Inserts are confirmed by re-query — the RUN
  SUMMARY only reports IDs verified present.
- **Firecrawl**: scrapes the portal's target page (preferring pre-built keyword
  search URLs), extracts listing links whose real anchor text/URL carries a
  LIMS signal, follows each one (a second real scrape), runs the full relevance
  gate on the detail page text, and inserts qualifying listings with a
  deterministic `FC-<hash>` notice_id (same URL → same ID → dedup works).
  Unknown fields (dates, value, POC) stay `null` — never invented.

## Usage

```bash
pip install -r requirements.txt
cp .env.example .env        # then fill in real keys

python -m scraper.run            # SAM.gov pipeline (default)
python -m scraper.run --dry-run  # fetch + score, no inserts
python -m scraper.run --firecrawl --portal-limit 1   # non-SAM portal pipeline
```

Deduplication is on `notice_id` (already a UNIQUE column). A second immediate
run inserts 0 rows and reports the prior IDs as `Skipped (duplicate)`.

## Environment variables

See `.env.example`. Required for a live SAM run: `SUPABASE_URL`,
`SUPABASE_SERVICE_KEY`, `SAM_API_KEY`. Required for the Firecrawl pipeline:
`FIRECRAWL_URL` (+ `FIRECRAWL_API_KEY` if your server requires it).
`ANTHROPIC_API_KEY` is optional.
