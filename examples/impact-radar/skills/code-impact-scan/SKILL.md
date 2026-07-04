---
name: code-impact-scan
description: Scan a local codebase for LLM API/model usage and map each site to the change cards that affect it. Use to find where a pricing/deprecation change lands in code.
---

# Code impact scan

Find every place the target codebase touches an LLM API or pins a model, and map
those sites to the change cards. This is **read-only** — you analyze the code,
you never modify it.

## Procedure

1. Make sure `change_cards.json` exists (run api-change-extraction first).
2. Run the scanner:
   ```
   python3 "$OMNIGENT_AGENT_BUNDLE_DIR/scripts/scan_code.py" \
     --repo <path-to-target-codebase> \
     --change-cards runs/<run_id>/change_cards.json \
     --out runs/<run_id>/code_impact.json
   ```
   The scanner prefers semgrep / ast-grep when installed and otherwise uses a
   regex fallback. The output shape is identical.
3. Read `code_impact.json`. Each finding has `file`, `line`, `snippet`,
   `category` (`import`|`client_call`|`model_literal`), `provider`, `model`,
   `matched_change_ids`, and a `severity` hint (`high` for a used deprecated
   model, `medium` for a price increase, else `low`/`info`).
4. Cross-reference `$OMNIGENT_AGENT_BUNDLE_DIR/data/feature_map.yaml` to
   translate affected files into the owning feature and team, so the report
   speaks in product terms.

## Rules

- Never edit, refactor, or "fix" the scanned code. Never open a PR or create a
  ticket. Findings and recommendations only.
- Keep scans focused on source code. The scanner skips common generated/vendor
  paths and caps evidence snippets by default. Use `--exclude-dir`,
  `--exclude-path`, `--max-file-bytes`, or `--max-snippet-chars` only when the
  target repository needs tighter bounds.
- Treat a `high` finding (deprecated model in use) as an action item with a
  deadline = the change card's `shutdown_date`.
- The scanner can match a model name inside a comment. Keep those but mark them
  lower priority than a real `model_literal` assignment or `client_call`.
