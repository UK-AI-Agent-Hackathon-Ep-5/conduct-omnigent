# 📡 LLM Impact Radar

An Omnigent agent that turns an **external LLM API change** (pricing move,
deprecation, migration notice) into **internal product / cost / code impact** and
an **evidence-grounded, human-approved report**.

It is the sibling of [Polly](../polly/) (code) and [Scribe](../scribe/) (docs): a
multi-agent orchestrator whose intelligence lives in **prompt + skills +
sub-agents + built-in tools**, backed by a small **deterministic script layer** so
every number and citation is computed, not guessed.

> **Report-first, human-in-the-loop.** Radar produces a report + artifact
> directory and proposes actions. It **never** modifies product code, opens PRs,
> or creates tickets — approved actions are handed back to you to execute.

## Enforced human-in-the-loop

Beyond the report's soft approval loop, the orchestrator carries a **hard** gate
(`approve_repo_changes`, a CEL policy in `guardrails`): the runtime **pauses and
asks you** before any tool call that writes a file **outside `runs/`** (i.e.
touches your real codebase) or runs **`git push`**. Normal work — reading code,
running `python3 scripts/*`, writing artifacts under `runs/` — is never
interrupted, and the catastrophic set (force-push, `rm -rf /`, hard-reset) stays
denied outright by `blast_radius`. The gate is on the orchestrator only. The
sub-agents run headless (can't answer a prompt), so they stay read-only by prompt
+ `blast_radius`.

## What it does

```
official pricing / deprecation sources   (researcher sub-agent, live web + citations)
        └─► change cards        extract_change_cards.py
                └─► code impact  scan_code.py     (code-scanner sub-agent, read-only)
                └─► cost impact  cost_impact.py   (usage log × pricing)
                        └─► bounded risk inputs   prepare_risk_inputs.py
                                └─► risk & action plan
                                └─► report.md + approval_log.md
                                      (reviewer sub-agent fact-checks and you approve)
```

## Layout

```
config.yaml            orchestrator (codex harness)
agents/                researcher · code-scanner · reviewer  (sub-agents)
skills/                the phase playbooks (SKILL.md)
scripts/               deterministic backbone, run via the shell (stdlib-only)
data/                  demo inputs: pricing snapshots, usage_log.csv, feature_map.yaml, demo_codebase/
runs/                  per-run artifacts (gitignored): runs/<run_id>/*.json + report.md + approval_log.md
```

## Deep research (the `researcher` sub-agent)

The researcher runs a bounded **deep-research loop** inspired by
[gpt-researcher](https://github.com/assafelovic/gpt-researcher) — *plan queries →
search → deepen on gaps* — but adapted to our domain: it curates sources by
**authority** (is this the official page?) instead of by breadth (how many pages
agree). The loop and its scoring are deterministic bundle scripts. No external
research engine is required.

```
plan_queries.py     provider × facets → query_plan.json   (breadth=4 per facet)
     └─► search      scripts/adapters/search.py (Tavily REST)  ·  fallback fetch.py on seed pages
          └─► score_sources.py   authority score 0–100 → conclusion / support / appendix
               └─► extract       evidence_cards.json (official quotes) + unresolved.json
                    └─► deepen    re-plan from unresolved gaps, up to depth=2
                         └─► research_context.json  (per-facet coverage for the orchestrator)
```

- **Facets:** pricing, changelog, deprecation, migration, rate_limits, model_release.
- **Knobs:** `breadth` (queries/facet, default 4), `depth` (levels, default 2),
  `official_only` (default true). Only `conclusion`-tier (official) sources may back
  a hard pricing/deprecation claim.
- **Knowledge base:** [data/provider_registry.json](data/provider_registry.json) —
  official domains, per-facet seed pages, and keywords per provider.

## Setup

Runs on the **Codex** harness with no pinned model or provider. It uses the
Codex/OpenAI provider configured for this deployment, so the bundle does not
require any named gateway provider or provider-specific API key.

Use `--harness` or `--model` when running locally if you want a different
execution surface or model for a specific run.

For **live web research**, put a Tavily key in the bundle's gitignored `.env`
(`TAVILY_API_KEY=tvly-...`). The researcher searches via
`scripts/adapters/search.py` (Tavily REST), which reads the key from `.env` or
the environment — so it works in normal server/daemon mode, unlike an MCP server
whose subprocess never receives the key. Without a key it falls back to
`scripts/adapters/fetch.py` on the registry's official seed URLs.

## Run

```bash
omnigent run examples/impact-radar \
  -p "Analyze OpenAI + Gemini pricing and deprecation changes and their impact on ./examples/impact-radar/data/demo_codebase"
```

The result is `examples/impact-radar/runs/<run_id>/report.md` plus the JSON
artifacts and `approval_log.md`.

## Try the deterministic core with no LLM and no keys

The script layer is the source of truth for the numbers and runs on its own:

```bash
cd examples/impact-radar
RUN=runs/manual
mkdir -p $RUN
python3 scripts/extract_change_cards.py --pricing-dir data/pricing --out $RUN/change_cards.json
python3 scripts/scan_code.py --repo data/demo_codebase --change-cards $RUN/change_cards.json --out $RUN/code_impact.json
python3 scripts/cost_impact.py --usage data/usage_log.csv --pricing-dir data/pricing --out $RUN/cost_impact.json
python3 scripts/export_handoff_records.py --code $RUN/code_impact.json --feature-map data/feature_map.yaml --cost $RUN/cost_impact.json --external-research data/external_research.example.json --repo data/demo_codebase --out $RUN/api_call_records.json
python3 scripts/summarize_handoff_stats.py --api-call-records $RUN/api_call_records.json --change-cards $RUN/change_cards.json --code-impact $RUN/code_impact.json --cost-impact $RUN/cost_impact.json --external-research data/external_research.example.json --out $RUN/handoff_stats.json
python3 scripts/prepare_risk_inputs.py --api-call-records $RUN/api_call_records.json --handoff-stats $RUN/handoff_stats.json --out $RUN/risk_inputs.json
python3 scripts/render_report.py --run-dir $RUN
```

With the bundled demo data this reports a `gpt-3.5-turbo` (used in
`app/summarizer/legacy.py`) and `gemini-1.5-pro` (used in `app/docs/analyze.py`)
deprecation, a `gpt-4o` price increase, and a **+$120/mo** cost delta driven by
the chat assistant.

## Optional tools (all degrade gracefully)

| Capability | Preferred | Fallback |
|---|---|---|
| Web research | `scripts/adapters/search.py` (Tavily REST) | `scripts/adapters/fetch.py` (urllib) |
| Code scan | semgrep / ast-grep | regex scanner in `scan_code.py` |
| Cost math | pandas | stdlib `csv` |
| Report | jinja2 | stdlib string templating |
| Pricing schema | LiteLLM cost map | local `data/pricing/*.json` |

Nothing in the bundle hard-depends on these — the demo runs with only Python's
standard library.
