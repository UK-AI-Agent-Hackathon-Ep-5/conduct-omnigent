#!/usr/bin/env python3
"""Deterministically validate a report's citations against the source cards.

Prevents the LLM from citing sources that do not exist or leaning on untrusted
ones for hard facts. Fails loudly (non-zero exit) so it can gate finalization.

Checks:
  1. Every ``[S#]`` label used in the report resolves to a source card.
  2. No source card referenced by the report is ``authority_tier: untrusted``.
  3. (warn) source cards that are defined but never cited.

Usage:
    python validate_citations.py --report runs/<id>/report.md \
        --sources runs/<id>/source_cards.json
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from schema import load_json

_LABEL_RE = re.compile(r"\[(S\d+)\]")


def validate(report_md: str, sources: list[dict]) -> tuple[list[str], list[str]]:
    """Return (errors, warnings)."""
    by_id = {s["source_id"]: s for s in sources}
    used = set(_LABEL_RE.findall(report_md))
    errors: list[str] = []
    warnings: list[str] = []

    for label in sorted(used):
        src = by_id.get(label)
        if src is None:
            errors.append(f"{label} cited in report but not present in source cards")
            continue
        if src.get("authority_tier") == "untrusted":
            errors.append(f"{label} is untrusted and cannot back a hard claim")
        if not src.get("url"):
            errors.append(f"{label} has no url")

    for sid in sorted(set(by_id) - used):
        warnings.append(f"{sid} defined but never cited")

    return errors, warnings


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--report", type=Path, required=True)
    ap.add_argument("--sources", type=Path, required=True)
    args = ap.parse_args(argv)

    report_md = args.report.read_text(encoding="utf-8")
    sources = load_json(args.sources)
    if not isinstance(sources, list):
        print("source cards file must be a JSON list", file=sys.stderr)
        return 2

    errors, warnings = validate(report_md, sources)
    for w in warnings:
        print(f"WARN: {w}", file=sys.stderr)
    for e in errors:
        print(f"ERROR: {e}", file=sys.stderr)
    if errors:
        print(f"citation validation FAILED with {len(errors)} error(s)", file=sys.stderr)
        return 1
    print("citation validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
