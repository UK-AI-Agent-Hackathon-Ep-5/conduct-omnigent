"""Export compact API callsite handoff records from Impact Radar artifacts.

The existing code scanner produces report-oriented ``CodeFinding`` rows. This
adapter turns them into one-record-per-finding JSON that can be handed to the
next agent step: pricing verification, migration recommendation, owner routing,
or approval workflow.

Stdlib only. The feature-map parser intentionally supports the small YAML shape
used by ``data/feature_map.yaml`` without requiring PyYAML.
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

from schema import load_json, write_json

LIKELIHOOD_BY_CATEGORY = {
    "client_call": ("high", 0.9),
    "model_literal": ("medium", 0.7),
    "import": ("low", 0.35),
}

RISK_BY_SEVERITY = {
    "critical": ("critical", 1.0),
    "high": ("high", 0.9),
    "medium": ("medium", 0.65),
    "low": ("low", 0.35),
    "info": ("info", 0.15),
}


def _parse_inline_list(value: str) -> list[str]:
    value = value.strip()
    if not (value.startswith("[") and value.endswith("]")):
        return []
    body = value[1:-1].strip()
    if not body:
        return []
    return [item.strip().strip("\"'") for item in body.split(",")]


def _parse_feature_map(path: Path | None) -> dict[str, dict[str, Any]]:
    if not path or not path.exists():
        return {}

    features: dict[str, dict[str, Any]] = {}
    current: str | None = None
    in_features = False

    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].rstrip()
        if not line.strip():
            continue
        if line.strip() == "features:":
            in_features = True
            continue
        if not in_features:
            continue
        if line.startswith("  ") and not line.startswith("    ") and line.strip().endswith(":"):
            current = line.strip()[:-1]
            features[current] = {"name": current}
            continue
        if current and line.startswith("    ") and ":" in line:
            key, value = line.strip().split(":", 1)
            value = value.strip()
            if value.startswith("["):
                features[current][key] = _parse_inline_list(value)
            else:
                features[current][key] = value.strip("\"'")

    return features


def _match_feature(
    finding: dict[str, Any], features: dict[str, dict[str, Any]]
) -> dict[str, Any] | None:
    file_path = (finding.get("file") or "").replace("\\", "/")
    model = finding.get("model")

    for feature in features.values():
        code_paths = [path.replace("\\", "/") for path in feature.get("code_paths", [])]
        if file_path in code_paths:
            return feature
    if model:
        for feature in features.values():
            if model in feature.get("models", []):
                return feature
    return None


def _cost_lookup(
    cost_impact: dict[str, Any],
) -> dict[tuple[str | None, str | None], dict[str, Any]]:
    lookup: dict[tuple[str | None, str | None], dict[str, Any]] = {}
    for row in cost_impact.get("rows", []) if isinstance(cost_impact, dict) else []:
        lookup[(row.get("feature"), row.get("model"))] = row
        lookup[(None, row.get("model"))] = row
    return lookup


def _research_lookup(
    external_research: dict[str, Any],
) -> dict[tuple[str | None, str | None], dict[str, Any]]:
    lookup: dict[tuple[str | None, str | None], dict[str, Any]] = {}
    if not isinstance(external_research, dict):
        return lookup
    for model in external_research.get("models", []):
        provider = model.get("provider")
        model_name = model.get("model_name")
        lookup[(provider, model_name)] = model
        lookup[(None, model_name)] = model
    return lookup


def _verification_needs(
    finding: dict[str, Any],
    feature: dict[str, Any] | None,
    cost_row: dict[str, Any] | None,
    research_row: dict[str, Any] | None,
) -> list[str]:
    needs: list[str] = []
    if not finding.get("model"):
        needs.append("resolve_runtime_model_name")
    if not finding.get("provider"):
        needs.append("verify_provider_from_client_context")
    if not feature:
        needs.append("map_code_path_to_product_owner")
    if not cost_row:
        needs.append("attach_usage_and_pricing_cost_delta")
    if finding.get("model") and not research_row:
        needs.append("attach_external_model_research")
    if research_row and not research_row.get("source_urls"):
        needs.append("verify_external_research_sources")
    if finding.get("category") == "import":
        needs.append("confirm_import_is_used_in_runtime_path")
    return needs


def _research_payload(research_row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not research_row:
        return None
    return {
        "model_status": research_row.get("status"),
        "api_compatibility": research_row.get("api_compatibility"),
        "input_price_per_1m": research_row.get("input_price_per_1m"),
        "output_price_per_1m": research_row.get("output_price_per_1m"),
        "context_window_tokens": research_row.get("context_window_tokens"),
        "replacement_models": research_row.get("replacement_models", []),
        "migration_notes": research_row.get("migration_notes"),
        "source_urls": research_row.get("source_urls", []),
        "research_confidence": research_row.get("confidence"),
        "last_verified_at": research_row.get("last_verified_at"),
    }


def _record(
    finding: dict[str, Any],
    feature: dict[str, Any] | None,
    cost_row: dict[str, Any] | None,
    research_row: dict[str, Any] | None,
) -> dict[str, Any]:
    category = finding.get("category") or "unknown"
    severity = finding.get("severity") or "info"
    likelihood_label, likelihood_score = LIKELIHOOD_BY_CATEGORY.get(category, ("unknown", 0.5))
    risk_label, risk_score = RISK_BY_SEVERITY.get(severity, ("unknown", 0.5))

    if feature and feature.get("tier") == "production" and category != "import":
        likelihood_label = "high"
        likelihood_score = max(likelihood_score, 0.85)
    if finding.get("matched_change_ids") and feature and feature.get("tier") == "production":
        if severity == "critical":
            risk_score = max(risk_score, 0.98)
            risk_label = "critical"
        else:
            risk_score = max(risk_score, 0.7)
            risk_label = "high" if severity == "high" else "medium"

    feature_name = feature.get("name") if feature else None
    return {
        "id": finding.get("finding_id"),
        "model_name": finding.get("model") or "unknown",
        "provider": finding.get("provider") or "unknown",
        "calling_method": f"{finding.get('provider') or 'unknown'}::{category}",
        "responsible_work": feature.get("description") if feature else "unknown",
        "code_location": f"{finding.get('file')}:{finding.get('line')}",
        "file_path": finding.get("file"),
        "line": finding.get("line"),
        "category": category,
        "feature": {
            "name": feature_name,
            "owner": feature.get("owner") if feature else None,
            "tier": feature.get("tier") if feature else None,
        },
        "call_likelihood": likelihood_label,
        "call_likelihood_score": round(likelihood_score, 2),
        "migration_risk": risk_label,
        "risk_score": round(risk_score, 2),
        "matched_change_ids": finding.get("matched_change_ids", []),
        "estimated_cost_delta_usd": cost_row.get("delta_usd") if cost_row else None,
        "cost_basis": {
            "feature": cost_row.get("feature") if cost_row else feature_name,
            "old_cost_usd": cost_row.get("old_cost_usd") if cost_row else None,
            "new_cost_usd": cost_row.get("new_cost_usd") if cost_row else None,
            "pct_change": cost_row.get("pct_change") if cost_row else None,
        },
        "external_research": _research_payload(research_row),
        "handoff_target": {
            "next_agent": "report-generator",
            "recommended_action": "include_in_migration_assessment",
        },
        "needs_external_verification": _verification_needs(
            finding, feature, cost_row, research_row
        ),
        "confidence": "medium"
        if category == "model_literal"
        else "low"
        if category == "import"
        else "high",
        "evidence": {"snippet": finding.get("snippet")},
    }


def build_handoff(
    code_findings: list[dict[str, Any]],
    features: dict[str, dict[str, Any]],
    cost_impact: dict[str, Any],
    external_research: dict[str, Any],
    repo: str | None,
) -> dict[str, Any]:
    costs = _cost_lookup(cost_impact)
    research = _research_lookup(external_research)
    records = []
    for finding in code_findings:
        feature = _match_feature(finding, features)
        feature_name = feature.get("name") if feature else None
        cost_row = costs.get((feature_name, finding.get("model"))) or costs.get(
            (None, finding.get("model"))
        )
        research_row = research.get(
            (finding.get("provider"), finding.get("model"))
        ) or research.get((None, finding.get("model")))
        records.append(_record(finding, feature, cost_row, research_row))

    return {
        "schema_version": "0.1",
        "artifact_type": "api_callsite_handoff_records",
        "repo": repo,
        "record_count": len(records),
        "records": records,
        "contract_notes": [
            "One record represents one scanned LLM API/model touchpoint.",
            "Scores are deterministic heuristics from category, severity, "
            "feature tier, and matched changes.",
            "Cost fields are copied from cost_impact.json when usage/pricing data can be matched.",
            "External model facts are copied from external_research.json "
            "when provider/model can be matched.",
        ],
        "external_research": {
            "schema_version": external_research.get("schema_version")
            if isinstance(external_research, dict)
            else None,
            "research_timestamp": external_research.get("research_timestamp")
            if isinstance(external_research, dict)
            else None,
            "model_count": len(external_research.get("models", []))
            if isinstance(external_research, dict)
            else 0,
        },
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--code", type=Path, required=True, help="code_impact.json from scan_code.py")
    ap.add_argument("--feature-map", type=Path, default=None, help="data/feature_map.yaml")
    ap.add_argument("--cost", type=Path, default=None, help="cost_impact.json from cost_impact.py")
    ap.add_argument(
        "--external-research",
        type=Path,
        default=None,
        help="external_research.json from the research agent",
    )
    ap.add_argument("--repo", default=None, help="Scanned repository/path label")
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args(argv)

    code_findings = load_json(args.code)
    if not isinstance(code_findings, list):
        raise SystemExit(f"expected list in {args.code}")

    features = _parse_feature_map(args.feature_map)
    cost_impact = load_json(args.cost) if args.cost and args.cost.exists() else {}
    external_research = (
        load_json(args.external_research)
        if args.external_research and args.external_research.exists()
        else {}
    )
    payload = build_handoff(code_findings, features, cost_impact, external_research, args.repo)
    write_json(args.out, payload)
    print(f"wrote {payload['record_count']} handoff records -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
