---
name: report
description: Assemble the final enterprise Markdown report and UI-renderable report output from the artifacts, then run the human approval loop and record decisions to the approval log. Use as the last step.
---

# Report & Approval

Produce the final enterprise-readable report, a UI-renderable report output
payload, and get human sign-off on the proposed actions. The deliverable is the
report plus artifact directory. When posting the report in chat, use the
generated `REPORT_OUTPUT` block.

The final chat response is part of the product surface. It must render as the
report preview. A status sentence such as "Rendered the report" is not a valid
final response for this skill.

Treat `api_call_records.json` as a full audit artifact consumed by
`render_report.py`, not as model context. Treat `risk_inputs.json` and
`handoff_stats.json` as the bounded model-facing payloads for callsite
intelligence, model-provider research, token-pricing research, verification
gaps, and report-generation statistics.

## Procedure

1. Make sure the run directory has:
   - `change_cards.json`
   - `code_impact.json`
   - `cost_impact.json`
   - `api_call_records.json`
   - `handoff_stats.json`
   - `risk_inputs.json`
   - `source_cards.json` if live research was used
   - `risk_action_plan.json`
2. Render the Markdown report and the UI report output payload. Numbers, handoff
   statistics, and Sources panel come from artifacts:
   ```
   BUNDLE="${OMNIGENT_AGENT_BUNDLE_DIR:-}"
   if [ -z "$BUNDLE" ] || [ ! -f "$BUNDLE/scripts/render_report.py" ]; then
     if [ -f "scripts/render_report.py" ] && [ -f "config.yaml" ]; then
       BUNDLE="$PWD"
     else
       echo "Cannot find Impact Radar bundle. OMNIGENT_AGENT_BUNDLE_DIR is not set and ./scripts/render_report.py is not available." >&2
       exit 1
     fi
   fi
   python3 "$BUNDLE/scripts/render_report.py" --run-dir runs/<run_id>
   ```
   This writes:
   - `runs/<run_id>/report.md`
   - `runs/<run_id>/report_output.json`
   - `runs/<run_id>/report_output.block.txt`
3. Enrich the prose in `runs/<run_id>/report.md` if useful, keeping every number
   and citation exactly as rendered. Do not hand-edit `report_output.json` unless
   you can keep it valid against the UI report schema.
4. Validate citations with the `evidence-citation` skill.
5. Run the approval loop. Present the risk/action plan to the human and ask them
   to approve or reject each proposed action. Record the outcome in
   `runs/<run_id>/approval_log.md`.
6. Optionally call the `upload_file` tool on `report.md` and
   `report_output.json` so they are downloadable from the web UI.
7. Read `runs/<run_id>/report_output.block.txt`.
8. Final response: paste the exact contents of
   `runs/<run_id>/report_output.block.txt`. Do not summarize it, do not replace
   it with an artifact path, and do not say it is too large for chat. The web UI
   only renders the report when the marker block is present in the chat message.
   Do not wrap it in a Markdown code fence. Do not put `REPORT_OUTPUT` and the
   JSON object on the same line.

## Required Report Sections

- Executive summary.
- API change cards.
- Code impact.
- API callsite intelligence from `api_call_records.json`.
- Handoff data contract from `handoff_stats.json`.
- Bounded risk-planning inputs from `risk_inputs.json`.
- Cost impact.
- Risk and recommended actions.
- Sources.
- Approval log.

## UI Report Output Contract

The chat-rendered report must use this exact shape:

```
REPORT_OUTPUT
{...valid report JSON...}
END_REPORT_OUTPUT
```

The JSON must contain `report_version`, `run_id`, `generated_at`, `title`,
`providers`, and a non-empty `sections` array. Every section must contain `id`,
`type`, `title`, `content`, `severity`, and `data`. Valid severities are
`critical`, `high`, `medium`, `low`, and `info`.

## Final Response Contract

The final assistant message for this skill must begin with:

```
REPORT_OUTPUT
```

and end with:

```
END_REPORT_OUTPUT
```

No text may appear before `REPORT_OUTPUT`. No status sentence may replace the
block. Artifact paths are useful secondary evidence, but they do not render the
report preview and must not be used as the final answer.

## Rules

- Include model provider, token price research, owner, risk score, cost delta,
  and verification gaps from the rendered report and `risk_inputs.json`.
- Do not paste the full `api_call_records.json` into the model context. Let
  `render_report.py` read it deterministically.
- Report-first: lead with change counts, total cost delta, affected code sites,
  and enriched callsite record counts.
- Never improvise the UI JSON in the final answer. Use the generated
  `report_output.block.txt`.
- Never finish with only "Rendered", "validated", "uploaded", or an artifact
  path. If `report_output.block.txt` exists, the final answer is its full
  contents.
- The report proposes actions. Approvals are the human's. Never auto-apply an
  action, edit scanned code, open a PR, or create a ticket.
- All run artifacts live under `runs/<run_id>/`. Never write outside it.
