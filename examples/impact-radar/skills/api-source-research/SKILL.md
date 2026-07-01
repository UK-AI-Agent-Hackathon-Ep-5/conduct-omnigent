---
name: api-source-research
description: Deep-research loop for official LLM provider API pricing, changelog, and deprecation facts. Plans queries, searches, scores sources by authority, extracts cited evidence, and deepens on unresolved gaps. Use when you need current, authoritative pricing/deprecation facts.
---

# API source research (deep-research loop)

Domain-specific deep research for LLM API changes. Borrows gpt-researcher's
**plan → search → deepen** loop, but curates by **authority** (is this the official
page?) rather than by breadth. The goal is the authoritative official source for
each fact, plus a verifiable evidence trail — not many pages.

## Knobs (defaults)

- `breadth = 4` — queries generated per facet per level.
- `depth = 2` — how many recursive levels (level 0 + up to `depth-1` deepenings).
- `official_only = true` — scope searches to official domains.

Facets: `pricing`, `changelog`, `deprecation`, `migration`, `rate_limits`,
`model_release`.

## Loop

Work inside the run directory you were given (`runs/<run_id>/`). Let `L` = 0.

1. **Plan (level L).**
   ```
   python3 examples/impact-radar/scripts/plan_queries.py \
     --provider <provider> --facets all \
     --registry examples/impact-radar/data/provider_registry.json \
     --breadth 4 --depth-level 0 --out runs/<run_id>/query_plan.json
   ```
2. **Search** each query with the live web-search adapter (Tavily REST):
   ```
   python3 examples/impact-radar/scripts/adapters/search.py "<query>" \
     --domains <comma-separated official domains> --max 5 --raw
   ```
   It reads `TAVILY_API_KEY` from the environment or the bundle's gitignored
   `.env`. If it returns `"error": "no_api_key"` or empty `results`, fall back to
   fetching the registry's `seed_pages` directly:
   `python3 examples/impact-radar/scripts/adapters/fetch.py <url>`.
   Turn hits into candidate `source_cards.json` (one card per page: `source_id`,
   `provider`, `url`, `title`, `source_type`, `retrieved_at`, and a
   `content_hash` from the returned text). Use the **real URLs search returned** —
   never invent them.
3. **Curate by authority.**
   ```
   python3 examples/impact-radar/scripts/score_sources.py \
     --sources runs/<run_id>/source_cards.json \
     --registry examples/impact-radar/data/provider_registry.json \
     --out runs/<run_id>/source_cards.json
   ```
   The script adds `score` + `usable_for` (`conclusion` ≥80 / `support` 60–79 /
   `appendix` <60). Only `conclusion`-tier (official) sources may back hard facts.
4. **Extract evidence.** Scrape the top `conclusion` sources and write
   `evidence_cards.json` — short direct quotes tied to a `source_id` with
   `claim_type` (`pricing`|`deprecation`|`migration`|`rate_limit`|`model_release`),
   `subject`, `quote`, `url`, `confidence`. Record every fact you still could NOT
   confirm from an official source in `unresolved.json` as
   `{provider, facet, subject}`.
5. **Deepen.** If `unresolved.json` is non-empty and `L+1 < depth`, plan targeted
   follow-ups and repeat 2–4:
   ```
   python3 examples/impact-radar/scripts/plan_queries.py \
     --provider <provider> --gaps runs/<run_id>/unresolved.json \
     --registry examples/impact-radar/data/provider_registry.json \
     --depth-level 1 --out runs/<run_id>/query_plan_l1.json
   ```
   Increment `L`. Stop when there are no gaps or you hit `depth`.
6. **Aggregate.** Write `research_context.json`: per-facet coverage
   (`resolved` / `unresolved`), the source_ids used, and a short learnings summary
   for the orchestrator.

## Rules

- Official docs are required for hard pricing/deprecation facts; `support`/
  `appendix` (third-party) sources are context only, never the basis of a price or
  shutdown claim.
- Never assert a price, date, or deprecation without a backing `evidence_id`.
- Do not invent URLs or cite a source not in `source_cards.json`. Leave genuine
  gaps in `unresolved.json` rather than guessing.
- You are READ-ONLY and stay inside the run directory.
