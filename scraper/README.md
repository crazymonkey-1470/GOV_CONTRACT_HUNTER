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
3. Only opportunities scoring `>= MIN_RELEVANCE_SCORE` (65, matching the
   dashboard) are inserted.
4. LLM enrichment (optional) may only rephrase supplied text; it adds no facts.

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
