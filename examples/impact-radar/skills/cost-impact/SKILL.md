---
name: cost-impact
description: Compute the USD cost delta of a pricing change against an internal usage log, broken down by feature and model. Use when the change involves price movements.
---

# Cost impact

Quantify what a pricing change costs (or saves) using the internal usage log.
Compute this **with the script** — do not estimate token costs in your head.

## Procedure

1. Confirm `$OMNIGENT_AGENT_BUNDLE_DIR/data/usage_log.csv` exists with columns:
   `date,provider,model,feature,input_tokens,output_tokens,requests`.
2. Run the calculator:
   ```
   python3 "$OMNIGENT_AGENT_BUNDLE_DIR/scripts/cost_impact.py" \
     --usage "$OMNIGENT_AGENT_BUNDLE_DIR/data/usage_log.csv" \
     --pricing-dir "$OMNIGENT_AGENT_BUNDLE_DIR/data/pricing" \
     --out runs/<run_id>/cost_impact.json
   ```
3. Read `cost_impact.json`: `rows` (per usage line), `by_feature`, `by_model`,
   and `totals` (old → new USD, delta, pct_change).

## Rules

- The script owns every number. In the report, quote its `totals` and
  `by_feature` figures verbatim. Never round them into new invented values.
- A model missing from a snapshot yields a `null` cost for that side — call that
  out rather than treating it as `$0` of real spend.
- Lead the cost section with the features whose `delta_usd` is largest.
