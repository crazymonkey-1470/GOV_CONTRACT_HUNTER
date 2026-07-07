"""Client for a self-hosted Firecrawl server (real HTTP scrape requests).

Used for the non-SAM sourcing portals in ``sourcing_portals``. Firecrawl turns
a portal page into markdown/text; listing links whose anchor text carries a
genuine LIMS signal are followed (a second real scrape) and run through the
same :mod:`scraper.scoring` gate as SAM results -- so a row is only inserted
when the scraped detail page genuinely contains LIMS-relevant text.

Supports the Firecrawl ``/v1/scrape`` API (self-hosted or cloud).
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urljoin

import httpx

from . import config, scoring


class FirecrawlError(RuntimeError):
    """Raised on a non-transient Firecrawl failure."""


@dataclass
class ScrapeResult:
    url: str
    markdown: str
    metadata: dict[str, Any]

    @property
    def has_content(self) -> bool:
        return bool(self.markdown and self.markdown.strip())


# Markdown links: [anchor text](https://target). Anchor capped to keep nav
# noise and megabyte-long anchors out.
_MD_LINK_RE = re.compile(r"\[([^\]\n]{4,300})\]\((https?://[^)\s]+|/[^)\s]*)\)")
# 'lims' as a standalone token in a URL (query, path segment) -- not 'slims'.
_URL_LIMS_RE = re.compile(r"(?<![a-z0-9])lims(?![a-z0-9])", re.IGNORECASE)


def extract_listing_links(
    markdown: str, *, base_url: str, limit: int = 5
) -> list[tuple[str, str]]:
    """Pull candidate opportunity links out of scraped page markdown.

    Returns (anchor_text, absolute_url) pairs where the *real* anchor text
    contains a primary LIMS term, or the URL itself mentions LIMS. Purely
    mechanical extraction of what is on the page -- nothing is synthesized.
    """
    if not markdown:
        return []
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    base_clean = base_url.split("#", 1)[0].rstrip("/")
    for match in _MD_LINK_RE.finditer(markdown):
        anchor = " ".join(match.group(1).split())
        href = match.group(2)
        # Fragments are client-side only: "#tab-8" on a search page is the
        # same page, not a listing. Compare and store URLs without them.
        url = urljoin(base_url, href).split("#", 1)[0]
        if not url or url in seen or url.rstrip("/") == base_clean:
            continue
        # A LIMS signal must come from the link itself (real anchor text or
        # its own path/query) -- note relative hrefs resolved against a
        # ?q=LIMS base keep that query only when the href had none of its own.
        if scoring.contains_primary_term(anchor) or _URL_LIMS_RE.search(url):
            seen.add(url)
            out.append((anchor, url))
            if len(out) >= limit:
                break
    return out


def _portal_target_url(portal: dict[str, Any]) -> str | None:
    """Choose which URL to scrape for a portal row.

    Prefers a pre-built LIMS keyword search URL if the portal row carries one
    (a ``search_url`` field), otherwise falls back to the portal's landing
    page (``portal_url``). ``search_url`` is not a column in the base schema;
    ``.get`` returns ``None`` when it is absent, so this is safe today and
    ready if such a column/value is added later (see Step 6).
    """
    search_url = portal.get("search_url")
    if isinstance(search_url, str) and search_url.strip():
        return search_url.strip()
    portal_url = portal.get("portal_url")
    if isinstance(portal_url, str) and portal_url.strip():
        return portal_url.strip()
    return None


class FirecrawlClient:
    def __init__(self, base_url: str, api_key: str | None = None, *, timeout: float | None = None) -> None:
        if not base_url:
            raise FirecrawlError("FIRECRAWL_URL is required")
        base = base_url.strip().rstrip("/")
        # Tolerate a bare hostname (e.g. "myfirecrawl.up.railway.app") -- an
        # URL without a scheme fails every request at the client layer.
        if not re.match(r"^https?://", base, re.IGNORECASE):
            base = "https://" + base
        self.base_url = base
        headers = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        self._client = httpx.Client(
            timeout=timeout or config.HTTP_TIMEOUT_SECONDS,
            headers=headers,
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "FirecrawlClient":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def scrape(self, url: str) -> ScrapeResult:
        """Scrape a single URL to markdown via Firecrawl's /v1/scrape endpoint."""
        endpoint = f"{self.base_url}/v1/scrape"
        payload = {"url": url, "formats": ["markdown"], "onlyMainContent": True}

        backoff = 2.0
        last_exc: Exception | None = None
        for attempt in range(1, config.HTTP_MAX_RETRIES + 1):
            try:
                resp = self._client.post(endpoint, json=payload)
            except httpx.HTTPError as exc:
                last_exc = exc
                if attempt == config.HTTP_MAX_RETRIES:
                    break
                time.sleep(backoff)
                backoff *= 2
                continue
            if resp.status_code in (429, 500, 502, 503, 504):
                last_exc = FirecrawlError(f"Firecrawl {resp.status_code}: {resp.text[:300]}")
                if attempt == config.HTTP_MAX_RETRIES:
                    break
                time.sleep(backoff)
                backoff *= 2
                continue
            if resp.status_code >= 400:
                raise FirecrawlError(
                    f"Firecrawl scrape failed [{resp.status_code}] for {url}: {resp.text[:400]}"
                )
            return self._parse(url, resp)

        raise FirecrawlError(f"Firecrawl scrape failed after retries for {url}: {last_exc}")

    @staticmethod
    def _parse(url: str, resp: httpx.Response) -> ScrapeResult:
        try:
            body = resp.json()
        except ValueError as exc:
            raise FirecrawlError(f"Firecrawl returned non-JSON for {url}: {resp.text[:300]}") from exc

        # Firecrawl v1 wraps the payload in {"success": true, "data": {...}}.
        data = body.get("data", body) if isinstance(body, dict) else {}
        if isinstance(body, dict) and body.get("success") is False:
            raise FirecrawlError(f"Firecrawl reported failure for {url}: {body.get('error')}")

        markdown = ""
        metadata: dict[str, Any] = {}
        if isinstance(data, dict):
            markdown = data.get("markdown") or data.get("content") or ""
            metadata = data.get("metadata") or {}
        return ScrapeResult(url=url, markdown=markdown, metadata=metadata)

    def scrape_portal(self, portal: dict[str, Any]) -> ScrapeResult | None:
        """Scrape the best target URL for a portal row, or None if it has no URL."""
        target = _portal_target_url(portal)
        if not target:
            return None
        return self.scrape(target)
