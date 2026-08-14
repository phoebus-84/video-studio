#!/usr/bin/env python3
"""Validate, unblind, and aggregate the predeclared three-listener evaluation."""

from __future__ import annotations

import argparse
import csv
import json
import statistics
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SEGMENT_DIMENSIONS = (
    "text_fidelity", "pronunciation", "naturalness", "pacing",
    "emotional_fit", "voice_identity", "overall",
)
CONTINUITY_DIMENSIONS = (
    "identity_continuity", "prosody_continuity", "level_continuity",
    "boundary_quality", "pause_intent", "transition_fit",
)


class ListeningScoreError(ValueError):
    pass


def load_expected(run: Path) -> tuple[dict[str, str], dict[str, dict[str, str]]]:
    results = run / "results"
    kinds: dict[str, str] = {}
    keys: dict[str, dict[str, str]] = {}
    for stem, kind in (("listening", "segment"), ("continuity", "continuity")):
        items_path = results / f"{stem}-items.json"
        key_path = results / f"{stem}-key.json"
        if not items_path.is_file():
            if kind == "continuity":
                raise ListeningScoreError("continuity listening package is missing")
            raise ListeningScoreError("segment listening package is missing")
        items = json.loads(items_path.read_text())["items"]
        key_items = json.loads(key_path.read_text())["items"]
        for item in items:
            item_id = item["item_id"]
            if item_id in kinds: raise ListeningScoreError(f"duplicate package item {item_id}")
            kinds[item_id] = kind
        for item in key_items:
            keys[item["item_id"]] = {"A": item["A"], "B": item["B"]}
    if set(kinds) != set(keys): raise ListeningScoreError("item/key identifiers do not match")
    return kinds, keys


def read_scores(paths: list[Path], kinds: dict[str, str]) -> list[dict[str, str]]:
    rows = []
    listeners = set()
    expected = set(kinds)
    for path in paths:
        with path.open(newline="", encoding="utf-8-sig") as handle:
            file_rows = list(csv.DictReader(handle))
        if not file_rows: raise ListeningScoreError(f"empty listener file: {path}")
        ids = {row.get("listener_id", "").strip() for row in file_rows}
        if len(ids) != 1 or "" in ids: raise ListeningScoreError(f"one nonempty listener_id required in {path}")
        listener = ids.pop()
        if listener in listeners: raise ListeningScoreError(f"listener pseudonym repeated: {listener}")
        listeners.add(listener)
        item_ids = [row.get("item_id", "") for row in file_rows]
        if len(item_ids) != len(set(item_ids)) or set(item_ids) != expected:
            raise ListeningScoreError(f"{path} must contain every expected item exactly once")
        for row in file_rows:
            item_id = row["item_id"]; kind = kinds[item_id]
            if row.get("item_kind", kind) != kind: raise ListeningScoreError(f"wrong item_kind for {item_id}")
            if not row.get("playback_setup", "").strip() or not row.get("timestamp", "").strip():
                raise ListeningScoreError(f"playback setup and timestamp required for {listener}")
            dimensions = SEGMENT_DIMENSIONS if kind == "segment" else CONTINUITY_DIMENSIONS
            for dimension in dimensions:
                for side in ("A", "B"):
                    field = f"{dimension}_{side}"
                    try: score = int(row.get(field, ""))
                    except ValueError as exc: raise ListeningScoreError(f"{field} must be integer 1-5") from exc
                    if not 1 <= score <= 5: raise ListeningScoreError(f"{field} must be 1-5")
            if row.get("preference") not in {"A", "B", "no preference"}:
                raise ListeningScoreError(f"invalid preference for {item_id}")
            rows.append(row)
    return rows


def analyze(score_paths: list[Path], run: Path, acceptance_path: Path) -> dict:
    policy = json.loads(acceptance_path.read_text())
    required = policy["required_listener_count"]
    if len(score_paths) != required:
        raise ListeningScoreError(f"exactly {required} listener CSV files are required")
    kinds, keys = load_expected(run)
    rows = read_scores(score_paths, kinds)
    values: dict[str, dict[str, list[float]]] = {
        "candidate": defaultdict(list), "baseline": defaultdict(list)
    }
    pronunciation_flags = {"candidate": 0, "baseline": 0}
    preferences = {"candidate": 0, "baseline": 0, "no preference": 0}
    preferences_by_item: dict[str, list[str]] = defaultdict(list)
    for row in rows:
        item_id = row["item_id"]; dimensions = SEGMENT_DIMENSIONS if kinds[item_id] == "segment" else CONTINUITY_DIMENSIONS
        side_for_system = {system: side for side, system in keys[item_id].items()}
        for system in ("candidate", "baseline"):
            side = side_for_system[system]
            for dimension in dimensions:
                values[system][dimension].append(int(row[f"{dimension}_{side}"]))
            flags = row.get(f"flags_{side}", "").casefold()
            pronunciation_flags[system] += "pronunciation" in flags
        chosen = row["preference"]
        preference = "no preference" if chosen == "no preference" else keys[item_id][chosen]
        preferences[preference] += 1; preferences_by_item[item_id].append(preference)
    aggregates = {
        system: {
            dimension: {"mean": statistics.fmean(scores), "median": statistics.median(scores), "ratings": len(scores)}
            for dimension, scores in dimensions.items()
        } for system, dimensions in values.items()
    }
    listening = policy["listening"]
    regressions = {
        dimension: aggregates["candidate"][dimension]["mean"] - aggregates["baseline"][dimension]["mean"]
        for dimension in SEGMENT_DIMENSIONS
    }
    continuity_scores = [
        *values["candidate"]["identity_continuity"],
        *values["candidate"]["prosody_continuity"],
        *values["candidate"]["level_continuity"],
    ]
    total_preferences = sum(preferences.values())
    checks = {
        "listener_count": len({row["listener_id"] for row in rows}) == required,
        "item_completion": len(rows) == len(kinds) * required,
        "candidate_overall_median": aggregates["candidate"]["overall"]["median"] >= listening["candidate_overall_median_min"],
        "candidate_preference_rate": preferences["candidate"] / total_preferences >= listening["candidate_preference_rate_min"],
        "pronunciation_error_relative": pronunciation_flags["candidate"] - pronunciation_flags["baseline"] <= listening["candidate_pronunciation_error_count_max_relative_to_baseline"],
        "dimension_regression": all(delta >= -listening["candidate_dimension_mean_regression_max"] for delta in regressions.values()),
        "continuity_median": statistics.median(continuity_scores) >= listening["candidate_continuity_median_min"],
        "boundary_median": statistics.median(values["candidate"]["boundary_quality"]) >= listening["candidate_boundary_median_min"],
    }
    pairwise = []
    for item_preferences in preferences_by_item.values():
        for left in range(len(item_preferences)):
            for right in range(left + 1, len(item_preferences)):
                pairwise.append(item_preferences[left] == item_preferences[right])
    return {
        "schema_version": "0.1.0", "run_id": run.name,
        "analyzed_at": datetime.now(timezone.utc).isoformat(),
        "listener_count": required, "item_count_per_listener": len(kinds),
        "ratings": len(rows), "aggregates": aggregates,
        "candidate_minus_baseline_dimension_means": regressions,
        "preferences": {**preferences, "candidate_rate_all_items": preferences["candidate"] / total_preferences},
        "pronunciation_flag_counts": pronunciation_flags,
        "preference_pairwise_agreement": sum(pairwise) / len(pairwise) if pairwise else None,
        "checks": checks,
        "listening_thresholds_met": all(checks.values()),
        "quality_claim_authorized": False,
        "quality_claim_blocker": "Merge reviewed listening results with separately retained objective gates before authorizing the final claim.",
        "limitations": [
            "Objective gates are evaluated separately in comparison-objective.json.",
            "Three listeners support the predeclared minimum but produce wide uncertainty.",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("scores", nargs="+", type=Path)
    parser.add_argument("--run", type=Path, default=ROOT / "evaluation" / "runs" / "candidate-qtw-v1")
    parser.add_argument("--acceptance", type=Path, default=ROOT / "evaluation" / "acceptance-v1.json")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = analyze(args.scores, args.run, args.acceptance)
    output = args.output or args.run / "results" / "listening-analysis.json"
    output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__": main()
