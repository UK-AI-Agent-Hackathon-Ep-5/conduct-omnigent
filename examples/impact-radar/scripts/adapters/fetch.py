#!/usr/bin/env python3
"""Fetch a URL as text/markdown, preferring Firecrawl, falling back to urllib.

Used by the researcher when the Tavily/Firecrawl MCP tools are unavailable, so
live research still works with only the stdlib. Never raises on a fetch error —
returns a short error string the caller can record instead.

Usage:
    python -m adapters.fetch https://platform.openai.com/docs/pricing
"""

from __future__ import annotations

import os
import re
import sys
import urllib.request

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\n\s*\n\s*\n+")


def _via_firecrawl(url: str) -> str | None:
    key = os.environ.get("FIRECRAWL_API_KEY")
    if not key:
        return None
    try:
        import json

        req = urllib.request.Request(
            "https://api.firecrawl.dev/v1/scrape",
            data=json.dumps({"url": url, "formats": ["markdown"]}).encode(),
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
        return data.get("data", {}).get("markdown")
    except Exception:  # noqa: BLE001 — best-effort adapter, fall through to urllib
        return None


def _via_urllib(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "impact-radar/0.1"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        html = resp.read().decode("utf-8", errors="replace")
    text = _TAG_RE.sub("", html)
    return _WS_RE.sub("\n\n", text).strip()


def fetch(url: str) -> str:
    try:
        md = _via_firecrawl(url)
        if md:
            return md
        return _via_urllib(url)
    except Exception as exc:  # noqa: BLE001
        return f"[fetch error for {url}: {exc}]"


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    if not args:
        print("usage: python -m adapters.fetch <url>", file=sys.stderr)
        return 2
    print(fetch(args[0]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
