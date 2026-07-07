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
from .firecrawl_client import (
    FirecrawlClient,
    FirecrawlError,
    _portal_target_url,
    extract_listing_links,
)
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
    # Minimal fallback parser (dotenv-compatible for the common cases:
    # optional "export " prefix, quoted values, inline comments on unquoted
    # values).
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            if line.startswith("export "):
                line = line[len("export "):].lstrip()
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip()
            if len(value) >= 2 and value[0] in "\"'" and value.endswith(value[0]):
                value = value[1:-1]
            else:
                # Unquoted: strip an inline comment ("VALUE  # note").
                value = value.split(" #")[0].split("\t#")[0].strip()
            if key:
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
    # Non-fatal issues worth surfacing (e.g. a description fetch that failed and
    # forced title-only scoring). Do not flip the exit code.
    warnings: list[str] = field(default_factory=list)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _is_search_url(url: str | None) -> bool:
    """True if a URL already looks like a keyword search (has a query string).

    Used only to prioritize which portal to scrape first -- a search results
    page yields listings, a bare landing page usually does not.
    """
    if not url:
        return False
    low = url.lower()
    return any(marker in low for marker in ("?q=", "&q=", "search", "keyword", "?", "solicitation"))


# ---------------------------------------------------------------------------
# SAM pipeline
# ---------------------------------------------------------------------------
def _widen_schedule(start_days: int) -> list[int]:
    """Lookback windows to try, starting at the configured window.

    Implements the "widen up to 90 days if the narrow window is empty" rule:
    the relevance gate is never loosened, only the posted-date window grows.
    """
    start = max(1, min(start_days, config.MAX_LOOKBACK_DAYS))
    schedule = [start]
    for step in (30, 60, config.MAX_LOOKBACK_DAYS):
        if step > start:
            schedule.append(step)
    return schedule


def run_sam(*, dry_run: bool) -> RunStats:
    """Run the SAM pipeline, widening the lookback window if it finds nothing.

    A window is only widened when it produced zero relevant notices, zero
    duplicates (i.e. nothing LIMS-related exists in it at all), and no errors.
    """
    schedule = _widen_schedule(config.lookback_days())
    stats = RunStats()
    for i, days in enumerate(schedule):
        stats = _run_sam_window(dry_run=dry_run, lookback=days)
        if i > 0:
            stats.warnings.append(
                f"lookback auto-widened to {days} days (narrower windows were empty)"
            )
        if stats.relevant or stats.skipped_duplicate or stats.errors:
            break
        if i + 1 < len(schedule):
            print(f"[sam] window of {days} days found nothing LIMS-relevant; widening…")
    return stats


def _run_sam_window(*, dry_run: bool, lookback: int) -> RunStats:
    stats = RunStats()

    sam_key = config.require(config.ENV_SAM_API_KEY)
    supa = None
    if not dry_run:
        supa = SupabaseClient(
            config.require(config.ENV_SUPABASE_URL),
            config.require(config.ENV_SUPABASE_SERVICE_KEY),
        )

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

        # Dedup BEFORE the per-notice description fetch: notices already in the
        # table were inserted by a previous run and need no further API calls.
        # This both keeps SAM quota for new notices and makes the second-run
        # dedup proof visible in the summary.
        existing: set[str] = set()
        if not dry_run:
            assert supa is not None
            try:
                existing = supa.existing_notice_ids(list(raw_by_id))
            except DbError as exc:
                # Fail-safe: with an unknown existing-set we could double-insert,
                # so treat this as fatal for the run rather than guessing.
                stats.errors.append(f"dedup lookup failed, aborting inserts: {exc}")
                supa.close()
                return stats
            stats.skipped_duplicate = sorted(existing & set(raw_by_id))
            if stats.skipped_duplicate:
                print(f"[sam] {len(stats.skipped_duplicate)} notices already in DB (skipped)")

        # Score each NEW notice against its real title + fetched description.
        qualifying: list[dict] = []
        for nid, rec in raw_by_id.items():
            if nid in existing:
                continue
            try:
                opp = sam.normalize(rec, with_description=True)
            except SamApiError as exc:
                stats.errors.append(f"normalize {nid}: {exc}")
                continue

            if not opp.description and rec.get("description"):
                # The notice HAS a description we could not fetch; say so --
                # title-only scoring is stricter, never looser.
                stats.warnings.append(f"description fetch failed for {nid}; scored title-only")

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
    to_insert = qualifying
    if to_insert:
        sent_ids = [r["notice_id"] for r in to_insert]
        try:
            supa.insert_opportunities(to_insert)
            # Trust, but verify: confirm the rows are actually present rather
            # than assuming the POST landed. Only confirmed IDs are reported
            # as inserted.
            now_present = supa.existing_notice_ids(sent_ids)
            stats.inserted = [nid for nid in sent_ids if nid in now_present]
            missing = [nid for nid in sent_ids if nid not in now_present]
            if missing:
                stats.errors.append(
                    f"{len(missing)} rows sent but not found after insert: {missing}"
                )
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
def _firecrawl_notice_id(url: str) -> str:
    """Deterministic dedup key for a non-SAM listing: same URL -> same ID."""
    import hashlib

    return "FC-" + hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]


def _build_firecrawl_record(
    *, portal: dict, listing_title: str, listing_url: str, page_markdown: str, result
) -> dict:
    """Assemble a record from a real scraped detail page.

    Every populated field is taken from the page or the portal row; everything
    unknown (dates, value, POC, NAICS) stays None/empty -- never invented.
    """
    return {
        "notice_id": _firecrawl_notice_id(listing_url),
        "title": listing_title or "(untitled listing)",
        "agency": None,
        "value": None,
        "posted_date": None,
        "response_deadline": None,
        "sam_link": listing_url,
        "relevance_score": result.score,
        "summary": scoring.build_summary(title=listing_title, description=page_markdown),
        "keywords": result.keyword_tags(source_tag=config.SOURCE_TAG_FIRECRAWL),
        "naics_codes": [],
        "set_aside": None,
        "customer_fit_notes": None,
        "raw_data": {
            "source": "Firecrawl",
            "portal_name": portal.get("name"),
            "portal_url": portal.get("portal_url"),
            "listing_url": listing_url,
            "matched_primary": result.matched_primary,
            "matched_secondary": result.matched_secondary,
            "markdown_excerpt": (page_markdown or "")[:5000],
        },
        "status": config.NEW_OPPORTUNITY_STATUS,
        "notice_type": None,
        "poc_name": None,
        "poc_email": None,
        "requirements": scoring.extract_requirements(page_markdown),
    }


def run_firecrawl(*, limit: int = 1, dry_run: bool = False, listings_per_portal: int = 5) -> RunStats:
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

    # Prefer a non-SAM portal per Step 6, and among those prefer a portal whose
    # target URL is already a keyword *search* (e.g. HigherGov's ?q=LIMS) over a
    # bare landing page -- a search page is far more likely to yield extractable
    # LIMS listings. Ordering only; nothing is invented.
    non_sam = [p for p in portals if "sam.gov" not in (p.get("portal_url") or "").lower()]
    non_sam.sort(key=lambda p: (0 if _is_search_url(_portal_target_url(p)) else 1, p.get("name") or ""))
    chosen = non_sam[:limit] or portals[:limit]

    qualifying: list[dict] = []
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

            if not dry_run:
                try:
                    supa.touch_portal_last_checked(portal["id"], _now_iso())
                except DbError as exc:
                    stats.errors.append(f"touch last_checked {portal.get('name')}: {exc}")

            if scraped is None or not scraped.has_content:
                print("[firecrawl] page yielded no extractable content")
                continue

            print(f"[firecrawl] scraped {len(scraped.markdown)} chars from {scraped.url}")
            listings = extract_listing_links(
                scraped.markdown, base_url=scraped.url, limit=listings_per_portal
            )
            if not listings:
                print(
                    "[firecrawl] no LIMS-relevant listing links extractable from this "
                    "page -- consider adding a pre-built keyword search_url (see GO_LIVE.md)"
                )
                continue

            # Follow each real listing link and run the full relevance gate on
            # the detail page's actual text.
            for anchor, url in listings:
                try:
                    detail = fc.scrape(url)
                except FirecrawlError as exc:
                    stats.warnings.append(f"listing scrape failed {url}: {exc}")
                    continue
                stats.fetched += 1
                title = (detail.metadata.get("title") if isinstance(detail.metadata, dict) else "") or anchor
                if not isinstance(title, str):
                    title = anchor
                result = scoring.score_opportunity(
                    title=title, description=detail.markdown, naics_codes=[]
                )
                print(f"[score] {result.score:>3}  {url[:90]}")
                if not result.is_relevant:
                    stats.below_threshold += 1
                    continue
                stats.relevant += 1
                qualifying.append(
                    _build_firecrawl_record(
                        portal=portal,
                        listing_title=title,
                        listing_url=url,
                        page_markdown=detail.markdown,
                        result=result,
                    )
                )

    stats.unique = len(qualifying)
    if dry_run:
        print("[firecrawl] dry-run: no inserts performed")
        supa.close()
        return stats

    if qualifying:
        sent_ids = [r["notice_id"] for r in qualifying]
        try:
            already = supa.existing_notice_ids(sent_ids)
            stats.skipped_duplicate = sorted(already)
            to_insert = [r for r in qualifying if r["notice_id"] not in already]
            if to_insert:
                supa.insert_opportunities(to_insert)
                now_present = supa.existing_notice_ids([r["notice_id"] for r in to_insert])
                stats.inserted = [r["notice_id"] for r in to_insert if r["notice_id"] in now_present]
                missing = [r["notice_id"] for r in to_insert if r["notice_id"] not in now_present]
                if missing:
                    stats.errors.append(f"rows sent but not found after insert: {missing}")
        except DbError as exc:
            stats.errors.append(f"insert: {exc}")

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
    print(f"  Warnings                   : {len(stats.warnings)}")
    for w in stats.warnings:
        print(f"      ~ {w}")
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
            stats = run_firecrawl(limit=args.portal_limit, dry_run=args.dry_run)
            print_summary("FIRECRAWL" + (" (dry-run)" if args.dry_run else ""), stats)
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
