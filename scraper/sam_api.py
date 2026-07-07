"""Real SAM.gov Opportunities API v2 client.

Docs: https://open.gsa.gov/api/get-opportunities-public-api/

This module makes real HTTP requests. There is no mock/sample mode -- if the
API errors, the error is raised so the caller can report it as an error.
"""

from __future__ import annotations

import html
import re
import time
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

import httpx

from . import config


class SamApiError(RuntimeError):
    """Raised when the SAM.gov API returns an error or an unexpected payload."""


class SamQuotaError(SamApiError):
    """The API key's daily request quota is exhausted (429 code 900804).

    Retrying is pointless until the quota resets (nextAccessTime in the body),
    so callers should abort the run immediately instead of burning further
    requests.
    """


def _is_quota_exhausted(body: str) -> bool:
    low = (body or "").lower()
    return "900804" in low or "exceeded your quota" in low or "throttled out" in low


@dataclass
class SamOpportunity:
    """A normalized view of a single SAM.gov notice.

    Every field is populated straight from the API response; missing values are
    left as ``None``/empty and never invented.
    """

    notice_id: str
    title: str
    agency: str | None
    notice_type: str | None
    posted_date: str | None            # YYYY-MM-DD
    response_deadline: str | None       # ISO 8601 timestamp or None
    sam_link: str | None
    naics_codes: list[str] = field(default_factory=list)
    set_aside: str | None = None
    value: float | None = None
    poc_name: str | None = None
    poc_email: str | None = None
    description: str = ""               # plain text (HTML stripped)
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def haystack(self) -> str:
        """Lower-cased title + description used for relevance scoring."""
        return f"{self.title}\n{self.description}".lower()


_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"[ \t\r\f\v]+")


def _strip_html(text: str) -> str:
    """Turn the HTML SAM returns for a notice description into plain text."""
    if not text:
        return ""
    # Preserve line breaks that carry list/paragraph structure.
    text = re.sub(r"(?i)<\s*br\s*/?\s*>", "\n", text)
    text = re.sub(r"(?i)</\s*(p|li|div|tr|h[1-6])\s*>", "\n", text)
    text = _TAG_RE.sub(" ", text)
    text = html.unescape(text)
    text = _WS_RE.sub(" ", text)
    text = re.sub(r"\n\s*\n\s*", "\n", text)
    return text.strip()


def _first_present(d: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        val = d.get(key)
        if val not in (None, "", []):
            return val
    return None


class SamClient:
    """Thin wrapper over the SAM.gov Opportunities v2 search endpoint."""

    def __init__(self, api_key: str, *, timeout: float | None = None) -> None:
        if not api_key:
            raise SamApiError("SAM_API_KEY is required")
        self.api_key = api_key
        # Set once the daily quota comes back exhausted; all further calls
        # (searches, description fetches) short-circuit instead of burning
        # requests against a dead quota.
        self.quota_exhausted = False
        self._client = httpx.Client(
            timeout=timeout or config.HTTP_TIMEOUT_SECONDS,
            headers={"Accept": "application/json"},
        )

    # -- lifecycle ---------------------------------------------------------
    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "SamClient":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    # -- HTTP with retry/backoff ------------------------------------------
    def _get(self, url: str, params: dict[str, Any]) -> httpx.Response:
        if self.quota_exhausted:
            raise SamQuotaError("SAM.gov daily quota already exhausted this run")
        last_exc: Exception | None = None
        backoff = 2.0
        for attempt in range(1, config.HTTP_MAX_RETRIES + 1):
            try:
                resp = self._client.get(url, params=params)
            except httpx.HTTPError as exc:  # network-level failure
                last_exc = exc
                if attempt == config.HTTP_MAX_RETRIES:
                    break
                time.sleep(backoff)
                backoff *= 2
                continue

            # Quota exhaustion (429 code 900804) resets at a fixed time --
            # retrying only wastes requests. Abort the whole run instead.
            if resp.status_code == 429 and _is_quota_exhausted(resp.text):
                self.quota_exhausted = True
                raise SamQuotaError(
                    f"SAM.gov daily quota exhausted: {resp.text[:300]}"
                )

            # Other 429/5xx are transient -> retry with backoff.
            if resp.status_code in (429, 500, 502, 503, 504):
                last_exc = SamApiError(
                    f"SAM.gov returned {resp.status_code}: {resp.text[:300]}"
                )
                if attempt == config.HTTP_MAX_RETRIES:
                    break
                time.sleep(backoff)
                backoff *= 2
                continue

            if resp.status_code >= 400:
                # 4xx (bad key, bad params) -- not retryable; surface it.
                raise SamApiError(
                    f"SAM.gov request failed [{resp.status_code}]: {resp.text[:500]}"
                )
            return resp

        raise SamApiError(f"SAM.gov request failed after retries: {last_exc}")

    # -- public API --------------------------------------------------------
    @staticmethod
    def _search_params(
        query: str, posted_from: date, posted_to: date, limit: int, offset: int
    ) -> dict[str, Any]:
        """Build query params for one search page.

        NOTE: the public Opportunities v2 API has NO free-text ``q`` parameter --
        keyword search is done via ``title`` (substring match against the notice
        title). Descriptions still get matched later by scoring.py after the
        per-notice description fetch. postedFrom/postedTo are REQUIRED by the
        API and must be MM/dd/yyyy.
        """
        return {
            "title": query,
            "postedFrom": posted_from.strftime("%m/%d/%Y"),
            "postedTo": posted_to.strftime("%m/%d/%Y"),
            "limit": limit,
            "offset": offset,
        }

    def search(
        self,
        *,
        query: str,
        posted_from: date,
        posted_to: date,
        limit: int = config.SAM_PAGE_LIMIT,
        max_pages: int = 5,
    ) -> list[dict[str, Any]]:
        """Return raw ``opportunitiesData`` dicts for one title-keyword query.

        Paginates until results are exhausted or ``max_pages`` is reached; if
        the API reports more records than we fetched, that is surfaced on
        stdout so silent truncation can't masquerade as full coverage.
        """
        results: list[dict[str, Any]] = []
        offset = 0
        total = 0
        for _ in range(max_pages):
            params = {"api_key": self.api_key}
            params.update(self._search_params(query, posted_from, posted_to, limit, offset))
            resp = self._get(config.SAM_SEARCH_URL, params)
            try:
                payload = resp.json()
            except ValueError as exc:
                raise SamApiError(f"SAM.gov returned non-JSON: {resp.text[:300]}") from exc

            # The API reports its own errors inside a 200 body sometimes.
            if isinstance(payload, dict) and payload.get("error"):
                raise SamApiError(f"SAM.gov error: {payload['error']}")

            batch = payload.get("opportunitiesData") or []
            results.extend(batch)

            total = payload.get("totalRecords", 0) or 0
            offset += limit
            if offset >= total or not batch:
                break
        if total > len(results):
            print(
                f"[sam]   note: '{query}' has {total} records in window, "
                f"fetched first {len(results)} (raise max_pages to widen)"
            )
        return results

    def fetch_description(self, description_ref: str | None) -> str:
        """Fetch and plain-text a notice's description.

        SAM returns ``description`` as a URL to a separate endpoint. We follow
        it (with the API key) to get the real text. Returns "" on any failure --
        a missing description must never block or fabricate a record.
        """
        if not description_ref:
            return ""
        if not description_ref.startswith("http"):
            # Already inline text.
            return _strip_html(description_ref)
        try:
            resp = self._get(description_ref, {"api_key": self.api_key})
            data = resp.json()
        except (SamApiError, ValueError):
            return ""
        if isinstance(data, dict):
            return _strip_html(data.get("description") or "")
        if isinstance(data, str):
            return _strip_html(data)
        return ""

    def normalize(self, raw: dict[str, Any], *, with_description: bool = True) -> SamOpportunity:
        """Map one raw SAM record onto :class:`SamOpportunity` (real fields only)."""
        notice_id = _first_present(raw, "noticeId", "noticeid", "id")
        if not notice_id:
            raise SamApiError("SAM record missing noticeId")

        # Agency: fullParentPathName is a dotted hierarchy; keep the leading
        # (department) segment for readability, store the full path in raw_data.
        agency_path = _first_present(raw, "fullParentPathName", "organizationName")
        agency = None
        if isinstance(agency_path, str) and agency_path:
            agency = agency_path.split(".")[0].strip().title() or None

        naics: list[str] = []
        single = raw.get("naicsCode")
        if single:
            naics.append(str(single))
        for code in raw.get("naicsCodes") or []:
            code = str(code)
            if code not in naics:
                naics.append(code)

        # Point of contact: prefer the primary contact.
        poc_name = poc_email = None
        pocs = raw.get("pointOfContact") or []
        if isinstance(pocs, list) and pocs:
            primary = next(
                (p for p in pocs if str(p.get("type", "")).lower() == "primary"),
                pocs[0],
            )
            poc_name = primary.get("fullName") or None
            poc_email = primary.get("email") or None

        # Award amount only exists for award notices; otherwise value is null.
        value = None
        award = raw.get("award")
        if isinstance(award, dict):
            amount = award.get("amount")
            if amount not in (None, ""):
                try:
                    value = float(str(amount).replace(",", "").replace("$", ""))
                except ValueError:
                    value = None

        description = ""
        if with_description:
            description = self.fetch_description(raw.get("description"))

        return SamOpportunity(
            notice_id=str(notice_id),
            title=(raw.get("title") or "").strip(),
            agency=agency,
            notice_type=_first_present(raw, "type", "baseType"),
            posted_date=_normalize_date(raw.get("postedDate")),
            response_deadline=_first_present(raw, "responseDeadLine", "responseDeadline"),
            sam_link=_first_present(raw, "uiLink", "link"),
            naics_codes=naics,
            set_aside=_first_present(raw, "typeOfSetAsideDescription", "typeOfSetAside"),
            value=value,
            poc_name=poc_name,
            poc_email=poc_email,
            description=description,
            raw=raw,
        )


def default_window(lookback_days: int, *, today: date | None = None) -> tuple[date, date]:
    """Return (posted_from, posted_to) for a lookback window ending today."""
    end = today or date.today()
    start = end - timedelta(days=max(1, lookback_days))
    return start, end


def _normalize_date(value: Any) -> str | None:
    """Coerce a SAM posted date (may include a time component) to YYYY-MM-DD."""
    if not value:
        return None
    text = str(value)
    # Postings look like "2026-06-30" or "2026-06-30-04:00".
    match = re.match(r"(\d{4}-\d{2}-\d{2})", text)
    return match.group(1) if match else None
