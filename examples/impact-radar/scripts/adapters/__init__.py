"""Optional-integration adapters, each with a deterministic local fallback.

Nothing in the bundle hard-depends on these third-party tools; when they are
absent the adapter degrades to a stdlib implementation so the workflow still
runs (per the product brief):

- fetch.py         Firecrawl / Crawl4AI-style scrape -> falls back to urllib.
- (semgrep / ast-grep are handled inline in ../scan_code.py via shutil.which)
- LiteLLM pricing: the JSON snapshots under data/pricing/ follow a LiteLLM-like
  schema; a real deployment can regenerate them from LiteLLM's model cost map,
  but the bundle never imports litellm.
"""
