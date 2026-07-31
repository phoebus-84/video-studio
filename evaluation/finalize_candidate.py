#!/usr/bin/env python3
"""Process/master candidate repeat 1 and publish objective baseline comparison."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

from qwen_tts_worker.advisory_diagnostics import transcribe_with_mlx_whisper
from qwen_tts_worker.audio_processing import AudioProcessor, AudioTransformStore
from qwen_tts_worker.models.quality import SynthesisAttempt
from qwen_tts_worker.narration_mastering import AssemblyEntry, AssemblyPlan, NarrationMasterer
from qwen_tts_worker.signal_validation import SignalValidationEvidence


ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "evaluation" / "fixtures" / "quality-v1.json"
BASELINE = ROOT / "evaluation" / "runs" / "legacy-5957fea64c1a"


def finalize(run_id: str) -> dict:
    run = ROOT / "evaluation" / "runs" / run_id
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    segments = [segment for case in fixture["cases"] for segment in case["expected_segments"]]
    processor = AudioProcessor()
    transforms = AudioTransformStore(run)
    entries: list[AssemblyEntry] = []
    candidate_asr: list[dict] = []
    for segment in segments:
        attempt_dir = run / "attempts" / segment["segment_id"] / "repeat-1"
        response = json.loads((attempt_dir / "response.json").read_text(encoding="utf-8"))
        attempt = SynthesisAttempt.model_validate(response["attempt"])
        evidence = SignalValidationEvidence.model_validate_json(
            (attempt_dir / "signal-report.json").read_text(encoding="utf-8")
        )
        transform = processor.process_attempt(
            attempt,
            evidence.report,
            run,
            run,
            pause_after_ms=segment["pause_after_ms"],
        )
        transforms.save(transform)
        entries.append(
            AssemblyEntry(
                segment_id=segment["segment_id"],
                accepted_attempt_id=attempt.attempt_id,
                quality_report_id=evidence.report.report_id,
                transform_id=transform.transform_id,
                speech_wav=transform.transformed_wav,
                pause_wav=transform.pause_wav,
                pause_after_ms=segment["pause_after_ms"],
            )
        )
        asr = transcribe_with_mlx_whisper(
            attempt_dir / "raw.wav",
            segment["spoken_text"],
            lexicon_targets=tuple(note["term"] for note in segment["pronunciation_notes"]),
        )
        candidate_asr.append(
            {"segment_id": segment["segment_id"], "report": asr.model_dump(mode="json")}
        )

    mastering = NarrationMasterer().master(
        AssemblyPlan(
            episode_id=f"quality-evaluation-{run_id}",
            source_revision=json.loads((run / "run.json").read_text())["fixture_sha256"],
            entries=tuple(entries),
        ),
        run,
        run,
    )
    assembly = run / "assembly"
    assembly.mkdir(exist_ok=True)
    (assembly / "narration-manifest.json").write_text(
        json.dumps(mastering.manifest.model_dump(mode="json"), indent=2) + "\n",
        encoding="utf-8",
    )
    (assembly / "mastering-report.json").write_text(
        json.dumps(mastering.model_dump(mode="json"), indent=2) + "\n",
        encoding="utf-8",
    )
    shutil.copy2(run / mastering.final_wav.path, assembly / "narration-full.wav")

    baseline_metrics = []
    candidate_metrics = []
    for segment in segments:
        for repeat in range(1, 4):
            baseline_metrics.append(
                json.loads(
                    (
                        BASELINE
                        / "attempts"
                        / segment["segment_id"]
                        / f"repeat-{repeat}"
                        / "signal-report.json"
                    ).read_text()
                )
            )
            candidate_metrics.append(
                SignalValidationEvidence.model_validate_json(
                    (
                        run
                        / "attempts"
                        / segment["segment_id"]
                        / f"repeat-{repeat}"
                        / "signal-report.json"
                    ).read_text()
                ).report.model_dump(mode="json")
            )

    def mean(values):
        return sum(values) / len(values)

    baseline_summary = {
        "attempts": len(baseline_metrics),
        "mean_duration_seconds": mean([item["duration_seconds"] for item in baseline_metrics]),
        "mean_rms_dbfs": mean([item["rms_dbfs"] for item in baseline_metrics]),
        "mean_peak_dbfs": mean([item["peak_dbfs"] for item in baseline_metrics]),
        "mean_wpm": mean([item["spoken_words_per_minute"] for item in baseline_metrics]),
        "clipped_attempts": sum(item["clipped_sample_ratio"] > 0.001 for item in baseline_metrics),
        "invalid_attempts": sum(not item["valid"] for item in baseline_metrics),
    }
    candidate_summary = {
        "attempts": len(candidate_metrics),
        "mean_duration_seconds": mean([
            next(item for item in metric["checks"] if item["check_id"] == "wav.duration")["observed"].split()[0]
            and SynthesisAttempt.model_validate(
                json.loads(
                    (
                        run / "attempts" / record["segment_id"] / f"repeat-{record['repeat']}" / "response.json"
                    ).read_text()
                )["attempt"]
            ).raw_wav.duration_seconds
            for metric, record in zip(candidate_metrics, json.loads((run / "results" / "objective.json").read_text())["records"])
        ]),
        "mean_rms_dbfs": mean([item["metrics"]["rms_dbfs"] for item in candidate_metrics]),
        "mean_peak_dbfs": mean([item["metrics"]["peak_dbfs"] for item in candidate_metrics]),
        "mean_wpm": mean([item["metrics"]["spoken_words_per_minute"] for item in candidate_metrics]),
        "clipped_attempts": sum(item["metrics"]["clipped_sample_ratio"] > 0.001 for item in candidate_metrics),
        "rejected_attempts": sum(item["decision"] == "reject" for item in candidate_metrics),
        "review_attempts": sum(item["decision"] == "review" for item in candidate_metrics),
    }
    wers = [item["report"]["word_error_rate"] for item in candidate_asr]
    result = {
        "schema_version": "0.1.0",
        "run_id": run_id,
        "baseline": baseline_summary,
        "candidate": candidate_summary,
        "candidate_repeat1_advisory_asr": {
            "mean_word_error_rate": mean(wers),
            "max_word_error_rate": max(wers),
            "segments_at_or_above_0_15": sum(value >= 0.15 for value in wers),
            "automatic_gate": False,
            "reports": candidate_asr,
        },
        "mastering": {
            "assembly_id": mastering.assembly_id,
            "ordered_segments": list(mastering.ordered_segment_ids),
            "duration_seconds": mastering.final_duration_seconds,
            "integrated_lufs": mastering.measured.integrated_lufs,
            "true_peak_dbtp": mastering.measured.true_peak_dbtp,
            "loudness_range_lu": mastering.measured.loudness_range_lu,
            "boundary_failures": sum(item.status == "fail" for item in mastering.boundaries),
            "final_sha256": mastering.final_wav.sha256,
        },
        "quality_claim_authorized": False,
        "quality_claim_blocker": "Blinded scores from at least three independent listeners are absent.",
    }
    (run / "results" / "comparison-objective.json").write_text(
        json.dumps(result, indent=2) + "\n", encoding="utf-8"
    )
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", default="candidate-qtw-v1")
    args = parser.parse_args()
    result = finalize(args.run_id)
    print(json.dumps({key: value for key, value in result.items() if key != "candidate_repeat1_advisory_asr"}, indent=2))


if __name__ == "__main__":
    main()
