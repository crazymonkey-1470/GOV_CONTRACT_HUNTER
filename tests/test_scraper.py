"""Offline tests for the ContractHunter LIMS scraper.

Run with:  python -m unittest discover -s tests -v

These exercise the pure logic only (no network): the relevance gate, COLUMN_MAP
serialization, portal URL selection, and SAM record normalization. Live-run
verification (Steps 4-6 of the go-live checklist) is separate and real.
"""

from __future__ import annotations

import unittest

from scraper import config, db, scoring
from scraper.firecrawl_client import _portal_target_url
from scraper.sam_api import SamClient, _normalize_date, _strip_html


class ScoringGate(unittest.TestCase):
    def test_genuine_lims_notice_qualifies(self):
        r = scoring.score_opportunity(
            title="Laboratory Information Management System (LIMS) Modernization",
            description="The agency requires a LIMS to support specimen tracking "
                        "and clinical laboratory accessioning.",
            naics_codes=["541512"],
        )
        self.assertGreaterEqual(r.score, config.MIN_RELEVANCE_SCORE)
        self.assertTrue(r.is_relevant)
        self.assertIn("lims", r.matched_primary)

    def test_non_lims_laboratory_mention_rejected(self):
        r = scoring.score_opportunity(
            title="Janitorial Services for Laboratory Building",
            description="Provide cleaning and custodial services for a laboratory "
                        "building. Must maintain floors and restrooms.",
            naics_codes=["561720"],
        )
        self.assertLess(r.score, config.MIN_RELEVANCE_SCORE)
        self.assertFalse(r.is_relevant)

    def test_secondary_terms_alone_cannot_qualify(self):
        # Every secondary term present, zero primary terms: must stay below gate.
        r = scoring.score_opportunity(
            title="Laboratory specimen assay pathology informatics biobank",
            description="clinical laboratory diagnostic reagent accessioning "
                        "chain of custody test results management",
            naics_codes=["541512", "621511"],
        )
        self.assertFalse(r.is_relevant, f"secondary-only text scored {r.score}")

    def test_deterministic(self):
        kwargs = dict(title="LIMS", description="LIMS upgrade", naics_codes=[])
        self.assertEqual(
            scoring.score_opportunity(**kwargs).score,
            scoring.score_opportunity(**kwargs).score,
        )

    def test_unambiguous_lims_title_qualifies_alone(self):
        # A notice titled with a core LIMS term must clear the gate even when
        # the description fetch failed and NAICS doesn't match (recall fix).
        r = scoring.score_opportunity(
            title="Laboratory Information Management System Replacement",
            description="",
            naics_codes=["518210"],
        )
        self.assertTrue(r.is_relevant, f"scored {r.score}")

    def test_specimen_courier_logistics_rejected(self):
        # Contextual primary terms need software context: a physical courier
        # RFP mentioning specimen tracking must not qualify (precision fix).
        r = scoring.score_opportunity(
            title="Specimen Tracking and Courier Services",
            description="Contractor shall provide daily specimen pickup, transport "
                        "to the reference laboratory, and chain of custody logs.",
            naics_codes=["492110"],
        )
        self.assertFalse(r.is_relevant, f"scored {r.score}")

    def test_specimen_system_with_software_context_qualifies(self):
        r = scoring.score_opportunity(
            title="Specimen Tracking System Modernization",
            description="Replace the legacy specimen tracking software platform "
                        "used by the clinical laboratory.",
            naics_codes=["541512"],
        )
        self.assertTrue(r.is_relevant, f"scored {r.score}")

    def test_lims_word_boundary(self):
        # 'slims'/'limsomething' must not fire the 'lims' pattern.
        r = scoring.score_opportunity(
            title="Slims down operations", description="prelims and slims", naics_codes=[]
        )
        self.assertNotIn("lims", r.matched_primary)


class ExcerptingIsGrounded(unittest.TestCase):
    def test_requirements_are_excerpts_of_source(self):
        desc = ("Contractor shall provide 24/7 support. The system must comply "
                "with CLIA. Unrelated marketing sentence here today.")
        reqs = scoring.extract_requirements(desc)
        for r in reqs:
            self.assertIn(r.rstrip("."), desc)

    def test_empty_description_yields_no_summary(self):
        self.assertIsNone(scoring.build_summary(title="t", description=""))
        self.assertEqual(scoring.extract_requirements(""), [])


class ColumnMapContract(unittest.TestCase):
    LIVE_COLUMNS = {
        "notice_id", "title", "agency", "value", "posted_date",
        "response_deadline", "sam_link", "relevance_score", "summary",
        "keywords", "naics_codes", "set_aside", "customer_fit_notes",
        "raw_data", "status", "notice_type", "poc_name", "poc_email",
        "requirements",
    }

    def test_column_map_matches_live_schema(self):
        # Verified against the live contract_opportunities schema on 2026-07-07.
        self.assertEqual(set(db.COLUMN_MAP.keys()), self.LIVE_COLUMNS)
        self.assertEqual(set(db.COLUMN_MAP.values()), self.LIVE_COLUMNS)

    def test_to_db_row_serialization(self):
        row = db.to_db_row({
            "notice_id": "N1", "keywords": ["a"], "naics_codes": None,
            "raw_data": {"x": 1}, "relevance_score": 72, "bogus": "dropped",
        })
        self.assertEqual(row["naics_codes"], [])       # None array -> []
        self.assertIsInstance(row["keywords"], list)   # text[] as JSON array
        self.assertIsInstance(row["raw_data"], dict)   # jsonb as JSON object
        self.assertNotIn("bogus", row)                 # unknown keys dropped


class PortalRotation(unittest.TestCase):
    def test_never_checked_first_then_oldest(self):
        from scraper.run import _is_search_url
        from scraper.firecrawl_client import _portal_target_url
        portals = [
            {"name": "Checked yesterday", "portal_url": "https://a.gov", "last_checked": "2026-07-07T11:00:00Z"},
            {"name": "Never checked", "portal_url": "https://b.gov", "last_checked": None},
            {"name": "Checked last week", "portal_url": "https://c.gov", "last_checked": "2026-07-01T11:00:00Z"},
            {"name": "Also never, search URL", "portal_url": "https://d.gov/search?q=LIMS", "last_checked": None},
        ]
        portals.sort(
            key=lambda p: (
                0 if not p.get("last_checked") else 1,
                p.get("last_checked") or "",
                0 if _is_search_url(_portal_target_url(p)) else 1,
                p.get("name") or "",
            )
        )
        names = [p["name"] for p in portals]
        # Never-checked first (search-style URL breaking the tie), then oldest.
        self.assertEqual(
            names,
            ["Also never, search URL", "Never checked", "Checked last week", "Checked yesterday"],
        )


class PortalUrlSelection(unittest.TestCase):
    def test_prefers_search_url_then_portal_url(self):
        self.assertEqual(_portal_target_url({"portal_url": "https://p.gov"}), "https://p.gov")
        self.assertEqual(
            _portal_target_url({"portal_url": "https://p.gov", "search_url": "https://p.gov/q?LIMS"}),
            "https://p.gov/q?LIMS",
        )
        self.assertIsNone(_portal_target_url({}))


class SamNormalization(unittest.TestCase):
    def test_normalize_real_shape(self):
        sam = SamClient.__new__(SamClient)  # no HTTP
        sam.api_key = "x"
        opp = SamClient.normalize(sam, {
            "noticeId": "abc123",
            "title": "LIMS Upgrade",
            "fullParentPathName": "DEPT OF HEALTH.FDA",
            "type": "Solicitation",
            "postedDate": "2026-06-30",
            "responseDeadLine": "2026-07-30T17:00:00-04:00",
            "uiLink": "https://sam.gov/opp/abc123/view",
            "naicsCode": "541512",
            "pointOfContact": [{"type": "primary", "fullName": "Jane Doe", "email": "j@fda.gov"}],
            "typeOfSetAsideDescription": "Small Business",
        }, with_description=False)
        self.assertEqual(opp.notice_id, "abc123")
        self.assertEqual(opp.agency, "Dept Of Health")
        self.assertEqual(opp.naics_codes, ["541512"])
        self.assertEqual(opp.poc_email, "j@fda.gov")
        self.assertEqual(opp.posted_date, "2026-06-30")

    def test_missing_notice_id_raises(self):
        from scraper.sam_api import SamApiError
        sam = SamClient.__new__(SamClient)
        sam.api_key = "x"
        with self.assertRaises(SamApiError):
            SamClient.normalize(sam, {"title": "no id"}, with_description=False)

    def test_helpers(self):
        self.assertEqual(_normalize_date("2026-06-30-04:00"), "2026-06-30")
        self.assertIsNone(_normalize_date(None))
        self.assertEqual(_strip_html("<p>Need a <b>LIMS</b></p>"), "Need a LIMS")


class SearchParamContract(unittest.TestCase):
    def test_uses_title_not_q(self):
        # The public Opportunities v2 API has no free-text `q` parameter.
        from datetime import date
        params = SamClient._search_params("LIMS", date(2026, 6, 1), date(2026, 7, 1), 100, 0)
        self.assertNotIn("q", params)
        self.assertEqual(params["title"], "LIMS")
        self.assertEqual(params["postedFrom"], "06/01/2026")
        self.assertEqual(params["postedTo"], "07/01/2026")

    def test_naics_and_psc_sweep_fields(self):
        from datetime import date
        p = SamClient._search_params("541512", date(2026, 6, 1), date(2026, 7, 1), 100, 0, field="ncode")
        self.assertEqual(p["ncode"], "541512")
        self.assertNotIn("title", p)
        p = SamClient._search_params("DA01", date(2026, 6, 1), date(2026, 7, 1), 100, 0, field="ccode")
        self.assertEqual(p["ccode"], "DA01")
        from scraper.sam_api import SamApiError
        with self.assertRaises(SamApiError):
            SamClient._search_params("x", date(2026, 6, 1), date(2026, 7, 1), 100, 0, field="bogus")

    def test_sweep_list_env_override(self):
        import os
        self.assertEqual(config.sweep_list("_CH_NO_SUCH", ("a", "b")), ("a", "b"))
        os.environ["_CH_SWEEP"] = "541512, 541511"
        try:
            self.assertEqual(config.sweep_list("_CH_SWEEP", ("x",)), ("541512", "541511"))
            os.environ["_CH_SWEEP"] = "off"
            self.assertEqual(config.sweep_list("_CH_SWEEP", ("x",)), ())
        finally:
            del os.environ["_CH_SWEEP"]

    def test_psc_match_boosts_score(self):
        base = dict(title="Business application support for the clinical laboratory",
                    description="Support the lab's LIMS interfaces.", naics_codes=[])
        without = scoring.score_opportunity(**base)
        with_psc = scoring.score_opportunity(**base, psc_code="DA01")
        self.assertEqual(with_psc.score, without.score + 10)


class LookbackWidening(unittest.TestCase):
    def test_schedule_widens_to_90(self):
        from scraper.run import _widen_schedule
        self.assertEqual(_widen_schedule(14), [14, 30, 60, 90])
        self.assertEqual(_widen_schedule(45), [45, 60, 90])
        self.assertEqual(_widen_schedule(90), [90])
        self.assertEqual(_widen_schedule(200), [90])  # capped at MAX_LOOKBACK_DAYS


class FirecrawlListingExtraction(unittest.TestCase):
    MD = (
        "# Results\n"
        "[LIMS Replacement RFP #2431](https://portal.gov/rfp/2431)\n"
        "[Laboratory Information Management System Upgrade](/opps/lims-upgrade)\n"
        "[Road Paving Services](https://portal.gov/rfp/9999)\n"
        "[Careers](https://portal.gov/careers)\n"
        "[Slims Fitness Program](https://portal.gov/slims)\n"
    )

    def test_extracts_only_lims_links_and_resolves_relative(self):
        from scraper.firecrawl_client import extract_listing_links
        links = extract_listing_links(self.MD, base_url="https://portal.gov/search?q=LIMS")
        urls = [u for _, u in links]
        self.assertIn("https://portal.gov/rfp/2431", urls)
        self.assertIn("https://portal.gov/opps/lims-upgrade", urls)  # relative resolved
        self.assertNotIn("https://portal.gov/rfp/9999", urls)        # non-LIMS
        self.assertNotIn("https://portal.gov/careers", urls)
        self.assertNotIn("https://portal.gov/slims", urls)           # 'slims' != 'lims'

    def test_empty_markdown(self):
        from scraper.firecrawl_client import extract_listing_links
        self.assertEqual(extract_listing_links("", base_url="https://x.gov"), [])

    def test_same_page_fragment_anchors_excluded(self):
        # Regression: on a ?q=LIMS search page, "#tab-N" anchors resolve to the
        # same page (with the LIMS query inherited) and must not be followed.
        from scraper.firecrawl_client import extract_listing_links
        base = "https://www.highergov.com/all/?q=LIMS"
        md = (
            "[Contracts (8)](#tab-8)\n"
            "[Awards (23)](https://www.highergov.com/all/?q=LIMS#tab-23)\n"
            "[LIMS Replacement RFP](https://www.highergov.com/contract-opportunity/lims-2431/)\n"
        )
        links = extract_listing_links(md, base_url=base)
        urls = [u for _, u in links]
        self.assertEqual(
            urls, ["https://www.highergov.com/contract-opportunity/lims-2431/"]
        )
        # Stored URLs carry no fragments.
        self.assertTrue(all("#" not in u for u in urls))

    def test_deterministic_notice_id(self):
        from scraper.run import _firecrawl_notice_id
        a = _firecrawl_notice_id("https://portal.gov/rfp/2431")
        b = _firecrawl_notice_id("https://portal.gov/rfp/2431")
        self.assertEqual(a, b)
        self.assertTrue(a.startswith("FC-"))
        self.assertNotEqual(a, _firecrawl_notice_id("https://portal.gov/rfp/2432"))


class SourceTags(unittest.TestCase):
    def test_keyword_tags_source(self):
        r = scoring.score_opportunity(title="LIMS", description="LIMS system", naics_codes=[])
        self.assertIn(config.SOURCE_TAG_SAM, r.keyword_tags())
        self.assertIn(config.SOURCE_TAG_FIRECRAWL,
                      r.keyword_tags(source_tag=config.SOURCE_TAG_FIRECRAWL))


class DotenvFallbackParser(unittest.TestCase):
    def test_export_quotes_and_inline_comments(self):
        import os, tempfile
        from scraper.run import _load_dotenv
        with tempfile.TemporaryDirectory() as tmp:
            with open(os.path.join(tmp, ".env"), "w") as fh:
                fh.write(
                    'export FOO_TEST_A=plain # trailing comment\n'
                    'FOO_TEST_B="quoted # not a comment"\n'
                    "FOO_TEST_C='single'\n"
                )
            cwd = os.getcwd()
            os.chdir(tmp)
            try:
                _load_dotenv()  # python-dotenv path (if installed) or fallback
            finally:
                os.chdir(cwd)
            try:
                self.assertEqual(os.environ.get("FOO_TEST_A"), "plain")
                self.assertEqual(os.environ.get("FOO_TEST_B"), "quoted # not a comment")
                self.assertEqual(os.environ.get("FOO_TEST_C"), "single")
            finally:
                for k in ("FOO_TEST_A", "FOO_TEST_B", "FOO_TEST_C"):
                    os.environ.pop(k, None)


class QuotaExhaustion(unittest.TestCase):
    """A 429 quota response must abort immediately, not burn retries."""

    QUOTA_BODY = {
        "code": "900804",
        "message": "Message throttled out",
        "description": "You have exceeded your quota .You can access API after "
                       "2026-Jul-08 00:00:00+0000 UTC",
    }

    def _client_with(self, handler):
        import httpx
        from scraper.sam_api import SamClient
        sam = SamClient("test-key")
        sam._client = httpx.Client(transport=httpx.MockTransport(handler))
        return sam

    def test_quota_429_raises_after_single_request(self):
        import httpx
        from datetime import date
        from scraper.sam_api import SamQuotaError
        calls = {"n": 0}

        def handler(request):
            calls["n"] += 1
            return httpx.Response(429, json=self.QUOTA_BODY)

        sam = self._client_with(handler)
        with self.assertRaises(SamQuotaError):
            sam.search(query="LIMS", posted_from=date(2026, 6, 1), posted_to=date(2026, 7, 1))
        self.assertEqual(calls["n"], 1)          # no retry burn
        self.assertTrue(sam.quota_exhausted)

    def test_after_exhaustion_no_further_http_calls(self):
        import httpx
        from datetime import date
        from scraper.sam_api import SamQuotaError
        calls = {"n": 0}

        def handler(request):
            calls["n"] += 1
            return httpx.Response(429, json=self.QUOTA_BODY)

        sam = self._client_with(handler)
        with self.assertRaises(SamQuotaError):
            sam.search(query="LIMS", posted_from=date(2026, 6, 1), posted_to=date(2026, 7, 1))
        # Description fetches short-circuit without touching the network.
        self.assertEqual(sam.fetch_description("https://api.sam.gov/noticedesc?x=1"), "")
        self.assertEqual(calls["n"], 1)

    def test_generic_429_still_retries(self):
        import httpx
        from datetime import date
        calls = {"n": 0}

        def handler(request):
            calls["n"] += 1
            if calls["n"] < 3:
                return httpx.Response(429, text="slow down")  # transient, no quota marker
            return httpx.Response(200, json={"totalRecords": 0, "opportunitiesData": []})

        sam = self._client_with(handler)
        out = sam.search(query="LIMS", posted_from=date(2026, 6, 1), posted_to=date(2026, 7, 1))
        self.assertEqual(out, [])
        self.assertEqual(calls["n"], 3)


class WideningRespectsDailyQuota(unittest.TestCase):
    """Regression: a spent daily quota must stop the lookback auto-widen.

    run_sam used to create a fresh SamClient per widened window, resetting the
    request counter -- so after the narrow window had (by design) spent the
    whole SAM_DAILY_QUOTA on searches + description fetches, the widened pass
    fired real searches into an exhausted quota and failed with a 429 every
    single day.
    """

    QUOTA_BODY = QuotaExhaustion.QUOTA_BODY

    def _run_with_stub(self, handler, quota="10"):
        import os
        import httpx
        from scraper import run as run_mod
        from scraper.sam_api import SamClient

        class StubbedSam(SamClient):
            def __init__(self, api_key, **kwargs):
                super().__init__(api_key)
                self._client = httpx.Client(transport=httpx.MockTransport(handler))

        env = {"SAM_API_KEY": "test-sam-key", "SAM_DAILY_QUOTA": quota,
               "LOOKBACK_DAYS": "14"}
        saved = {k: os.environ.get(k) for k in env}
        os.environ.update(env)
        real_client = run_mod.SamClient
        run_mod.SamClient = StubbedSam
        try:
            return run_mod.run_sam(dry_run=True)
        finally:
            run_mod.SamClient = real_client
            for k, v in saved.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v

    def test_widening_skipped_when_quota_spent(self):
        import httpx
        calls = {"n": 0}

        def handler(request):
            calls["n"] += 1
            if calls["n"] > 10:  # the key's real daily allowance
                return httpx.Response(429, json=self.QUOTA_BODY)
            if request.url.path.endswith("/search"):
                data = [
                    {
                        "noticeId": f"stub-{calls['n']}-{i}",
                        "title": "Road Paving Services",
                        "postedDate": "2026-07-01",
                        "description": "https://api.sam.gov/noticedesc?id=x",
                    }
                    for i in range(30)
                ]
                return httpx.Response(
                    200, json={"totalRecords": 30, "opportunitiesData": data}
                )
            return httpx.Response(200, json={"description": "asphalt and paving"})

        stats = self._run_with_stub(handler)
        # 4 searches + 6 description fetches spend the quota; the widened pass
        # must never fire (it used to 429 here every day).
        self.assertEqual(stats.errors, [])
        self.assertEqual(calls["n"], 10)
        self.assertEqual(stats.fetched, 120)  # narrow window's work is kept
        self.assertTrue(any("widening skipped" in w for w in stats.warnings),
                        stats.warnings)

    def test_widening_continues_while_budget_remains(self):
        import httpx
        calls = {"n": 0}

        def handler(request):
            calls["n"] += 1
            if calls["n"] > 10:
                return httpx.Response(429, json=self.QUOTA_BODY)
            return httpx.Response(200, json={"totalRecords": 0, "opportunitiesData": []})

        stats = self._run_with_stub(handler)
        # Empty windows leave the description budget unspent, so widening can
        # keep searching -- but never past the 10-request allowance.
        self.assertEqual(stats.errors, [])
        self.assertLessEqual(calls["n"], 10)
        self.assertTrue(any("auto-widened" in w for w in stats.warnings),
                        stats.warnings)


class SupabaseUrlNormalization(unittest.TestCase):
    def test_rest_v1_suffix_not_doubled(self):
        from scraper.db import SupabaseClient
        for given in (
            "https://x.supabase.co",
            "https://x.supabase.co/",
            "https://x.supabase.co/rest/v1",
            "https://x.supabase.co/rest/v1/",
            " https://x.supabase.co/rest/v1/ ",
            "x.supabase.co",  # missing scheme
        ):
            client = SupabaseClient(given, "key")
            self.assertEqual(client.rest_url, "https://x.supabase.co/rest/v1", given)
            client.close()

    def test_firecrawl_url_scheme_added(self):
        from scraper.firecrawl_client import FirecrawlClient
        for given, expected in (
            ("myfc.up.railway.app", "https://myfc.up.railway.app"),
            ("https://myfc.up.railway.app/", "https://myfc.up.railway.app"),
            ("http://fc.railway.internal:3002", "http://fc.railway.internal:3002"),
        ):
            client = FirecrawlClient(given)
            self.assertEqual(client.base_url, expected, given)
            client.close()


class SmallQuotaMode(unittest.TestCase):
    def test_default_plan_titles_first(self):
        from scraper.run import _build_search_plan
        plan = _build_search_plan()
        self.assertEqual(plan[0], ("title", "LIMS"))
        # All titles precede all sweeps in the default plan.
        kinds = [f for f, _ in plan]
        self.assertEqual(kinds.index("ncode"), len(config.SAM_SEARCH_QUERIES))

    def test_small_quota_plan_prioritizes_primary_sweep(self):
        import os
        from scraper.run import _build_search_plan
        os.environ["SAM_DAILY_QUOTA"] = "10"
        try:
            plan = _build_search_plan()
        finally:
            del os.environ["SAM_DAILY_QUOTA"]
        # 'LIMS' title first, then the 541512 sweep -- the two highest-yield
        # requests fit even the smallest allowance.
        self.assertEqual(plan[0], ("title", "LIMS"))
        self.assertEqual(plan[1], ("ncode", "541512"))

    def test_allowance_split(self):
        # ~40% of the declared quota goes to searches, minimum 2.
        for quota, expected in ((10, 4), (25, 10), (5, 2), (3, 2)):
            self.assertEqual(max(2, (quota * 2) // 5), expected)


class InsertAttribution(unittest.TestCase):
    """_record_insert_outcome must attribute inserts from the representation."""

    RECORDS = [{"notice_id": "A"}, {"notice_id": "B"}]

    def test_race_loser_reported_as_duplicate_not_insert(self):
        from scraper.run import RunStats, _record_insert_outcome

        class FakeSupa:  # only A actually inserted; B hit the conflict
            def insert_opportunities(self, records):
                return [{"notice_id": "A"}]

        stats = RunStats()
        _record_insert_outcome(FakeSupa(), self.RECORDS, stats)
        self.assertEqual(stats.inserted, ["A"])
        self.assertIn("B", stats.skipped_duplicate)
        self.assertTrue(stats.warnings)

    def test_missing_representation_falls_back_to_requery(self):
        from scraper.run import RunStats, _record_insert_outcome

        class FakeSupa:
            def insert_opportunities(self, records):
                return None  # body missing/unparseable

            def existing_notice_ids(self, ids):
                return {"A"}  # only A is actually present

        stats = RunStats()
        _record_insert_outcome(FakeSupa(), self.RECORDS, stats)
        self.assertEqual(stats.inserted, ["A"])
        self.assertTrue(any("not found after insert" in e for e in stats.errors))


class ConfigGuards(unittest.TestCase):
    def test_placeholder_rejected_without_leaking_value(self):
        import os
        os.environ["_CH_TEST_KEY"] = "your-sam-api-key"
        try:
            with self.assertRaises(config.ConfigError) as ctx:
                config.require("_CH_TEST_KEY")
            # The error must never echo the value (it may be a real secret).
            self.assertNotIn("your-sam-api-key", str(ctx.exception))
        finally:
            del os.environ["_CH_TEST_KEY"]

    def test_missing_rejected(self):
        with self.assertRaises(config.ConfigError):
            config.require("_CH_DOES_NOT_EXIST")

    def test_real_jwt_and_sam_key_accepted(self):
        import os
        # Shapes of real keys (values here are NOT real credentials).
        os.environ["_CH_TEST_JWT"] = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig"
        os.environ["_CH_TEST_SAM"] = "SAM-00000000-0000-0000-0000-000000000000"
        try:
            self.assertTrue(config.require("_CH_TEST_JWT"))
            self.assertTrue(config.require("_CH_TEST_SAM"))
        finally:
            del os.environ["_CH_TEST_JWT"]
            del os.environ["_CH_TEST_SAM"]


if __name__ == "__main__":
    unittest.main()
