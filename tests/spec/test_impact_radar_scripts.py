"""Regression guards for Impact Radar's bounded script artifacts."""

from __future__ import annotations

import importlib.util
import json
import sys
from datetime import date
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


def test_scan_code_marks_near_shutdown_deprecations_as_critical(tmp_path: Path) -> None:
    scan_code = _load_script("scan_code")
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "workflow.py").write_text(
        'MODEL = "deepseek-chat"\nNEXT_MODEL = "gpt-3.5-turbo"\n',
        encoding="utf-8",
    )

    near_shutdown = scan_code.ChangeCard(
        change_id="deepseek-C1",
        provider="deepseek",
        change_type="deprecation",
        target="deepseek-chat",
        target_type="model",
        metric="status",
        old_value="active",
        new_value="deprecated",
        shutdown_date="2026-07-24 15:59 UTC",
    )
    later_shutdown = scan_code.ChangeCard(
        change_id="openai-C1",
        provider="openai",
        change_type="deprecation",
        target="gpt-3.5-turbo",
        target_type="model",
        metric="status",
        old_value="active",
        new_value="deprecated",
        shutdown_date="2026-10-23",
    )

    findings = scan_code.scan(repo, [near_shutdown, later_shutdown], today=date(2026, 7, 4))
    by_model = {finding.model: finding for finding in findings}

    assert by_model["deepseek-chat"].severity == "critical"
    assert by_model["deepseek-chat"].provider == "deepseek"
    assert by_model["gpt-3.5-turbo"].severity == "high"
    assert scan_code._severity_for([near_shutdown], today=date(2026, 7, 4)) == "critical"
    assert scan_code._severity_for([later_shutdown], today=date(2026, 7, 4)) == "high"


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
            "external_research": {
                "model_status": "active",
                "source_urls": ["https://example.com"],
            },
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
            "external_research": {
                "model_status": "deprecated",
                "source_urls": ["https://example.com"],
            },
            "needs_external_verification": [],
            "confidence": "medium",
            "evidence": {"snippet": "gemini-1.5-pro"},
        },
        {
            "id": "F4",
            "provider": "deepseek",
            "model_name": "deepseek-chat",
            "calling_method": "deepseek::model_literal",
            "category": "model_literal",
            "code_location": "app/invoice.py:4",
            "file_path": "app/invoice.py",
            "line": 4,
            "feature": {"name": "invoice", "owner": "finance-team", "tier": "production"},
            "call_likelihood": "high",
            "migration_risk": "critical",
            "risk_score": 0.98,
            "matched_change_ids": ["deepseek-C1"],
            "estimated_cost_delta_usd": 0,
            "external_research": {
                "model_status": "deprecated",
                "source_urls": ["https://example.com"],
            },
            "needs_external_verification": [],
            "confidence": "medium",
            "evidence": {"snippet": "deepseek-chat"},
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
            "record_count": 4,
            "records_with_cost": 1,
            "records_with_external_research": 3,
            "records_needing_external_verification": 1,
            "risk_levels": {"critical": 1, "high": 1, "medium": 1, "info": 1},
        }
    }

    payload = prepare_risk_inputs.build_risk_inputs(
        {"records": records},
        handoff_stats,
        limit=1,
        max_snippet_chars=60,
    )

    assert payload["source_record_count"] == 4
    assert payload["candidate_record_count"] == 3
    assert payload["selected_record_count"] == 1
    assert payload["omitted_candidate_count"] == 2
    assert payload["records"][0]["id"] == "F4"
    snippet = payload["records"][0]["evidence"]["snippet"]
    assert snippet is not None
    assert len(snippet) <= 60
    assert payload["stats_digest"]["risk_levels"] == {
        "critical": 1,
        "high": 1,
        "medium": 1,
        "info": 1,
    }


def test_render_report_writes_ui_renderable_report_output(tmp_path: Path) -> None:
    render_report = _load_script("render_report")
    run_dir = tmp_path / "runs" / "example"
    run_dir.mkdir(parents=True)

    artifacts = {
        "change_cards.json": [
            {
                "change_id": "deepseek-C1",
                "provider": "deepseek",
                "change_type": "deprecation",
                "target": "deepseek-chat",
                "target_type": "model",
                "metric": "status",
                "old_value": "active",
                "new_value": "deprecated",
                "shutdown_date": "2026-07-24 15:59 UTC",
                "replacement": "deepseek-v4-flash",
            }
        ],
        "code_impact.json": [
            {
                "finding_id": "F1",
                "file": "app/invoice.py",
                "line": 4,
                "snippet": 'MODEL = "deepseek-chat"',
                "category": "model_literal",
                "provider": "deepseek",
                "model": "deepseek-chat",
                "matched_change_ids": ["deepseek-C1"],
                "severity": "critical",
            }
        ],
        "cost_impact.json": {
            "totals": {
                "old_cost_usd": 100.0,
                "new_cost_usd": 60.0,
                "delta_usd": -40.0,
                "pct_change": -40.0,
            },
            "by_feature": {
                "invoice": {
                    "old_cost_usd": 100.0,
                    "new_cost_usd": 60.0,
                    "delta_usd": -40.0,
                }
            },
        },
        "api_call_records.json": {
            "repo": "/work/repo",
            "records": [
                {
                    "id": "F1",
                    "provider": "deepseek",
                    "model_name": "deepseek-chat",
                    "code_location": "app/invoice.py:4",
                    "migration_risk": "critical",
                    "call_likelihood": "high",
                    "estimated_cost_delta_usd": -40.0,
                    "feature": {"name": "invoice", "owner": "finance-team"},
                    "matched_change_ids": ["deepseek-C1"],
                }
            ],
        },
        "handoff_stats.json": {"output_summary": {"record_count": 1}},
        "risk_inputs.json": {
            "source_record_count": 1,
            "selected_record_count": 1,
            "records": [
                {
                    "id": "F1",
                    "provider": "deepseek",
                    "model_name": "deepseek-chat",
                    "code_location": "app/invoice.py:4",
                    "migration_risk": "critical",
                    "feature": {"owner": "finance-team"},
                    "needs_external_verification": [],
                }
            ],
        },
        "risk_action_plan.json": [
            {
                "action_id": "ACT-001",
                "severity": "critical",
                "title": "Migrate invoice extraction",
                "recommended_action": "Replace deepseek-chat with deepseek-v4-flash.",
                "evidence_ids": ["deepseek-C1", "F1"],
            }
        ],
        "source_cards.json": [
            {
                "source_id": "S1",
                "title": "DeepSeek updates",
                "url": "https://example.com/deepseek",
                "source_type": "provider_docs",
                "authority_tier": "official",
            }
        ],
    }
    for name, payload in artifacts.items():
        (run_dir / name).write_text(json.dumps(payload), encoding="utf-8")

    assert render_report.main(["--run-dir", str(run_dir), "--run-id", "runs/example"]) == 0

    report_output = json.loads((run_dir / "report_output.json").read_text(encoding="utf-8"))
    required_report_keys = {
        "report_version",
        "run_id",
        "generated_at",
        "title",
        "providers",
        "sections",
    }
    assert required_report_keys <= set(report_output)
    assert report_output["run_id"] == "runs/example"
    assert report_output["providers"] == ["deepseek"]
    assert report_output["target"] == {"name": "repo", "path": "/work/repo"}
    assert report_output["sections"]

    required_section_keys = {"id", "type", "title", "content", "severity", "data"}
    for section in report_output["sections"]:
        assert required_section_keys <= set(section)
        assert section["severity"] in {"critical", "high", "medium", "low", "info"}
        assert isinstance(section["data"], dict)

    assert any(
        section["type"] == "code_impact" and section["severity"] == "critical"
        for section in report_output["sections"]
    )
    block = (run_dir / "report_output.block.txt").read_text(encoding="utf-8")
    assert block.startswith("REPORT_OUTPUT\n{")
    assert block.endswith("END_REPORT_OUTPUT\n")
    payload = block.removeprefix("REPORT_OUTPUT\n").removesuffix("END_REPORT_OUTPUT\n")
    assert json.loads(payload)["run_id"] == "runs/example"
