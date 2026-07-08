"""Configuration for the ContractHunter LIMS scraper.

All secrets and tunables are read from the environment (loaded from ``.env`` by
``scraper.run`` at start-up). Nothing is read at import time that would fail
without keys present -- callers use :func:`require` to fetch a value only when
they actually need it, so the module imports cleanly during tests and builds.
"""

from __future__ import annotations

import os

# ---------------------------------------------------------------------------
# Environment variable names (single source of truth; keep in sync with .env)
# ---------------------------------------------------------------------------
ENV_SUPABASE_URL = "SUPABASE_URL"
ENV_SUPABASE_SERVICE_KEY = "SUPABASE_SERVICE_KEY"
ENV_SAM_API_KEY = "SAM_API_KEY"
ENV_ANTHROPIC_API_KEY = "ANTHROPIC_API_KEY"
ENV_FIRECRAWL_URL = "FIRECRAWL_URL"
ENV_FIRECRAWL_API_KEY = "FIRECRAWL_API_KEY"


class ConfigError(RuntimeError):
    """Raised when a required environment variable is missing or a placeholder."""


# Values that look like an un-filled ``.env.example`` placeholder. We refuse to
# run with these so a live run never silently uses fake credentials. Markers
# are chosen so no real random credential can contain them (no hex/base64
# substrings like "xxxx").
_PLACEHOLDER_MARKERS = (
    "your-",
    "your_",
    "changeme",
    "replace-me",
    "replace_me",
    "example.com",
)


def get(name: str, default: str | None = None) -> str | None:
    """Return an environment variable's value (stripped) or ``default``."""
    raw = os.environ.get(name)
    if raw is None:
        return default
    raw = raw.strip()
    return raw if raw else default


def _looks_like_placeholder(value: str) -> bool:
    low = value.lower()
    if low.startswith("<") and low.endswith(">"):
        return True
    return any(marker in low for marker in _PLACEHOLDER_MARKERS)


def require(name: str) -> str:
    """Return a required env var, raising :class:`ConfigError` if absent/placeholder."""
    value = get(name)
    if not value:
        raise ConfigError(
            f"Missing required environment variable {name!r}. "
            f"Copy .env.example to .env and fill it in."
        )
    if _looks_like_placeholder(value):
        # Deliberately does NOT echo the value: this message can end up in cron
        # logs and the variable may hold a real (if oddly-shaped) secret.
        raise ConfigError(
            f"Environment variable {name!r} looks like an unfilled .env.example "
            f"placeholder. Fill in the real value before running."
        )
    return value


def get_int(name: str, default: int) -> int:
    value = get(name)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        return default


# ---------------------------------------------------------------------------
# SAM.gov Opportunities API
# ---------------------------------------------------------------------------
SAM_SEARCH_URL = "https://api.sam.gov/opportunities/v2/search"
# Max records per page allowed by the API.
SAM_PAGE_LIMIT = 100

# How far back to look for postings, in days. Widened (up to SAM's ceiling of a
# 1-year window) only when a narrower window returns nothing -- never by
# loosening relevance rules. Overridable via the LOOKBACK_DAYS env var.
DEFAULT_LOOKBACK_DAYS = 14
MAX_LOOKBACK_DAYS = 90


def lookback_days() -> int:
    return get_int("LOOKBACK_DAYS", DEFAULT_LOOKBACK_DAYS)


def sam_daily_quota() -> int:
    """The key's daily request allowance, if the user has told us (0 = plenty).

    Set SAM_DAILY_QUOTA=10 for a personal non-federal key so the run splits
    the budget between a few high-value searches and description fetches
    instead of burning everything on searches. Entity-associated keys
    (~1,000/day) can leave this unset.
    """
    return get_int("SAM_DAILY_QUOTA", 0)


# ---------------------------------------------------------------------------
# LIMS relevance model
# ---------------------------------------------------------------------------
# The minimum relevance the dashboard shows (matches lib/types.ts
# MIN_RELEVANCE_SCORE). Only opportunities scoring >= this are inserted.
MIN_RELEVANCE_SCORE = 65

# Primary LIMS signals. Presence of one of these in the title/description is
# what makes an opportunity genuinely LIMS-related. Matched case-insensitively
# with word boundaries (see scoring.py).
#
# CORE terms are unambiguous on their own. CONTEXTUAL terms (specimen/sample
# tracking or management) also describe physical logistics work (couriers,
# transport), so they only count as primary when a software-context word is
# present too -- otherwise a "Specimen Courier Services" RFP would qualify.
LIMS_CORE_PRIMARY_TERMS = (
    "laboratory information management system",
    "laboratory information management systems",
    "laboratory information management",
    "laboratory information system",
    "laboratory informatics",
    "lab informatics",
    "lims",
    "electronic laboratory notebook",
    "laboratory data management",
    "scientific data management system",
)

LIMS_CONTEXTUAL_PRIMARY_TERMS = (
    "specimen tracking",
    "specimen management",
    "sample tracking",
    "sample management system",
    "laboratory software",
    "laboratory automation",
)

# Words indicating a software/system procurement (vs physical logistics).
SOFTWARE_CONTEXT_TERMS = (
    "system",
    "software",
    "solution",
    "platform",
    "informatics",
    "application",
    "database",
    "module",
    "electronic",
    "digital",
    "automation",
    "interface",
)

# Union, for callers that just need "any primary term" (e.g. link filtering).
LIMS_PRIMARY_TERMS = LIMS_CORE_PRIMARY_TERMS + LIMS_CONTEXTUAL_PRIMARY_TERMS

# Secondary/context signals. On their own these do not qualify a notice, but
# they add confidence when a primary term is also present.
LIMS_SECONDARY_TERMS = (
    "laboratory",
    "specimen",
    "assay",
    "clinical laboratory",
    "pathology",
    "informatics",
    "biobank",
    "chain of custody",
    "test results management",
    "diagnostic",
    "reagent",
    "accessioning",
)

# Search phrases sent to the SAM.gov ``title`` parameter (the public v2 API has
# no free-text ``q`` param; ``title`` does substring matching on notice titles).
# "laboratory information" also covers "...management system" and
# "...system" title variants. scoring.py re-validates every hit -- including
# its fetched description -- against the term lists above.
SAM_SEARCH_QUERIES = (
    "LIMS",
    "laboratory information",
    "laboratory informatics",
    "lab informatics",
    "laboratory software",
    "electronic laboratory notebook",
    "specimen tracking",
    "specimen management",
)

# NAICS codes to SWEEP (fetch everything filed under them in the window and
# let scoring decide). These are the codes agencies actually use for LIMS
# consulting/integration work. Override with a comma-separated NAICS_SWEEP env
# var; set it to "off" to disable sweeps entirely.
SAM_NAICS_SWEEP = (
    "541512",  # Computer Systems Design Services (primary)
    "541511",  # Custom Computer Programming Services
    "541690",  # Other Scientific and Technical Consulting Services
    "541611",  # Admin/General Management Consulting Services
    "541519",  # Other Computer Related Services
)

# Product Service Codes (classification codes) to sweep, same mechanics.
# Override with PSC_SWEEP env var ("off" to disable).
SAM_PSC_SWEEP = (
    "DA01",  # IT and Telecom - Business Application Support Services
    "DJ01",  # IT and Telecom - Security and Compliance Support Services
    "DB02",  # IT and Telecom - Compute Support Services
    "R425",  # Support Professional: Engineering and Technical
    "R408",  # Support Professional: Program Management/Support
    "R499",  # Support Professional: Other
)


def sweep_list(env_name: str, default: tuple[str, ...]) -> tuple[str, ...]:
    """A sweep code list, overridable per env ("off"/"none" disables)."""
    raw = get(env_name)
    if raw is None:
        return default
    if raw.strip().lower() in ("off", "none", "0", "false"):
        return ()
    return tuple(code.strip() for code in raw.split(",") if code.strip())

# NAICS codes commonly associated with LIMS procurements. A match adds a small
# amount of confidence; it never qualifies a notice by itself.
LIMS_RELEVANT_NAICS = frozenset(
    {
        "541511",  # Custom Computer Programming Services
        "541512",  # Computer Systems Design Services
        "541513",  # Computer Facilities Management Services
        "541519",  # Other Computer Related Services
        "621511",  # Medical Laboratories
        "621512",  # Diagnostic Imaging Centers
        "541380",  # Testing Laboratories
        "334516",  # Analytical Laboratory Instrument Manufacturing
        "541714",  # R&D in Biotechnology
        "511210",  # Software Publishers (2017 NAICS -- standard for COTS buys)
        "513210",  # Software Publishers (2022 NAICS vintage)
        "541611",  # Admin/Management Consulting (workflow analysis, advisory)
        "541690",  # Other Scientific and Technical Consulting Services
    }
)

# PSCs typical of LIMS-adjacent buys; a match adds the same small confidence
# boost as a NAICS match (never qualifies a notice by itself).
LIMS_RELEVANT_PSC = frozenset(
    {"DA01", "DJ01", "DB02", "R425", "R408", "R499", "7A20", "7J20"}
)

# Status written to new rows (matches the table default of 'new').
NEW_OPPORTUNITY_STATUS = "new"

# Tag prefix used to mark the sourcing origin inside the keywords array. The
# dashboard hides "Source:..." tags (see lib/contracts.ts visibleKeywords).
SOURCE_TAG_SAM = "Source:SAM.gov"
SOURCE_TAG_FIRECRAWL = "Source:Firecrawl"


# ---------------------------------------------------------------------------
# HTTP behaviour
# ---------------------------------------------------------------------------
HTTP_TIMEOUT_SECONDS = 45.0
HTTP_MAX_RETRIES = 4
