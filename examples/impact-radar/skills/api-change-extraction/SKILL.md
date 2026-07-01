---
name: api-change-extraction
description: Turn old vs new pricing snapshots into normalized change cards using the deterministic extractor. Use after you have both snapshots on disk.
---

# API change extraction

Convert two pricing snapshots into normalized **change cards**. Do the diffing
**deterministically with the script** — never eyeball the numbers.

## Procedure

1. Ensure old and new snapshots exist under `data/pricing/` as
   `<provider>.old.json` / `<provider>.new.json` (LiteLLM-like schema: a
   `models` map with `input_cost_per_1m`, `output_cost_per_1m`,
   `cached_input_cost_per_1m`, `context_window`, `status`, and — when deprecated
   — `shutdown_date` / `replacement`).
   - If research produced fresh numbers, write them into a new snapshot file
     first, then diff. Keep the snapshot next to its evidence card.
2. Run the extractor into the run directory:
   ```
   python3 examples/impact-radar/scripts/extract_change_cards.py \
     --pricing-dir data/pricing --out runs/<run_id>/change_cards.json
   ```
   (or `--old <file> --new <file>` for a single pair.)
3. Read `change_cards.json`. Each card has `change_id`, `change_type`
   (`price_increase`|`price_decrease`|`deprecation`|`new_model`|`context_window_change`),
   `target`, `metric`, `old_value`/`new_value`, `shutdown_date`, `replacement`.

## Rules

- The script is the source of truth for what changed and by how much.
- Unknown fields stay `unknown`; a `replacement` is only trusted when the
  snapshot states it. Do not infer replacements.
- Tie each pricing/deprecation card back to an `evidence_id` from research when
  you write the report.
