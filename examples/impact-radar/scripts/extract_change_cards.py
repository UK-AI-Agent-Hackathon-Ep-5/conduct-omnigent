#!/usr/bin/env python3
"""Diff old vs new pricing snapshots into normalized change cards.

Deterministic: given two provider pricing snapshots (LiteLLM-like schema), emit
one ChangeCard per changed price dimension, deprecation, new model, or context
window change. Unknown fields stay ``unknown``; replacements are only reported
when the snapshot states them explicitly (never inferred).

Usage:
    python extract_change_cards.py --pricing-dir data/pricing --out runs/<id>/change_cards.json
    python extract_change_cards.py --old data/pricing/openai.old.json \
        --new data/pricing/openai.new.json --out change_cards.json
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from schema import ChangeCard, load_json, write_json

_PRICE_METRICS = ("input_cost_per_1m", "output_cost_per_1m", "cached_input_cost_per_1m")


def _diff_pair(old: dict, new: dict) -> list[ChangeCard]:
    provider = new.get("provider") or old.get("provider") or "unknown"
    effective = new.get("snapshot_date")
    old_models = old.get("models", {})
    new_models = new.get("models", {})
    cards: list[ChangeCard] = []
    seq = 0

    def cid() -> str:
        nonlocal seq
        seq += 1
        return f"{provider}-C{seq}"

    for model, nspec in new_models.items():
        ospec = old_models.get(model)
        if ospec is None:
            cards.append(
                ChangeCard(
                    change_id=cid(),
                    provider=provider,
                    change_type="new_model",
                    target=model,
                    target_type="model",
                    metric="status",
                    old_value=None,
                    new_value=nspec.get("status", "active"),
                    effective_date=effective,
                )
            )
            continue

        # Price movements.
        for metric in _PRICE_METRICS:
            if metric in ospec or metric in nspec:
                ov, nv = ospec.get(metric), nspec.get(metric)
                if ov != nv and ov is not None and nv is not None:
                    ctype = "price_increase" if nv > ov else "price_decrease"
                    cards.append(
                        ChangeCard(
                            change_id=cid(),
                            provider=provider,
                            change_type=ctype,
                            target=model,
                            target_type="model",
                            metric=metric,
                            old_value=ov,
                            new_value=nv,
                            effective_date=effective,
                        )
                    )

        # Context window changes.
        if ospec.get("context_window") != nspec.get("context_window"):
            cards.append(
                ChangeCard(
                    change_id=cid(),
                    provider=provider,
                    change_type="context_window_change",
                    target=model,
                    target_type="model",
                    metric="context_window",
                    old_value=ospec.get("context_window"),
                    new_value=nspec.get("context_window"),
                    effective_date=effective,
                )
            )

        # Deprecation.
        if ospec.get("status") != "deprecated" and nspec.get("status") == "deprecated":
            cards.append(
                ChangeCard(
                    change_id=cid(),
                    provider=provider,
                    change_type="deprecation",
                    target=model,
                    target_type="model",
                    metric="status",
                    old_value=ospec.get("status", "active"),
                    new_value="deprecated",
                    effective_date=effective,
                    shutdown_date=nspec.get("shutdown_date"),
                    replacement=nspec.get("replacement"),
                )
            )

    return cards


def _discover_pairs(pricing_dir: Path) -> list[tuple[Path, Path]]:
    pairs = []
    for old_path in sorted(pricing_dir.glob("*.old.json")):
        provider = old_path.name[: -len(".old.json")]
        new_path = pricing_dir / f"{provider}.new.json"
        if new_path.exists():
            pairs.append((old_path, new_path))
    return pairs


def extract(pairs: list[tuple[Path, Path]]) -> list[ChangeCard]:
    cards: list[ChangeCard] = []
    for old_path, new_path in pairs:
        cards.extend(_diff_pair(load_json(old_path), load_json(new_path)))
    return cards


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--pricing-dir", type=Path, help="Directory of <provider>.old.json / .new.json pairs"
    )
    ap.add_argument("--old", type=Path, help="Single old snapshot")
    ap.add_argument("--new", type=Path, help="Single new snapshot")
    ap.add_argument("--out", type=Path, default=Path("change_cards.json"))
    args = ap.parse_args(argv)

    if args.pricing_dir:
        pairs = _discover_pairs(args.pricing_dir)
        if not pairs:
            print(f"no *.old.json/*.new.json pairs in {args.pricing_dir}", file=sys.stderr)
            return 2
    elif args.old and args.new:
        pairs = [(args.old, args.new)]
    else:
        ap.error("provide --pricing-dir OR both --old and --new")
        return 2  # unreachable

    cards = extract(pairs)
    write_json(args.out, cards)
    print(f"wrote {len(cards)} change cards -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
