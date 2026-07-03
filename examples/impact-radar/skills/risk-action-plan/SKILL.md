---
name: risk-action-plan
description: Turn change cards, code impact, cost impact, and advisor handoff records into a prioritized, non-executing risk and action plan. Use after analysis, before writing the report.
---

# Risk & Action Plan

Synthesize the analysis into a prioritized list of risks and proposed actions.
Use the enriched advisor handoff payload as the main bridge between code-level
findings, external model-provider research, token-pricing research, cost impact,
and report generation. You propose; a human approves. You never execute actions.

## Severity Model

- **high**: a deprecated model is used in a production-tier feature, a shutdown
  deadline is near, or a callsite has high `migration_risk` and high `risk_score`.
- **medium**: a price increase affects a high-volume feature, a replacement needs
  compatibility review, or verification gaps remain for important code paths.
- **low**: small cost movements, new-model opportunities, or informational
  context.

## Procedure

1. Join these artifacts:
   - `change_cards.json`
   - `code_impact.json`
   - `cost_impact.json`
   - `api_call_records.json`
   - `handoff_stats.json`
   - `feature_map.yaml`
2. For each affected feature or callsite, note the provider/model change, code
   location, owner, monthly cost delta, external research status, compatibility,
   replacement candidates, verification gaps, and deadline.
3. Write `runs/<run_id>/risk_action_plan.json` as a JSON list of items:
   `severity`, `title`, `rationale`, `recommended_action`, `owner`, `deadline`,
   `affected_files`, `evidence_ids`.
4. Order by severity, then by `risk_score`, then by `delta_usd`.

## Rules

- Recommended actions are advisory text only; do not edit code, open PRs, or
  create tickets.
- Every action item needs evidence IDs, including change IDs, code finding IDs,
  API callsite record IDs, and source IDs when available.
- Prioritize records with high `migration_risk`, high `risk_score`, missing
  external research, missing cost deltas, or non-empty
  `needs_external_verification`.
- Attach a deadline to every deprecation item from the matching change card.
