"""Per-user macOS LaunchAgent installation for the local worker."""

from __future__ import annotations

import os
import plistlib
import subprocess
import sys
from pathlib import Path


LABEL = "org.agenticvideo.qwen-tts-worker"


class ServiceError(RuntimeError):
    pass


def launch_agent_path(home: Path | None = None) -> Path:
    return (home or Path.home()) / "Library" / "LaunchAgents" / f"{LABEL}.plist"


def service_paths(home: Path | None = None) -> dict[str, Path]:
    home = home or Path.home()
    support = home / "Library" / "Application Support" / "QwenTTSWorker"
    logs = home / "Library" / "Logs" / "QwenTTSWorker"
    return {"support": support, "models": support / "models", "voices": support / "voices", "outputs": support / "outputs", "logs": logs}


def install(*, home: Path | None = None, python: Path | None = None, port: int = 8000) -> Path:
    if sys.platform != "darwin": raise ServiceError("LaunchAgent installation is supported only on macOS")
    paths = service_paths(home)
    for key in ("support", "models", "voices", "outputs", "logs"):
        paths[key].mkdir(parents=True, exist_ok=True)
    executable = (python or Path(sys.executable)).resolve()
    plist = {
        "Label": LABEL,
        "ProgramArguments": [str(executable), "-m", "qwen_tts_worker"],
        "RunAtLoad": True,
        "KeepAlive": {"SuccessfulExit": False},
        "ProcessType": "Interactive",
        "EnvironmentVariables": {
            "QTW_HOST": "127.0.0.1", "QTW_PORT": str(port), "QTW_WORKERS": "1",
            "QTW_TTS_MODE": "live", "QTW_MODELS_DIR": str(paths["models"]),
            "QTW_VOICES_DIR": str(paths["voices"]), "QTW_OUTPUTS_DIR": str(paths["outputs"]),
            "QTW_LOG_FORMAT": "json",
        },
        "StandardOutPath": str(paths["logs"] / "worker.log"),
        "StandardErrorPath": str(paths["logs"] / "worker.error.log"),
        "WorkingDirectory": str(paths["support"]),
        "Umask": 0o077,
    }
    destination = launch_agent_path(home); destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".plist.tmp")
    temporary.write_bytes(plistlib.dumps(plist, sort_keys=True)); os.chmod(temporary, 0o600)
    os.replace(temporary, destination)
    return destination


def launchctl(action: str, *, home: Path | None = None) -> subprocess.CompletedProcess[str]:
    if sys.platform != "darwin": raise ServiceError("launchctl is supported only on macOS")
    domain = f"gui/{os.getuid()}"; path = launch_agent_path(home)
    if action == "start": command = ["launchctl", "bootstrap", domain, str(path)]
    elif action == "stop": command = ["launchctl", "bootout", domain, str(path)]
    elif action == "status": command = ["launchctl", "print", f"{domain}/{LABEL}"]
    else: raise ServiceError(f"unsupported service action: {action}")
    result = subprocess.run(command, capture_output=True, text=True, timeout=30)
    if result.returncode and not (action == "stop" and "Could not find service" in result.stderr):
        raise ServiceError(result.stderr.strip() or result.stdout.strip() or f"launchctl exited {result.returncode}")
    return result


def uninstall(*, home: Path | None = None) -> None:
    path = launch_agent_path(home)
    try: launchctl("stop", home=home)
    except ServiceError: pass
    try: path.unlink()
    except FileNotFoundError: pass
