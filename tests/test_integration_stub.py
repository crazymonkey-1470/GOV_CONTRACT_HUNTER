"""OFFLINE integration harness: full pipeline against local stub endpoints.

Stands up an in-process HTTP server on 127.0.0.1 that emulates the *shapes* of
the SAM.gov Opportunities v2 API, Supabase PostgREST, and Firecrawl /v1/scrape,
then drives ``run_sam`` and ``run_firecrawl`` end-to-end over real HTTP.

This validates the wiring -- request params, headers, JSON body shapes, dedup
order, insert confirmation, and RUN SUMMARY accounting -- without any network
egress. It is explicitly NOT the live-run proof (Steps 4-6 of GO_LIVE.md);
those require the real APIs.

Run with:  python -m unittest tests.test_integration_stub -v
"""

from __future__ import annotations

import json
import os
import re
import threading
import unittest
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

TODAY = date.today()
POSTED = (TODAY - timedelta(days=3)).isoformat()

LIMS_NOTICE_ID = "test-lims-0001"
JANITOR_NOTICE_ID = "test-janitor-0002"


class _StubState:
    """Shared mutable state: rows 'inserted' into the stub PostgREST."""

    def __init__(self) -> None:
        self.opportunities: dict[str, dict] = {}
        self.patches: list[dict] = []
        self.lock = threading.Lock()


def _sam_payload(base: str) -> dict:
    return {
        "totalRecords": 2,
        "opportunitiesData": [
            {
                "noticeId": LIMS_NOTICE_ID,
                "title": "Laboratory Information Management System (LIMS) Modernization",
                "solicitationNumber": "TEST-24-R-0001",
                "fullParentPathName": "HEALTH AND HUMAN SERVICES, DEPARTMENT OF.FOOD AND DRUG ADMINISTRATION",
                "postedDate": POSTED,
                "type": "Solicitation",
                "baseType": "Solicitation",
                "naicsCode": "541512",
                "typeOfSetAsideDescription": "Total Small Business Set-Aside",
                "responseDeadLine": f"{(TODAY + timedelta(days=30)).isoformat()}T17:00:00-04:00",
                "uiLink": f"https://sam.gov/opp/{LIMS_NOTICE_ID}/view",
                "pointOfContact": [
                    {"type": "primary", "fullName": "Jane Doe", "email": "jane.doe@fda.hhs.gov"}
                ],
                "description": f"{base}/noticedesc?noticeid={LIMS_NOTICE_ID}",
                "award": None,
            },
            {
                "noticeId": JANITOR_NOTICE_ID,
                "title": "Laboratory Building Janitorial Services",
                "fullParentPathName": "GENERAL SERVICES ADMINISTRATION",
                "postedDate": POSTED,
                "type": "Solicitation",
                "naicsCode": "561720",
                "uiLink": f"https://sam.gov/opp/{JANITOR_NOTICE_ID}/view",
                "description": f"{base}/noticedesc?noticeid={JANITOR_NOTICE_ID}",
            },
        ],
    }


_DESCRIPTIONS = {
    LIMS_NOTICE_ID: (
        "<p>The FDA requires a modern <b>laboratory information management "
        "system</b> supporting specimen tracking, accessioning, and instrument "
        "integration. The contractor shall provide implementation, data "
        "migration, and 12 months of support. The system must comply with 21 "
        "CFR Part 11.</p>"
    ),
    JANITOR_NOTICE_ID: (
        "<p>Provide janitorial and custodial services for a laboratory "
        "building, including floors and restrooms. Contractor shall supply "
        "all cleaning materials.</p>"
    ),
}


def _portal_search_md(base: str) -> str:
    return (
        "# Opportunity search: LIMS\n"
        f"[LIMS Replacement RFP #2431]({base}/portal/rfp-2431)\n"
        f"[Road Paving Services RFP #9999]({base}/portal/rfp-9999)\n"
        "[About us](/about)\n"
    )


_PORTAL_DETAIL_MD = (
    "# LIMS Replacement RFP #2431\n"
    "The county public health laboratory seeks a laboratory information "
    "management system (LIMS) to replace its legacy platform. The solution "
    "must support specimen tracking, electronic reporting, and instrument "
    "interfaces. Contractor shall provide training and maintain the system "
    "for three years.\n"
)


class _Handler(BaseHTTPRequestHandler):
    state: _StubState  # set by the test
    base: str

    def log_message(self, *args):  # silence request logging
        pass

    def _json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # -- GET: SAM search, notice descriptions, PostgREST reads --------------
    def do_GET(self):
        url = urlparse(self.path)
        qs = parse_qs(url.query)

        if url.path == "/opportunities/v2/search":
            # Contract checks: title (not q), MM/DD/YYYY window, api_key.
            assert "q" not in qs, "v2 API has no q param"
            assert "title" in qs and "api_key" in qs
            assert re.match(r"\d{2}/\d{2}/\d{4}$", qs["postedFrom"][0])
            return self._json(_sam_payload(self.base))

        if url.path == "/noticedesc":
            nid = qs.get("noticeid", [""])[0]
            return self._json({"description": _DESCRIPTIONS.get(nid, "")})

        if url.path == "/rest/v1/contract_opportunities":
            # Dedup lookup: notice_id=in.("a","b")
            flt = qs.get("notice_id", [""])[0]
            ids = re.findall(r'"([^"]+)"', flt)
            with self.state.lock:
                rows = [
                    {"notice_id": n} for n in ids if n in self.state.opportunities
                ]
            return self._json(rows)

        if url.path == "/rest/v1/sourcing_portals":
            return self._json([
                {
                    "id": "portal-uuid-1",
                    "name": "Stub County Procurement",
                    "portal_url": f"{self.base}/portal/search?q=LIMS",
                    "portal_type": "county",
                    "is_active": True,
                }
            ])

        return self._json({"error": f"unexpected GET {url.path}"}, 404)

    # -- POST: PostgREST inserts, Firecrawl scrape ---------------------------
    def do_POST(self):
        url = urlparse(self.path)
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length) or b"null")

        if url.path == "/rest/v1/contract_opportunities":
            qs = parse_qs(url.query)
            assert qs.get("on_conflict") == ["notice_id"]
            prefer = self.headers.get("Prefer", "")
            assert "resolution=ignore-duplicates" in prefer
            assert self.headers.get("Authorization", "").startswith("Bearer ")
            inserted = []
            with self.state.lock:
                for row in body:
                    # Shape checks: arrays arrive as JSON lists, jsonb as object.
                    assert isinstance(row.get("keywords"), list)
                    assert isinstance(row.get("naics_codes"), list)
                    assert isinstance(row.get("raw_data"), dict)
                    assert isinstance(row.get("relevance_score"), (int, float))
                    nid = row["notice_id"]
                    if nid not in self.state.opportunities:
                        self.state.opportunities[nid] = row
                        inserted.append(row)
            return self._json(inserted, 201)

        if url.path == "/v1/scrape":
            target = body.get("url", "")
            if "/portal/search" in target:
                md = _portal_search_md(self.base)
                title = "Opportunity search: LIMS"
            elif "/portal/rfp-2431" in target:
                md = _PORTAL_DETAIL_MD
                title = "LIMS Replacement RFP #2431"
            elif "/portal/rfp-9999" in target:
                md = "# Road Paving Services\nAsphalt and paving work."
                title = "Road Paving Services RFP #9999"
            else:
                md, title = "", ""
            return self._json(
                {"success": True, "data": {"markdown": md, "metadata": {"title": title}}}
            )

        return self._json({"error": f"unexpected POST {url.path}"}, 404)

    # -- PATCH: portal last_checked ------------------------------------------
    def do_PATCH(self):
        url = urlparse(self.path)
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length) or b"null")
        if url.path == "/rest/v1/sourcing_portals":
            with self.state.lock:
                self.state.patches.append(body)
            self.send_response(204)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        return self._json({"error": f"unexpected PATCH {url.path}"}, 404)


class OfflineIntegration(unittest.TestCase):
    """Drives the real pipeline over HTTP against the local stub."""

    @classmethod
    def setUpClass(cls):
        cls.state = _StubState()
        _Handler.state = cls.state
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        port = cls.server.server_address[1]
        cls.base = f"http://127.0.0.1:{port}"
        _Handler.base = cls.base
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

        cls.env_backup = dict(os.environ)
        os.environ.update({
            "SUPABASE_URL": cls.base,
            "SUPABASE_SERVICE_KEY": "stub-service-key",
            "SAM_API_KEY": "stub-sam-key",
            "FIRECRAWL_URL": cls.base,
            "FIRECRAWL_API_KEY": "fc-stub",
            "LOOKBACK_DAYS": "14",
        })
        os.environ.pop("ANTHROPIC_API_KEY", None)  # enrichment off

        # Point the SAM client at the stub for the duration of the class.
        from scraper import config
        cls._real_sam_url = config.SAM_SEARCH_URL
        config.SAM_SEARCH_URL = f"{cls.base}/opportunities/v2/search"

    @classmethod
    def tearDownClass(cls):
        from scraper import config
        config.SAM_SEARCH_URL = cls._real_sam_url
        os.environ.clear()
        os.environ.update(cls.env_backup)
        cls.server.shutdown()
        cls.server.server_close()

    def test_1_sam_first_run_inserts_lims_only(self):
        from scraper.run import run_sam
        stats = run_sam(dry_run=False)
        self.assertEqual(stats.errors, [])
        self.assertEqual(stats.inserted, [LIMS_NOTICE_ID])
        self.assertEqual(stats.skipped_duplicate, [])
        self.assertGreaterEqual(stats.below_threshold, 1)  # janitorial rejected
        row = self.state.opportunities[LIMS_NOTICE_ID]
        self.assertEqual(row["agency"], "Health And Human Services, Department Of")
        self.assertEqual(row["naics_codes"], ["541512"])
        self.assertEqual(row["poc_email"], "jane.doe@fda.hhs.gov")
        self.assertGreaterEqual(row["relevance_score"], 65)
        self.assertIn("Source:SAM.gov", row["keywords"])
        self.assertEqual(row["status"], "new")
        self.assertNotIn(JANITOR_NOTICE_ID, self.state.opportunities)

    def test_2_sam_second_run_dedups(self):
        from scraper.run import run_sam
        stats = run_sam(dry_run=False)
        self.assertEqual(stats.errors, [])
        self.assertEqual(stats.inserted, [])
        self.assertIn(LIMS_NOTICE_ID, stats.skipped_duplicate)
        self.assertEqual(len(self.state.opportunities), 1)

    def test_3_firecrawl_inserts_gated_listing(self):
        from scraper.run import run_firecrawl
        stats = run_firecrawl(limit=1, dry_run=False)
        self.assertEqual(stats.errors, [])
        self.assertEqual(len(stats.inserted), 1)
        fc_id = stats.inserted[0]
        self.assertTrue(fc_id.startswith("FC-"))
        row = self.state.opportunities[fc_id]
        self.assertIn("rfp-2431", row["sam_link"])          # real listing URL
        self.assertIn("Source:Firecrawl", row["keywords"])
        self.assertIsNone(row["posted_date"])                # unknown -> null, never invented
        self.assertGreaterEqual(row["relevance_score"], 65)
        self.assertEqual(len(self.state.patches), 1)         # last_checked touched
        # The non-LIMS "Road Paving" link is filtered at extraction and never
        # followed: exactly one detail page was scraped and scored.
        self.assertEqual(stats.fetched, 1)

    def test_4_firecrawl_second_run_dedups(self):
        from scraper.run import run_firecrawl
        stats = run_firecrawl(limit=1, dry_run=False)
        self.assertEqual(stats.errors, [])
        self.assertEqual(stats.inserted, [])
        self.assertEqual(len(stats.skipped_duplicate), 1)

    def test_6_default_mode_runs_both_pipelines(self):
        # No flags = SAM + Firecrawl in one run, independent of each other;
        # everything is a duplicate by now so exit code is 0 with 0 inserts.
        from scraper.run import main
        rows_before = dict(self.state.opportunities)
        rc = main([])
        self.assertEqual(rc, 0)
        self.assertEqual(self.state.opportunities, rows_before)

    def test_5_dry_run_writes_nothing(self):
        from scraper.run import run_firecrawl
        before_rows = dict(self.state.opportunities)
        before_patches = len(self.state.patches)
        stats = run_firecrawl(limit=1, dry_run=True)
        self.assertEqual(stats.inserted, [])
        self.assertEqual(self.state.opportunities, before_rows)
        self.assertEqual(len(self.state.patches), before_patches)


if __name__ == "__main__":
    unittest.main()
