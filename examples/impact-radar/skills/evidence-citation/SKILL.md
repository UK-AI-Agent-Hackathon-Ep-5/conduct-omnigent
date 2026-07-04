---
name: evidence-citation
description: Attach claim-level [S#] citations to every hard fact and validate them against the source cards before finalizing. Use before producing any final report or answer.
---

# Evidence citation

Every pricing / deprecation / migration fact in the final report must trace to an
official source. Citations are **rendered from source cards, not invented** by
you.

## Procedure

1. For each hard claim, attach the `source_id`(s) of the evidence that supports
   it, written inline as `[S1]`, `[S2]`.
2. Keep the `source_cards.json` list current — the report's Sources panel is
   generated from it (`render_report.py` reads it).
3. Before finalizing, run the validator (it gates the report):
   ```
   python3 "$OMNIGENT_AGENT_BUNDLE_DIR/scripts/validate_citations.py" \
     --report runs/<run_id>/report.md \
     --sources runs/<run_id>/source_cards.json
   ```
   Fix every ERROR (a `[S#]` with no matching source card, an untrusted source
   backing a hard claim, or a source with no URL) until it exits 0.

## Rules

- Executive-summary facts and any price/date/deprecation claim **require** a
  `[S#]`.
- Official docs only for hard facts. Third-party sources are context, never the
  basis of a price or shutdown claim.
- Never invent a URL and never cite a `source_id` that is not in
  `source_cards.json`. If there is no evidence, write "no official source found"
  instead of guessing.
