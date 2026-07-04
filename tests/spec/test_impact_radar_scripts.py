"""Regression guards for Impact Radar's bounded script artifacts."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import ModuleType

_REPO_ROOT = Path(__file__).resolve().parents[2]
_SCRIPTS_DIR = _REPO_ROOT / "examples" / "impact-radar" / "scripts"


def _load_script(name: str) -> ModuleType:
    if str(_SCRIPTS_DIR) not in sys.path:
        sys.path.insert(0, str(_SCRIPTS_DIR))
    spec = importlib.util.spec_from_file_location(
        f"impact_radar_{name}",
        _SCRIPTS_DIR / f"{name}.py",
    )
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_scan_code_skips_generated_paths_and_caps_snippets(tmp_path: Path) -> None:
    scan_code = _load_script("scan_code")
    repo = tmp_path / "repo"
    (repo / "src").mkdir(parents=True)
    (repo / "dist").mkdir(parents=True)
    (repo / "server" / "static" / "web-ui" / "assets").mkdir(parents=True)

    long_line = f"MODEL = '{'x' * 200} gpt-4o {'y' * 200}'"
    (repo / "src" / "app.py").write_text(long_line, encoding="utf-8")
    (repo / "dist" / "bundle.js").write_text('const model = "gpt-4o";', encoding="utf-8")
    (repo / "server" / "static" / "web-ui" / "assets" / "app.js").write_text(
        'const model = "gpt-4o";',
        encoding="utf-8",
    )

    card = scan_code.ChangeCard(
        change_id="openai-C1",
        provider="openai",
        change_type="price_increase",
        target="gpt-4o",
        target_type="model",
        metric="input_cost_per_1m",
        old_value=1,
        new_value=2,
    )
    findings = scan_code.scan(repo, [card], max_snippet_chars=80)

    assert [finding.file for finding in findings] == ["src/app.py"]
    assert findings[0].model == "gpt-4o"
    assert findings[0].matched_change_ids == ["openai-C1"]
    assert len(findings[0].snippet) <= 80
    assert "gpt-4o" in findings[0].snippet


def test_prepare_risk_inputs_keeps_only_bounded_high_signal_records() -> None:
    prepare_risk_inputs = _load_script("prepare_risk_inputs")
    records = [
        {
            "id": "F1",
            "provider": "openai",
            "model_name": "gpt-4o",
            "calling_method": "openai::model_literal",
            "category": "model_literal",
            "code_location": "app/chat.py:1",
            "file_path": "app/chat.py",
            "line": 1,
            "feature": {"name": "chat", "owner": "assistant-team", "tier": "production"},
            "call_likelihood": "high",
            "migration_risk": "medium",
            "risk_score": 0.7,
            "matched_change_ids": ["openai-C1"],
            "estimated_cost_delta_usd": 120,
            "external_research": {"model_status": "active", "source_urls": ["https://example.com"]},
            "needs_external_verification": [],
            "confidence": "medium",
            "evidence": {"snippet": "gpt-4o " + ("x" * 500)},
        },
        {
            "id": "F2",
            "provider": "gemini",
            "model_name": "gemini-1.5-pro",
            "calling_method": "gemini::model_literal",
            "category": "model_literal",
            "code_location": "app/docs.py:2",
            "file_path": "app/docs.py",
            "line": 2,
            "feature": {"name": "docs", "owner": "docs-team", "tier": "production"},
            "call_likelihood": "high",
            "migration_risk": "high",
            "risk_score": 0.9,
            "matched_change_ids": ["gemini-C1"],
            "estimated_cost_delta_usd": 0,
            "external_research": {"model_status": "deprecated", "source_urls": ["https://example.com"]},
            "needs_external_verification": [],
            "confidence": "medium",
            "evidence": {"snippet": "gemini-1.5-pro"},
        },
        {
            "id": "F3",
            "provider": "openai",
            "model_name": "unknown",
            "calling_method": "openai::import",
            "category": "import",
            "code_location": "app/unused.py:3",
            "file_path": "app/unused.py",
            "line": 3,
            "feature": {},
            "call_likelihood": "low",
            "migration_risk": "info",
            "risk_score": 0.1,
            "matched_change_ids": [],
            "estimated_cost_delta_usd": None,
            "external_research": None,
            "needs_external_verification": ["confirm_import_is_used_in_runtime_path"],
            "confidence": "low",
            "evidence": {"snippet": "from openai import OpenAI"},
        },
    ]
    handoff_stats = {
        "output_summary": {
            "record_count": 3,
            "records_with_cost": 1,
            "records_with_external_research": 2,
            "records_needing_external_verification": 1,
            "risk_levels": {"high": 1, "medium": 1, "info": 1},
        }
    }

    payload = prepare_risk_inputs.build_risk_inputs(
        {"records": records},
        handoff_stats,
        limit=1,
        max_snippet_chars=60,
    )

    assert payload["source_record_count"] == 3
    assert payload["candidate_record_count"] == 2
    assert payload["selected_record_count"] == 1
    assert payload["omitted_candidate_count"] == 1
    assert payload["records"][0]["id"] == "F2"
    snippet = payload["records"][0]["evidence"]["snippet"]
    assert snippet is not None
    assert len(snippet) <= 60
    assert payload["stats_digest"]["risk_levels"] == {"high": 1, "medium": 1, "info": 1}
