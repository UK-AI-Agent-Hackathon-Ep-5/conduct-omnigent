#!/usr/bin/env python3
"""Compute the cost delta of a pricing change against an internal usage log.

Deterministic: usage_log.csv x (old,new) pricing snapshots -> per-row, per-model,
per-feature, and total USD deltas. Uses stdlib csv (pandas is not required).

Usage:
    python cost_impact.py --usage data/usage_log.csv --pricing-dir data/pricing \
        --out runs/<id>/cost_impact.json
"""

from __future__ import annotations

import argparse
import csv
from collections import defaultdict
from pathlib import Path

from schema import load_json, write_json


def _load_pricing(pricing_dir: Path, suffix: str) -> dict[str, dict]:
    """provider -> models dict, merged across all <provider>.<suffix>.json files."""
    out: dict[str, dict] = {}
    for path in sorted(pricing_dir.glob(f"*.{suffix}.json")):
        snap = load_json(path)
        out[snap["provider"]] = snap.get("models", {})
    return out


def _row_cost(models: dict, model: str, in_tok: float, out_tok: float) -> float | None:
    spec = models.get(model)
    if not spec:
        return None
    in_price = spec.get("input_cost_per_1m")
    out_price = spec.get("output_cost_per_1m")
    if in_price is None or out_price is None:
        return None
    return round(in_tok / 1e6 * in_price + out_tok / 1e6 * out_price, 4)


def compute(usage_csv: Path, pricing_dir: Path) -> dict:
    old_pricing = _load_pricing(pricing_dir, "old")
    new_pricing = _load_pricing(pricing_dir, "new")

    rows = []
    by_feature: dict[str, dict[str, float]] = defaultdict(lambda: {"old": 0.0, "new": 0.0})
    by_model: dict[str, dict[str, float]] = defaultdict(lambda: {"old": 0.0, "new": 0.0})
    total_old = total_new = 0.0

    with usage_csv.open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            provider, model, feature = r["provider"], r["model"], r["feature"]
            in_tok, out_tok = float(r["input_tokens"]), float(r["output_tokens"])
            old_cost = _row_cost(old_pricing.get(provider, {}), model, in_tok, out_tok)
            new_cost = _row_cost(new_pricing.get(provider, {}), model, in_tok, out_tok)
            oc, nc = (old_cost or 0.0), (new_cost or 0.0)
            delta = round(nc - oc, 4)
            rows.append(
                {
                    "provider": provider,
                    "model": model,
                    "feature": feature,
                    "old_cost_usd": old_cost,
                    "new_cost_usd": new_cost,
                    "delta_usd": delta,
                    "pct_change": (round(delta / oc * 100, 2) if oc else None),
                }
            )
            by_feature[feature]["old"] += oc
            by_feature[feature]["new"] += nc
            by_model[model]["old"] += oc
            by_model[model]["new"] += nc
            total_old += oc
            total_new += nc

    def _summ(d: dict[str, dict[str, float]]) -> dict:
        return {
            k: {
                "old_cost_usd": round(v["old"], 4),
                "new_cost_usd": round(v["new"], 4),
                "delta_usd": round(v["new"] - v["old"], 4),
            }
            for k, v in d.items()
        }

    return {
        "rows": rows,
        "by_feature": _summ(by_feature),
        "by_model": _summ(by_model),
        "totals": {
            "old_cost_usd": round(total_old, 4),
            "new_cost_usd": round(total_new, 4),
            "delta_usd": round(total_new - total_old, 4),
            "pct_change": (
                round((total_new - total_old) / total_old * 100, 2) if total_old else None
            ),
        },
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--usage", type=Path, required=True)
    ap.add_argument("--pricing-dir", type=Path, required=True)
    ap.add_argument("--out", type=Path, default=Path("cost_impact.json"))
    args = ap.parse_args(argv)

    result = compute(args.usage, args.pricing_dir)
    write_json(args.out, result)
    t = result["totals"]
    print(
        f"wrote cost impact -> {args.out} "
        f"(old ${t['old_cost_usd']} -> new ${t['new_cost_usd']}, "
        f"delta ${t['delta_usd']})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
