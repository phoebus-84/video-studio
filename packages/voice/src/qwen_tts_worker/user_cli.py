"""Human-facing local CLI for install, diagnostics, service, voices, and synthesis."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import ipaddress
import json
import os
import platform
import shutil
import sys
import urllib.error
import urllib.request
from urllib.parse import urlparse
from pathlib import Path
from typing import Any, Mapping

from qwen_tts_worker.cli import DownloadError, download_model
from qwen_tts_worker.config import Settings
from qwen_tts_worker.macos_service import ServiceError, install as install_service
from qwen_tts_worker.macos_service import launch_agent_path, launchctl, service_paths, uninstall
from qwen_tts_worker.models.catalog import MODEL_SPECS
from qwen_tts_worker.models.registry import InstallStatus, ModelRegistry


class CliError(RuntimeError):
    pass


def _default_models_dir() -> Path:
    configured = os.environ.get("QTW_MODELS_DIR")
    if configured: return Path(configured).expanduser()
    if sys.platform == "darwin": return service_paths()["models"]
    return Settings().models_dir


def serve_environment(
    environ: Mapping[str, str], system: str, home: Path | None = None, dotenv: Mapping[str, str | None] | None = None,
) -> dict[str, str]:
    """The data directories ``serve`` exports: on macOS the service's, where ``install`` puts the models.

    A foreground worker started from the repository otherwise looked in ``./models``, found
    nothing, and failed its first synthesis while ``/health`` said ready (avg-07q). A directory
    set in the environment is kept; one set in ``.env`` is exported as it is, since
    ``/synthesize`` reads the process environment and not ``.env``.
    """
    dotenv = dotenv or {}
    service = service_paths(home) if system == "darwin" else {}
    out: dict[str, str] = {}
    for name, key in (("QTW_MODELS_DIR", "models"), ("QTW_VOICES_DIR", "voices"), ("QTW_OUTPUTS_DIR", "outputs")):
        if environ.get(name): continue
        if dotenv.get(name): out[name] = str(dotenv[name])
        elif key in service: out[name] = str(service[key])
    return out


def _api(base_url: str, method: str, path: str, payload: dict[str, Any] | None = None) -> Any:
    parsed = urlparse(base_url)
    hostname = parsed.hostname or ""
    try: loopback = hostname.lower() == "localhost" or ipaddress.ip_address(hostname).is_loopback
    except ValueError: loopback = hostname.lower() == "localhost"
    if parsed.scheme != "http" or not loopback or parsed.username or parsed.password:
        raise CliError("worker URL must be unauthenticated HTTP on an explicit loopback host")
    data = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(
        base_url.rstrip("/") + path, data=data, method=method,
        headers={"content-type": "application/json", "accept": "application/json"},
    )
    try:
        # Scheme, credentials, and explicit loopback host are validated above.
        with urllib.request.urlopen(request, timeout=120) as response:  # nosec B310
            body = response.read()
            return json.loads(body) if body else None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        raise CliError(f"worker returned HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise CliError(f"cannot reach worker at {base_url}: {exc.reason}") from exc


def _text(args: argparse.Namespace) -> str:
    if getattr(args, "text", None) is not None: value = args.text
    elif getattr(args, "file", None) is not None: value = args.file.read_text()
    else: value = sys.stdin.read()
    if not value.strip(): raise CliError("input text is blank")
    return value


def _copy_worker_wav(result: dict[str, Any], output: Path) -> None:
    worker_result = result.get("result", result)
    if worker_result.get("status") == "failed" or result.get("ok") is False:
        raise CliError(worker_result.get("error", "synthesis failed"))
    source_name = worker_result.get("wav_path")
    if not source_name: raise CliError("worker response contains no wav_path")
    source = Path(source_name)
    if not source.is_file(): raise CliError(f"worker output is unavailable locally: {source}")
    expected_hash = worker_result.get("wav_sha256")
    if expected_hash is not None and hashlib.sha256(source.read_bytes()).hexdigest() != expected_hash:
        raise CliError("worker output SHA-256 does not match its response provenance")
    output = output.expanduser().resolve(); output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".tmp")
    shutil.copyfile(source, temporary); os.replace(temporary, output)
    print(output)


def _doctor(args: argparse.Namespace) -> int:
    models_dir = args.models_dir.expanduser().resolve()
    checks: list[dict[str, Any]] = []
    def add(name: str, ok: bool, detail: str) -> None: checks.append({"name": name, "ok": ok, "detail": detail})
    from qwen_tts_worker.backends import backend_name, resolve_runtime
    backend = backend_name()
    add("platform", True, platform.platform())
    try:
        add("inference runtime", True, json.dumps(resolve_runtime().as_dict(), sort_keys=True))
    except (RuntimeError, ValueError, ImportError) as exc:
        add("inference runtime", False, str(exc))
    add("Python", sys.version_info >= (3, 10), platform.python_version())
    add("FFmpeg", shutil.which("ffmpeg") is not None, shutil.which("ffmpeg") or "not found")
    for module in (("mlx", "mlx_audio", "huggingface_hub") if backend == "mlx" else ("torch", "qwen_tts", "huggingface_hub")):
        add(f"module:{module}", importlib.util.find_spec(module) is not None, "available" if importlib.util.find_spec(module) else "missing")
    free = shutil.disk_usage(models_dir.parent if models_dir.parent.exists() else Path.home()).free
    add("free disk", free >= 5_000_000_000, f"{free / 2**30:.1f} GiB")
    registry = ModelRegistry(models_dir)
    reports = registry.scan()
    verified = [
        f"{item.size.value}/{item.profile.value}"
        for item in reports if item.status == InstallStatus.COMPLETE and item.verified
    ]
    add("verified model", bool(verified), ", ".join(verified) or f"none in {models_dir}")
    try:
        health = _api(args.url, "GET", "/health")
        add("worker", health.get("service") in {"healthy", "degraded"}, json.dumps(health, sort_keys=True))
    except CliError as exc: add("worker", False, str(exc))
    ok = all(item["ok"] for item in checks)
    if args.json: print(json.dumps({"ok": ok, "checks": checks}, indent=2))
    else:
        for item in checks: print(f"{'PASS' if item['ok'] else 'FAIL':4}  {item['name']}: {item['detail']}")
    return 0 if ok else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="qwen-tts", description="Local Qwen3-TTS control tool for MLX, CPU, CUDA and ROCm")
    parser.add_argument("--backend", choices=("auto", "mlx", "torch"), default=None)
    parser.add_argument("--device", default=None, help="auto, cpu, cuda, or cuda:N; ROCm uses cuda:N")
    parser.add_argument("--url", default=os.environ.get("QTW_URL", "http://127.0.0.1:8000"))
    sub = parser.add_subparsers(dest="command", required=True)

    install = sub.add_parser("install", help="install one pinned checkpoint for the selected backend")
    install.add_argument("size", choices=sorted({item.size for item in MODEL_SPECS}))
    install.add_argument("--profile", choices=sorted({item.profile for item in MODEL_SPECS}), default="custom_voice")
    install.add_argument("--models-dir", type=Path, default=_default_models_dir())
    install.add_argument("--replace", action="store_true")

    doctor = sub.add_parser("doctor", help="run actionable local readiness checks")
    doctor.add_argument("--models-dir", type=Path, default=_default_models_dir()); doctor.add_argument("--json", action="store_true")

    sub.add_parser("serve", help="run the worker in the foreground")
    sub.add_parser("models", help="list worker model profiles as JSON")
    service = sub.add_parser("service", help="manage the per-user macOS LaunchAgent")
    service.add_argument("action", choices=("install", "uninstall", "start", "stop", "status")); service.add_argument("--port", type=int, default=8000)

    synth = sub.add_parser("synthesize", help="synthesize with a CustomVoice preset")
    source = synth.add_mutually_exclusive_group(); source.add_argument("--text"); source.add_argument("--file", type=Path)
    synth.add_argument("--output", "-o", type=Path, required=True); synth.add_argument("--voice", default="serena")
    synth.add_argument("--language", default="auto"); synth.add_argument("--instruct"); synth.add_argument("--seed", type=int, default=42)

    voices = sub.add_parser("voices", help="list, inspect, or revoke voices")
    voices.add_argument("action", choices=("list", "show", "delete")); voices.add_argument("voice_id", nargs="?")

    clone = sub.add_parser("clone", help="enroll or synthesize a consented clone")
    clone_sub = clone.add_subparsers(dest="clone_action", required=True)
    enroll = clone_sub.add_parser("enroll")
    enroll.add_argument("--name", required=True); enroll.add_argument("--reference", type=Path, required=True)
    enroll.add_argument("--transcript", required=True); enroll.add_argument("--language", default="en-US")
    enroll.add_argument("--source", choices=("self_recorded", "licensed", "synthetic"), required=True)
    enroll.add_argument("--consent-statement", required=True); enroll.add_argument("--license-or-terms", required=True)
    csynth = clone_sub.add_parser("synthesize"); csynth.add_argument("voice_id")
    csource = csynth.add_mutually_exclusive_group(); csource.add_argument("--text"); csource.add_argument("--file", type=Path)
    csynth.add_argument("--output", "-o", type=Path, required=True); csynth.add_argument("--language", default="english")
    csynth.add_argument("--model-size", choices=("0.6B", "1.7B"), default="1.7B"); csynth.add_argument("--seed", type=int, default=42)
    return parser


def run(args: argparse.Namespace) -> int:
    if getattr(args, "backend", None) is not None:
        os.environ["QTW_BACKEND"] = args.backend
    if getattr(args, "device", None) is not None:
        os.environ["QTW_DEVICE"] = args.device
    if args.command == "install":
        print(download_model(args.models_dir, args.size, profile=args.profile, replace=args.replace)); return 0
    if args.command == "doctor": return _doctor(args)
    if args.command == "serve":
        from qwen_tts_worker.__main__ import main as serve
        from dotenv import dotenv_values
        os.environ.update(serve_environment(os.environ, sys.platform, dotenv=dotenv_values(".env")))
        serve(); return 0
    if args.command == "models":
        print(json.dumps(_api(args.url, "GET", "/models"), indent=2)); return 0
    if args.command == "service":
        if args.action == "install": print(install_service(port=args.port))
        elif args.action == "uninstall": uninstall(); print("LaunchAgent removed")
        else:
            result = launchctl(args.action)
            if result.stdout: print(result.stdout, end="")
        return 0
    if args.command == "synthesize":
        result = _api(args.url, "POST", "/synthesize", {"text": _text(args), "voice": args.voice, "language": args.language, "instruct": args.instruct, "seed": args.seed})
        _copy_worker_wav(result, args.output); return 0
    if args.command == "voices":
        if args.action != "list" and not args.voice_id: raise CliError("voice_id is required for show/delete")
        path = "/voices" + (f"/{args.voice_id}" if args.voice_id else "")
        result = _api(args.url, "DELETE" if args.action == "delete" else "GET", path)
        print(json.dumps(result if result is not None else {"deleted": args.voice_id}, indent=2)); return 0
    if args.clone_action == "enroll":
        result = _api(args.url, "POST", "/voices/enroll", {
            "name": args.name, "reference_audio_path": str(args.reference.expanduser().resolve()),
            "reference_text": args.transcript, "language": args.language,
            "consent": {"confirmed": True, "source": args.source, "statement": args.consent_statement, "license_or_terms": args.license_or_terms},
        })
        print(json.dumps(result, indent=2)); return 0
    result = _api(args.url, "POST", f"/voices/{args.voice_id}/synthesize", {
        "text": _text(args), "language": args.language, "model_size": args.model_size, "seed": args.seed,
    })
    _copy_worker_wav(result, args.output); return 0


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    try: code = run(parser.parse_args(argv))
    except (CliError, DownloadError, ServiceError, OSError) as exc: parser.exit(1, f"error: {exc}\n")
    raise SystemExit(code)


if __name__ == "__main__": main()
