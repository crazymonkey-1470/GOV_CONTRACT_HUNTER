"""Optional LLM enrichment (Anthropic), used only to phrase real notice text.

If ``ANTHROPIC_API_KEY`` is set and the ``anthropic`` package is installed, this
produces a short ``customer_fit_notes`` line. The model is instructed to ground
every statement in the provided notice text and to output nothing if the text
does not support a useful note -- it never adds facts that are not in the
source. When the key or package is absent, enrichment is skipped entirely and
the affected field stays ``None`` (no fabrication, no failure).
"""

from __future__ import annotations

from . import config

_SYSTEM = (
    "You help a small government contractor triage SAM.gov opportunities for "
    "fit with Laboratory Information Management System (LIMS) work. You are "
    "given only the real notice title and description. Write at most two "
    "sentences noting why this could or could not be a fit, using ONLY facts "
    "present in the provided text. Do not invent agencies, dollar values, "
    "dates, or requirements. If the text does not support a useful note, reply "
    "with exactly the word NONE."
)


def is_available() -> bool:
    if not config.get(config.ENV_ANTHROPIC_API_KEY):
        return False
    try:
        import anthropic  # noqa: F401
    except ImportError:
        return False
    return True


def customer_fit_notes(*, title: str, description: str) -> str | None:
    """Return a grounded fit note, or None if unavailable/unsupported."""
    if not is_available():
        return None
    try:
        import anthropic
    except ImportError:
        return None

    api_key = config.get(config.ENV_ANTHROPIC_API_KEY)
    text = (description or "").strip()
    prompt = f"Title: {title}\n\nDescription:\n{text[:6000] or '(no description provided)'}"

    try:
        client = anthropic.Anthropic(api_key=api_key)
        resp = client.messages.create(
            model="claude-sonnet-5",
            max_tokens=500,
            # Two grounded sentences need no extended thinking; disabling it
            # also stops thinking tokens from eating the max_tokens budget.
            thinking={"type": "disabled"},
            system=_SYSTEM,
            messages=[{"role": "user", "content": prompt}],
        )
        # A response cut off by max_tokens could end mid-sentence; discard it
        # rather than store a truncated note.
        if getattr(resp, "stop_reason", None) == "max_tokens":
            return None
        parts = [block.text for block in resp.content if getattr(block, "type", None) == "text"]
        out = " ".join(p.strip() for p in parts).strip()
    except Exception:
        # Enrichment is best-effort; a failure must never break a live run.
        return None

    if not out or out.strip().upper() == "NONE":
        return None
    return out
