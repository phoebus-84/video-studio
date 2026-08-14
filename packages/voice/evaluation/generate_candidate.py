#!/usr/bin/env python3
"""Generate all quality-v1 candidate repeats without favorable-sample replacement."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
import platform
import random
import shutil
import subprocess
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from qwen_tts_worker.direction import CustomVoiceDirectionProfile, compose_direction
from qwen_tts_worker.model_lifecycle import model_lifecycle
from qwen_tts_worker.models.quality import (
    AttemptPhase,
    DeliveryDelta,
    ModelIdentity,
    SamplingProfile,
    SegmentContext,
    SegmentPlan,
    SourceSpan,
    SpeechRole,
    SynthesisAttempt,
    SynthesisProfile,
    WavArtifact,
)
from qwen_tts_worker.routes.synthesis import (
    SynthesizeRequest,
    inspect_customvoice_model,
    synthesize_with_qwen,
)
from qwen_tts_worker.signal_validation import validate_attempt_signal


ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "evaluation" / "fixtures" / "quality-v1.json"
ACCEPTANCE = ROOT / "evaluation" / "acceptance-v1.json"
BASELINE = ROOT / "evaluation" / "runs" / "legacy-5957fea64c1a"
MODEL = ROOT / "models" / "qwen3-tts-1.7b-customvoice-8bit"
SEEDS = (42001, 42002, 42003)
BLIND_RANDOM_SEED = 20260801


def file_sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=ROOT, check=True, capture_output=True, text=True
    ).stdout.strip()


def profiles() -> dict[str, CustomVoiceDirectionProfile]:
    common = {
        "profile_revision": "candidate-v1",
        "source_language": "en-US",
        "backend_language": "english",
    }
    return {
        "narrator-under-test": CustomVoiceDirectionProfile(
            profile_id="narrator-serena-candidate-v1",
            character_id="narrator-under-test",
            continuity_group="narrator-serena-candidate",
            backend_speaker="serena",
            base_direction_id="clear-consistent-narration-v1",
            base_instruction="Speak clearly and naturally while maintaining consistent delivery across adjacent narration",
            **common,
        ),
        "mira-under-test": CustomVoiceDirectionProfile(
            profile_id="mira-vivian-candidate-v1",
            character_id="mira-under-test",
            continuity_group="mira-vivian-candidate",
            backend_speaker="vivian",
            base_direction_id="clear-consistent-dialogue-v1",
            base_instruction="Speak clearly and naturally while maintaining consistent delivery across adjacent dialogue",
            **common,
        ),
    }


def model_identity() -> ModelIdentity:
    return ModelIdentity(
        model_id="mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit",
        model_profile="custom_voice",
        model_sha256=file_sha(MODEL / "model.safetensors"),
        quantization="8bit-affine-g64",
        mlx_audio_version=importlib.metadata.version("mlx-audio"),
        mlx_version=importlib.metadata.version("mlx"),
    )


def make_plan(segment: dict, fixture_sha: str, profile: CustomVoiceDirectionProfile) -> SegmentPlan:
    delta = DeliveryDelta.model_validate(segment["delivery"])
    direction = compose_direction(profile, delta)
    text = segment["spoken_text"]
    return SegmentPlan(
        segment_id=segment["segment_id"],
        source_document_sha256=fixture_sha,
        source_block_ids=(segment["segment_id"],),
        source_spans=(SourceSpan(start=0, end=len(segment["display_text"])),),
        preprocessing_version="quality-v1-reviewed",
        display_text=segment["display_text"],
        spoken_text=text,
        language="en-US",
        role=SpeechRole(segment["role"]),
        speaker_profile_id=profile.profile_id,
        direction=direction,
        context=SegmentContext(),
        pause_after_ms=segment["pause_after_ms"],
    )


def make_profile(
    selected: CustomVoiceDirectionProfile,
    identity: ModelIdentity,
    seed: int,
) -> SynthesisProfile:
    return SynthesisProfile(
        profile_id=selected.profile_id,
        profile_revision=selected.profile_revision,
        model=identity,
        speaker=selected.backend_speaker,
        language=selected.backend_language,
        sampling=SamplingProfile(
            temperature=0.7,
            top_k=50,
            top_p=1.0,
            repetition_penalty=1.05,
            max_tokens=1200,
            seed=seed,
        ),
    )


def artifact(relative: str, data: bytes, info) -> WavArtifact:
    return WavArtifact(
        path=relative,
        sha256=hashlib.sha256(data).hexdigest(),
        size_bytes=len(data),
        duration_seconds=info.duration_seconds,
        sample_rate=info.sample_rate,
        channels=info.channels,
        sample_width_bytes=info.sample_width_bytes,
    )


def generate(run_id: str) -> dict:
    output = ROOT / "evaluation" / "runs" / run_id
    if output.exists():
        raise RuntimeError(f"immutable run already exists: {output}")
    output.mkdir(parents=True)
    fixture_raw = FIXTURE.read_bytes()
    fixture = json.loads(fixture_raw)
    fixture_sha = hashlib.sha256(fixture_raw).hexdigest()
    acceptance_sha = file_sha(ACCEPTANCE)
    identity = model_identity()
    selected_profiles = profiles()
    model = inspect_customvoice_model(MODEL)
    segments = [segment for case in fixture["cases"] for segment in case["expected_segments"]]
    plans = {
        segment["segment_id"]: make_plan(
            segment, fixture_sha, selected_profiles[segment["speaker_profile"]]
        )
        for segment in segments
    }
    (output / "segment-plan.json").write_text(
        json.dumps(
            [plan.model_dump(mode="json") for plan in plans.values()],
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    revision = git("rev-parse", "HEAD")
    dirty = bool(git("status", "--porcelain"))
    run_manifest = {
        "schema_version": "0.1.0",
        "run_id": run_id,
        "provider_mode": "live",
        "fixture": str(FIXTURE.relative_to(ROOT)),
        "fixture_sha256": fixture_sha,
        "acceptance_sha256": acceptance_sha,
        "repository_revision": revision,
        "repository_dirty_at_start": dirty,
        "seed_schedule": list(SEEDS),
        "repeat_count": len(SEEDS),
        "model": identity.model_dump(mode="json"),
        "profiles": {
            key: value.model_dump(mode="json") for key, value in selected_profiles.items()
        },
        "environment": {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "machine": platform.machine(),
            "mlx_audio": importlib.metadata.version("mlx-audio"),
            "mlx": importlib.metadata.version("mlx"),
            "worker": importlib.metadata.version("qwen-tts-worker"),
            "disk_free_bytes": shutil.disk_usage(output).free,
        },
        "started_at": datetime.now(timezone.utc).isoformat(),
        "limitations": [
            "Legacy baseline repeats had no controllable seed; candidate uses predeclared seeds",
            "No listening scores are generated by this command",
        ],
    }
    (output / "run.json").write_text(
        json.dumps(run_manifest, indent=2) + "\n", encoding="utf-8"
    )
    records: list[dict] = []
    try:
        with model_lifecycle.acquire(model.path) as loaded:
            for segment in segments:
                plan = plans[segment["segment_id"]]
                selected = selected_profiles[segment["speaker_profile"]]
                for repeat, seed in enumerate(SEEDS, 1):
                    attempt_dir = output / "attempts" / segment["segment_id"] / f"repeat-{repeat}"
                    attempt_dir.mkdir(parents=True)
                    synthesis_profile = make_profile(selected, identity, seed)
                    request = SynthesizeRequest(
                        text=plan.spoken_text,
                        voice=selected.backend_speaker,
                        language=selected.backend_language,
                        instruct=plan.direction.composed_instruction,
                        temperature=synthesis_profile.sampling.temperature,
                        top_k=synthesis_profile.sampling.top_k,
                        top_p=synthesis_profile.sampling.top_p,
                        repetition_penalty=synthesis_profile.sampling.repetition_penalty,
                        max_tokens=synthesis_profile.sampling.max_tokens,
                        seed=seed,
                    )
                    (attempt_dir / "request.json").write_text(
                        json.dumps(
                            {
                                "segment": plan.model_dump(mode="json"),
                                "profile": synthesis_profile.model_dump(mode="json"),
                                "request": request.model_dump(mode="json"),
                            },
                            indent=2,
                            ensure_ascii=False,
                        )
                        + "\n",
                        encoding="utf-8",
                    )
                    created = datetime.now(timezone.utc)
                    started = time.monotonic()
                    raw_path = attempt_dir / "raw.wav"
                    try:
                        data, info = synthesize_with_qwen(
                            request, model, selected.backend_speaker, loaded.instance
                        )
                        elapsed = time.monotonic() - started
                        model_lifecycle.record_synthesis(elapsed)
                        raw_path.write_bytes(data)
                        relative = str(raw_path.relative_to(output))
                        wav_artifact = artifact(relative, data, info)
                        attempt = SynthesisAttempt(
                            segment_id=plan.segment_id,
                            request_fingerprint=hashlib.sha256(
                                json.dumps(
                                    {
                                        "segment": plan.model_dump(mode="json"),
                                        "profile": synthesis_profile.model_dump(mode="json"),
                                    },
                                    sort_keys=True,
                                    separators=(",", ":"),
                                ).encode()
                            ).hexdigest(),
                            phase=AttemptPhase.COMPLETED,
                            profile=synthesis_profile,
                            direction=plan.direction,
                            raw_wav=wav_artifact,
                            created_at=created,
                            completed_at=datetime.now(timezone.utc),
                            processing_seconds=elapsed,
                            peak_memory_bytes=model_lifecycle.snapshot().peak_memory_bytes,
                        )
                        evidence = validate_attempt_signal(
                            attempt,
                            output,
                            spoken_word_count=len(plan.spoken_text.split()),
                        )
                        (attempt_dir / "signal-report.json").write_text(
                            json.dumps(evidence.model_dump(mode="json"), indent=2) + "\n",
                            encoding="utf-8",
                        )
                        response = {
                            "status": "completed",
                            "attempt": attempt.model_dump(mode="json"),
                            "quality_decision": evidence.report.decision.value,
                        }
                    except Exception as exc:
                        elapsed = time.monotonic() - started
                        model_lifecycle.record_synthesis(elapsed)
                        response = {
                            "status": "failed",
                            "error": f"{type(exc).__name__}: {exc}",
                            "processing_seconds": elapsed,
                        }
                    (attempt_dir / "response.json").write_text(
                        json.dumps(response, indent=2) + "\n", encoding="utf-8"
                    )
                    records.append(
                        {
                            "segment_id": segment["segment_id"],
                            "repeat": repeat,
                            "seed": seed,
                            "status": response["status"],
                            "quality_decision": response.get("quality_decision"),
                            "processing_seconds": elapsed,
                            "wav_sha256": response.get("attempt", {}).get("raw_wav", {}).get("sha256"),
                            "error": response.get("error"),
                        }
                    )
    finally:
        model_lifecycle.unload(wait=True)

    completed = [record for record in records if record["status"] == "completed"]
    decisions: dict[str, int] = {}
    for record in completed:
        decision = record["quality_decision"]
        decisions[decision] = decisions.get(decision, 0) + 1
    objective = {
        "schema_version": "0.1.0",
        "run_id": run_id,
        "attempts_expected": len(segments) * len(SEEDS),
        "attempts_completed": len(completed),
        "attempts_failed": len(records) - len(completed),
        "completion_rate": len(completed) / len(records),
        "quality_decisions": decisions,
        "total_processing_seconds": sum(record["processing_seconds"] for record in records),
        "mean_processing_seconds": sum(record["processing_seconds"] for record in records) / len(records),
        "peak_memory_bytes": model_lifecycle.snapshot().peak_memory_bytes,
        "records": records,
    }
    results = output / "results"
    results.mkdir()
    (results / "objective.json").write_text(
        json.dumps(objective, indent=2) + "\n", encoding="utf-8"
    )
    create_blinded_package(output, segments)
    run_manifest["completed_at"] = datetime.now(timezone.utc).isoformat()
    run_manifest["repository_dirty_at_completion"] = bool(git("status", "--porcelain"))
    (output / "run.json").write_text(
        json.dumps(run_manifest, indent=2) + "\n", encoding="utf-8"
    )
    return objective


def create_blinded_package(output: Path, segments: list[dict]) -> None:
    rng = random.Random(BLIND_RANDOM_SEED)
    items: list[dict] = []
    key: list[dict] = []
    for segment in segments:
        for repeat in range(1, 4):
            baseline = BASELINE / "attempts" / segment["segment_id"] / f"repeat-{repeat}" / "raw.wav"
            candidate = output / "attempts" / segment["segment_id"] / f"repeat-{repeat}" / "raw.wav"
            candidate_is_a = bool(rng.getrandbits(1))
            item_id = f"{segment['segment_id']}.repeat-{repeat}"
            items.append(
                {
                    "item_id": item_id,
                    "segment_id": segment["segment_id"],
                    "repeat": repeat,
                    "A": str((candidate if candidate_is_a else baseline).relative_to(ROOT)),
                    "B": str((baseline if candidate_is_a else candidate).relative_to(ROOT)),
                }
            )
            key.append(
                {
                    "item_id": item_id,
                    "A": "candidate" if candidate_is_a else "baseline",
                    "B": "baseline" if candidate_is_a else "candidate",
                }
            )
    results = output / "results"
    (results / "listening-items.json").write_text(
        json.dumps(
            {
                "schema_version": "0.1.0",
                "random_seed": BLIND_RANDOM_SEED,
                "instructions": "Withhold listening-key.json until all listener score files are final.",
                "items": items,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    (results / "listening-key.json").write_text(
        json.dumps({"schema_version": "0.1.0", "items": key}, indent=2) + "\n",
        encoding="utf-8",
    )
    header = (
        "listener_id,item_id,playback_setup,timestamp,text_fidelity_A,text_fidelity_B,"
        "pronunciation_A,pronunciation_B,naturalness_A,naturalness_B,pacing_A,pacing_B,"
        "emotional_fit_A,emotional_fit_B,voice_identity_A,voice_identity_B,overall_A,overall_B,"
        "preference,flags,notes\n"
    )
    (results / "listening-scores.csv").write_text(header, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", default="candidate-qtw-v1")
    args = parser.parse_args()
    objective = generate(args.run_id)
    print(json.dumps({key: value for key, value in objective.items() if key != "records"}, indent=2))


if __name__ == "__main__":
    main()
