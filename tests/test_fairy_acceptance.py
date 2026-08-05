"""Reviewed multi-character fairy-tale acceptance planning tests."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

EVALUATION = Path(__file__).resolve().parent.parent / "evaluation"
sys.path.insert(0, str(EVALUATION))
try:
    SPEC = importlib.util.spec_from_file_location("accept_fairy_tale", EVALUATION / "accept_fairy_tale.py")
    assert SPEC is not None and SPEC.loader is not None
    acceptance = importlib.util.module_from_spec(SPEC)
    SPEC.loader.exec_module(acceptance)
finally:
    sys.path.remove(str(EVALUATION))


def test_reviewed_dialogue_mapping_is_complete_and_attribution_stays_narration() -> None:
    script = acceptance.DEFAULT_EPISODE / "artifacts" / "script.md"
    if not script.is_file():
        pytest.skip("optional monorepo fairy-tale source is not present in standalone checkout")
    plans = acceptance.make_plans(
        script
    )
    assert len(plans) == 41
    assert {profile for _, profile, _ in plans} == {
        "narrator", "mother-goat", "wolf", "wolf-disguised", "kids", "youngest-kid"
    }
    assert all(plan.speaker_profile_id != "review-required" for _, _, plan in plans)
    profiles_by_text = {
        plan.spoken_text: profile for _, profile, plan in plans
    }
    assert profiles_by_text["she said softly."] == "narrator"
    assert profiles_by_text["rumbled a voice as rough as a bag of pebbles."] == "narrator"
    assert profiles_by_text["Now listen, my darlings,"] == "mother-goat"
    assert profiles_by_text["Open up, my little dears,"] == "wolf"
    assert profiles_by_text["Mama! Mama!"] == "youngest-kid"
    assert profiles_by_text["No, no!"] == "kids"


def test_profile_instructions_do_not_redefine_preset_identity() -> None:
    forbidden = (" male ", " female ", " boy ", " girl ", " pitch ", " accent ")
    for _, instruction in acceptance.PROFILES.values():
        padded = f" {instruction.casefold()} "
        assert not any(term in padded for term in forbidden)
