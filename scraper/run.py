"""Entry point for the ContractHunter LIMS scraper.

Usage:
    python -m scraper.run              # SAM.gov pipeline (default)
    python -m scraper.run --firecrawl  # non-SAM sourcing-portal pipeline
    python -m scraper.run --dry-run    # fetch + score, but do not insert

Every run ends with a RUN SUMMARY block. All API calls are real; any failure is
reported as an error and the process exits non-zero.
"""

from __future__ import annotations

import argparse
import os
import sys
import traceback
from dataclasses import dataclass, field
from datetime import datetime, timezone

from . import config, enrichment, scoring
from .db import DbError, SupabaseClient
from .firecrawl_client import FirecrawlClient, FirecrawlError, _portal_target_url
from .sam_api import SamApiError, SamClient, default_window


# ---------------------------------------------------------------------------
# .env loading (best-effort; python-dotenv if present, else a tiny parser)
# ---------------------------------------------------------------------------
def _load_dotenv() -> None:
    path = os.path.join(os.getcwd(), ".env")
    if not os.path.exists(path):
        return
    try:
        from dotenv import load_dotenv

        load_dotenv(path, override=False)
        return
    except ImportError:
        pass
    # Minimal fallback parser.
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            os.environ.setdefault(key, value)


@dataclass
class RunStats:
    fetched: int = 0
    unique: int = 0
    relevant: int = 0
    inserted: list[str] = field(default_factory=list)
    skipped_duplicate: list[str] = field(default_factory=list)
    below_threshold: int = 0
    errors: list[str] = field(default_factory=list)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# SAM pipeline
# ---------------------------------------------------------------------------
def run_sam(*, dry_run: bool) -> RunStats:
    stats = RunStats()

    sam_key = config.require(config.ENV_SAM_API_KEY)
    supa = None
    if not dry_run:
        supa = SupabaseClient(
            config.require(config.ENV_SUPABASE_URL),
            config.require(config.ENV_SUPABASE_SERVICE_KEY),
        )

    lookback = config.lookback_days()
    lookback = min(lookback, config.MAX_LOOKBACK_DAYS)

    use_llm = enrichment.is_available()
    print(f"[sam] lookback window: {lookback} days   LLM enrichment: {'on' if use_llm else 'off'}")

    raw_by_id: dict[str, dict] = {}
    with SamClient(sam_key) as sam:
        posted_from, posted_to = default_window(lookback)
        print(f"[sam] searching {posted_from} .. {posted_to}")
        for query in config.SAM_SEARCH_QUERIES:
            try:
                batch = sam.search(query=query, posted_from=posted_from, posted_to=posted_to)
            except SamApiError as exc:
                stats.errors.append(f"SAM search '{query}': {exc}")
                print(f"[sam] ERROR query '{query}': {exc}")
                continue
            stats.fetched += len(batch)
            for rec in batch:
                nid = rec.get("noticeId") or rec.get("id")
                if nid:
                    raw_by_id.setdefault(str(nid), rec)
            print(f"[sam]   '{query}': {len(batch)} records")

        stats.unique = len(raw_by_id)
        print(f"[sam] {stats.fetched} records fetched, {stats.unique} unique notices")

        # Score every unique notice against its real title + description.
        qualifying: list[dict] = []
        for nid, rec in raw_by_id.items():
            try:
                opp = sam.normalize(rec, with_description=True)
            except SamApiError as exc:
                stats.errors.append(f"normalize {nid}: {exc}")
                continue

            result = scoring.score_opportunity(
                title=opp.title,
                description=opp.description,
                naics_codes=opp.naics_codes,
            )
            if not result.is_relevant:
                stats.below_threshold += 1
                continue

            stats.relevant += 1
            record = _build_record(opp, result, use_llm=use_llm)
            qualifying.append(record)
            print(
                f"[score] {result.score:>3}  {opp.notice_id}  {opp.title[:70]}"
            )

    if dry_run:
        print("[sam] dry-run: no inserts performed")
        return stats

    assert supa is not None
    # Dedup: which notice_ids already exist?
    ids = [r["notice_id"] for r in qualifying]
    try:
        existing = supa.existing_notice_ids(ids)
    except DbError as exc:
        stats.errors.append(f"dedup lookup: {exc}")
        existing = set()

    to_insert = [r for r in qualifying if r["notice_id"] not in existing]
    stats.skipped_duplicate = [r["notice_id"] for r in qualifying if r["notice_id"] in existing]

    if to_insert:
        try:
            inserted = supa.insert_opportunities(to_insert)
            stats.inserted = [r.get("notice_id") for r in inserted if r.get("notice_id")]
            # If PostgREST didn't echo rows, fall back to what we sent.
            if not stats.inserted:
                stats.inserted = [r["notice_id"] for r in to_insert]
        except DbError as exc:
            stats.errors.append(f"insert: {exc}")
    supa.close()
    return stats


def _build_record(opp, result, *, use_llm: bool) -> dict:
    """Assemble an internal record dict from a scored SAM opportunity."""
    naics = list(opp.naics_codes)
    keywords = result.keyword_tags()
    summary = scoring.build_summary(title=opp.title, description=opp.description)
    requirements = scoring.extract_requirements(opp.description)

    fit_notes = None
    if use_llm:
        fit_notes = enrichment.customer_fit_notes(title=opp.title, description=opp.description)

    return {
        "notice_id": opp.notice_id,
        "title": opp.title or "(untitled)",
        "agency": opp.agency,
        "value": opp.value,
        "posted_date": opp.posted_date,
        "response_deadline": opp.response_deadline,
        "sam_link": opp.sam_link,
        "relevance_score": result.score,
        "summary": summary,
        "keywords": keywords,
        "naics_codes": naics,
        "set_aside": opp.set_aside,
        "customer_fit_notes": fit_notes,
        "raw_data": {
            "source": "SAM.gov",
            "notice_type": opp.notice_type,
            "matched_primary": result.matched_primary,
            "matched_secondary": result.matched_secondary,
            "matched_naics": result.matched_naics,
            "sam": opp.raw,
        },
        "status": config.NEW_OPPORTUNITY_STATUS,
        "notice_type": opp.notice_type,
        "poc_name": opp.poc_name,
        "poc_email": opp.poc_email,
        "requirements": requirements,
    }


# ---------------------------------------------------------------------------
# Firecrawl (non-SAM portal) pipeline
# ---------------------------------------------------------------------------
def run_firecrawl(*, limit: int = 1) -> RunStats:
    stats = RunStats()

    supa = SupabaseClient(
        config.require(config.ENV_SUPABASE_URL),
        config.require(config.ENV_SUPABASE_SERVICE_KEY),
    )
    fc = FirecrawlClient(
        config.require(config.ENV_FIRECRAWL_URL),
        config.get(config.ENV_FIRECRAWL_API_KEY),
    )

    try:
        portals = supa.list_active_portals()
    except DbError as exc:
        stats.errors.append(f"list portals: {exc}")
        supa.close()
        fc.close()
        return stats

    # Prefer a non-SAM portal per Step 6.
    non_sam = [p for p in portals if "sam.gov" not in (p.get("portal_url") or "").lower()]
    chosen = non_sam[:limit] or portals[:limit]

    with fc:
        for portal in chosen:
            target = _portal_target_url(portal)
            print(f"[firecrawl] portal '{portal.get('name')}' -> {target}")
            try:
                scraped = fc.scrape_portal(portal)
            except FirecrawlError as exc:
                stats.errors.append(f"firecrawl {portal.get('name')}: {exc}")
                print(f"[firecrawl] ERROR: {exc}")
                continue

            try:
                supa.touch_portal_last_checked(portal["id"], _now_iso())
            except DbError as exc:
                stats.errors.append(f"touch last_checked {portal.get('name')}: {exc}")

            if scraped is None or not scraped.has_content:
                print("[firecrawl] landing page yielded no extractable content")
                stats.below_threshold += 1
                continue

            stats.fetched += 1
            result = scoring.score_opportunity(
                title=scraped.metadata.get("title", "") or portal.get("name", ""),
                description=scraped.markdown,
                naics_codes=[],
            )
            print(
                f"[firecrawl] scraped {len(scraped.markdown)} chars, "
                f"LIMS relevance score {result.score}"
            )
            if result.is_relevant:
                stats.relevant += 1
            else:
                stats.below_threshold += 1
                print(
                    "[firecrawl] page has no LIMS-relevant listings extractable from "
                    "the landing page (see summary for suggested search URLs)"
                )

    supa.close()
    return stats


# ---------------------------------------------------------------------------
# RUN SUMMARY
# ---------------------------------------------------------------------------
def print_summary(mode: str, stats: RunStats) -> None:
    line = "=" * 60
    print(f"\n{line}\nRUN SUMMARY  ({mode})   {_now_iso()}\n{line}")
    print(f"  Records fetched (raw)      : {stats.fetched}")
    print(f"  Unique notices             : {stats.unique}")
    print(f"  LIMS-relevant (>= {config.MIN_RELEVANCE_SCORE})       : {stats.relevant}")
    print(f"  Below relevance threshold  : {stats.below_threshold}")
    print(f"  Inserted (new)             : {len(stats.inserted)}")
    for nid in stats.inserted:
        print(f"      + {nid}")
    print(f"  Skipped (duplicate)        : {len(stats.skipped_duplicate)}")
    for nid in stats.skipped_duplicate:
        print(f"      = {nid}  (already present)")
    print(f"  Errors                     : {len(stats.errors)}")
    for err in stats.errors:
        print(f"      ! {err}")
    print(line)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="ContractHunter LIMS scraper")
    parser.add_argument("--firecrawl", action="store_true", help="run the non-SAM portal pipeline")
    parser.add_argument("--dry-run", action="store_true", help="fetch + score but do not insert")
    parser.add_argument("--portal-limit", type=int, default=1, help="portals to scrape (firecrawl mode)")
    args = parser.parse_args(argv)

    _load_dotenv()

    try:
        if args.firecrawl:
            stats = run_firecrawl(limit=args.portal_limit)
            print_summary("FIRECRAWL", stats)
        else:
            stats = run_sam(dry_run=args.dry_run)
            print_summary("SAM.gov" + (" (dry-run)" if args.dry_run else ""), stats)
    except config.ConfigError as exc:
        print(f"\nCONFIG ERROR: {exc}", file=sys.stderr)
        return 2
    except Exception as exc:  # real error -> report and exit non-zero
        print(f"\nFATAL: {exc}", file=sys.stderr)
        traceback.print_exc()
        return 1

    # Non-zero exit if anything errored, so cron/Railway surfaces failures.
    if stats.errors:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
