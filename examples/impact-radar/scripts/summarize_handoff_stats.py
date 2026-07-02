#!/usr/bin/env python3
"""Summarize handoff inputs and outputs for the report-generation step.

This script produces a deterministic `handoff_stats.json` payload that explains
what data entered the advisor handoff, what enriched records were emitted, how
many fields/dimensions are available, and where each information group came
from.
"""

from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path
from typing import Any

from schema import load_json, write_json


INPUT_SOURCES = {
    "change_cards": {
        "file": "change_cards.json",
        "source": "Provider pricing/model snapshots processed by extract_change_cards.py",
        "purpose": "Model/service change detection, including pricing, status, context window, and replacement signals.",
    },
    "code_impact": {
        "file": "code_impact.json",
        "source": "Target repository scan produced by scan_code.py",
        "purpose": "LLM provider imports, model literals, client-call sites, and matched change IDs.",
    },
    "cost_impact": {
        "file": "cost_impact.json",
        "source": "Internal usage log plus old/new provider pricing snapshots processed by cost_impact.py",
        "purpose": "Monthly old/new/delta cost by feature and model.",
    },
    "external_research": {
        "file": "external_research.json or external_research.example.json",
        "source": "Upstream research agent using provider docs and source URLs",
        "purpose": "Provider/model status, API compatibility, token prices, context windows, replacements, source URLs, and confidence.",
    },
    "feature_map": {
        "file": "feature_map.yaml",
        "source": "Internal product ownership map maintained by the target team",
        "purpose": "Feature, owner, tier, model, and code-path mapping.",
    },
}

RECORD_DIMENSIONS = [
    "id",
    "model_name",
    "provider",
    "calling_method",
    "responsible_work",
    "code_location",
    "file_path",
    "line",
    "category",
    "feature.name",
    "feature.owner",
    "feature.tier",
    "call_likelihood",
    "call_likelihood_score",
    "migration_risk",
    "risk_score",
    "matched_change_ids",
    "estimated_cost_delta_usd",
    "cost_basis.feature",
    "cost_basis.old_cost_usd",
    "cost_basis.new_cost_usd",
    "cost_basis.pct_change",
    "external_research.model_status",
    "external_research.api_compatibility",
    "external_research.input_price_per_1m",
    "external_research.output_price_per_1m",
    "external_research.context_window_tokens",
    "external_research.replacement_models",
    "external_research.migration_notes",
    "external_research.source_urls",
    "external_research.research_confidence",
    "external_research.last_verified_at",
    "handoff_target.next_agent",
    "handoff_target.recommended_action",
    "needs_external_verification",
    "confidence",
    "evidence.snippet",
]


def _load_optional(path: Path | None, default: Any) -> Any:
    if path and path.exists():
        return load_json(path)
    return default


def _records(payload: dict[str, Any]) -> list[dict[str, Any]]:
    records = payload.get("records", []) if isinstance(payload, dict) else []
    return records if isinstance(records, list) else []


def _count_present(records: list[dict[str, Any]], key: str) -> int:
    count = 0
    for record in records:
        value: Any = record
        for part in key.split("."):
            if not isinstance(value, dict) or part not in value:
                value = None
                break
            value = value[part]
        if value not in (None, "", [], {}):
            count += 1
    return count


def _counter(records: list[dict[str, Any]], key: str) -> dict[str, int]:
    values: Counter[str] = Counter()
    for record in records:
        value: Any = record
        for part in key.split("."):
            if not isinstance(value, dict):
                value = None
                break
            value = value.get(part)
        if isinstance(value, list):
            for item in value:
                values[str(item)] += 1
        elif value not in (None, "", [], {}):
            values[str(value)] += 1
    return dict(sorted(values.items()))


def summarize(
    api_call_records: dict[str, Any],
    change_cards: list[dict[str, Any]],
    code_impact: list[dict[str, Any]],
    cost_impact: dict[str, Any],
    external_research: dict[str, Any],
) -> dict[str, Any]:
    records = _records(api_call_records)
    external_models = external_research.get("models", []) if isinstance(external_research, dict) else []
    cost_rows = cost_impact.get("rows", []) if isinstance(cost_impact, dict) else []
    totals = cost_impact.get("totals", {}) if isinstance(cost_impact, dict) else {}

    records_with_cost = [record for record in records if record.get("estimated_cost_delta_usd") is not None]
    records_with_research = [record for record in records if record.get("external_research")]
    records_needing_verification = [
        record for record in records if record.get("needs_external_verification")
    ]

    return {
        "schema_version": "0.1",
        "artifact_type": "handoff_report_stats",
        "input_summary": {
            "source_count": len(INPUT_SOURCES),
            "sources": INPUT_SOURCES,
            "change_card_count": len(change_cards),
            "code_finding_count": len(code_impact),
            "cost_row_count": len(cost_rows),
            "external_model_research_count": len(external_models),
        },
        "output_summary": {
            "record_count": len(records),
            "dimension_count": len(RECORD_DIMENSIONS),
            "dimensions": RECORD_DIMENSIONS,
            "records_with_cost": len(records_with_cost),
            "records_with_external_research": len(records_with_research),
            "records_needing_external_verification": len(records_needing_verification),
            "providers": _counter(records, "provider"),
            "models": _counter(records, "model_name"),
            "calling_methods": _counter(records, "calling_method"),
            "features": _counter(records, "feature.name"),
            "owners": _counter(records, "feature.owner"),
            "risk_levels": _counter(records, "migration_risk"),
            "call_likelihood_levels": _counter(records, "call_likelihood"),
            "research_statuses": _counter(records, "external_research.model_status"),
            "api_compatibility": _counter(records, "external_research.api_compatibility"),
            "verification_needs": _counter(records, "needs_external_verification"),
        },
        "cost_summary": {
            "old_cost_usd": totals.get("old_cost_usd"),
            "new_cost_usd": totals.get("new_cost_usd"),
            "delta_usd": totals.get("delta_usd"),
            "pct_change": totals.get("pct_change"),
            "records_with_cost_delta": len(records_with_cost),
        },
        "dimension_coverage": {
            dimension: _count_present(records, dimension) for dimension in RECORD_DIMENSIONS
        },
        "handoff_contract": {
            "input_files": [source["file"] for source in INPUT_SOURCES.values()],
            "output_files": ["api_call_records.json", "handoff_stats.json"],
            "next_consumer": "risk-action-plan and report generation",
        },
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--api-call-records", type=Path, required=True)
    ap.add_argument("--change-cards", type=Path, default=None)
    ap.add_argument("--code-impact", type=Path, default=None)
    ap.add_argument("--cost-impact", type=Path, default=None)
    ap.add_argument("--external-research", type=Path, default=None)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args(argv)

    payload = summarize(
        api_call_records=load_json(args.api_call_records),
        change_cards=_load_optional(args.change_cards, []),
        code_impact=_load_optional(args.code_impact, []),
        cost_impact=_load_optional(args.cost_impact, {}),
        external_research=_load_optional(args.external_research, {}),
    )
    write_json(args.out, payload)
    print(
        "wrote handoff stats "
        f"({payload['output_summary']['record_count']} records, "
        f"{payload['output_summary']['dimension_count']} dimensions) -> {args.out}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
