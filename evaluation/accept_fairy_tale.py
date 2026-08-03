#!/usr/bin/env python3
"""Run live multi-character acceptance and composition for the wolf fairy tale."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

from qwen_tts_worker.audio_processing import AudioProcessor
from qwen_tts_worker.dialogue import analyze_dialogue
from qwen_tts_worker.ingestion import ingest_script
from qwen_tts_worker.model_lifecycle import model_lifecycle
from qwen_tts_worker.models.quality import (
    AttemptPhase, DeliveryDelta, SamplingProfile, SegmentContext, SegmentPlan,
    SpeechRole, SynthesisAttempt, SynthesisProfile, VoiceDirection, WavArtifact,
)
from qwen_tts_worker.narration_mastering import AssemblyEntry, AssemblyPlan, NarrationMasterer
from qwen_tts_worker.routes.synthesis import SynthesizeRequest, inspect_customvoice_model, synthesize_with_qwen
from qwen_tts_worker.segmentation import SegmentationInput, segment_speech
from qwen_tts_worker.signal_validation import validate_attempt_signal

from regenerate_jaromail import MODEL, artifact, compose, model_identity, retime_srt, sha, slice_scenes


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_EPISODE = ROOT / "library" / "childrens" / "fairy-tales" / "the-wolf-and-the-seven-little-kids"
PROFILES = {
    "narrator": ("serena", "Tell the story warmly and gently, with calm wonder and natural pacing."),
    "mother-goat": ("sohee", "Reassure the children with gentle warmth, clear care, and calm confidence."),
    "wolf": ("uncle_fu", "Deliver with sly confidence, controlled menace, and concise natural pauses."),
    "wolf-disguised": ("uncle_fu", "Sound falsely sweet and cunning, with restrained theatrical charm."),
    "kids": ("vivian", "Answer together with alert energy, courage, and a clear warning."),
    "youngest-kid": ("vivian", "Speak with urgent honesty, then growing confidence and relief."),
}
# Reviewed against script.md Production Notes. Attribution remains narrator speech.
OVERRIDES = {
    ("s2", "Now listen, my darlings,"): "mother-goat",
    ("s2", "Keep the door locked tight while I am gone. A sly old wolf lives in the forest, and he loves to play tricks. If he comes knocking, do not open the door. You will always know him by his rough, gravelly voice — and his dark, shaggy paws."): "mother-goat",
    ("s2", "We promise, Mama,"): "kids",
    ("s3", "Open up, my little dears,"): "wolf",
    ("s3", "Your mother is home, and she has brought treats for everyone!"): "wolf",
    ("s3", "No, no!"): "kids",
    ("s3", "Your voice is too rough. You are the wolf!"): "kids",
    ("s4", "Little ones, little ones,"): "wolf-disguised",
    ("s4", "open the door for your dear mother!"): "wolf-disguised",
    ("s4", "No, no!"): "kids",
    ("s4", "Our mama's feet are soft and white. You are the wolf!"): "kids",
    ("s6", "My little ones!"): "mother-goat",
    ("s6", "Where are you?"): "mother-goat",
    ("s6", "Mama! Mama!"): "youngest-kid",
    ("s6", "The wolf tricked us, and he locked my brothers and sisters in the wardrobe. But I hid, just like you taught us — I listened, and I looked, and I stayed safe!"): "youngest-kid",
    ("s8", "You were clever, and brave, and you remembered the rules,"): "mother-goat",
}


def direction(profile_id: str) -> VoiceDirection:
    instruction = PROFILES[profile_id][1]
    return VoiceDirection(direction_version="0.1.0", base_direction_id=f"{profile_id}-fairy-v1",
                          base_instruction=instruction, delta=DeliveryDelta(), composed_instruction=instruction)


def make_plans(script: Path) -> list[tuple[str, str, SegmentPlan]]:
    ingested = ingest_script(script)
    plans: list[tuple[str, str, SegmentPlan]] = []
    used_overrides: set[tuple[str, str]] = set()
    for scene_number, block in enumerate(ingested.spoken_blocks, 1):
        scene_id = f"s{scene_number}"
        analysis = analyze_dialogue(block, ingested.source)
        malformed = [item for item in analysis.diagnostics if item.code != "dialogue.speaker-unresolved"]
        if malformed:
            raise RuntimeError(f"malformed dialogue in {scene_id}: {malformed}")
        for turn in analysis.turns:
            profile_id = "narrator"
            if turn.role == SpeechRole.DIALOGUE:
                key = (scene_id, turn.display_text)
                profile_id = OVERRIDES.get(key, "review-required")
                if profile_id == "review-required":
                    raise RuntimeError(f"unreviewed dialogue speaker in {scene_id}: {turn.display_text!r}")
                used_overrides.add(key)
            item = SegmentationInput(
                source_anchor_id=turn.turn_id,
                source_document_sha256=turn.source_document_sha256,
                source_block_ids=(turn.source_block_id,), source_spans=(turn.source_span,),
                source_spans_exact=turn.source_span_exact,
                display_text=turn.display_text, spoken_text=turn.spoken_text,
                language="en-US", role=turn.role, speaker_profile_id=profile_id,
            )
            result = segment_speech((item,))
            reconstructed = "".join(x.spoken_text + x.spoken_separator_after for x in result.segments)
            if reconstructed != turn.spoken_text:
                raise RuntimeError(f"segmentation conservation failure in {turn.turn_id}")
            for semantic in result.segments:
                plan = SegmentPlan(
                    segment_id=semantic.segment_id, source_document_sha256=semantic.source_document_sha256,
                    source_block_ids=semantic.source_block_ids, source_spans=semantic.source_spans,
                    preprocessing_version="fairy-production-reviewed-v1",
                    display_text=semantic.display_text, spoken_text=semantic.spoken_text,
                    language="en-US", role=semantic.role, speaker_profile_id=profile_id,
                    direction=direction(profile_id), context=SegmentContext(),
                    pause_after_ms=semantic.pause.duration_hint_ms,
                )
                plans.append((scene_id, profile_id, plan))
    unused = set(OVERRIDES) - used_overrides
    if unused:
        raise RuntimeError(f"reviewed dialogue overrides no longer match source: {sorted(unused)}")
    return plans


def accept(episode: Path, resume_run: str | None = None) -> dict:
    script = episode / "artifacts" / "script.md"
    old_timing_doc = json.loads((episode / "artifacts" / "timing.json").read_text())
    old_timing = old_timing_doc["scenes"] if isinstance(old_timing_doc, dict) else old_timing_doc
    old_srt = (episode / "artifacts" / "captions.srt").read_text()
    plans = make_plans(script)
    scene_ids = [f"s{i}" for i in range(1, 9)]
    run_id = resume_run or ("wolf-fairy-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
    narration = episode / "artifacts" / "narration"; run = narration / "runs" / run_id
    if resume_run:
        if not run.is_dir(): raise RuntimeError(f"resume run does not exist: {run}")
    else:
        run.mkdir(parents=True)
    identity = model_identity(); backend = inspect_customvoice_model(MODEL); processor = AudioProcessor()
    records = [json.loads(path.read_text()) for path in sorted((run / "raw").glob("**/record.json"))]
    entries_by_segment: dict[str, AssemblyEntry] = {}
    for record in records:
        if record["quality"]["report"]["decision"] != "accept" or record.get("transform") is None:
            continue
        transformed = record["transform"]
        entries_by_segment[record["segment"]["segment_id"]] = AssemblyEntry(
            segment_id=record["segment"]["segment_id"],
            accepted_attempt_id=record["attempt"]["attempt_id"],
            quality_report_id=record["quality"]["report"]["report_id"],
            transform_id=transformed["transform_id"],
            speech_wav=WavArtifact.model_validate(transformed["transformed_wav"]),
            pause_wav=WavArtifact.model_validate(transformed["pause_wav"]) if transformed["pause_wav"] else None,
            pause_after_ms=transformed["requested_pause_ms"],
        )
    try:
        with model_lifecycle.acquire(backend.path) as loaded:
            for ordinal, (scene_id, profile_id, plan) in enumerate(plans, 1):
                if plan.segment_id in entries_by_segment:
                    continue
                speaker, instruction = PROFILES[profile_id]
                raw_root = run / "raw" / plan.segment_id; raw_root.mkdir(parents=True, exist_ok=True)
                first_attempt = 2 if (raw_root / "raw.wav").exists() else 1
                accepted = False
                for retry_number in range(first_attempt, 4):
                    seed = 48000 + ordinal + (retry_number - 1) * 1000
                    profile = SynthesisProfile(
                        profile_id=f"fairy-{profile_id}-v1", profile_revision="1", model=identity,
                        speaker=speaker, language="english",
                        sampling=SamplingProfile(temperature=0.7, top_k=50, top_p=1.0,
                                                 repetition_penalty=1.05, max_tokens=1200, seed=seed),
                    )
                    request = SynthesizeRequest(text=plan.spoken_text, voice=speaker, language="english",
                                                instruct=instruction, seed=seed)
                    created = datetime.now(timezone.utc); started = time.monotonic()
                    data, info = synthesize_with_qwen(request, backend, speaker, loaded.instance)
                    elapsed = time.monotonic() - started; model_lifecycle.record_synthesis(elapsed)
                    raw_dir = raw_root if retry_number == 1 else raw_root / f"attempt-{retry_number}"
                    raw_dir.mkdir(parents=True, exist_ok=True)
                    raw_path = raw_dir / "raw.wav"; raw_path.write_bytes(data)
                    wav = artifact(str(raw_path.relative_to(run)), data, info.duration_seconds)
                    attempt = SynthesisAttempt(
                        segment_id=plan.segment_id,
                        request_fingerprint=sha(json.dumps({"segment": plan.model_dump(mode="json"), "profile": profile.model_dump(mode="json")}, sort_keys=True).encode()),
                        phase=AttemptPhase.COMPLETED, profile=profile, direction=plan.direction, raw_wav=wav,
                        created_at=created, completed_at=datetime.now(timezone.utc), processing_seconds=elapsed,
                        peak_memory_bytes=model_lifecycle.snapshot().peak_memory_bytes,
                    )
                    evidence = validate_attempt_signal(attempt, run, spoken_word_count=len(plan.spoken_text.split()))
                    transformed = None
                    if evidence.report.decision.value == "accept":
                        transformed = processor.process_attempt(attempt, evidence.report, run, run, pause_after_ms=plan.pause_after_ms)
                        entries_by_segment[plan.segment_id] = AssemblyEntry(
                            segment_id=plan.segment_id, accepted_attempt_id=attempt.attempt_id,
                            quality_report_id=evidence.report.report_id, transform_id=transformed.transform_id,
                            speech_wav=transformed.transformed_wav, pause_wav=transformed.pause_wav,
                            pause_after_ms=plan.pause_after_ms,
                        )
                    record = {"scene_id": scene_id, "speaker_profile_id": profile_id,
                              "segment": plan.model_dump(mode="json"), "profile": profile.model_dump(mode="json"),
                              "attempt": attempt.model_dump(mode="json"), "quality": evidence.model_dump(mode="json"),
                              "transform": transformed.model_dump(mode="json") if transformed else None,
                              "retry_number": retry_number, "elapsed_seconds": elapsed}
                    (raw_dir / "record.json").write_text(json.dumps(record, indent=2) + "\n"); records.append(record)
                    if transformed:
                        accepted = True; break
                if not accepted:
                    raise RuntimeError(f"three attempts did not accept {plan.segment_id}")
    finally:
        model_lifecycle.unload(wait=True)
    entries = [entries_by_segment[plan.segment_id] for _, _, plan in plans]
    scene_frames = {scene: 0 for scene in scene_ids}
    scene_by_segment = {plan.segment_id: scene for scene, _, plan in plans}
    for entry in entries:
        scene_frames[scene_by_segment[entry.segment_id]] += round(entry.speech_wav.duration_seconds * 24_000)
        if entry.pause_wav: scene_frames[scene_by_segment[entry.segment_id]] += round(entry.pause_wav.duration_seconds * 24_000)
    assembly = AssemblyPlan(episode_id="childrens/fairy-tales/the-wolf-and-the-seven-little-kids",
                            source_revision=sha(script.read_bytes()), entries=tuple(entries))
    report = NarrationMasterer().master(assembly, run, run); mastered = run / report.final_wav.path
    publish = Path(tempfile.mkdtemp(prefix=".wolf-publish-", dir=narration))
    staged_video = episode / "artifacts" / f".{run_id}.mp4"
    staged_srt = episode / "artifacts" / f".{run_id}.srt"
    try:
        shutil.copy2(mastered, publish / "narration-full.wav")
        durations = slice_scenes(mastered, scene_frames, publish)
        timing = []; cursor = 0.0
        for scene_id in scene_ids:
            old = next(item for item in old_timing if item["id"] == scene_id); duration = durations[scene_id]
            timing.append({"id": scene_id, "title": old["title"], "start": round(cursor, 6),
                           "duration": round(duration, 6), "end": round(cursor + duration, 6)})
            cursor += duration
        staged_srt.write_text(retime_srt(old_srt, old_timing, timing))
        compose(episode, timing, publish / "narration-full.wav", staged_srt, staged_video)
        manifest = report.manifest.model_dump(mode="json"); manifest["final_wav"]["path"] = "artifacts/narration/narration-full.wav"
        for item in manifest["entries"]:
            item["wav"]["path"] = f"artifacts/narration/runs/{run_id}/{item['wav']['path']}"
        (publish / "narration-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        (publish / "mastering-report.json").write_text(report.model_dump_json(indent=2) + "\n")
        provenance = {"schema_version": "0.1.0", "run_id": run_id, "provider_mode": "live",
                      "created_at": datetime.now(timezone.utc).isoformat(), "model": identity.model_dump(mode="json"),
                      "reviewed_speaker_overrides": len(OVERRIDES), "profiles": PROFILES,
                      "segments": len(plans), "scenes": len(scene_ids), "model_load_count": 1,
                      "peak_memory_bytes": max(r["attempt"].get("peak_memory_bytes", 0) or 0 for r in records),
                      "mastering": report.measured.model_dump(mode="json"), "final_wav_sha256": report.final_wav.sha256}
        (publish / "regeneration.json").write_text(json.dumps(provenance, indent=2) + "\n")
        for scene_id in scene_ids:
            related = [r for r in records if r["scene_id"] == scene_id and r["quality"]["report"]["decision"] == "accept"]
            (publish / f"{scene_id}.json").write_text(json.dumps({"id": scene_id, "duration_sec": durations[scene_id],
                "provider_mode": "live", "run_id": run_id,
                "attempt_ids": [r["attempt"]["attempt_id"] for r in related],
                "segment_ids": [r["segment"]["segment_id"] for r in related],
                "speaker_profile_ids": list(dict.fromkeys(r["speaker_profile_id"] for r in related))}, indent=2) + "\n")
        for path in publish.iterdir(): os.replace(path, narration / path.name)
        timing_doc = {"total_duration": round(cursor, 6), "fps": 30,
                      "transition": {"type": "cut", "duration_ms": 0}, "scenes": timing}
        (episode / "artifacts" / "timing.json").write_text(json.dumps(timing_doc, indent=2) + "\n")
        os.replace(staged_srt, episode / "artifacts" / "captions.srt")
        os.replace(staged_video, episode / "artifacts" / "final.mp4")
        output = episode / "output"; output.mkdir(exist_ok=True); render_id = "render-002"
        shutil.copy2(episode / "artifacts" / "final.mp4", output / f"{render_id}.mp4")
        size = (output / f"{render_id}.mp4").stat().st_size
        (output / f"{render_id}.report.json").write_text(json.dumps({"renderId": render_id,
            "duration": round(cursor, 6), "fileSizeBytes": size,
            "warnings": ["captions not burned per user request"]}, indent=2) + "\n")
        (output / "current.json").write_text(json.dumps({"renderId": render_id, "path": f"{render_id}.mp4"}, indent=2) + "\n")
    finally:
        shutil.rmtree(publish, ignore_errors=True)
        staged_video.unlink(missing_ok=True); staged_srt.unlink(missing_ok=True)
    return {"run_id": run_id, "scene_count": len(scene_ids), "segment_count": len(plans),
            "speaker_profiles": sorted({profile for _, profile, _ in plans}),
            "duration_seconds": report.final_duration_seconds,
            "loudness": report.measured.model_dump(mode="json"),
            "boundary_failures": sum(x.status == "fail" for x in report.boundaries),
            "final_wav_sha256": report.final_wav.sha256,
            "video": str(episode / "output" / "render-002.mp4")}


def main() -> None:
    parser = argparse.ArgumentParser(); parser.add_argument("--episode", type=Path, default=DEFAULT_EPISODE)
    parser.add_argument("--resume-run", help="Continue an immutable run after a rejected attempt or publish failure")
    args = parser.parse_args(); print(json.dumps(accept(args.episode.resolve(), args.resume_run), indent=2))


if __name__ == "__main__": main()
