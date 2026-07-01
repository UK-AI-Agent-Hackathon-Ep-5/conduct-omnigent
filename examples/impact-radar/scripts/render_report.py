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
