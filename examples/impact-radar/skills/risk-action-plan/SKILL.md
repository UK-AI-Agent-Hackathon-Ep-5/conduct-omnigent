---
name: risk-action-plan
description: Turn change cards + code impact + cost impact into a prioritized, non-executing risk and action plan. Use after analysis, before writing the report.
---

# Risk & action plan

Synthesize the analysis into a prioritized list of risks and **proposed** actions.
You propose; a human approves. You never execute the actions.

## Severity model

- **high** — a deprecated model is used in a `production`-tier feature (per
  `feature_map.yaml`), or the deadline (`shutdown_date`) is within ~90 days.
- **medium** — a price increase on a high-volume feature (large `delta_usd`), or
  a deprecated model in a non-production tier.
- **low** — small cost movements, new-model opportunities, informational context.

## Procedure

1. Join `change_cards.json` × `code_impact.json` × `cost_impact.json` ×
   `feature_map.yaml`: for each affected feature, note the change, the code sites,
   the $ delta, the owning team, and the deadline.
2. Write `runs/<run_id>/risk_action_plan.json` — a JSON list of items:
   `severity`, `title`, `rationale`, `recommended_action`, `owner`,
   `deadline`, `affected_files`, `evidence_ids`.
3. Order by severity, then by `delta_usd`.

## Rules

- Recommended actions are advisory text only: e.g. "repoint MODEL in
  `app/summarizer/legacy.py` from gpt-3.5-turbo to gpt-4o-mini and re-test."
  **Do not** edit code, open PRs, or create tickets.
- Every high/medium item must carry `evidence_ids` linking to the source cards.
- Attach a deadline to every deprecation item (= the card's `shutdown_date`).
