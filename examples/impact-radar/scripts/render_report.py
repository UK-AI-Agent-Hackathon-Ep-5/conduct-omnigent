#!/usr/bin/env python3
"""Assemble the artifacts into an enterprise-readable Markdown report.

Deterministic scaffold: turns change_cards / code_impact / cost_impact (and an
optional risk/action plan and source cards) into report.md with a Sources panel.
The agent may enrich the prose, but the numbers and citations come from here so
they cannot drift from the evidence. stdlib only (jinja2 not required).

Usage:
    python render_report.py --run-dir runs/<id> --out runs/<id>/report.md
"""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from schema import load_json, write_json


def _load(run_dir: Path, name: str, default):
    p = run_dir / name
    return load_json(p) if p.exists() else default


def _fmt_money(v) -> str:
    return f"${v:,.2f}" if isinstance(v, (int, float)) else "unknown"


def _artifact_payloads(run_dir: Path) -> dict[str, Any]:
    return {
        "change_cards": _load(run_dir, "change_cards.json", []),
        "code_impact": _load(run_dir, "code_impact.json", []),
        "cost_impact": _load(run_dir, "cost_impact.json", {}),
        "risk_plan": _load(run_dir, "risk_action_plan.json", []),
        "sources": _load(run_dir, "source_cards.json", []),
        "api_call_records": _load(run_dir, "api_call_records.json", {}),
        "handoff_stats": _load(run_dir, "handoff_stats.json", {}),
        "risk_inputs": _load(run_dir, "risk_inputs.json", {}),
    }


def _slug(value: Any, fallback: str) -> str:
    text = str(value or fallback).strip().lower()
    chars = [char if char.isalnum() else "-" for char in text]
    slug = "-".join(part for part in "".join(chars).split("-") if part)
    return slug or fallback


def _severity(value: Any) -> str:
    text = str(value or "info").lower()
    return text if text in {"critical", "high", "medium", "low", "info"} else "info"


def _source_ids(sources: Any) -> list[str]:
    if not isinstance(sources, list):
        return []
    return [
        str(source["source_id"])
        for source in sources
        if isinstance(source, dict) and source.get("source_id")
    ]


def _providers(*collections: Any) -> list[str]:
    providers: set[str] = set()
    for collection in collections:
        if isinstance(collection, dict):
            collection = collection.get("records", [])
        if not isinstance(collection, list):
            continue
        for item in collection:
            if isinstance(item, dict) and item.get("provider"):
                providers.add(str(item["provider"]))
    return sorted(providers)


def _report_target(api_call_records: Any) -> dict[str, str] | None:
    if not isinstance(api_call_records, dict):
        return None
    repo = api_call_records.get("repo")
    if not repo:
        return None
    path = str(repo)
    return {"name": Path(path).name or path, "path": path}


def _section(
    section_id: Any,
    section_type: str,
    title: Any,
    content: Any,
    *,
    severity: Any = "info",
    data: dict[str, Any] | None = None,
    sources: list[str] | None = None,
    evidence: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "id": _slug(section_id, section_type),
        "type": section_type,
        "title": str(title or "Untitled section"),
        "content": str(content or "No details supplied."),
        "severity": _severity(severity),
        "data": data or {},
        "citations": {"sources": sources or [], "evidence": evidence or []},
        "editable": ["title", "content", "data"],
        "provenance": "generated",
    }


def _change_severity(change: dict[str, Any], code_impact: list[dict[str, Any]]) -> str:
    change_id = change.get("change_id")
    matched = [
        finding
        for finding in code_impact
        if change_id and change_id in (finding.get("matched_change_ids") or [])
    ]
    if any(finding.get("severity") == "critical" for finding in matched):
        return "critical"
    if any(finding.get("severity") == "high" for finding in matched):
        return "high"
    change_type = change.get("change_type")
    if change_type == "deprecation":
        return "high"
    if change_type == "price_increase":
        return "medium"
    if change_type in {"price_decrease", "new_model"}:
        return "low"
    return "info"


def _change_content(change: dict[str, Any]) -> str:
    provider = change.get("provider", "provider")
    target = change.get("target", "target")
    change_type = str(change.get("change_type", "change")).replace("_", " ")
    shutdown = change.get("shutdown_date")
    replacement = change.get("replacement")
    content = f"{provider} {target} has a {change_type} change."
    if shutdown:
        content += f" Shutdown date: {shutdown}."
    if replacement:
        content += f" Replacement: {replacement}."
    return content


def _code_content(finding: dict[str, Any]) -> str:
    location = f"{finding.get('file', 'unknown')}:{finding.get('line', 'unknown')}"
    model = finding.get("model") or "unknown model"
    category = str(finding.get("category", "usage")).replace("_", " ")
    return f"{location} contains {category} usage for {model}."


def _cost_section(cost_impact: dict[str, Any], source_ids: list[str]) -> dict[str, Any] | None:
    totals = cost_impact.get("totals", {}) if isinstance(cost_impact, dict) else {}
    by_feature = cost_impact.get("by_feature", {}) if isinstance(cost_impact, dict) else {}
    if not totals and not by_feature:
        return None
    old_cost = totals.get("old_cost_usd")
    new_cost = totals.get("new_cost_usd")
    delta = totals.get("delta_usd")
    content = (
        "The projected monthly cost moves from "
        f"{_fmt_money(old_cost)} to {_fmt_money(new_cost)}, "
        f"with a delta of {_fmt_money(delta)}."
    )
    severity = "medium"
    if isinstance(delta, (int, float)) and delta > 100:
        severity = "high"
    elif isinstance(delta, (int, float)) and delta < 0:
        severity = "low"
    return _section(
        "cost-impact",
        "cost_impact",
        "Cost Impact",
        content,
        severity=severity,
        data={**totals, "by_feature": by_feature},
        sources=source_ids,
    )


def build_report_output(run_dir: Path, run_id: str) -> dict[str, Any]:
    artifacts = _artifact_payloads(run_dir)
    change_cards = artifacts["change_cards"]
    code_impact = artifacts["code_impact"]
    cost_impact = artifacts["cost_impact"]
    risk_plan = artifacts["risk_plan"]
    sources = artifacts["sources"]
    api_call_records = artifacts["api_call_records"]
    handoff_stats = artifacts["handoff_stats"]
    risk_inputs = artifacts["risk_inputs"]

    change_cards = change_cards if isinstance(change_cards, list) else []
    code_impact = code_impact if isinstance(code_impact, list) else []
    risk_plan = risk_plan if isinstance(risk_plan, list) else []
    source_ids = _source_ids(sources)
    call_records = (
        api_call_records.get("records", []) if isinstance(api_call_records, dict) else []
    )
    call_records = call_records if isinstance(call_records, list) else []
    risk_records = risk_inputs.get("records", []) if isinstance(risk_inputs, dict) else []
    risk_records = risk_records if isinstance(risk_records, list) else []
    affected = [finding for finding in code_impact if finding.get("matched_change_ids")]
    totals = cost_impact.get("totals", {}) if isinstance(cost_impact, dict) else {}

    sections: list[dict[str, Any]] = []
    sections.append(
        _section(
            "executive-summary",
            "executive_summary",
            "Executive Summary",
            (
                f"{len(change_cards)} API changes were detected. "
                f"{len(affected)} code sites are directly affected. "
                f"{len(call_records)} callsite records were prepared for review."
            ),
            severity="high" if affected else "info",
            data={
                "metrics": [
                    {"label": "API changes", "value": str(len(change_cards))},
                    {"label": "Affected code sites", "value": str(len(affected))},
                    {"label": "Callsite records", "value": str(len(call_records))},
                    {"label": "Monthly cost delta", "value": _fmt_money(totals.get("delta_usd"))},
                ]
            },
            sources=source_ids,
        )
    )

    if handoff_stats or risk_inputs:
        output_summary = (
            handoff_stats.get("output_summary", {}) if isinstance(handoff_stats, dict) else {}
        )
        sections.append(
            _section(
                "methodology",
                "methodology",
                "Methodology",
                (
                    "The report joins provider change cards, code scan findings, "
                    "cost impact, handoff statistics, and bounded risk inputs."
                ),
                data={
                    "handoff_stats": output_summary,
                    "risk_input_counts": {
                        "source_record_count": risk_inputs.get("source_record_count")
                        if isinstance(risk_inputs, dict)
                        else None,
                        "selected_record_count": risk_inputs.get("selected_record_count")
                        if isinstance(risk_inputs, dict)
                        else None,
                    },
                },
                sources=source_ids,
            )
        )

    for change in change_cards:
        change_id = change.get("change_id") or change.get("target") or "change"
        sections.append(
            _section(
                f"change-{change_id}",
                "change",
                f"{change.get('provider', 'Provider')} {change.get('target', 'change')}",
                _change_content(change),
                severity=_change_severity(change, code_impact),
                data=change,
                sources=source_ids,
                evidence=[str(change_id)],
            )
        )

    severity_order = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
    for finding in sorted(
        affected,
        key=lambda item: severity_order.get(_severity(item.get("severity")), 4),
    )[:20]:
        finding_id = finding.get("finding_id") or finding.get("id") or "finding"
        sections.append(
            _section(
                f"code-{finding_id}",
                "code_impact",
                f"{finding.get('model') or 'Model'} usage at {finding.get('file', 'unknown')}",
                _code_content(finding),
                severity=finding.get("severity"),
                data=finding,
                sources=source_ids,
                evidence=[
                    str(finding_id),
                    *[str(value) for value in finding.get("matched_change_ids", [])],
                ],
            )
        )

    cost_section = _cost_section(cost_impact, source_ids)
    if cost_section:
        sections.append(cost_section)

    if risk_records:
        critical_count = sum(
            1 for record in risk_records if record.get("migration_risk") == "critical"
        )
        sections.append(
            _section(
                "risk-inputs",
                "risk_inputs",
                "Bounded Risk Inputs",
                (
                    f"{len(risk_records)} records were selected for planning. "
                    f"{critical_count} are critical."
                ),
                severity="critical" if critical_count else "high",
                data={"records": risk_records[:20]},
                sources=source_ids,
                evidence=[
                    str(record.get("id")) for record in risk_records[:20] if record.get("id")
                ],
            )
        )

    for index, action in enumerate(risk_plan, start=1):
        action_id = action.get("action_id") or action.get("id") or f"action-{index}"
        sections.append(
            _section(
                f"action-{action_id}",
                "action",
                action.get("title") or f"Recommended Action {index}",
                action.get("recommended_action") or action.get("rationale") or "Review required.",
                severity=action.get("severity"),
                data=action,
                sources=source_ids,
                evidence=[str(value) for value in action.get("evidence_ids", [])],
            )
        )

    for source in sources if isinstance(sources, list) else []:
        if not isinstance(source, dict):
            continue
        source_id = source.get("source_id") or source.get("url") or "source"
        sections.append(
            _section(
                f"source-{source_id}",
                "source",
                source.get("title") or source.get("url") or "Source",
                source.get("summary") or source.get("url") or "Source recorded for this report.",
                data=source,
                sources=[str(source_id)] if source.get("source_id") else [],
            )
        )

    if not sections:
        sections.append(
            _section(
                "empty-report",
                "callout",
                "No Report Data",
                "The run directory does not contain enough artifacts to render a report.",
                severity="low",
            )
        )

    target = _report_target(api_call_records)
    target_label = f" - {target['name']}" if target and target.get("name") else ""
    return {
        "report_version": 1,
        "run_id": run_id,
        "generated_at": datetime.now(UTC)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z"),
        "title": f"AI API Impact Radar{target_label}",
        "target": target,
        "providers": _providers(change_cards, code_impact, api_call_records),
        "sections": sections,
    }


def report_output_block(report_output: dict[str, Any]) -> str:
    return f"REPORT_OUTPUT\n{json.dumps(report_output, indent=2)}\nEND_REPORT_OUTPUT\n"


def render(run_dir: Path, run_id: str) -> str:
    change_cards = _load(run_dir, "change_cards.json", [])
    code_impact = _load(run_dir, "code_impact.json", [])
    cost_impact = _load(run_dir, "cost_impact.json", {})
    risk_plan = _load(run_dir, "risk_action_plan.json", [])
    sources = _load(run_dir, "source_cards.json", [])
    api_call_records = _load(run_dir, "api_call_records.json", {})
    handoff_stats = _load(run_dir, "handoff_stats.json", {})
    risk_inputs = _load(run_dir, "risk_inputs.json", {})
    call_records = (
        api_call_records.get("records", []) if isinstance(api_call_records, dict) else []
    )

    out: list[str] = []
    a = out.append

    a("# LLM Impact Radar Report\n")
    a(f"_Run: `{run_id}`_\n")

    # Executive summary.
    deprecations = [c for c in change_cards if c.get("change_type") == "deprecation"]
    price_ups = [c for c in change_cards if c.get("change_type") == "price_increase"]
    affected = [f for f in code_impact if f.get("matched_change_ids")]
    totals = cost_impact.get("totals", {})
    a("## Executive summary\n")
    a(
        f"- **{len(change_cards)}** API changes detected "
        f"({len(deprecations)} deprecation(s), {len(price_ups)} price increase(s))."
    )
    a(f"- **{len(affected)}** code site(s) directly affected across the scanned codebase.")
    if call_records:
        records_with_research = sum(1 for r in call_records if r.get("external_research"))
        records_with_cost = sum(
            1 for r in call_records if r.get("estimated_cost_delta_usd") is not None
        )
        records_needing_verification = sum(
            1 for r in call_records if r.get("needs_external_verification")
        )
        a(
            f"- **{len(call_records)}** enriched API callsite record(s) prepared "
            f"({records_with_research} with external research, "
            f"{records_with_cost} with cost deltas, "
            f"{records_needing_verification} needing verification)."
        )
    if totals:
        a(
            f"- Projected monthly cost move: {_fmt_money(totals.get('old_cost_usd'))} → "
            f"{_fmt_money(totals.get('new_cost_usd'))} "
            f"(**{_fmt_money(totals.get('delta_usd'))}**"
            + (f", {totals['pct_change']}%" if totals.get("pct_change") is not None else "")
            + ")."
        )
    a("")

    # Change cards.
    a("## API change cards\n")
    if change_cards:
        a("| ID | Provider | Change | Target | Metric | Old → New | Shutdown | Replacement |")
        a("|----|----------|--------|--------|--------|-----------|----------|-------------|")
        for c in change_cards:
            a(
                f"| {c['change_id']} | {c['provider']} | {c['change_type']} | `{c['target']}` "
                f"| {c['metric']} | {c.get('old_value')} → {c.get('new_value')} "
                f"| {c.get('shutdown_date') or '—'} | {c.get('replacement') or '—'} |"
            )
    else:
        a("_No changes detected._")
    a("")

    # Code impact.
    a("## Code impact\n")
    if affected:
        a("| Severity | File:line | Model | Change(s) | Snippet |")
        a("|----------|-----------|-------|-----------|---------|")
        severity_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
        for f in sorted(affected, key=lambda x: severity_order.get(x.get("severity"), 4)):
            a(
                f"| {f.get('severity')} | `{f['file']}:{f['line']}` | `{f.get('model') or '—'}` "
                f"| {', '.join(f.get('matched_change_ids', [])) or '—'} | `{f['snippet']}` |"
            )
    else:
        a("_No affected code sites._")
    a("")

    # API callsite intelligence handoff.
    a("## API callsite intelligence\n")
    if call_records:
        a(
            "| Risk | Likelihood | Provider | Model | Feature | Owner | Location "
            "| Cost delta | Research | Verification gaps |"
        )
        a(
            "|------|------------|----------|-------|---------|-------|----------"
            "|------------|----------|-------------------|"
        )
        risk_order = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
        sorted_records = sorted(
            call_records,
            key=lambda r: risk_order.get(r.get("migration_risk"), 4),
        )
        for record in sorted_records[:20]:
            feature = record.get("feature") or {}
            research = record.get("external_research") or {}
            needs = record.get("needs_external_verification") or []
            research_status = research.get("model_status") or "unknown"
            a(
                f"| {record.get('migration_risk', 'unknown')} "
                f"| {record.get('call_likelihood', 'unknown')} "
                f"| {record.get('provider', 'unknown')} "
                f"| `{record.get('model_name', 'unknown')}` "
                f"| {feature.get('name') or 'unknown'} "
                f"| {feature.get('owner') or 'unknown'} "
                f"| `{record.get('code_location', 'unknown')}` "
                f"| {_fmt_money(record.get('estimated_cost_delta_usd'))} "
                f"| {research_status} "
                f"| {', '.join(needs) if needs else 'none'} |"
            )
        if len(call_records) > 20:
            a(f"\n_Showing top 20 of {len(call_records)} callsite records._")
    else:
        a("_No enriched API callsite handoff records supplied._")
    a("")

    # Handoff data contract statistics.
    a("## Handoff data contract\n")
    if handoff_stats:
        input_summary = handoff_stats.get("input_summary", {})
        output_summary = handoff_stats.get("output_summary", {})
        a("| Area | Count |")
        a("|------|------:|")
        a(f"| Input source groups | {input_summary.get('source_count', 0)} |")
        a(f"| Change cards | {input_summary.get('change_card_count', 0)} |")
        a(f"| Code findings | {input_summary.get('code_finding_count', 0)} |")
        a(f"| Cost rows | {input_summary.get('cost_row_count', 0)} |")
        a(
            "| External model research entries "
            f"| {input_summary.get('external_model_research_count', 0)} |"
        )
        a(f"| Output callsite records | {output_summary.get('record_count', 0)} |")
        a(f"| Output dimensions | {output_summary.get('dimension_count', 0)} |")
        a("")
        sources_map = input_summary.get("sources", {})
        if sources_map:
            a("### Handoff information sources\n")
            a("| Source group | File | Origin |")
            a("|--------------|------|--------|")
            for name, meta in sources_map.items():
                a(
                    f"| {name} | `{meta.get('file', 'unknown')}` "
                    f"| {meta.get('source', 'unknown')} |"
                )
            a("")
    else:
        a("_No handoff statistics supplied._")
    a("")

    # Bounded model-facing payload.
    a("## Bounded risk-planning inputs\n")
    if risk_inputs:
        a("| Area | Count |")
        a("|------|------:|")
        a(f"| Source callsite records | {risk_inputs.get('source_record_count', 0)} |")
        a(f"| Candidate records | {risk_inputs.get('candidate_record_count', 0)} |")
        a(f"| Selected records | {risk_inputs.get('selected_record_count', 0)} |")
        a(f"| Selection limit | {risk_inputs.get('selection_limit', 0)} |")
        a(f"| Omitted candidates | {risk_inputs.get('omitted_candidate_count', 0)} |")
        selected = risk_inputs.get("records", [])
        if selected:
            a("")
            a("| Risk | Provider | Model | Owner | Location | Verification gaps |")
            a("|------|----------|-------|-------|----------|-------------------|")
            for record in selected[:10]:
                feature = record.get("feature") or {}
                needs = record.get("needs_external_verification") or []
                a(
                    f"| {record.get('migration_risk', 'unknown')} "
                    f"| {record.get('provider', 'unknown')} "
                    f"| `{record.get('model_name', 'unknown')}` "
                    f"| {feature.get('owner') or 'unknown'} "
                    f"| `{record.get('code_location', 'unknown')}` "
                    f"| {', '.join(needs) if needs else 'none'} |"
                )
            if len(selected) > 10:
                a(f"\n_Showing top 10 of {len(selected)} risk-planning records._")
    else:
        a("_No bounded risk-planning payload supplied._")
    a("")

    # Cost impact.
    a("## Cost impact\n")
    by_feature = cost_impact.get("by_feature", {})
    if by_feature:
        a("| Feature | Old | New | Delta |")
        a("|---------|-----|-----|-------|")
        for feat, v in sorted(by_feature.items(), key=lambda kv: -(kv[1].get("delta_usd") or 0)):
            old, new, delta = (
                _fmt_money(v.get("old_cost_usd")),
                _fmt_money(v.get("new_cost_usd")),
                _fmt_money(v.get("delta_usd")),
            )
            a(f"| {feat} | {old} | {new} | {delta} |")
    else:
        a("_No cost data supplied._")
    a("")

    # Risk & action plan.
    a("## Risk & recommended actions\n")
    if risk_plan:
        for item in risk_plan:
            a(f"### [{item.get('severity', '?').upper()}] {item.get('title', 'action')}")
            if item.get("rationale"):
                a(f"{item['rationale']}")
            if item.get("recommended_action"):
                a(f"- **Recommended action:** {item['recommended_action']}")
            if item.get("evidence_ids"):
                a(f"- **Evidence:** {', '.join(item['evidence_ids'])}")
            a("")
        a(
            "> Actions above are **proposals only**. No code, PR, or ticket is created "
            "automatically — see `approval_log.md` for the human decision."
        )
    else:
        a("_No action plan generated yet._")
    a("")

    # Sources panel.
    a("## Sources\n")
    if sources:
        for s in sources:
            a(
                f"- **[{s['source_id']}]** {s.get('title', s.get('url', 'source'))} "
                f"— {s.get('source_type', 'unknown')} / {s.get('authority_tier', 'unknown')}"
                + (f" — retrieved {s['retrieved_at']}" if s.get("retrieved_at") else "")
                + (f"\n  {s['url']}" if s.get("url") else "")
            )
    else:
        a("_No source cards recorded._")
    a("")

    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--run-dir", type=Path, required=True)
    ap.add_argument("--run-id", default=None)
    ap.add_argument("--out", type=Path, default=None)
    ap.add_argument("--report-output", type=Path, default=None)
    ap.add_argument("--report-output-block", type=Path, default=None)
    args = ap.parse_args(argv)

    run_id = args.run_id or args.run_dir.name
    out = args.out or (args.run_dir / "report.md")
    md = render(args.run_dir, run_id)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(md, encoding="utf-8")
    report_output = build_report_output(args.run_dir, run_id)
    report_output_path = args.report_output or (args.run_dir / "report_output.json")
    report_output_block_path = args.report_output_block or (
        args.run_dir / "report_output.block.txt"
    )
    write_json(report_output_path, report_output)
    report_output_block_path.parent.mkdir(parents=True, exist_ok=True)
    report_output_block_path.write_text(
        report_output_block(report_output),
        encoding="utf-8",
    )
    print(f"wrote report -> {out}")
    print(f"wrote report output -> {report_output_path}")
    print(f"wrote report output block -> {report_output_block_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
