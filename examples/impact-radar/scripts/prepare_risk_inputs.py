#!/usr/bin/env python3
"""Build a bounded risk-planning payload from full callsite handoff records.

`api_call_records.json` is the audit artifact and may be large on real
repositories. This script keeps the full file available, but produces a compact
`risk_inputs.json` for the LLM planning step.
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

from schema import load_json, write_json

RISK_WEIGHT = {"high": 4, "medium": 3, "low": 2, "info": 1}
HIGH_VALUE_NEEDS = {
    "resolve_runtime_model_name",
    "verify_provider_from_client_context",
    "attach_usage_and_pricing_cost_delta",
    "attach_external_model_research",
}


def _records(payload: dict[str, Any]) -> list[dict[str, Any]]:
    records = payload.get("records", []) if isinstance(payload, dict) else []
    return records if isinstance(records, list) else []


def _as_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _count_map(value: Any, *, limit: int = 20) -> dict[str, int]:
    if not isinstance(value, dict):
        return {}
    items = sorted(value.items(), key=lambda item: (-int(item[1]), str(item[0])))
    return {str(key): int(count) for key, count in items[:limit]}


def _clip(value: Any, max_chars: int) -> str | None:
    if value in (None, ""):
        return None
    text = str(value)
    if max_chars <= 0 or len(text) <= max_chars:
        return text
    return f"{text[: max_chars - 3].rstrip()}..."


def _cost_delta(record: dict[str, Any]) -> float:
    return _as_float(record.get("estimated_cost_delta_usd"))


def _has_signal(record: dict[str, Any]) -> bool:
    risk = str(record.get("migration_risk") or "").lower()
    if risk in {"high", "medium"}:
        return True
    if record.get("matched_change_ids"):
        return True
    if abs(_cost_delta(record)) > 0:
        return True
    if record.get("external_research"):
        return True
    needs = set(record.get("needs_external_verification") or [])
    if needs & HIGH_VALUE_NEEDS and record.get("category") == "client_call":
        return True
    feature = record.get("feature") if isinstance(record.get("feature"), dict) else {}
    return bool(feature.get("owner") and record.get("category") != "import")


def _priority(record: dict[str, Any]) -> tuple[float, float, float, float, float, str]:
    risk = str(record.get("migration_risk") or "info").lower()
    needs = record.get("needs_external_verification") or []
    return (
        RISK_WEIGHT.get(risk, 0),
        _as_float(record.get("risk_score")),
        1.0 if record.get("matched_change_ids") else 0.0,
        abs(_cost_delta(record)),
        float(len(needs)),
        str(record.get("id") or ""),
    )


def _compact_research(research: Any) -> dict[str, Any] | None:
    if not isinstance(research, dict) or not research:
        return None
    return {
        "model_status": research.get("model_status"),
        "api_compatibility": research.get("api_compatibility"),
        "replacement_models": research.get("replacement_models", [])[:5],
        "migration_notes": research.get("migration_notes"),
        "source_urls": research.get("source_urls", [])[:5],
        "research_confidence": research.get("research_confidence"),
        "last_verified_at": research.get("last_verified_at"),
    }


def _compact_record(record: dict[str, Any], *, max_snippet_chars: int) -> dict[str, Any]:
    feature = record.get("feature") if isinstance(record.get("feature"), dict) else {}
    evidence = record.get("evidence") if isinstance(record.get("evidence"), dict) else {}
    return {
        "id": record.get("id"),
        "provider": record.get("provider"),
        "model_name": record.get("model_name"),
        "calling_method": record.get("calling_method"),
        "category": record.get("category"),
        "code_location": record.get("code_location"),
        "file_path": record.get("file_path"),
        "line": record.get("line"),
        "feature": {
            "name": feature.get("name"),
            "owner": feature.get("owner"),
            "tier": feature.get("tier"),
        },
        "call_likelihood": record.get("call_likelihood"),
        "migration_risk": record.get("migration_risk"),
        "risk_score": record.get("risk_score"),
        "matched_change_ids": record.get("matched_change_ids", []),
        "estimated_cost_delta_usd": record.get("estimated_cost_delta_usd"),
        "external_research": _compact_research(record.get("external_research")),
        "needs_external_verification": record.get("needs_external_verification", []),
        "confidence": record.get("confidence"),
        "evidence": {"snippet": _clip(evidence.get("snippet"), max_snippet_chars)},
    }


def build_risk_inputs(
    api_call_records: dict[str, Any],
    handoff_stats: dict[str, Any],
    *,
    limit: int,
    max_snippet_chars: int,
) -> dict[str, Any]:
    records = _records(api_call_records)
    candidates = [record for record in records if _has_signal(record)]
    selected = sorted(candidates, key=_priority, reverse=True)[:limit]
    output_summary = (
        handoff_stats.get("output_summary", {}) if isinstance(handoff_stats, dict) else {}
    )

    return {
        "schema_version": "0.1",
        "artifact_type": "impact_radar_risk_inputs",
        "source_record_count": len(records),
        "candidate_record_count": len(candidates),
        "selected_record_count": len(selected),
        "selection_limit": limit,
        "omitted_candidate_count": max(0, len(candidates) - len(selected)),
        "selection_criteria": [
            "high_or_medium_migration_risk",
            "matched_change_ids",
            "non_zero_cost_delta",
            "external_research",
            "high_value_verification_gap_on_client_call",
            "owned_non_import_callsite",
        ],
        "stats_digest": {
            "record_count": output_summary.get("record_count"),
            "records_with_cost": output_summary.get("records_with_cost"),
            "records_with_external_research": output_summary.get("records_with_external_research"),
            "records_needing_external_verification": output_summary.get(
                "records_needing_external_verification"
            ),
            "risk_levels": _count_map(output_summary.get("risk_levels")),
            "providers": _count_map(output_summary.get("providers")),
            "calling_methods": _count_map(output_summary.get("calling_methods")),
            "verification_needs": _count_map(output_summary.get("verification_needs")),
        },
        "records": [
            _compact_record(record, max_snippet_chars=max_snippet_chars) for record in selected
        ],
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--api-call-records", type=Path, required=True)
    ap.add_argument("--handoff-stats", type=Path, default=None)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--limit", type=int, default=50)
    ap.add_argument("--max-snippet-chars", type=int, default=240)
    args = ap.parse_args(argv)

    handoff_stats = (
        load_json(args.handoff_stats)
        if args.handoff_stats and args.handoff_stats.exists()
        else {}
    )
    payload = build_risk_inputs(
        load_json(args.api_call_records),
        handoff_stats,
        limit=args.limit,
        max_snippet_chars=args.max_snippet_chars,
    )
    write_json(args.out, payload)
    print(
        "wrote risk inputs "
        f"({payload['selected_record_count']} of {payload['source_record_count']} records) "
        f"-> {args.out}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
