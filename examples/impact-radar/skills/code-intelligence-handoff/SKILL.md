---
name: code-intelligence-handoff
description: Convert Impact Radar code and cost artifacts into compact per-callsite JSON records for downstream migration, pricing, owner-routing, or recommendation agents. Use when another step needs one JSON object per LLM API/model usage site.
---

# Code Intelligence Handoff

Produce a machine-readable handoff contract from the scan results. This skill is
the bridge between the report-oriented Impact Radar flow and a downstream agent
that needs concise API usage metadata.

## Inputs

- `runs/<run_id>/code_impact.json` from `code-impact-scan`.
- `examples/impact-radar/data/feature_map.yaml` for owner, feature, and tier mapping.
- Optional `runs/<run_id>/cost_impact.json` from `cost-impact`.
- Optional `external_research.json` from an upstream research agent, using `examples/impact-radar/data/external_research.example.json` as the contract example.

## Procedure

1. Run `api-change-extraction`, `code-impact-scan`, and optionally `cost-impact` first.
2. Export the handoff records:
   ```
   python3 examples/impact-radar/scripts/export_handoff_records.py \
     --code runs/<run_id>/code_impact.json \
     --feature-map examples/impact-radar/data/feature_map.yaml \
     --cost runs/<run_id>/cost_impact.json \
     --external-research examples/impact-radar/data/external_research.example.json \
     --repo <scanned-codebase-label> \
     --out runs/<run_id>/api_call_records.json
   ```
3. Read `api_call_records.json` and pass its `records` array to the next step.

## Output Contract

The output is a JSON object with:

- `schema_version`: contract version, currently `0.1`.
- `artifact_type`: `api_callsite_handoff_records`.
- `record_count`: number of findings exported.
- `records`: one object per API/model usage site.

Each record contains model/provider identity, calling method, responsible work,
code location, owner/tier mapping, likelihood/risk labels and scores, matched
API change IDs, copied cost delta when available, external research facts when
available, verification gaps, handoff target metadata, and the source code
snippet used as evidence.

## Compatibility Notes

- This does not replace `code_impact.json`; it adapts it for downstream agents.
- Scores are deterministic heuristics, not measured runtime probabilities.
- Cost fields are copied from `cost_impact.json`; missing cost means usage or
  pricing data must be supplied by another verification/search step.
- External research fields are copied from `external_research.json`; missing
  research means the upstream research agent did not provide model facts for the
  matched provider/model pair.
- `needs_external_verification` marks data that should be resolved before final
  migration recommendations are treated as reliable.

## Rules

- Never modify scanned product code.
- Never invent cost numbers; copy from `cost_impact.json` or leave `null`.
- Never invent model status, compatibility, or replacement facts; copy them from
  `external_research.json` or leave the external research payload `null`.
- Preserve file paths and line numbers exactly from `code_impact.json`.
