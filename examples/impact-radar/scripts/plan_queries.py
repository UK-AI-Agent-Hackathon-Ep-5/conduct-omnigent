#!/usr/bin/env python3
"""Deterministic query planner for the deep-research loop.

Borrows gpt-researcher's planner idea (generate sub-questions before searching)
but constrains it to our domain: it expands a provider x facets (x unresolved
gaps) into official-domain-scoped search queries. Deterministic and offline — the
same inputs always yield the same query plan.

Usage:
    python plan_queries.py --provider openai --facets all \
        --registry data/provider_registry.json --breadth 4 --out query_plan.json
    # deepen: target only the facts still missing after a first pass
    python plan_queries.py --provider openai --gaps runs/<id>/unresolved.json \
        --registry data/provider_registry.json --depth-level 1 --out query_plan_l1.json
"""

from __future__ import annotations

import argparse
from pathlib import Path

from schema import load_json, write_json

FACETS = ("pricing", "changelog", "deprecation", "migration", "rate_limits", "model_release")

# Ordered phrase templates per facet. `{p}` = provider. The planner takes the
# first `breadth` phrases, so output is stable and breadth-capped.
_FACET_PHRASES: dict[str, list[str]] = {
    "pricing": [
        "{p} API pricing per 1M tokens",
        "{p} API input and output token price",
        "{p} API cached input and batch pricing",
        "{p} model pricing table current",
    ],
    "changelog": [
        "{p} API changelog",
        "{p} API release notes",
        "{p} API recent updates pricing and models",
        "{p} API announcement breaking changes",
    ],
    "deprecation": [
        "{p} API deprecations and shutdown dates",
        "{p} model deprecation replacement model",
        "{p} endpoint sunset retirement",
        "{p} legacy model end of life",
    ],
    "migration": [
        "{p} model migration guide",
        "{p} API upgrade path recommended replacement",
        "{p} migrate deprecated model steps",
        "{p} breaking change migration notes",
    ],
    "rate_limits": [
        "{p} API rate limits",
        "{p} API tier limits and quotas",
        "{p} API requests per minute limits",
        "{p} API usage tier throughput",
    ],
    "model_release": [
        "{p} new model release",
        "{p} available models list",
        "{p} latest model announcement",
        "{p} model versions and context windows",
    ],
}


def _site_clause(domains: list[str], official_only: bool) -> str:
    if not official_only or not domains:
        return ""
    return " OR ".join(f"site:{d}" for d in domains)


def _query(site: str, phrase: str) -> str:
    return f"({site}) {phrase}".strip() if site else phrase


def plan(
    provider: str,
    registry: dict,
    facets: list[str],
    breadth: int,
    official_only: bool,
    depth_level: int,
    gaps: list | None = None,
) -> list[dict]:
    pspec = registry["providers"][provider]
    domains = pspec.get("official_domains", [])
    site = _site_clause(domains, official_only)
    queries: list[dict] = []
    seq = 0

    def add(facet: str, phrase: str) -> None:
        nonlocal seq
        seq += 1
        queries.append(
            {
                "query_id": f"Q{depth_level}-{seq}",
                "provider": provider,
                "facet": facet,
                "query": _query(site, phrase),
                "official_domains": domains,
                "depth_level": depth_level,
            }
        )

    if gaps:
        # Deepening pass: one targeted query per unresolved gap.
        for g in gaps:
            if isinstance(g, dict):
                facet = g.get("facet", "deprecation")
                subject = g.get("subject") or g.get("question") or ""
            else:
                facet, subject = "deprecation", str(g)
            add(facet, f"{provider} {subject}".strip())
        return queries

    for facet in facets:
        for phrase in _FACET_PHRASES.get(facet, [])[:breadth]:
            add(facet, phrase.format(p=provider))
    return queries


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--provider", required=True)
    ap.add_argument("--registry", type=Path, required=True)
    ap.add_argument("--facets", default="all", help="comma-separated, or 'all'")
    ap.add_argument("--gaps", type=Path, help="unresolved.json to deepen from")
    ap.add_argument("--breadth", type=int, default=4)
    ap.add_argument("--depth-level", type=int, default=0)
    ap.add_argument("--official-only", default="true")
    ap.add_argument("--out", type=Path, default=Path("query_plan.json"))
    args = ap.parse_args(argv)

    registry = load_json(args.registry)
    if args.provider not in registry.get("providers", {}):
        ap.error(f"unknown provider {args.provider!r}; known: {list(registry['providers'])}")

    facets = FACETS if args.facets == "all" else tuple(f.strip() for f in args.facets.split(","))
    gaps = load_json(args.gaps) if args.gaps else None
    official_only = str(args.official_only).lower() not in ("false", "0", "no")

    queries = plan(
        args.provider,
        registry,
        list(facets),
        args.breadth,
        official_only,
        args.depth_level,
        gaps if isinstance(gaps, list) else None,
    )
    write_json(args.out, queries)
    print(f"wrote {len(queries)} queries (depth {args.depth_level}) -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
