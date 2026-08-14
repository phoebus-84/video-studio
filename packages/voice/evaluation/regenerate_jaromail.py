#!/usr/bin/env python3
"""Regenerate JaroMail narration and atomically recompose its mixed-media video."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import io
import json
import os
import platform
import re
import shutil
import subprocess
import tempfile
import time
import uuid
import wave
from datetime import datetime, timezone
from pathlib import Path

from qwen_tts_worker.audio_processing import AudioProcessor
from qwen_tts_worker.ingestion import ingest_script
from qwen_tts_worker.model_lifecycle import model_lifecycle
from qwen_tts_worker.models.quality import (
    AttemptPhase, DeliveryDelta, ModelIdentity, SamplingProfile, SegmentContext,
    SegmentPlan, SourceSpan, SpeechRole, SynthesisAttempt, SynthesisProfile,
    VoiceDirection, WavArtifact,
)
from qwen_tts_worker.narration_mastering import AssemblyEntry, AssemblyPlan, MasteringReport, NarrationMasterer
from qwen_tts_worker.normalization import normalize_ingestion
from qwen_tts_worker.routes.synthesis import SynthesizeRequest, inspect_customvoice_model, synthesize_with_qwen
from qwen_tts_worker.segmentation import SegmentationInput, segment_speech
from qwen_tts_worker.signal_validation import validate_attempt_signal


ROOT = Path(__file__).resolve().parents[2]
WORKER = ROOT / "qwen-tts-worker"
DEFAULT_EPISODE = ROOT / "library" / "dyne" / "software" / "jaromail"
MODEL = WORKER / "models" / "qwen3-tts-1.7b-customvoice-8bit"
DIRECTION = (
    "Explain clearly with crisp articulation, a steady pace, medium energy, "
    "and restrained confidence. Pronounce technical names and command-line terms carefully. "
    "Keep pauses natural and concise."
)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def artifact(path: str, data: bytes, duration: float) -> WavArtifact:
    return WavArtifact(path=path, sha256=sha(data), size_bytes=len(data),
                       duration_seconds=duration, sample_rate=24_000,
                       channels=1, sample_width_bytes=2)


def wav_info(data: bytes) -> tuple[int, float]:
    with wave.open(io.BytesIO(data), "rb") as source:
        if (source.getframerate(), source.getnchannels(), source.getsampwidth(), source.getcomptype()) != (24_000, 1, 2, "NONE"):
            raise RuntimeError("generated WAV is not canonical mono PCM16/24k")
        frames = source.getnframes()
    return frames, frames / 24_000


def model_identity() -> ModelIdentity:
    return ModelIdentity(
        model_id="mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit",
        model_profile="custom_voice",
        model_sha256=sha((MODEL / "model.safetensors").read_bytes()),
        quantization="8bit-affine-g64",
        mlx_audio_version=importlib.metadata.version("mlx-audio"),
        mlx_version=importlib.metadata.version("mlx"),
    )


def make_plans(script: Path) -> tuple[list[dict], list[tuple[str, SegmentPlan]]]:
    scenes = json.loads(script.read_text(encoding="utf-8"))
    ingested = ingest_script(script)
    normalized = normalize_ingestion(ingested)
    if len(scenes) != len(normalized):
        raise RuntimeError("scene/block count mismatch")
    plans: list[tuple[str, SegmentPlan]] = []
    direction = VoiceDirection(
        direction_version="0.1.0", base_direction_id="jaromail-technical-v1",
        base_instruction=DIRECTION, delta=DeliveryDelta(), composed_instruction=DIRECTION,
    )
    for scene, block in zip(scenes, normalized, strict=True):
        item = SegmentationInput(
            source_anchor_id=block.block_id,
            source_document_sha256=block.source_document_sha256,
            source_block_ids=(block.block_id,), source_spans=(SourceSpan(start=0, end=len(block.spoken_text)),),
            source_spans_exact=False, display_text=block.spoken_text, spoken_text=block.spoken_text,
            language="en-US", role=SpeechRole.NARRATOR, speaker_profile_id="jaromail-serena-v1",
        )
        segmented = segment_speech((item,))
        reconstructed = "".join(s.spoken_text + s.spoken_separator_after for s in segmented.segments)
        if reconstructed != block.spoken_text:
            raise RuntimeError(f"spoken conservation failed for {scene['id']}")
        for semantic in segmented.segments:
            plans.append((scene["id"], SegmentPlan(
                segment_id=semantic.segment_id,
                source_document_sha256=semantic.source_document_sha256,
                source_block_ids=semantic.source_block_ids, source_spans=semantic.source_spans,
                preprocessing_version="jaromail-production-v1",
                display_text=semantic.display_text, spoken_text=semantic.spoken_text,
                language="en-US", role=semantic.role,
                speaker_profile_id="jaromail-serena-v1", direction=direction,
                context=SegmentContext(), pause_after_ms=semantic.pause.duration_hint_ms,
            )))
    return scenes, plans


def retime_srt(old_srt: str, old_timing: list[dict], new_timing: list[dict]) -> str:
    stamp = re.compile(r"(\d\d):(\d\d):(\d\d),(\d\d\d)")
    def seconds(value: str) -> float:
        h, m, s, ms = map(int, stamp.fullmatch(value).groups())
        return h * 3600 + m * 60 + s + ms / 1000
    def render(value: float) -> str:
        millis = round(value * 1000); h, rem = divmod(millis, 3_600_000)
        m, rem = divmod(rem, 60_000); s, ms = divmod(rem, 1000)
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"
    new_by_id = {item["id"]: item for item in new_timing}
    blocks = []
    for block in re.split(r"\n\s*\n", old_srt.strip()):
        lines = block.splitlines(); start_text, end_text = lines[1].split(" --> ")
        start, end = seconds(start_text), seconds(end_text)
        old = next((item for item in old_timing if item["start"] - 0.001 <= start < item["end"] + 0.001), None)
        if old is None: raise RuntimeError(f"caption at {start} is outside old timing")
        new = new_by_id[old["id"]]; scale = new["duration"] / old["duration"]
        mapped_start = new["start"] + max(0, start - old["start"]) * scale
        mapped_end = new["start"] + min(old["duration"], end - old["start"]) * scale
        blocks.append("\n".join([lines[0], f"{render(mapped_start)} --> {render(mapped_end)}", *lines[2:]]))
    return "\n\n".join(blocks) + "\n"


def slice_scenes(mastered: Path, scene_frames: dict[str, int], destination: Path) -> dict[str, float]:
    with wave.open(str(mastered), "rb") as source:
        params = source.getparams(); raw = source.readframes(source.getnframes())
    cursor = 0; durations = {}
    for scene, frames in scene_frames.items():
        piece = raw[cursor * 2:(cursor + frames) * 2]
        with wave.open(str(destination / f"{scene}.wav"), "wb") as out:
            out.setparams(params); out.writeframes(piece)
        durations[scene] = frames / 24_000; cursor += frames
    if cursor * 2 != len(raw): raise RuntimeError("scene slices do not reconstruct mastered WAV")
    return durations


def compose(episode: Path, timing: list[dict], audio: Path, captions: Path, output: Path) -> None:
    inputs: list[str] = []; filters: list[str] = []
    for index, item in enumerate(timing):
        scene = item["id"]; duration = item["duration"]
        image = episode / "assets" / "images" / f"{scene}.jpg"
        video = episode / "assets" / "tapes" / f"{scene}.mp4"
        if image.is_file(): inputs += ["-loop", "1", "-t", f"{duration:.6f}", "-i", str(image)]
        elif video.is_file(): inputs += ["-i", str(video)]
        else: raise RuntimeError(f"missing visual asset for {scene}")
        filters.append(
            f"[{index}:v]scale=1920:1080:force_original_aspect_ratio=decrease,"
            f"pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30,"
            f"tpad=stop_mode=clone:stop_duration={duration:.6f},trim=duration={duration:.6f},setpts=PTS-STARTPTS[v{index}]"
        )
    audio_index = len(timing); inputs += ["-i", str(audio)]
    joined = "".join(f"[v{i}]" for i in range(len(timing)))
    # Captions remain as a retimed SRT sidecar; the local FFmpeg build has no libass.
    filters.append(f"{joined}concat=n={len(timing)}:v=1:a=0[v]")
    command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *inputs,
               "-filter_complex", ";".join(filters), "-map", "[v]", "-map", f"{audio_index}:a:0",
               "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
               "-c:a", "aac", "-b:a", "192k", "-ar", "24000", "-ac", "1", "-shortest", "-movflags", "+faststart", str(output)]
    subprocess.run(command, check=True, timeout=900)
    subprocess.run(["ffmpeg", "-v", "error", "-i", str(output), "-f", "null", "-"], check=True, timeout=300)


def regenerate(episode: Path, resume_run: str | None = None) -> dict:
    script = episode / "artifacts" / "narration-script.json"
    old_timing = json.loads((episode / "artifacts" / "timing.json").read_text())
    old_srt = (episode / "artifacts" / "captions.srt").read_text()
    scenes, plans = make_plans(script)
    run_id = resume_run or ("jaromail-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
    narration = episode / "artifacts" / "narration"
    run = narration / "runs" / run_id
    identity = model_identity()
    scene_frames = {scene["id"]: 0 for scene in scenes}
    records = []
    if resume_run:
        report_paths = list(run.glob("mastered/*/mastering-report.json"))
        if len(report_paths) != 1:
            raise RuntimeError(f"resume run must contain exactly one mastering report: {run}")
        report = MasteringReport.model_validate_json(report_paths[0].read_text())
        records = [json.loads(path.read_text()) for path in sorted((run / "raw").glob("*/record.json"))]
        if len(records) != len(plans):
            raise RuntimeError("resume run record count does not match current semantic plan")
        for record in records:
            transformed = record["transform"]
            frames = round(transformed["transformed_wav"]["duration_seconds"] * 24_000)
            if transformed["pause_wav"]:
                frames += round(transformed["pause_wav"]["duration_seconds"] * 24_000)
            scene_frames[record["scene_id"]] += frames
    else:
        run.mkdir(parents=True)
        backend = inspect_customvoice_model(MODEL)
        processor = AudioProcessor(); assembly_entries = []
        try:
            with model_lifecycle.acquire(backend.path) as loaded:
                for ordinal, (scene_id, plan) in enumerate(plans, 1):
                    seed = 47000 + ordinal
                    profile = SynthesisProfile(
                        profile_id="jaromail-serena-v1", profile_revision="1", model=identity,
                        speaker="serena", language="english",
                        sampling=SamplingProfile(temperature=0.7, top_k=50, top_p=1.0,
                                                 repetition_penalty=1.05, max_tokens=1200, seed=seed),
                    )
                    request = SynthesizeRequest(text=plan.spoken_text, voice="serena", language="english",
                                                instruct=DIRECTION, seed=seed)
                    started = time.monotonic(); data, info = synthesize_with_qwen(request, backend, "serena", loaded.instance)
                    elapsed = time.monotonic() - started; model_lifecycle.record_synthesis(elapsed)
                    raw_dir = run / "raw" / plan.segment_id; raw_dir.mkdir(parents=True)
                    raw_path = raw_dir / "raw.wav"; raw_path.write_bytes(data)
                    wav = artifact(str(raw_path.relative_to(run)), data, info.duration_seconds)
                    attempt = SynthesisAttempt(
                        segment_id=plan.segment_id,
                        request_fingerprint=sha(json.dumps({"segment": plan.model_dump(mode="json"), "profile": profile.model_dump(mode="json")}, sort_keys=True).encode()),
                        phase=AttemptPhase.COMPLETED, profile=profile, direction=plan.direction, raw_wav=wav,
                        created_at=datetime.now(timezone.utc), completed_at=datetime.now(timezone.utc),
                        processing_seconds=elapsed, peak_memory_bytes=model_lifecycle.snapshot().peak_memory_bytes,
                    )
                    evidence = validate_attempt_signal(attempt, run, spoken_word_count=len(plan.spoken_text.split()))
                    if evidence.report.decision.value != "accept":
                        raise RuntimeError(f"signal validation {evidence.report.decision.value} for {plan.segment_id}")
                    transformed = processor.process_attempt(attempt, evidence.report, run, run, pause_after_ms=plan.pause_after_ms)
                    entry = AssemblyEntry(segment_id=plan.segment_id, accepted_attempt_id=attempt.attempt_id,
                                          quality_report_id=evidence.report.report_id, transform_id=transformed.transform_id,
                                          speech_wav=transformed.transformed_wav, pause_wav=transformed.pause_wav,
                                          pause_after_ms=plan.pause_after_ms)
                    assembly_entries.append(entry)
                    frames = round(entry.speech_wav.duration_seconds * 24_000) + (round(entry.pause_wav.duration_seconds * 24_000) if entry.pause_wav else 0)
                    scene_frames[scene_id] += frames
                    record = {"scene_id": scene_id, "segment": plan.model_dump(mode="json"), "profile": profile.model_dump(mode="json"),
                              "attempt": attempt.model_dump(mode="json"), "quality": evidence.model_dump(mode="json"),
                              "transform": transformed.model_dump(mode="json"), "elapsed_seconds": elapsed}
                    (raw_dir / "record.json").write_text(json.dumps(record, indent=2) + "\n"); records.append(record)
        finally:
            model_lifecycle.unload(wait=True)
        plan = AssemblyPlan(episode_id="dyne/software/jaromail", source_revision=sha(script.read_bytes()), entries=tuple(assembly_entries))
        report = NarrationMasterer().master(plan, run, run)
    mastered = run / report.final_wav.path
    publish = Path(tempfile.mkdtemp(prefix=".jaromail-publish-", dir=narration))
    try:
        shutil.copy2(mastered, publish / "narration-full.wav")
        durations = slice_scenes(mastered, scene_frames, publish)
        timing = []; cursor = 0.0
        for scene in scenes:
            duration = durations[scene["id"]]
            timing.append({"id": scene["id"], "title": next(x["title"] for x in old_timing if x["id"] == scene["id"]),
                           "start": round(cursor, 6), "duration": round(duration, 6), "end": round(cursor + duration, 6)})
            cursor += duration
        captions_text = retime_srt(old_srt, old_timing, timing)
        staged_video = episode / "artifacts" / f".{run_id}.mp4"
        staged_srt = episode / "artifacts" / f".{run_id}.srt"; staged_srt.write_text(captions_text)
        compose(episode, timing, publish / "narration-full.wav", staged_srt, staged_video)
        manifest = report.manifest.model_dump(mode="json")
        manifest["final_wav"]["path"] = "artifacts/narration/narration-full.wav"
        for item in manifest["entries"]:
            item["wav"]["path"] = f"artifacts/narration/runs/{run_id}/{item['wav']['path']}"
        (publish / "narration-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        (publish / "mastering-report.json").write_text(report.model_dump_json(indent=2) + "\n")
        provenance = {"schema_version": "0.1.0", "run_id": run_id, "provider_mode": "live",
                      "created_at": datetime.now(timezone.utc).isoformat(), "model": identity.model_dump(mode="json"),
                      "direction": DIRECTION, "segments": len(plans), "scenes": len(scenes),
                      "model_load_count": 1,
                      "peak_memory_bytes": max(r["attempt"].get("peak_memory_bytes", 0) or 0 for r in records),
                      "mastering": report.measured.model_dump(mode="json"), "final_wav_sha256": report.final_wav.sha256}
        (publish / "regeneration.json").write_text(json.dumps(provenance, indent=2) + "\n")
        for scene in scenes:
            sid = scene["id"]; related = [r for r in records if r["scene_id"] == sid]
            (publish / f"{sid}.json").write_text(json.dumps({"id": sid, "duration_sec": durations[sid],
                "provider_mode": "live", "run_id": run_id, "attempt_ids": [r["attempt"]["attempt_id"] for r in related],
                "segment_ids": [r["segment"]["segment_id"] for r in related]}, indent=2) + "\n")
        for path in publish.iterdir(): os.replace(path, narration / path.name)
        (episode / "artifacts" / "timing.json").write_text(json.dumps(timing, indent=2) + "\n")
        os.replace(staged_srt, episode / "artifacts" / "captions.srt")
        os.replace(staged_video, episode / "artifacts" / "final.mp4")
    finally:
        shutil.rmtree(publish, ignore_errors=True)
    return {"run_id": run_id, "scene_count": len(scenes), "segment_count": len(plans),
            "duration_seconds": report.final_duration_seconds, "loudness": report.measured.model_dump(mode="json"),
            "boundary_failures": sum(b.status == "fail" for b in report.boundaries),
            "final_wav_sha256": report.final_wav.sha256,
            "video": str(episode / "artifacts" / "final.mp4")}


def main() -> None:
    parser = argparse.ArgumentParser(); parser.add_argument("--episode", type=Path, default=DEFAULT_EPISODE)
    parser.add_argument("--resume-run", help="Reuse an immutable generated/mastered run after a publish/composition failure")
    args = parser.parse_args(); print(json.dumps(regenerate(args.episode.resolve(), args.resume_run), indent=2))


if __name__ == "__main__": main()
