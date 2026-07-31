"""Integrity tests for the versioned TTS quality evaluation fixture."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

import pytest


FIXTURE = (
    Path(__file__).resolve().parent.parent
    / "evaluation"
    / "fixtures"
    / "quality-v1.json"
)


@pytest.fixture(scope="module")
def suite() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_fixture_has_stable_identity_and_repeated_generation(suite: dict) -> None:
    assert suite["suite_id"] == "qtw-quality-core"
    assert suite["schema_version"] == "0.1.0"
    assert suite["fixture_version"] == "1.0.0"
    assert suite["default_repeat_count"] >= 3


def test_every_required_category_is_exercised(suite: dict) -> None:
    required = set(suite["required_tags"])
    observed = {tag for case in suite["cases"] for tag in case["tags"]}
    assert required == observed


def test_cases_and_segments_are_complete_and_uniquely_addressable(suite: dict) -> None:
    case_ids = [case["case_id"] for case in suite["cases"]]
    assert len(case_ids) == len(set(case_ids))

    segment_ids: list[str] = []
    for case in suite["cases"]:
        assert case["source_text"].strip()
        assert case["language"]
        assert case["listening_focus"]
        assert case["expected_segments"]
        for segment in case["expected_segments"]:
            segment_ids.append(segment["segment_id"])
            assert segment["segment_id"].startswith(case["case_id"] + ".")
            assert segment["role"] in {"narrator", "dialogue"}
            assert segment["speaker_profile"]
            assert segment["display_text"].strip()
            assert segment["spoken_text"].strip()
            assert "`" not in segment["spoken_text"]
            assert 0 <= segment["pause_after_ms"] <= 10_000
            assert segment["continuity_group"]
            assert segment["delivery"]

    assert len(segment_ids) == len(set(segment_ids))
    assert len(segment_ids) == 18


def test_fixture_contains_multi_segment_continuity_and_emotional_arc(suite: dict) -> None:
    segments = [segment for case in suite["cases"] for segment in case["expected_segments"]]
    group_counts = Counter(segment["continuity_group"] for segment in segments)
    assert any(count >= 3 for count in group_counts.values())

    arc = next(case for case in suite["cases"] if case["case_id"] == "expressive-arc")
    emotions = [segment["delivery"]["emotion"] for segment in arc["expected_segments"]]
    assert emotions == ["curious", "tense", "joyful"]
    assert len({segment["speaker_profile"] for segment in arc["expected_segments"]}) == 1


def test_pronunciation_cases_have_explicit_review_targets(suite: dict) -> None:
    tagged = [
        case
        for case in suite["cases"]
        if {"names-foreign-words", "technical-text"}.intersection(case["tags"])
    ]
    assert tagged
    for case in tagged:
        notes = [
            note
            for segment in case["expected_segments"]
            for note in segment["pronunciation_notes"]
        ]
        assert notes
        assert all(note["term"] and note["expected"] for note in notes)


def test_normalization_changes_are_declared(suite: dict) -> None:
    for case in suite["cases"]:
        changed = any(
            segment["display_text"] != segment["spoken_text"]
            for segment in case["expected_segments"]
        )
        if changed:
            assert case["normalization_decisions"], case["case_id"]
            assert all(
                decision["rule_id"] and decision["decision"]
                for decision in case["normalization_decisions"]
            )
