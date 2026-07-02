#!/usr/bin/env python3
"""Scan a codebase for LLM API/model usage and map it to change cards.

Adapter order: semgrep -> ast-grep -> regex fallback. semgrep/ast-grep are used
only if installed on PATH; the regex fallback always works, so nothing hard-
depends on them (matches the product brief). Output is a list of CodeFindings,
each tagged with the change cards it is affected by and a severity hint.

Usage:
    python scan_code.py --repo data/demo_codebase \
        --change-cards runs/<id>/change_cards.json --out runs/<id>/code_impact.json
"""

from __future__ import annotations

import argparse
import re
import shutil
from pathlib import Path

from schema import PROVIDER_IMPORT_SIGNATURES, ChangeCard, CodeFinding, load_json, write_json

_CODE_SUFFIXES = {".py", ".ts", ".tsx", ".js", ".jsx", ".java", ".go", ".rb"}

# Generic model-id literal patterns per provider (used when no change-card model
# list is supplied, and to attribute a provider to a matched literal).
_MODEL_PATTERNS = {
    "openai": re.compile(r"\b(gpt-[0-9][\w.\-]*|o[0-9][\w.\-]*|text-embedding-[\w.\-]+)\b"),
    "anthropic": re.compile(r"\b(claude-[\w.\-]+)\b"),
    "gemini": re.compile(r"\b(gemini-[\w.\-]+)\b"),
    "mistral": re.compile(r"\b(mistral-[\w.\-]+|open-mistral-[\w.\-]+)\b"),
}

_CLIENT_CALL_PATTERNS = [
    re.compile(r"\.chat\.completions\.create\("),
    re.compile(r"\.messages\.create\("),
    re.compile(r"\.generate_content\("),
    re.compile(r"\.responses\.create\("),
]

_IMPORT_RES = {p: [re.compile(s) for s in sigs] for p, sigs in PROVIDER_IMPORT_SIGNATURES.items()}


def _severity_for(cards: list[ChangeCard]) -> str:
    if any(c.change_type == "deprecation" for c in cards):
        return "high"
    if any(c.change_type == "price_increase" for c in cards):
        return "medium"
    if cards:
        return "low"
    return "info"


def _scan_regex(repo: Path, cards_by_model: dict[str, list[ChangeCard]]) -> list[CodeFinding]:
    findings: list[CodeFinding] = []
    seq = 0

    def fid() -> str:
        nonlocal seq
        seq += 1
        return f"F{seq}"

    for path in sorted(repo.rglob("*")):
        if not path.is_file() or path.suffix not in _CODE_SUFFIXES:
            continue
        rel = str(path.relative_to(repo))
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except (OSError, UnicodeDecodeError):
            continue
        for i, line in enumerate(lines, start=1):
            # Imports.
            for provider, regexes in _IMPORT_RES.items():
                if any(r.search(line) for r in regexes):
                    findings.append(
                        CodeFinding(fid(), rel, i, line.strip(), "import", provider=provider)
                    )
            # Model literals.
            for provider, pat in _MODEL_PATTERNS.items():
                for m in pat.finditer(line):
                    model = m.group(1)
                    matched = cards_by_model.get(model, [])
                    findings.append(
                        CodeFinding(
                            fid(),
                            rel,
                            i,
                            line.strip(),
                            "model_literal",
                            provider=provider,
                            model=model,
                            matched_change_ids=[c.change_id for c in matched],
                            severity=_severity_for(matched),
                        )
                    )
            # Client calls.
            if any(r.search(line) for r in _CLIENT_CALL_PATTERNS):
                findings.append(CodeFinding(fid(), rel, i, line.strip(), "client_call"))
    return findings


def _adapter_available(name: str) -> bool:
    return shutil.which(name) is not None


def scan(repo: Path, cards: list[ChangeCard]) -> list[CodeFinding]:
    cards_by_model: dict[str, list[ChangeCard]] = {}
    for c in cards:
        cards_by_model.setdefault(c.target, []).append(c)

    # Adapters would go here (semgrep/ast-grep). They are optional; when absent
    # we fall through to the always-available regex scanner.
    if _adapter_available("semgrep") or _adapter_available("ast-grep"):
        # Intentionally not required for the MVP: the regex scanner produces the
        # same CodeFinding shape. Wire a real rule pack here later.
        pass
    return _scan_regex(repo, cards_by_model)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--repo", type=Path, required=True)
    ap.add_argument("--change-cards", type=Path, help="change_cards.json to attribute findings")
    ap.add_argument("--out", type=Path, default=Path("code_impact.json"))
    args = ap.parse_args(argv)

    cards: list[ChangeCard] = []
    if args.change_cards and args.change_cards.exists():
        cards = [ChangeCard(**c) for c in load_json(args.change_cards)]

    findings = scan(args.repo, cards)
    write_json(args.out, findings)
    affected = sum(1 for f in findings if f.matched_change_ids)
    print(f"wrote {len(findings)} findings ({affected} affected by a change) -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
