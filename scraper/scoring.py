"""Deterministic LIMS relevance scoring.

The score is derived *only* from terms that actually appear in the SAM-provided
title and description, plus the notice's real NAICS codes. There is no random
component and no model call -- the same notice always yields the same score, so
a result can be reproduced and audited. This is the anti-fabrication gate: a
notice that does not clear :data:`config.MIN_RELEVANCE_SCORE` on real matched
terms is never inserted.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from . import config

# Score weights. Tuned so that a genuine LIMS notice (a primary term present)
# clears the 65 gate, while a notice that merely mentions "laboratory" in
# passing (secondary terms only) cannot.
_TITLE_PRIMARY = 55          # a primary LIMS term in the title
_DESC_PRIMARY = 40           # a primary LIMS term in the description
_EXTRA_PRIMARY = 10          # each additional distinct primary term
_EXTRA_PRIMARY_CAP = 20
_SECONDARY = 5               # each distinct secondary term
_SECONDARY_CAP = 20
_NAICS_MATCH = 10            # notice carries a LIMS-relevant NAICS code
_MAX_SCORE = 100


@dataclass
class RelevanceResult:
    score: int
    matched_primary: list[str] = field(default_factory=list)
    matched_secondary: list[str] = field(default_factory=list)
    matched_naics: list[str] = field(default_factory=list)

    @property
    def is_relevant(self) -> bool:
        return self.score >= config.MIN_RELEVANCE_SCORE

    def keyword_tags(self) -> list[str]:
        """Return the concrete matched terms to store in the keywords column.

        These are real, matched signals -- not guesses. The Source tag lets the
        dashboard/user see where the row came from.
        """
        tags = list(self.matched_primary)
        # A few of the strongest secondary terms, for display context.
        for term in self.matched_secondary:
            if term not in tags:
                tags.append(term)
            if len(tags) >= 6:
                break
        tags.append(config.SOURCE_TAG_SAM)
        return tags


def _term_pattern(term: str) -> re.Pattern[str]:
    # Word-boundary match so "lims" doesn't fire inside "limsomething" and
    # "lis" style short tokens stay precise. Multi-word terms match with
    # flexible internal whitespace.
    escaped = r"\s+".join(re.escape(part) for part in term.split())
    return re.compile(rf"(?<![a-z0-9]){escaped}(?![a-z0-9])", re.IGNORECASE)


# Pre-compile once.
_PRIMARY_PATTERNS = [(t, _term_pattern(t)) for t in config.LIMS_PRIMARY_TERMS]
_SECONDARY_PATTERNS = [(t, _term_pattern(t)) for t in config.LIMS_SECONDARY_TERMS]


def _distinct_matches(text: str, patterns: list[tuple[str, re.Pattern[str]]]) -> list[str]:
    found: list[str] = []
    for term, pattern in patterns:
        if pattern.search(text):
            found.append(term)
    return found


def score_opportunity(
    *,
    title: str,
    description: str,
    naics_codes: list[str] | None = None,
) -> RelevanceResult:
    """Score a single opportunity for LIMS relevance from its real text."""
    title_l = (title or "").lower()
    desc_l = (description or "").lower()
    combined = f"{title_l}\n{desc_l}"
    naics_codes = naics_codes or []

    primary_in_title = _distinct_matches(title_l, _PRIMARY_PATTERNS)
    primary_all = _distinct_matches(combined, _PRIMARY_PATTERNS)
    secondary_all = _distinct_matches(combined, _SECONDARY_PATTERNS)
    matched_naics = [c for c in naics_codes if c in config.LIMS_RELEVANT_NAICS]

    score = 0

    if primary_in_title:
        score += _TITLE_PRIMARY
    elif primary_all:
        # Primary term is present, just not in the title.
        score += _DESC_PRIMARY

    # Additional distinct primary terms beyond the first add confidence.
    extra_primary = max(0, len(primary_all) - 1)
    score += min(extra_primary * _EXTRA_PRIMARY, _EXTRA_PRIMARY_CAP)

    score += min(len(secondary_all) * _SECONDARY, _SECONDARY_CAP)

    if matched_naics:
        score += _NAICS_MATCH

    score = min(score, _MAX_SCORE)

    return RelevanceResult(
        score=score,
        matched_primary=primary_all,
        matched_secondary=secondary_all,
        matched_naics=matched_naics,
    )


def extract_requirements(description: str, *, limit: int = 6) -> list[str]:
    """Pull short requirement-like bullets from the real description text.

    Purely mechanical: it selects existing sentences/lines that read like
    requirements. It never writes new claims -- only excerpts real text.
    Returns an empty list when nothing suitable is found.
    """
    if not description:
        return []

    # Split on line breaks and sentence boundaries.
    candidates: list[str] = []
    for line in re.split(r"[\n\r]+", description):
        for sentence in re.split(r"(?<=[.;])\s+", line):
            s = sentence.strip(" -*•\t")
            if s:
                candidates.append(s)

    requirement_re = re.compile(
        r"\b(shall|must|required|require[sd]?|provide|support|maintain|"
        r"deliver|implement|comply|include[s]?|responsible for)\b",
        re.IGNORECASE,
    )

    out: list[str] = []
    seen: set[str] = set()
    for c in candidates:
        if len(c) < 20 or len(c) > 240:
            continue
        if not requirement_re.search(c):
            continue
        key = c.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(c)
        if len(out) >= limit:
            break
    return out


def build_summary(*, title: str, description: str, limit: int = 600) -> str | None:
    """Return a plain-text summary grounded strictly in the real description.

    No model is required; this returns a trimmed excerpt of the actual notice
    text so the summary can never contain invented facts. Returns ``None`` if
    there is no description to summarize.
    """
    text = (description or "").strip()
    if not text:
        return None
    # Collapse whitespace and cut on a sentence boundary near the limit.
    text = re.sub(r"\s+", " ", text)
    if len(text) <= limit:
        return text
    cut = text[:limit]
    last_period = cut.rfind(". ")
    if last_period > 200:
        return cut[: last_period + 1]
    return cut.rstrip() + "…"
