#!/usr/bin/env python3
"""Capture a complete, resumable baseline through the legacy /synthesize path.

The script intentionally does not import worker internals. It records exactly
what an external caller can observe before synthesis behavior is corrected.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import wave
from array import array
from datetime import datetime, timezone
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any


HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent
DEFAULT_FIXTURE = HERE / "fixtures" / "quality-v1.json"
MODEL_DIR = PROJECT / "models" / "qwen3-tts-1.7b-customvoice-8bit"
SPEAKERS = {
    "narrator-under-test": "serena",
    "mira-under-test": "vivian",
}
BASE_INSTRUCTIONS = {
    "narrator-under-test": "Speak warmly and clearly with natural pacing and a stable narrator voice.",
    "mira-under-test": "Speak clearly and naturally as the same character, Mira.",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def sha256_file(path: Path, block_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while block := handle.read(block_size):
            digest.update(block)
    return digest.hexdigest()


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def package_version(name: str) -> str | None:
    try:
        return version(name)
    except PackageNotFoundError:
        return None


def command_output(*args: str) -> str | None:
    try:
        return subprocess.check_output(args, cwd=PROJECT, text=True, stderr=subprocess.DEVNULL).strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def git_state() -> dict[str, Any]:
    revision = command_output("git", "rev-parse", "HEAD")
    status = command_output("git", "status", "--porcelain")
    return {"revision": revision, "dirty": bool(status), "status_porcelain": status or ""}


def hardware_state() -> dict[str, Any]:
    memory = command_output("sysctl", "-n", "hw.memsize")
    return {
        "platform": platform.platform(),
        "machine": platform.machine(),
        "processor": platform.processor(),
        "python": platform.python_version(),
        "physical_memory_bytes": int(memory) if memory and memory.isdigit() else None,
    }


def http_json(url: str, payload: dict[str, Any] | None = None, timeout: float = 600) -> dict[str, Any]:
    body = None
    headers = {"Accept": "application/json"}
    method = "GET"
    if payload is not None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
        method = "POST"
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            parsed = json.loads(response.read().decode("utf-8"))
            parsed["_http_status"] = response.status
            return parsed
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            detail: Any = json.loads(raw)
        except json.JSONDecodeError:
            detail = raw
        return {"_http_status": exc.code, "_http_error": detail}


def compose_instruction(segment: dict[str, Any]) -> str:
    """Map fixture intent to the free-form instruction accepted by legacy API."""

    profile = segment["speaker_profile"]
    delivery = segment["delivery"]
    clauses: list[str] = []
    labels = {
        "emotion": "emotion",
        "pace": "pace",
        "articulation": "articulation",
        "energy": "energy",
        "intensity": "intensity",
        "intent": "intent",
        "distance": "vocal distance",
    }
    for key in ("emotion", "pace", "articulation", "energy", "intensity", "intent", "distance"):
        if value := delivery.get(key):
            clauses.append(f"{labels[key]}: {value}")
    suffix = "; ".join(clauses)
    return f"{BASE_INSTRUCTIONS[profile]} Delivery guidance — {suffix}." if suffix else BASE_INSTRUCTIONS[profile]


def dbfs(value: float) -> float:
    return round(20.0 * math.log10(max(value, 1.0 / 32768.0)), 3)


def analyze_wav(path: Path, spoken_text: str) -> dict[str, Any]:
    """Return inexpensive, deterministic PCM signal checks."""

    report: dict[str, Any] = {
        "validator_version": "legacy-baseline-signal-1",
        "path": str(path),
        "sha256": sha256_file(path),
        "size_bytes": path.stat().st_size,
        "valid": False,
        "failure_reasons": [],
    }
    try:
        with wave.open(str(path), "rb") as wav:
            channels = wav.getnchannels()
            sample_width = wav.getsampwidth()
            sample_rate = wav.getframerate()
            frame_count = wav.getnframes()
            compression = wav.getcomptype()
            raw = wav.readframes(frame_count)
    except (OSError, EOFError, wave.Error) as exc:
        report["failure_reasons"].append(f"invalid_wav:{exc}")
        return report

    report.update(
        {
            "channels": channels,
            "sample_width_bytes": sample_width,
            "sample_rate": sample_rate,
            "frame_count": frame_count,
            "duration_seconds": round(frame_count / sample_rate, 6) if sample_rate else 0.0,
            "compression": compression,
        }
    )
    if compression != "NONE":
        report["failure_reasons"].append("compressed_wav")
    if channels != 1:
        report["failure_reasons"].append("not_mono")
    if sample_width != 2:
        report["failure_reasons"].append("not_pcm16")
    if sample_rate != 24_000:
        report["failure_reasons"].append("unexpected_sample_rate")
    if not raw or sample_width != 2:
        report["failure_reasons"].append("missing_pcm_samples")
        return report

    samples = array("h")
    samples.frombytes(raw)
    if sys.byteorder != "little":
        samples.byteswap()
    values = [int(sample) for sample in samples]
    if not values:
        report["failure_reasons"].append("missing_pcm_samples")
        return report

    count = len(values)
    peak = max(abs(value) for value in values)
    mean = sum(values) / count
    rms = math.sqrt(sum(value * value for value in values) / count)
    silence_threshold = round(32768 * 10 ** (-50 / 20))

    leading = 0
    for value in values:
        if abs(value) > silence_threshold:
            break
        leading += 1
    trailing = 0
    for value in reversed(values):
        if abs(value) > silence_threshold:
            break
        trailing += 1

    duration = frame_count / sample_rate if sample_rate else 0.0
    words = len(spoken_text.split())
    report.update(
        {
            "peak_dbfs": dbfs(peak / 32768.0),
            "rms_dbfs": dbfs(rms / 32768.0),
            "clipped_sample_ratio": round(sum(abs(value) >= 32760 for value in values) / count, 9),
            "dc_offset": round(mean / 32768.0, 9),
            "leading_silence_ms": round(leading / (sample_rate * channels) * 1000, 3),
            "trailing_silence_ms": round(trailing / (sample_rate * channels) * 1000, 3),
            "spoken_words_per_minute": round(words / duration * 60, 3) if duration else 0.0,
            "speech_presence_threshold_dbfs": -50.0,
        }
    )
    if duration <= 0.1:
        report["failure_reasons"].append("duration_too_short")
    if report["rms_dbfs"] <= -50.0:
        report["failure_reasons"].append("silent_or_near_silent")
    if report["clipped_sample_ratio"] > 0.001:
        report["failure_reasons"].append("excessive_clipping")
    report["valid"] = not report["failure_reasons"]
    return report


def server_rss_bytes(pid: int | None) -> int | None:
    if pid is None:
        return None
    rss = command_output("ps", "-o", "rss=", "-p", str(pid))
    return int(rss) * 1024 if rss and rss.isdigit() else None


def source_manifest() -> dict[str, Any]:
    """Hash the exact legacy implementation and capture tool used by a run."""

    relative_paths = (
        "pyproject.toml",
        "requirements.txt",
        "src/qwen_tts_worker/__main__.py",
        "src/qwen_tts_worker/app.py",
        "src/qwen_tts_worker/config.py",
        "src/qwen_tts_worker/routes/synthesis.py",
        "evaluation/capture_legacy_baseline.py",
    )
    return {
        relative: {"sha256": sha256_file(PROJECT / relative), "size_bytes": (PROJECT / relative).stat().st_size}
        for relative in relative_paths
    }


def model_manifest() -> dict[str, Any]:
    files: dict[str, Any] = {}
    for name in ("config.json", "generation_config.json", "model.safetensors"):
        path = MODEL_DIR / name
        files[name] = {
            "size_bytes": path.stat().st_size,
            "sha256": sha256_file(path),
        }
    return {
        "path": str(MODEL_DIR),
        "profile": "custom_voice",
        "quantization": "8bit-affine-g64",
        "files": files,
    }


def direct_concat(paths: list[Path], output: Path) -> dict[str, Any]:
    """Reproduce legacy stream-style assembly without synthetic pauses."""

    output.parent.mkdir(parents=True, exist_ok=True)
    parameters: tuple[int, int, int, str, str] | None = None
    frames: list[bytes] = []
    for path in paths:
        with wave.open(str(path), "rb") as wav:
            current = (
                wav.getnchannels(),
                wav.getsampwidth(),
                wav.getframerate(),
                wav.getcomptype(),
                wav.getcompname(),
            )
            if parameters is None:
                parameters = current
            elif current != parameters:
                raise ValueError(f"incompatible WAV parameters: {path}")
            frames.append(wav.readframes(wav.getnframes()))
    if parameters is None:
        raise ValueError("cannot concatenate an empty path list")
    with wave.open(str(output), "wb") as wav:
        wav.setnchannels(parameters[0])
        wav.setsampwidth(parameters[1])
        wav.setframerate(parameters[2])
        wav.setcomptype(parameters[3], parameters[4])
        for payload in frames:
            wav.writeframes(payload)
    return {
        "assembly_policy": "legacy-direct-concat-no-explicit-pauses",
        "input_paths": [str(path) for path in paths],
        "output_path": str(output),
        "sha256": sha256_file(output),
        "size_bytes": output.stat().st_size,
    }


def initialize_run(
    output: Path,
    fixture_path: Path,
    fixture: dict[str, Any],
    endpoint: str,
    server_pid: int | None,
) -> dict[str, Any]:
    run_path = output / "run.json"
    fixture_hash = sha256_file(fixture_path)
    if run_path.exists():
        run = json.loads(run_path.read_text(encoding="utf-8"))
        if run["fixture"]["sha256"] != fixture_hash:
            raise RuntimeError("existing run uses a different fixture")
        if run["endpoint"] != endpoint:
            raise RuntimeError("existing run uses a different endpoint")
        run["source_files"] = source_manifest()
        return run

    run = {
        "schema_version": "0.1.0",
        "run_id": output.name,
        "classification": "controlled-legacy-baseline",
        "status": "running",
        "started_at": utc_now(),
        "completed_at": None,
        "endpoint": endpoint,
        "legacy_limitations": [
            "model reloads for each request",
            "language is accepted but not forwarded as lang_code",
            "sampling seed/top-k/top-p/repetition penalty are not exposed",
            "voice instructions are unconstrained free text",
            "successful fallback silence is possible",
            "assembly has no explicit pause or mastering policy",
        ],
        "fixture": {
            "path": str(fixture_path),
            "sha256": fixture_hash,
            "suite_id": fixture["suite_id"],
            "fixture_version": fixture["fixture_version"],
            "repeat_count": fixture["default_repeat_count"],
            "baseline_input_policy": "send expected segment display_text; retain spoken_text as the candidate normalization target",
        },
        "source_repository": git_state(),
        "source_files": source_manifest(),
        "runtime": {
            "hardware": hardware_state(),
            "packages": {
                "qwen-tts-worker": package_version("qwen-tts-worker"),
                "mlx-audio": package_version("mlx-audio"),
                "mlx": package_version("mlx"),
                "fastapi": package_version("fastapi"),
                "uvicorn": package_version("uvicorn"),
            },
            "server_pid": server_pid,
            "health_at_start": http_json(endpoint.rsplit("/", 1)[0] + "/health"),
        },
        "model": model_manifest(),
        "request_profile": {
            "temperature": 0.7,
            "speed": 1.0,
            "language": "english",
            "seed": None,
            "seed_limitation": "legacy endpoint does not expose or apply a seed",
            "speakers": SPEAKERS,
            "instruction_policy": "legacy-freeform-1",
        },
        "historical_episode_audio": {
            "classification": "legacy-uncontrolled",
            "eligible_as_controlled_baseline": False,
            "reason": "Historical files lack complete source/profile/seed/runtime provenance and inspected worker outputs include silent WAVs.",
        },
    }
    write_json(run_path, run)
    return run


def capture(args: argparse.Namespace) -> int:
    fixture_path = args.fixture.resolve()
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    run = initialize_run(output, fixture_path, fixture, args.endpoint, args.server_pid)

    total = sum(len(case["expected_segments"]) for case in fixture["cases"]) * args.repeats
    completed = 0
    valid = 0
    failed = 0
    print(f"Capturing {total} legacy attempts in {output}", flush=True)

    for case in fixture["cases"]:
        for segment in case["expected_segments"]:
            for repeat in range(1, args.repeats + 1):
                attempt_dir = output / "attempts" / segment["segment_id"] / f"repeat-{repeat}"
                response_path = attempt_dir / "response.json"
                report_path = attempt_dir / "signal-report.json"
                raw_path = attempt_dir / "raw.wav"
                if response_path.exists() and report_path.exists():
                    report = json.loads(report_path.read_text(encoding="utf-8"))
                    completed += 1
                    valid += int(bool(report.get("valid")))
                    failed += int(not bool(report.get("valid")))
                    print(f"[{completed}/{total}] resume {segment['segment_id']} repeat {repeat}", flush=True)
                    continue

                attempt_dir.mkdir(parents=True, exist_ok=True)
                request_body = {
                    "text": segment["display_text"],
                    "voice": SPEAKERS[segment["speaker_profile"]],
                    "speed": 1.0,
                    "temperature": 0.7,
                    "instruct": compose_instruction(segment),
                    "language": "english",
                }
                request_record = {
                    "captured_at": utc_now(),
                    "case_id": case["case_id"],
                    "segment_id": segment["segment_id"],
                    "repeat": repeat,
                    "expected_spoken_text": segment["spoken_text"],
                    "expected_pause_after_ms": segment["pause_after_ms"],
                    "body": request_body,
                }
                write_json(attempt_dir / "request.json", request_record)

                started = time.monotonic()
                captured_at = utc_now()
                try:
                    response = http_json(args.endpoint, request_body, timeout=args.timeout)
                except (OSError, TimeoutError) as exc:
                    response = {"transport_error": f"{type(exc).__name__}: {exc}"}
                elapsed = time.monotonic() - started
                response_record = {
                    "captured_at": captured_at,
                    "completed_at": utc_now(),
                    "wall_seconds": round(elapsed, 6),
                    "server_rss_bytes_after": server_rss_bytes(args.server_pid),
                    "response": response,
                }
                write_json(response_path, response_record)

                report: dict[str, Any]
                source_wav_value = response.get("result", {}).get("wav_path") if isinstance(response, dict) else None
                source_wav = Path(source_wav_value) if source_wav_value else None
                if response.get("ok") and source_wav and source_wav.exists():
                    shutil.copy2(source_wav, raw_path)
                    report = analyze_wav(raw_path, segment["spoken_text"])
                else:
                    report = {
                        "validator_version": "legacy-baseline-signal-1",
                        "valid": False,
                        "failure_reasons": ["synthesis_failed_or_missing_output"],
                        "response_status": response.get("_http_status"),
                    }
                report.update(
                    {
                        "case_id": case["case_id"],
                        "segment_id": segment["segment_id"],
                        "repeat": repeat,
                        "wall_seconds": round(elapsed, 6),
                    }
                )
                write_json(report_path, report)
                completed += 1
                valid += int(bool(report["valid"]))
                failed += int(not bool(report["valid"]))
                outcome = "valid" if report["valid"] else "FAILED"
                print(f"[{completed}/{total}] {segment['segment_id']} repeat {repeat}: {outcome} ({elapsed:.2f}s)", flush=True)

    assemblies: list[dict[str, Any]] = []
    for case in fixture["cases"]:
        paths = [
            output / "attempts" / segment["segment_id"] / "repeat-1" / "raw.wav"
            for segment in case["expected_segments"]
        ]
        if all(path.exists() for path in paths):
            assembly_path = output / "assembly" / f"{case['case_id']}.wav"
            result = direct_concat(paths, assembly_path)
            result["case_id"] = case["case_id"]
            result["signal_report"] = analyze_wav(
                assembly_path,
                " ".join(segment["spoken_text"] for segment in case["expected_segments"]),
            )
            assemblies.append(result)
    write_json(output / "assembly" / "manifest.json", {"assemblies": assemblies})

    summary = {
        "schema_version": "0.1.0",
        "run_id": output.name,
        "completed_at": utc_now(),
        "attempts_expected": total,
        "attempts_completed": completed,
        "attempts_valid": valid,
        "attempts_failed": failed,
        "completion_rate": round(completed / total, 6) if total else 0.0,
        "valid_rate": round(valid / total, 6) if total else 0.0,
        "assembled_cases": len(assemblies),
        "baseline_status": "complete" if completed == total else "incomplete",
    }
    write_json(output / "summary.json", summary)
    run["status"] = summary["baseline_status"]
    run["completed_at"] = summary["completed_at"]
    run["summary"] = summary
    write_json(output / "run.json", run)
    print(json.dumps(summary, indent=2), flush=True)
    return 0 if completed == total else 1


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture", type=Path, default=DEFAULT_FIXTURE)
    parser.add_argument("--endpoint", default="http://127.0.0.1:5197/synthesize")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--timeout", type=float, default=600)
    parser.add_argument("--server-pid", type=int)
    args = parser.parse_args()
    if args.repeats < 3:
        parser.error("--repeats must be at least 3 for a controlled stochastic baseline")
    return args


if __name__ == "__main__":
    raise SystemExit(capture(parse_args()))
