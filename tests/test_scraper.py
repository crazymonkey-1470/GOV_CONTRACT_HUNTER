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


class ConfigGuards(unittest.TestCase):
    def test_placeholder_rejected(self):
        import os
        os.environ["_CH_TEST_KEY"] = "your-sam-api-key"
        try:
            with self.assertRaises(config.ConfigError):
                config.require("_CH_TEST_KEY")
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
