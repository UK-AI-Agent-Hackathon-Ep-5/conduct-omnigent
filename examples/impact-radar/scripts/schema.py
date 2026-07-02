"""Shared data structures and helpers for the Impact Radar deterministic scripts.

Stdlib-only (dataclasses + json) so every script runs anywhere with zero extra
installs. The scripts are the deterministic backbone: the agent invokes them via
the shell and reasons over their structured JSON output — it never invents the
numbers itself.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

UNKNOWN = "unknown"


def load_json(path: str | Path) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path: str | Path, payload: Any) -> Path:
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2, default=_default) + "\n", encoding="utf-8")
    return out


def _default(obj: Any) -> Any:
    if hasattr(obj, "__dataclass_fields__"):
        return asdict(obj)
    raise TypeError(f"not serializable: {type(obj)!r}")


@dataclass
class ChangeCard:
    """A single normalized API change, derived deterministically from two snapshots."""

    change_id: str
    provider: str
    change_type: (
        str  # price_increase | price_decrease | deprecation | new_model | context_window_change
    )
    target: str  # e.g. "gpt-4o"
    target_type: str  # model | endpoint
    metric: str  # e.g. "output_cost_per_1m", "status", "context_window"
    old_value: Any
    new_value: Any
    effective_date: str | None = None
    shutdown_date: str | None = None
    replacement: str | None = None
    confidence: float = 1.0  # snapshot diffs are deterministic → high confidence

    def pct_change(self) -> float | None:
        try:
            old = float(self.old_value)
            new = float(self.new_value)
        except (TypeError, ValueError):
            return None
        if old == 0:
            return None
        return round((new - old) / old * 100.0, 2)


@dataclass
class CodeFinding:
    """One place in the target codebase that touches an LLM API/model."""

    finding_id: str
    file: str
    line: int
    snippet: str
    category: str  # import | client_call | model_literal
    provider: str | None = None
    model: str | None = None
    matched_change_ids: list[str] = field(default_factory=list)
    severity: str = "info"  # info | low | medium | high


# Known provider signatures for the regex fallback scanner. Kept small and
# obvious; semgrep/ast-grep adapters can supersede this when installed.
PROVIDER_IMPORT_SIGNATURES: dict[str, list[str]] = {
    "openai": [r"\bimport openai\b", r"\bfrom openai\b"],
    "anthropic": [r"\bimport anthropic\b", r"\bfrom anthropic\b"],
    "gemini": [r"google\.generativeai", r"\bfrom google\b.*generativeai"],
    "mistral": [r"\bimport mistralai\b", r"\bfrom mistralai\b"],
}
