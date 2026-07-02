#!/usr/bin/env python3
"""Deterministic authority scoring for source cards.

Our domain wants credibility by AUTHORITY (is this the official page?), not by
breadth (how many pages agree) as in gpt-researcher. This assigns each source card
a 0-100 score and a `usable_for` tier so hard pricing/deprecation facts can only
rest on official sources.

Scoring:
  official domain match ............ +60
  official facet source_type ....... +25   (official_pricing/changelog/deprecation/migration)
  provider/model keyword present ... +10
  has retrieved_at AND content_hash  +5
  third-party news / untrusted ..... total capped at 50

Tiers: >=80 conclusion | 60-79 support | <60 appendix.

Usage:
    python score_sources.py --sources runs/<id>/source_cards.json \
        --registry data/provider_registry.json --out runs/<id>/source_cards.json
"""

from __future__ import annotations

import argparse
from pathlib import Path
from urllib.parse import urlparse

from schema import load_json, write_json

_OFFICIAL_TYPES = {
    "official_pricing",
    "official_changelog",
    "official_deprecation",
    "official_migration",
}


def _host(url: str) -> str:
    return (urlparse(url).hostname or "").lower()


def _is_official_domain(host: str, domains: list[str]) -> bool:
    return any(host == d or host.endswith("." + d) for d in domains)


def score_source(card: dict, registry: dict) -> dict:
    provider = card.get("provider", "")
    pspec = registry.get("providers", {}).get(provider, {})
    domains = pspec.get("official_domains", [])
    keywords = [provider, *pspec.get("keywords", [])]

    host = _host(card.get("url", ""))
    source_type = card.get("source_type", "unknown")
    haystack = f"{card.get('title', '')} {card.get('url', '')}".lower()

    official_domain = _is_official_domain(host, domains)
    score = 0
    if official_domain:
        score += 60
    if source_type in _OFFICIAL_TYPES:
        score += 25
    if any(k and k.lower() in haystack for k in keywords):
        score += 10
    if card.get("retrieved_at") and card.get("content_hash"):
        score += 5

    third_party = source_type == "third_party_news" or card.get("authority_tier") == "untrusted"
    if third_party:
        score = min(score, 50)

    if official_domain:
        authority_tier = "official"
    elif third_party:
        authority_tier = "untrusted"
    else:
        authority_tier = "trusted_secondary"

    usable_for = "conclusion" if score >= 80 else "support" if score >= 60 else "appendix"

    out = dict(card)
    out["score"] = score
    out["authority_tier"] = authority_tier
    out["usable_for"] = usable_for
    return out


def score_all(cards: list[dict], registry: dict) -> list[dict]:
    scored = [score_source(c, registry) for c in cards]
    scored.sort(key=lambda c: c["score"], reverse=True)
    return scored


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--sources", type=Path, required=True)
    ap.add_argument("--registry", type=Path, required=True)
    ap.add_argument("--out", type=Path, default=None)
    args = ap.parse_args(argv)

    cards = load_json(args.sources)
    if not isinstance(cards, list):
        ap.error("source cards file must be a JSON list")
    scored = score_all(cards, load_json(args.registry))
    write_json(args.out or args.sources, scored)

    tiers = {"conclusion": 0, "support": 0, "appendix": 0}
    for c in scored:
        tiers[c["usable_for"]] += 1
    print(
        f"scored {len(scored)} sources -> {args.out or args.sources} "
        f"(conclusion {tiers['conclusion']}, support {tiers['support']}, "
        f"appendix {tiers['appendix']})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
