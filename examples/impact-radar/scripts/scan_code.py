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
import os
import re
import shutil
from datetime import date
from pathlib import Path

from schema import PROVIDER_IMPORT_SIGNATURES, ChangeCard, CodeFinding, load_json, write_json

_CODE_SUFFIXES = {".py", ".ts", ".tsx", ".js", ".jsx", ".java", ".go", ".rb"}
_CRITICAL_SHUTDOWN_WINDOW_DAYS = 30
_DEFAULT_EXCLUDED_DIRS = {
    ".cache",
    ".codex-tmp",
    ".git",
    ".hg",
    ".mypy_cache",
    ".next",
    ".pytest_cache",
    ".ruff_cache",
    ".svn",
    ".tox",
    ".turbo",
    ".venv",
    "__pycache__",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "venv",
}
_DEFAULT_EXCLUDED_PATHS = {
    "server/static",
    "static/web-ui/assets",
    "web-ui/assets",
}
_DEFAULT_MAX_FILE_BYTES = 1_000_000
_DEFAULT_MAX_SNIPPET_CHARS = 400

# Generic model-id literal patterns per provider (used when no change-card model
# list is supplied, and to attribute a provider to a matched literal).
_MODEL_PATTERNS = {
    "openai": re.compile(r"\b(gpt-[0-9][\w.\-]*|o[0-9][\w.\-]*|text-embedding-[\w.\-]+)\b"),
    "anthropic": re.compile(r"\b(claude-[\w.\-]+)\b"),
    "deepseek": re.compile(r"\b(deepseek-[\w.\-]+)\b"),
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


def _normal_path(value: str) -> str:
    return value.replace("\\", "/").strip("/")


def _is_excluded_path(
    rel: str,
    *,
    excluded_dirs: set[str],
    excluded_path_prefixes: set[str],
) -> bool:
    parts = set(_normal_path(rel).split("/"))
    if parts & excluded_dirs:
        return True
    normalized = _normal_path(rel)
    return any(
        normalized == prefix or normalized.startswith(f"{prefix}/")
        for prefix in excluded_path_prefixes
    )


def _snippet(line: str, start: int | None, end: int | None, max_chars: int) -> str:
    text = line.strip()
    if max_chars <= 0 or len(text) <= max_chars:
        return text
    if max_chars <= 3:
        return text[:max_chars]
    if start is None or end is None:
        return f"{text[: max_chars - 3].rstrip()}..."

    leading_ws = len(line) - len(line.lstrip())
    start = max(0, start - leading_ws)
    end = max(start, end - leading_ws)
    match_len = max(1, end - start)
    if match_len >= max_chars:
        return f"{text[start : start + max_chars - 3].rstrip()}..."

    context = max(0, (max_chars - match_len) // 2)
    window_start = max(0, start - context)
    window_end = min(len(text), window_start + max_chars)
    window_start = max(0, window_end - max_chars)
    snippet = text[window_start:window_end].strip()
    if window_start > 0:
        snippet = f"...{snippet[3:].lstrip()}" if len(snippet) >= 3 else "..."
    if window_end < len(text):
        snippet = f"{snippet[:-3].rstrip()}..." if len(snippet) >= 3 else "..."
    return snippet


def _append_finding(
    findings: list[CodeFinding],
    seen: set[tuple[str, int, str, str | None, str | None]],
    finding_id: str,
    rel: str,
    line_no: int,
    line: str,
    category: str,
    *,
    provider: str | None = None,
    model: str | None = None,
    matched_change_ids: list[str] | None = None,
    severity: str = "info",
    match_start: int | None = None,
    match_end: int | None = None,
    max_snippet_chars: int = _DEFAULT_MAX_SNIPPET_CHARS,
) -> None:
    key = (rel, line_no, category, provider, model)
    if key in seen:
        return
    seen.add(key)
    findings.append(
        CodeFinding(
            finding_id,
            rel,
            line_no,
            _snippet(line, match_start, match_end, max_snippet_chars),
            category,
            provider=provider,
            model=model,
            matched_change_ids=matched_change_ids or [],
            severity=severity,
        )
    )


def _iter_code_files(
    repo: Path,
    *,
    excluded_dirs: set[str],
    excluded_path_prefixes: set[str],
):
    for root, dirnames, filenames in os.walk(repo):
        root_path = Path(root)
        kept_dirs: list[str] = []
        for dirname in sorted(dirnames):
            rel_dir = (root_path / dirname).relative_to(repo).as_posix()
            if _is_excluded_path(
                rel_dir,
                excluded_dirs=excluded_dirs,
                excluded_path_prefixes=excluded_path_prefixes,
            ):
                continue
            kept_dirs.append(dirname)
        dirnames[:] = kept_dirs

        for filename in sorted(filenames):
            path = root_path / filename
            if path.suffix not in _CODE_SUFFIXES:
                continue
            rel = path.relative_to(repo).as_posix()
            if _is_excluded_path(
                rel,
                excluded_dirs=excluded_dirs,
                excluded_path_prefixes=excluded_path_prefixes,
            ):
                continue
            yield path, rel


def _parse_shutdown_date(value: str | None) -> date | None:
    if not value:
        return None
    match = re.search(r"\d{4}-\d{2}-\d{2}", value)
    if not match:
        return None
    try:
        return date.fromisoformat(match.group(0))
    except ValueError:
        return None


def _is_near_shutdown(card: ChangeCard, today: date) -> bool:
    shutdown = _parse_shutdown_date(card.shutdown_date)
    if shutdown is None:
        return False
    return (shutdown - today).days <= _CRITICAL_SHUTDOWN_WINDOW_DAYS


def _severity_for(cards: list[ChangeCard], *, today: date | None = None) -> str:
    today = today or date.today()
    if any(c.change_type == "deprecation" and _is_near_shutdown(c, today) for c in cards):
        return "critical"
    if any(c.change_type == "deprecation" for c in cards):
        return "high"
    if any(c.change_type == "price_increase" for c in cards):
        return "medium"
    if cards:
        return "low"
    return "info"


def _scan_regex(
    repo: Path,
    cards_by_model: dict[str, list[ChangeCard]],
    *,
    today: date | None,
    excluded_dirs: set[str],
    excluded_path_prefixes: set[str],
    max_file_bytes: int,
    max_snippet_chars: int,
) -> list[CodeFinding]:
    findings: list[CodeFinding] = []
    seen: set[tuple[str, int, str, str | None, str | None]] = set()
    seq = 0

    def fid() -> str:
        nonlocal seq
        seq += 1
        return f"F{seq}"

    for path, rel in _iter_code_files(
        repo,
        excluded_dirs=excluded_dirs,
        excluded_path_prefixes=excluded_path_prefixes,
    ):
        try:
            stat = path.stat()
        except OSError:
            continue
        if not path.is_file():
            continue
        if max_file_bytes > 0 and stat.st_size > max_file_bytes:
            continue
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except (OSError, UnicodeDecodeError):
            continue
        for i, line in enumerate(lines, start=1):
            # Imports.
            for provider, regexes in _IMPORT_RES.items():
                match = next((m for r in regexes if (m := r.search(line))), None)
                if match:
                    _append_finding(
                        findings,
                        seen,
                        fid(),
                        rel,
                        i,
                        line,
                        "import",
                        provider=provider,
                        match_start=match.start(),
                        match_end=match.end(),
                        max_snippet_chars=max_snippet_chars,
                    )
            # Model literals.
            for provider, pat in _MODEL_PATTERNS.items():
                for m in pat.finditer(line):
                    model = m.group(1)
                    matched = cards_by_model.get(model, [])
                    _append_finding(
                        findings,
                        seen,
                        fid(),
                        rel,
                        i,
                        line,
                        "model_literal",
                        provider=provider,
                        model=model,
                        matched_change_ids=[c.change_id for c in matched],
                        severity=_severity_for(matched, today=today),
                        match_start=m.start(1),
                        match_end=m.end(1),
                        max_snippet_chars=max_snippet_chars,
                    )
            # Client calls.
            match = next((m for r in _CLIENT_CALL_PATTERNS if (m := r.search(line))), None)
            if match:
                _append_finding(
                    findings,
                    seen,
                    fid(),
                    rel,
                    i,
                    line,
                    "client_call",
                    match_start=match.start(),
                    match_end=match.end(),
                    max_snippet_chars=max_snippet_chars,
                )
    return findings


def _adapter_available(name: str) -> bool:
    return shutil.which(name) is not None


def scan(
    repo: Path,
    cards: list[ChangeCard],
    *,
    excluded_dirs: set[str] | None = None,
    excluded_path_prefixes: set[str] | None = None,
    max_file_bytes: int = _DEFAULT_MAX_FILE_BYTES,
    max_snippet_chars: int = _DEFAULT_MAX_SNIPPET_CHARS,
    today: date | None = None,
) -> list[CodeFinding]:
    cards_by_model: dict[str, list[ChangeCard]] = {}
    for c in cards:
        cards_by_model.setdefault(c.target, []).append(c)

    # Adapters would go here (semgrep/ast-grep). They are optional; when absent
    # we fall through to the always-available regex scanner.
    if _adapter_available("semgrep") or _adapter_available("ast-grep"):
        # Intentionally not required for the MVP: the regex scanner produces the
        # same CodeFinding shape. Wire a real rule pack here later.
        pass
    return _scan_regex(
        repo,
        cards_by_model,
        today=today,
        excluded_dirs=excluded_dirs or set(_DEFAULT_EXCLUDED_DIRS),
        excluded_path_prefixes=excluded_path_prefixes or set(_DEFAULT_EXCLUDED_PATHS),
        max_file_bytes=max_file_bytes,
        max_snippet_chars=max_snippet_chars,
    )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--repo", type=Path, required=True)
    ap.add_argument("--change-cards", type=Path, help="change_cards.json to attribute findings")
    ap.add_argument("--out", type=Path, default=Path("code_impact.json"))
    ap.add_argument(
        "--exclude-dir",
        action="append",
        default=[],
        help="Directory name to skip. May be supplied more than once.",
    )
    ap.add_argument(
        "--exclude-path",
        action="append",
        default=[],
        help="Repo-relative path prefix to skip. May be supplied more than once.",
    )
    ap.add_argument(
        "--max-file-bytes",
        type=int,
        default=_DEFAULT_MAX_FILE_BYTES,
        help="Skip source files larger than this many bytes. Use 0 to disable.",
    )
    ap.add_argument(
        "--max-snippet-chars",
        type=int,
        default=_DEFAULT_MAX_SNIPPET_CHARS,
        help="Maximum evidence snippet length per finding. Use 0 to disable.",
    )
    args = ap.parse_args(argv)

    cards: list[ChangeCard] = []
    if args.change_cards and args.change_cards.exists():
        cards = [ChangeCard(**c) for c in load_json(args.change_cards)]

    excluded_dirs = set(_DEFAULT_EXCLUDED_DIRS) | set(args.exclude_dir)
    excluded_paths = {
        _normal_path(path) for path in _DEFAULT_EXCLUDED_PATHS | set(args.exclude_path)
    }
    findings = scan(
        args.repo,
        cards,
        excluded_dirs=excluded_dirs,
        excluded_path_prefixes=excluded_paths,
        max_file_bytes=args.max_file_bytes,
        max_snippet_chars=args.max_snippet_chars,
    )
    write_json(args.out, findings)
    affected = sum(1 for f in findings if f.matched_change_ids)
    print(f"wrote {len(findings)} findings ({affected} affected by a change) -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
