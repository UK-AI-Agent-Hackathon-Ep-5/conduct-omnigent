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
from pathlib import Path

from schema import load_json


def _load(run_dir: Path, name: str, default):
    p = run_dir / name
    return load_json(p) if p.exists() else default


def _fmt_money(v) -> str:
    return f"${v:,.2f}" if isinstance(v, (int, float)) else "unknown"


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
        for f in sorted(
            affected, key=lambda x: {"high": 0, "medium": 1, "low": 2}.get(x.get("severity"), 3)
        ):
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
        risk_order = {"high": 0, "medium": 1, "low": 2, "info": 3}
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
    args = ap.parse_args(argv)

    run_id = args.run_id or args.run_dir.name
    out = args.out or (args.run_dir / "report.md")
    md = render(args.run_dir, run_id)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(md, encoding="utf-8")
    print(f"wrote report -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
