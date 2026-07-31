#!/usr/bin/env python3
"""Run optional local ASR and adjacent diagnostics over controlled baseline repeat 1."""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import platform
from pathlib import Path

from qwen_tts_worker.advisory_diagnostics import (
    compare_adjacent_boundaries,
    compare_transcript,
    normalized_words,
    transcribe_with_mlx_whisper,
)


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_FIXTURE = ROOT / "evaluation" / "fixtures" / "quality-v1.json"
DEFAULT_RUN = ROOT / "evaluation" / "runs" / "legacy-5957fea64c1a"
DEFAULT_OUTPUT = ROOT / "evaluation" / "diagnostics" / "legacy-advisory-v1.json"
MODEL_ID = "mlx-community/whisper-tiny.en-mlx"


def _calibration(segments: list[dict]) -> dict:
    labeled: list[tuple[bool, str, str]] = []
    for segment in segments:
        expected = segment["spoken_text"]
        words = list(normalized_words(expected))
        labeled.append((False, expected, expected))
        labeled.append((False, expected, expected.upper() + "!!!"))
        count = max(1, round(len(words) * 0.25))
        labeled.append((True, expected, " ".join(words[count:])))
        labeled.append((True, expected, " ".join(words + words[-count:])))
        replaced = ["mismatch"] * count + words[count:]
        labeled.append((True, expected, " ".join(replaced)))
    threshold = 0.15
    tp = fp = tn = fn = 0
    for actual_error, expected, observed in labeled:
        detected = compare_transcript(expected, observed).word_error_rate >= threshold
        if actual_error and detected:
            tp += 1
        elif actual_error:
            fn += 1
        elif detected:
            fp += 1
        else:
            tn += 1
    return {
        "dataset": "deterministic synthetic transcript perturbations over quality-v1",
        "threshold_word_error_rate": threshold,
        "labeled_examples": len(labeled),
        "true_positive": tp,
        "false_positive": fp,
        "true_negative": tn,
        "false_negative": fn,
        "precision": tp / (tp + fp) if tp + fp else 0,
        "recall": tp / (tp + fn) if tp + fn else 0,
        "false_reject_rate": fp / (fp + tn) if fp + tn else 0,
        "limitation": "Text perturbations calibrate edit accounting only; they do not measure end-to-end ASR/accent precision.",
    }


def evaluate(fixture_path: Path, run_path: Path, output_path: Path) -> dict:
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    segments = [segment for case in fixture["cases"] for segment in case["expected_segments"]]
    asr_reports: list[dict] = []
    for segment in segments:
        wav = run_path / "attempts" / segment["segment_id"] / "repeat-1" / "raw.wav"
        targets = tuple(note["term"] for note in segment["pronunciation_notes"])
        report = transcribe_with_mlx_whisper(
            wav,
            segment["spoken_text"],
            model_id=MODEL_ID,
            lexicon_targets=targets,
        )
        asr_reports.append(
            {
                "segment_id": segment["segment_id"],
                "wav": str(wav.relative_to(ROOT)),
                "report": report.model_dump(mode="json"),
            }
        )

    boundary_reports: list[dict] = []
    for case in fixture["cases"]:
        case_segments = case["expected_segments"]
        for left, right in zip(case_segments, case_segments[1:]):
            left_wav = run_path / "attempts" / left["segment_id"] / "repeat-1" / "raw.wav"
            right_wav = run_path / "attempts" / right["segment_id"] / "repeat-1" / "raw.wav"
            report = compare_adjacent_boundaries(
                left_wav,
                right_wav,
                expected_same_speaker=left["speaker_profile"] == right["speaker_profile"],
            )
            boundary_reports.append(
                {
                    "left_segment_id": left["segment_id"],
                    "right_segment_id": right["segment_id"],
                    "report": report.model_dump(mode="json"),
                }
            )

    wers = [item["report"]["word_error_rate"] for item in asr_reports]
    target_results = [
        target
        for item in asr_reports
        for target in item["report"]["lexicon_targets"]
    ]
    result = {
        "schema_version": "0.1.0",
        "evaluation_id": "legacy-advisory-v1",
        "source_run": run_path.name,
        "environment": {
            "platform": platform.platform(),
            "python": platform.python_version(),
            "mlx_whisper": importlib.metadata.version("mlx-whisper"),
            "mlx": importlib.metadata.version("mlx"),
            "numpy": importlib.metadata.version("numpy"),
            "model_id": MODEL_ID,
            "model_resource": "Hugging Face cache; downloaded locally; English-only tiny checkpoint",
        },
        "decision": {
            "asr": "advisory",
            "continuity": "advisory",
            "automatic_gate_authorized": False,
            "reason": "No human-labeled accented/name pronunciation corpus or validated speaker embedding model; tiny.en ASR confuses intended phonetic spellings and content errors.",
        },
        "aggregate": {
            "segments": len(asr_reports),
            "mean_word_error_rate": sum(wers) / len(wers),
            "max_word_error_rate": max(wers),
            "segments_at_or_above_0_15_wer": sum(value >= 0.15 for value in wers),
            "lexicon_targets": len(target_results),
            "lexicon_targets_observed_as_written": sum(target["observed"] for target in target_results),
            "boundaries": len(boundary_reports),
            "boundaries_with_notes_beyond_disclaimer": sum(
                len(item["report"]["notes"]) > 1 for item in boundary_reports
            ),
        },
        "calibration": _calibration(segments),
        "asr_reports": asr_reports,
        "boundary_reports": boundary_reports,
        "limitations": [
            "whisper-tiny.en is English-only and known to normalize, substitute, or omit uncommon names, accents, dialects, code tokens, and phonetic spellings",
            "ASR disagreement cannot distinguish TTS pronunciation error from ASR recognition error",
            "RMS, waveform step, and spectral centroid are not speaker embeddings and cannot establish identity continuity",
            "No diagnostic changes acceptance automatically; blinded human review remains required",
        ],
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", type=Path, default=DEFAULT_FIXTURE)
    parser.add_argument("--run", type=Path, default=DEFAULT_RUN)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    result = evaluate(args.fixture, args.run, args.output)
    print(json.dumps({"output": str(args.output), **result["aggregate"]}, indent=2))


if __name__ == "__main__":
    main()
