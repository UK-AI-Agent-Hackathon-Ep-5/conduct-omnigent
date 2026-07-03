---
name: report
description: Assemble the final enterprise Markdown report from the artifacts and run the human approval loop, recording decisions to the approval log. Use as the last step.
---

# Report & Approval

Produce the final enterprise-readable report and get human sign-off on the
proposed actions. The deliverable is the report plus artifact directory, not
chat text.

Treat `api_call_records.json` and `handoff_stats.json` as the advisor handoff
payload for callsite intelligence, model-provider research, token-pricing
research, verification gaps, and report-generation statistics.

## Procedure

1. Make sure the run directory has:
   - `change_cards.json`
   - `code_impact.json`
   - `cost_impact.json`
   - `api_call_records.json`
   - `handoff_stats.json`
   - `source_cards.json` if live research was used
   - `risk_action_plan.json`
2. Render the report scaffold. Numbers, handoff statistics, and Sources panel
   come from artifacts:
   ```
   python3 examples/impact-radar/scripts/render_report.py --run-dir runs/<run_id>
   ```
3. Enrich the prose in `runs/<run_id>/report.md` if useful, keeping every number
   and citation exactly as rendered.
4. Validate citations with the `evidence-citation` skill.
5. Run the approval loop. Present the risk/action plan to the human and ask them
   to approve or reject each proposed action. Record the outcome in
   `runs/<run_id>/approval_log.md`.
6. Optionally call the `upload_file` tool on `report.md` so it is downloadable
   from the web UI.

## Required Report Sections

- Executive summary.
- API change cards.
- Code impact.
- API callsite intelligence from `api_call_records.json`.
- Handoff data contract from `handoff_stats.json`.
- Cost impact.
- Risk and recommended actions.
- Sources.
- Approval log.

## Rules

- Include model provider, token price research, owner, risk score, cost delta,
  and verification gaps from `api_call_records.json`.
- Report-first: lead with change counts, total cost delta, affected code sites,
  and enriched callsite record counts.
- The report proposes actions; approvals are the human's. Never auto-apply an
  action, edit scanned code, open a PR, or create a ticket.
- All run artifacts live under `runs/<run_id>/`; never write outside it.
