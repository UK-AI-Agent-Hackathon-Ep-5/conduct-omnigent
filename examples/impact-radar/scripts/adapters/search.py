#!/usr/bin/env python3
"""Live web search via Tavily's REST API — the researcher's real-research path.

Why a script instead of the Tavily MCP server: an MCP subprocess only gets a
restricted env allowlist and a detached omnigent daemon does not inherit the
shell's exported vars, so the MCP server never receives TAVILY_API_KEY. This
script reads the key directly — from the environment, or from the bundle's
gitignored `.env` — so it works in every run mode and keeps the key out of git.

Returns JSON: {"query", "results": [{title, url, content, score, raw_content?}]}.
Exits 0 with an empty result list (and a note on stderr) when no key is
configured, so the researcher can fall back to fetch.py without the run failing.

Usage:
    python3 search.py "OpenAI API pricing per 1M tokens" \
        --domains platform.openai.com,openai.com --max 5 --raw
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

_TAVILY_URL = "https://api.tavily.com/search"
# scripts/adapters/search.py -> bundle root is two parents up.
_BUNDLE_ROOT = Path(__file__).resolve().parents[2]


def _read_key() -> str | None:
    import os

    key = os.environ.get("TAVILY_API_KEY")
    if key:
        return key.strip()
    # Fall back to the bundle's gitignored .env (KEY=VALUE lines).
    env_file = _BUNDLE_ROOT / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("TAVILY_API_KEY="):
                val = line.split("=", 1)[1].strip().strip("'\"")
                if val and not val.endswith("replace-me"):
                    return val
    return None


def search(
    query: str,
    domains: list[str] | None = None,
    max_results: int = 5,
    raw: bool = False,
    depth: str = "basic",
) -> dict:
    key = _read_key()
    if not key:
        print("no TAVILY_API_KEY (env or .env); returning empty results", file=sys.stderr)
        return {"query": query, "results": [], "error": "no_api_key"}

    body: dict = {"query": query, "search_depth": depth, "max_results": max_results}
    if domains:
        body["include_domains"] = domains
    if raw:
        body["include_raw_content"] = "text"

    req = urllib.request.Request(
        _TAVILY_URL,
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=40) as resp:
            data = json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        return {"query": query, "results": [], "error": f"http_{exc.code}: {exc.reason}"}
    except Exception as exc:  # noqa: BLE001 — best-effort adapter
        return {"query": query, "results": [], "error": str(exc)}

    # Trim to the fields the researcher needs.
    results = [
        {
            "title": r.get("title"),
            "url": r.get("url"),
            "content": r.get("content"),
            "score": r.get("score"),
            **({"raw_content": r.get("raw_content")} if raw else {}),
        }
        for r in data.get("results", [])
    ]
    return {"query": query, "results": results}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("query")
    ap.add_argument("--domains", default="", help="comma-separated include_domains")
    ap.add_argument("--max", type=int, default=5, dest="max_results")
    ap.add_argument("--raw", action="store_true", help="include raw page text")
    ap.add_argument(
        "--depth", default="basic", choices=["basic", "fast", "advanced", "ultra-fast"]
    )
    args = ap.parse_args(argv)

    domains = [d.strip() for d in args.domains.split(",") if d.strip()]
    out = search(args.query, domains or None, args.max_results, args.raw, args.depth)
    print(json.dumps(out, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
