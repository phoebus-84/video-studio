"""End-user CLI and deterministic LaunchAgent tests."""

from __future__ import annotations

import plistlib
from argparse import Namespace
from pathlib import Path

import pytest

from qwen_tts_worker import macos_service
from qwen_tts_worker.user_cli import CliError, _api, _copy_worker_wav, build_parser, run


@pytest.mark.parametrize("url", ["file:///etc/passwd", "https://127.0.0.1:8000", "http://example.com:8000"])
def test_api_rejects_nonlocal_or_unexpected_url_schemes(url: str) -> None:
    with pytest.raises(CliError, match="loopback"):
        _api(url, "GET", "/health")


def test_parser_exposes_production_commands() -> None:
    parser = build_parser()
    assert parser.parse_args(["install", "1.7B", "--profile", "base"]).command == "install"
    assert parser.parse_args(["doctor", "--json"]).command == "doctor"
    assert parser.parse_args(["service", "install"]).action == "install"
    clone = parser.parse_args([
        "clone", "enroll", "--name", "Mine", "--reference", "/tmp/ref.wav",
        "--transcript", "Exact words.", "--source", "self_recorded",
        "--consent-statement", "I consent to this local voice profile.",
        "--license-or-terms", "Owner",
    ])
    assert clone.clone_action == "enroll"


def test_launch_agent_is_private_loopback_and_reproducible(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(macos_service.sys, "platform", "darwin")
    python = tmp_path / "venv" / "bin" / "python"; python.parent.mkdir(parents=True); python.write_text("")
    destination = macos_service.install(home=tmp_path, python=python, port=8123)
    document = plistlib.loads(destination.read_bytes())
    environment = document["EnvironmentVariables"]
    assert document["ProgramArguments"] == [str(python.resolve()), "-m", "qwen_tts_worker"]
    assert environment["QTW_HOST"] == "127.0.0.1"
    assert environment["QTW_PORT"] == "8123"
    assert environment["QTW_WORKERS"] == "1"
    assert environment["QTW_TTS_MODE"] == "live"
    assert document["Umask"] == 0o077
    assert oct(destination.stat().st_mode & 0o777) == "0o600"


def test_copy_worker_wav_is_atomic_and_rejects_failed_result(tmp_path: Path) -> None:
    source = tmp_path / "source.wav"; source.write_bytes(b"RIFF-test")
    output = tmp_path / "nested" / "final.wav"
    _copy_worker_wav({"ok": True, "result": {"status": "completed", "wav_path": str(source)}}, output)
    assert output.read_bytes() == source.read_bytes()
    with pytest.raises(CliError, match="generation broke"):
        _copy_worker_wav({"ok": False, "result": {"status": "failed", "error": "generation broke"}}, output)
    with pytest.raises(CliError, match="SHA-256"):
        _copy_worker_wav({"wav_path": str(source), "wav_sha256": "0" * 64}, output)


def test_clone_cli_forwards_explicit_consent(monkeypatch: pytest.MonkeyPatch, capsys) -> None:
    captured: dict = {}
    def api(base_url: str, method: str, path: str, payload: dict | None = None):
        captured.update(url=base_url, method=method, path=path, payload=payload); return {"id": "voice-id"}
    monkeypatch.setattr("qwen_tts_worker.user_cli._api", api)
    args = build_parser().parse_args([
        "--url", "http://127.0.0.1:9000", "clone", "enroll", "--name", "Mine",
        "--reference", "/tmp/ref.wav", "--transcript", "These are exact words.",
        "--source", "licensed", "--consent-statement", "I have a license that permits local cloning.",
        "--license-or-terms", "Contract section 4",
    ])
    assert run(args) == 0
    assert captured["path"] == "/voices/enroll"
    assert captured["payload"]["reference_text"] == "These are exact words."
    assert captured["payload"]["consent"]["confirmed"] is True
    assert "voice-id" in capsys.readouterr().out
