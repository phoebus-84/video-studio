#!/usr/bin/env python3
"""Objective A/B evidence for conservative edge trim and explicit pauses."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import statistics
import wave
from array import array
from pathlib import Path

from qwen_tts_worker.audio_processing import AudioProcessor


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_FIXTURE = ROOT / "evaluation" / "fixtures" / "quality-v1.json"
DEFAULT_RUN = ROOT / "evaluation" / "runs" / "legacy-5957fea64c1a"
DEFAULT_OUTPUT = ROOT / "evaluation" / "diagnostics" / "legacy-edge-ab-v1.json"


def decode(data: bytes) -> array[int]:
    with wave.open(io.BytesIO(data), "rb") as wav:
        samples = array("h")
        samples.frombytes(wav.readframes(wav.getnframes()))
    return samples


def edge_ms(samples: array[int], threshold: float) -> tuple[float, float]:
    first = next(index for index, value in enumerate(samples) if abs(value) > threshold)
    last = len(samples) - 1 - next(index for index, value in enumerate(reversed(samples)) if abs(value) > threshold)
    return first * 1000 / 24_000, (len(samples) - 1 - last) * 1000 / 24_000


def evaluate(fixture_path: Path, run_path: Path, output_path: Path) -> dict:
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    processor = AudioProcessor()
    threshold = 32768 * 10 ** (processor.policy.silence_threshold_dbfs / 20)
    records: dict[str, dict] = {}
    active_preserved = True
    for case in fixture["cases"]:
        for segment in case["expected_segments"]:
            segment_id = segment["segment_id"]
            path = run_path / "attempts" / segment_id / "repeat-1" / "raw.wav"
            raw = path.read_bytes()
            processed = processor.process_bytes(raw)
            before = decode(raw)
            after = decode(processed.wav_bytes)
            before_edges = edge_ms(before, threshold)
            after_edges = edge_ms(after, threshold)
            first = next(index for index, value in enumerate(before) if abs(value) > threshold)
            last = len(before) - 1 - next(index for index, value in enumerate(reversed(before)) if abs(value) > threshold)
            active_hash = hashlib.sha256(before[first : last + 1].tobytes()).hexdigest()
            active_preserved &= active_hash == processed.active_hash
            records[segment_id] = {
                "raw_path": str(path.relative_to(ROOT)),
                "raw_sha256": hashlib.sha256(raw).hexdigest(),
                "before_duration_seconds": len(before) / 24_000,
                "after_duration_seconds": len(after) / 24_000,
                "leading_edge_before_ms": before_edges[0],
                "leading_edge_after_ms": after_edges[0],
                "trailing_edge_before_ms": before_edges[1],
                "trailing_edge_after_ms": after_edges[1],
                "leading_trimmed_samples": processed.leading_trimmed_samples,
                "trailing_trimmed_samples": processed.trailing_trimmed_samples,
                "active_sequence_preserved": active_hash == processed.active_hash,
                "requested_pause_ms": segment["pause_after_ms"],
                "realized_pause_samples": round(segment["pause_after_ms"] * 24_000 / 1000),
            }

    boundaries: list[dict] = []
    for case in fixture["cases"]:
        for left, right in zip(case["expected_segments"], case["expected_segments"][1:]):
            left_record = records[left["segment_id"]]
            right_record = records[right["segment_id"]]
            before_gap = left_record["trailing_edge_before_ms"] + right_record["leading_edge_before_ms"]
            after_natural = left_record["trailing_edge_after_ms"] + right_record["leading_edge_after_ms"]
            realized = after_natural + left["pause_after_ms"]
            boundaries.append(
                {
                    "left_segment_id": left["segment_id"],
                    "right_segment_id": right["segment_id"],
                    "implicit_edge_gap_before_ms": before_gap,
                    "preserved_edge_gap_after_ms": after_natural,
                    "explicit_pause_ms": left["pause_after_ms"],
                    "realized_total_gap_after_ms": realized,
                }
            )

    reductions = [
        record["before_duration_seconds"] - record["after_duration_seconds"]
        for record in records.values()
    ]
    result = {
        "schema_version": "0.1.0",
        "evaluation_id": "legacy-edge-ab-v1",
        "source_run": run_path.name,
        "policy": processor.policy.model_dump(mode="json"),
        "policy_fingerprint": processor.policy_fingerprint,
        "decision": {
            "edge_trim": "enabled",
            "explicit_pause_wav": "enabled",
            "micro_fade": "disabled",
            "reason": "Threshold-active sample sequences remain byte-identical; 80 ms margins remain. No representative listening evidence justifies fades, and explicit zero-valued pauses eliminate direct nonzero sample joins.",
        },
        "aggregate": {
            "segments": len(records),
            "boundaries": len(boundaries),
            "all_active_sequences_preserved": active_preserved,
            "total_removed_seconds": sum(reductions),
            "median_removed_seconds": statistics.median(reductions),
            "max_removed_seconds": max(reductions),
            "segments_changed": sum(value > 0 for value in reductions),
            "median_implicit_boundary_gap_before_ms": statistics.median(
                boundary["implicit_edge_gap_before_ms"] for boundary in boundaries
            ),
            "median_preserved_edge_gap_after_ms": statistics.median(
                boundary["preserved_edge_gap_after_ms"] for boundary in boundaries
            ),
        },
        "segments": records,
        "boundaries": boundaries,
        "limitations": [
            "Objective threshold conservation cannot prove that every low-amplitude phoneme is perceptually unaffected",
            "Micro-fades remain disabled until blinded representative boundary listening supports them",
            "Pause preferences remain subject to candidate listening evaluation",
        ],
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", type=Path, default=DEFAULT_FIXTURE)
    parser.add_argument("--run", type=Path, default=DEFAULT_RUN)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    result = evaluate(args.fixture, args.run, args.output)
    print(json.dumps(result["aggregate"], indent=2))


if __name__ == "__main__":
    main()
