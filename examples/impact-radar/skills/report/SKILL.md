---
name: report
description: Assemble the final enterprise Markdown report from the artifacts and run the human approval loop, recording decisions to the approval log. Use as the last step.
---

# Report & approval

Produce the final enterprise-readable report and get human sign-off on the
proposed actions. The deliverable is the **report + artifact directory**, not
chat text.

## Procedure

1. Make sure the run directory has: `change_cards.json`, `code_impact.json`,
   `cost_impact.json`, `source_cards.json`, `risk_action_plan.json`.
2. Render the report scaffold (numbers + Sources panel come from the artifacts):
   ```
   python3 examples/impact-radar/scripts/render_report.py --run-dir runs/<run_id>
   ```
3. Enrich the prose in `runs/<run_id>/report.md` if useful, keeping every number
   and `[S#]` citation exactly as rendered.
4. Validate citations (must exit 0) — see the evidence-citation skill.
5. **Approval loop.** Present the risk/action plan to the human and ask them to
   APPROVE or REJECT each proposed action. Record the outcome in
   `runs/<run_id>/approval_log.md`:
   ```
   - <timestamp> — <action title> — APPROVED|REJECTED by <user> — <note>
   ```
6. Optionally call the `upload_file` tool on `report.md` so it is downloadable
   from the web UI.

## Rules

- Report-first: lead with an executive summary (change counts, total cost delta,
  count of affected code sites), then details.
- The report proposes actions; approvals are the human's. Never auto-apply an
  action, edit the scanned code, open a PR, or create a ticket — even after
  approval, hand the approved action back to the human to execute.
- All run artifacts live under `runs/<run_id>/`; never write outside it.
