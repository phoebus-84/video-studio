"""Frozen candidate objective evidence and honest listening-blocker tests."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
ACCEPTANCE = ROOT / "evaluation" / "acceptance-v1.json"
CANDIDATE = ROOT / "evaluation" / "candidates" / "candidate-qtw-v1.json"


def test_acceptance_thresholds_were_frozen_and_candidate_references_them() -> None:
    acceptance_raw = ACCEPTANCE.read_bytes()
    acceptance = json.loads(acceptance_raw)
    candidate = json.loads(CANDIDATE.read_text(encoding="utf-8"))
    assert acceptance["declared_before_candidate_listening"] is True
    assert acceptance["required_repeats_per_segment"] == 3
    assert acceptance["required_listener_count"] == 3
    assert candidate["run"]["acceptance_sha256"] == hashlib.sha256(acceptance_raw).hexdigest()
    assert candidate["run"]["repository_revision"].startswith("fe8fc1f")


def test_candidate_contains_all_attempts_without_favorable_replacement() -> None:
    candidate = json.loads(CANDIDATE.read_text(encoding="utf-8"))
    objective = candidate["objective"]
    assert objective["attempts_expected"] == 54
    assert objective["attempts_completed"] == 54
    assert objective["attempts_failed"] == 0
    assert objective["quality_decisions"] == {"accept": 54}
    records = objective["records"]
    assert len(records) == 54
    assert len({(item["segment_id"], item["repeat"]) for item in records}) == 54
    assert {item["seed"] for item in records} == {42001, 42002, 42003}
    assert all(item["status"] == "completed" for item in records)
    assert all(item["error"] is None for item in records)


def test_mastering_passes_objective_thresholds_but_quality_claim_remains_blocked() -> None:
    candidate = json.loads(CANDIDATE.read_text(encoding="utf-8"))
    comparison = candidate["comparison"]
    mastering = comparison["mastering"]
    assert len(mastering["ordered_segments"]) == 18
    assert mastering["boundary_failures"] == 0
    assert abs(mastering["integrated_lufs"] + 16.0) <= 0.6
    assert mastering["true_peak_dbtp"] <= -1.3
    assert comparison["candidate"]["clipped_attempts"] == 0
    assert comparison["candidate"]["rejected_attempts"] == 0
    assert comparison["quality_claim_authorized"] is False
    assert "listeners" in comparison["quality_claim_blocker"]
    assert candidate["listening"]["scores_received"] == 0
    assert candidate["listening"]["status"] == "blocked-human-listening"
