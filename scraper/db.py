"""Supabase writes for the ContractHunter scraper (PostgREST over HTTPS).

Uses the service-role key so RLS is bypassed for inserts, exactly like the
upstream agent. No ORM and no schema changes -- this module only reads and
writes the *existing* ``contract_opportunities`` and ``sourcing_portals``
tables. Deduplication is on ``notice_id`` (already a UNIQUE column).

COLUMN_MAP is the single place the scraper's internal record keys are mapped to
real database columns. Step 1 of the go-live checklist diffs this map against
the live schema; keep it accurate.
"""

from __future__ import annotations

import time
from typing import Any, Iterable

import httpx

from . import config

# ---------------------------------------------------------------------------
# internal record key  ->  contract_opportunities column name
# Every column here exists in supabase/migrations/001_initial.sql and
# 004_contract_detail_fields.sql. Nothing outside this map is written.
# ---------------------------------------------------------------------------
COLUMN_MAP: dict[str, str] = {
    "notice_id": "notice_id",
    "title": "title",
    "agency": "agency",
    "value": "value",
    "posted_date": "posted_date",
    "response_deadline": "response_deadline",
    "sam_link": "sam_link",
    "relevance_score": "relevance_score",
    "summary": "summary",
    "keywords": "keywords",
    "naics_codes": "naics_codes",
    "set_aside": "set_aside",
    "customer_fit_notes": "customer_fit_notes",
    "raw_data": "raw_data",
    "status": "status",
    "notice_type": "notice_type",
    "poc_name": "poc_name",
    "poc_email": "poc_email",
    "requirements": "requirements",
}

# Columns whose Postgres type is an array (text[]). These are sent as JSON
# arrays; PostgREST maps a JSON array onto a text[] column.
ARRAY_COLUMNS = frozenset({"keywords", "naics_codes", "requirements"})
# Columns whose Postgres type is jsonb.
JSONB_COLUMNS = frozenset({"raw_data"})

OPPORTUNITIES_TABLE = "contract_opportunities"
PORTALS_TABLE = "sourcing_portals"


class DbError(RuntimeError):
    """Raised on any non-transient Supabase/PostgREST failure."""


def to_db_row(record: dict[str, Any]) -> dict[str, Any]:
    """Translate an internal record into a PostgREST row using COLUMN_MAP.

    Keys not in COLUMN_MAP are dropped (defensive against typos writing to
    non-existent columns). Array/jsonb columns are passed through as native
    Python lists/dicts so httpx serializes them as JSON.
    """
    row: dict[str, Any] = {}
    for key, value in record.items():
        column = COLUMN_MAP.get(key)
        if column is None:
            continue
        if column in ARRAY_COLUMNS and value is None:
            value = []
        row[column] = value
    return row


class SupabaseClient:
    def __init__(self, url: str, service_key: str, *, timeout: float | None = None) -> None:
        if not url or not service_key:
            raise DbError("SUPABASE_URL and SUPABASE_SERVICE_KEY are required")
        # Accept either the project base URL or one that already carries the
        # /rest/v1 suffix -- a doubled prefix yields PostgREST's PGRST125
        # "Invalid path" on every request.
        base = url.strip().rstrip("/")
        if base.endswith("/rest/v1"):
            base = base[: -len("/rest/v1")]
        self.rest_url = base + "/rest/v1"
        self._client = httpx.Client(
            timeout=timeout or config.HTTP_TIMEOUT_SECONDS,
            headers={
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
                "Content-Type": "application/json",
            },
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "SupabaseClient":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    # -- HTTP with retry on transient failures ----------------------------
    def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        url = f"{self.rest_url}/{path.lstrip('/')}"
        backoff = 2.0
        last_exc: Exception | None = None
        for attempt in range(1, config.HTTP_MAX_RETRIES + 1):
            try:
                resp = self._client.request(method, url, **kwargs)
            except httpx.HTTPError as exc:
                last_exc = exc
                if attempt == config.HTTP_MAX_RETRIES:
                    break
                time.sleep(backoff)
                backoff *= 2
                continue
            if resp.status_code in (429, 500, 502, 503, 504):
                last_exc = DbError(f"Supabase {resp.status_code}: {resp.text[:300]}")
                if attempt == config.HTTP_MAX_RETRIES:
                    break
                time.sleep(backoff)
                backoff *= 2
                continue
            if resp.status_code >= 400:
                raise DbError(
                    f"Supabase request failed [{resp.status_code}] {method} {path}: "
                    f"{resp.text[:500]}"
                )
            return resp
        raise DbError(f"Supabase request failed after retries: {last_exc}")

    # -- reads -------------------------------------------------------------
    def existing_notice_ids(self, notice_ids: Iterable[str]) -> set[str]:
        """Return the subset of ``notice_ids`` already present in the table."""
        ids = [n for n in notice_ids if n]
        if not ids:
            return set()
        found: set[str] = set()
        # Chunk to keep the URL length sane.
        for chunk in _chunked(ids, 100):
            quoted = ",".join(f'"{i}"' for i in chunk)
            resp = self._request(
                "GET",
                OPPORTUNITIES_TABLE,
                params={"select": "notice_id", "notice_id": f"in.({quoted})"},
            )
            for row in resp.json():
                if row.get("notice_id"):
                    found.add(str(row["notice_id"]))
        return found

    def list_active_portals(self) -> list[dict[str, Any]]:
        resp = self._request(
            "GET",
            PORTALS_TABLE,
            params={"select": "*", "is_active": "eq.true", "order": "name.asc"},
        )
        return resp.json()

    # -- writes ------------------------------------------------------------
    def insert_opportunities(self, records: list[dict[str, Any]]) -> list[dict[str, Any]] | None:
        """Insert new opportunity rows.

        Returns the PostgREST representation: exactly the rows THIS request
        inserted. Rows skipped by ``ON CONFLICT DO NOTHING`` (dedup race with a
        concurrent run) are omitted from it, so callers can attribute inserts
        precisely. Returns ``None`` only when the response body is missing or
        unparseable -- callers should then verify presence by re-query instead
        of assuming success.
        """
        if not records:
            return []
        rows = [to_db_row(r) for r in records]
        resp = self._request(
            "POST",
            OPPORTUNITIES_TABLE,
            params={"on_conflict": "notice_id"},
            headers={"Prefer": "resolution=ignore-duplicates,return=representation"},
            json=rows,
        )
        if not resp.text:
            return None
        try:
            body = resp.json()
        except ValueError:
            return None
        return body if isinstance(body, list) else None

    def touch_portal_last_checked(self, portal_id: str, timestamp: str) -> None:
        """Set a portal's last_checked to the given ISO timestamp."""
        self._request(
            "PATCH",
            PORTALS_TABLE,
            params={"id": f"eq.{portal_id}"},
            headers={"Prefer": "return=minimal"},
            json={"last_checked": timestamp},
        )


def _chunked(seq: list[str], size: int) -> Iterable[list[str]]:
    for i in range(0, len(seq), size):
        yield seq[i : i + size]
