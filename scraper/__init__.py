"""ContractHunter LIMS scraper.

A small, additive pipeline that pulls Laboratory Information Management System
(LIMS) related opportunities from the real SAM.gov Opportunities API, scores
them deterministically for LIMS relevance, and inserts the qualifying ones into
the existing ``contract_opportunities`` Supabase table (dedup on ``notice_id``).

Design rules (do not relax):
  * Every value written comes from a real API response. Nothing is invented.
  * ``relevance_score`` is computed only from terms actually present in the
    SAM-provided title/description. If a notice does not clear the relevance
    gate on real matched terms, it is not inserted.
  * No simulated results anywhere -- real HTTP calls, real inserts, real errors.
"""

__all__ = ["config", "sam_api", "scoring", "db", "firecrawl_client"]
