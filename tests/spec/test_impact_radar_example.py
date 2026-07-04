"""Regression guards for the Impact Radar example."""

from __future__ import annotations

from pathlib import Path

from omnigent.spec.parser import parse

_REPO_ROOT = Path(__file__).resolve().parents[2]
_IMPACT_RADAR_DIR = _REPO_ROOT / "examples" / "impact-radar"
_PACKAGED_IMPACT_RADAR_DIR = _REPO_ROOT / "omnigent" / "resources" / "examples" / "impact-radar"


def _assert_unpinned_codex_bundle(path: Path) -> None:
    spec = parse(path)
    all_specs = [spec, *spec.sub_agents]

    for agent in all_specs:
        assert agent.executor.harness_kind == "codex", (
            f"{agent.name} should run on the codex harness, got {agent.executor.harness_kind!r}."
        )
        assert agent.executor.model is None, f"{agent.name} should not pin a model."
        assert agent.executor.auth is None, f"{agent.name} should not pin a provider."


def test_impact_radar_uses_codex_without_provider_pins() -> None:
    _assert_unpinned_codex_bundle(_IMPACT_RADAR_DIR)


def test_packaged_impact_radar_resource_stays_in_sync() -> None:
    assert _PACKAGED_IMPACT_RADAR_DIR.exists(), "Impact Radar's packaged resource should exist."
    assert _PACKAGED_IMPACT_RADAR_DIR.resolve() == _IMPACT_RADAR_DIR.resolve(), (
        "Impact Radar's packaged resource must resolve to examples/impact-radar."
    )
    _assert_unpinned_codex_bundle(_PACKAGED_IMPACT_RADAR_DIR)


def test_impact_radar_uses_bundle_dir_for_runtime_scripts() -> None:
    instruction_files = [
        _IMPACT_RADAR_DIR / "config.yaml",
        *(_IMPACT_RADAR_DIR / "skills").glob("*/SKILL.md"),
        *(_IMPACT_RADAR_DIR / "agents").glob("*/config.yaml"),
    ]
    joined = "\n".join(path.read_text(encoding="utf-8") for path in instruction_files)

    assert "OMNIGENT_AGENT_BUNDLE_DIR" in joined
    assert "examples/impact-radar/scripts" not in joined


def test_impact_radar_report_skill_requires_renderable_final_block() -> None:
    report_skill = (_IMPACT_RADAR_DIR / "skills" / "report" / "SKILL.md").read_text(
        encoding="utf-8"
    )
    config = (_IMPACT_RADAR_DIR / "config.yaml").read_text(encoding="utf-8")

    assert "report_output.block.txt" in report_skill
    assert "Final response: paste the exact contents" in report_skill
    assert "No text may appear before `REPORT_OUTPUT`" in report_skill
    assert "Never finish with only" in report_skill
    assert "too large for chat" in report_skill
    assert 'do not stop at "bundle path is not set"' in config
