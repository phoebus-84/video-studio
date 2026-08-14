"""Strict blinded listening score validation and unblinding tests."""

from __future__ import annotations

import csv
import importlib.util
import json
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "evaluation" / "analyze_listening_scores.py"
SPEC = importlib.util.spec_from_file_location("analyze_listening_scores", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
analysis = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(analysis)


def prepare(tmp_path: Path) -> tuple[Path, Path, list[Path]]:
    run = tmp_path / "candidate"; results = run / "results"; results.mkdir(parents=True)
    (results / "listening-items.json").write_text(json.dumps({"items": [{"item_id": "segment-1"}]}))
    (results / "listening-key.json").write_text(json.dumps({"items": [{"item_id": "segment-1", "A": "candidate", "B": "baseline"}]}))
    (results / "continuity-items.json").write_text(json.dumps({"items": [{"item_id": "full-1"}]}))
    (results / "continuity-key.json").write_text(json.dumps({"items": [{"item_id": "full-1", "A": "baseline", "B": "candidate"}]}))
    policy = tmp_path / "acceptance.json"
    policy.write_text(json.dumps({
        "required_listener_count": 3,
        "listening": {
            "candidate_overall_median_min": 3.5,
            "candidate_preference_rate_min": 0.55,
            "candidate_pronunciation_error_count_max_relative_to_baseline": 0,
            "candidate_dimension_mean_regression_max": 0.25,
            "candidate_continuity_median_min": 3.5,
            "candidate_boundary_median_min": 3.5,
        },
    }))
    fields = ["listener_id", "item_id", "item_kind", "playback_setup", "timestamp",
              *(f"{dimension}_{side}" for dimension in analysis.SEGMENT_DIMENSIONS + analysis.CONTINUITY_DIMENSIONS for side in ("A", "B")),
              "preference", "flags_A", "flags_B", "notes"]
    paths = []
    for listener in ("listener-1", "listener-2", "listener-3"):
        path = tmp_path / f"{listener}.csv"; paths.append(path)
        with path.open("w", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields); writer.writeheader()
            segment = {"listener_id": listener, "item_id": "segment-1", "item_kind": "segment", "playback_setup": "headphones", "timestamp": "2026-08-03T00:00:00Z", "preference": "A", "flags_A": "", "flags_B": "", "notes": ""}
            for dimension in analysis.SEGMENT_DIMENSIONS: segment[f"{dimension}_A"] = 5; segment[f"{dimension}_B"] = 3
            writer.writerow(segment)
            continuity = {"listener_id": listener, "item_id": "full-1", "item_kind": "continuity", "playback_setup": "headphones", "timestamp": "2026-08-03T00:00:00Z", "preference": "B", "flags_A": "", "flags_B": "", "notes": ""}
            for dimension in analysis.CONTINUITY_DIMENSIONS: continuity[f"{dimension}_A"] = 3; continuity[f"{dimension}_B"] = 5
            writer.writerow(continuity)
    return run, policy, paths


def test_complete_three_listener_panel_is_unblinded_and_thresholded(tmp_path: Path) -> None:
    run, policy, paths = prepare(tmp_path)
    result = analysis.analyze(paths, run, policy)
    assert result["listener_count"] == 3
    assert result["ratings"] == 6
    assert result["aggregates"]["candidate"]["overall"]["median"] == 5
    assert result["aggregates"]["candidate"]["boundary_quality"]["median"] == 5
    assert result["preferences"]["candidate"] == 6
    assert result["listening_thresholds_met"] is True
    assert result["quality_claim_authorized"] is False


def test_duplicate_listener_identity_is_rejected(tmp_path: Path) -> None:
    run, policy, paths = prepare(tmp_path)
    duplicate = tmp_path / "duplicate.csv"
    duplicate.write_text(paths[0].read_text())
    try:
        analysis.analyze([paths[0], duplicate, paths[2]], run, policy)
    except analysis.ListeningScoreError as exc:
        assert "pseudonym repeated" in str(exc)
    else:
        raise AssertionError("duplicate listener was accepted")
