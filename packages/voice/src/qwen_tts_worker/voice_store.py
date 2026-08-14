"""Atomic local voice-profile storage with clone reference ownership."""

from __future__ import annotations

import json
import os
import shutil
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from qwen_tts_worker.models.voices import VoiceProfile


class VoiceStoreError(RuntimeError):
    pass


class VoiceStore:
    def __init__(self, root: str | Path) -> None:
        self.root = Path(root).expanduser().resolve()
        self.profiles = self.root / "profiles"
        self.profiles.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()

    def _directory(self, voice_id: UUID) -> Path:
        return self.profiles / str(voice_id)

    def _metadata(self, voice_id: UUID) -> Path:
        return self._directory(voice_id) / "profile.json"

    def list(self) -> tuple[VoiceProfile, ...]:
        with self._lock:
            profiles = []
            for path in sorted(self.profiles.glob("*/profile.json")):
                try: profiles.append(VoiceProfile.model_validate_json(path.read_text()))
                except (OSError, ValueError) as exc: raise VoiceStoreError(f"invalid profile {path}: {exc}") from exc
            return tuple(profiles)

    def get(self, voice_id: UUID) -> VoiceProfile:
        with self._lock:
            try: return VoiceProfile.model_validate_json(self._metadata(voice_id).read_text())
            except FileNotFoundError as exc: raise VoiceStoreError(f"voice profile {voice_id} not found") from exc
            except (OSError, ValueError) as exc: raise VoiceStoreError(f"cannot read voice profile {voice_id}: {exc}") from exc

    def create(self, profile: VoiceProfile, reference_wav: bytes | None = None) -> VoiceProfile:
        directory = self._directory(profile.id)
        with self._lock:
            try: directory.mkdir(mode=0o700)
            except FileExistsError as exc: raise VoiceStoreError(f"voice profile {profile.id} already exists") from exc
            try:
                if reference_wav is not None:
                    reference = directory / "reference.wav"
                    with reference.open("xb") as handle:
                        handle.write(reference_wav); handle.flush(); os.fsync(handle.fileno())
                    os.chmod(reference, 0o600)
                self._write(profile)
            except Exception:
                shutil.rmtree(directory, ignore_errors=True); raise
        return profile

    def update(self, profile: VoiceProfile) -> VoiceProfile:
        with self._lock:
            self.get(profile.id); self._write(profile)
        return profile

    def delete(self, voice_id: UUID) -> None:
        with self._lock:
            directory = self._directory(voice_id)
            if not directory.is_dir(): raise VoiceStoreError(f"voice profile {voice_id} not found")
            tombstone = self.profiles / f".deleted-{voice_id}-{uuid.uuid4().hex}"
            os.replace(directory, tombstone)
            shutil.rmtree(tombstone)

    def reference_path(self, profile: VoiceProfile) -> Path:
        if profile.reference_audio_path is None: raise VoiceStoreError("profile has no reference audio")
        path = (self.root / profile.reference_audio_path).resolve()
        if self.root not in path.parents or not path.is_file():
            raise VoiceStoreError("reference audio path escapes voice store or is missing")
        return path

    def _write(self, profile: VoiceProfile) -> None:
        destination = self._metadata(profile.id); temporary = destination.with_suffix(".json.tmp")
        temporary.write_text(profile.model_dump_json(indent=2) + "\n")
        os.chmod(temporary, 0o600)
        os.replace(temporary, destination)
        try:
            descriptor = os.open(destination.parent, os.O_RDONLY); os.fsync(descriptor); os.close(descriptor)
        except OSError: pass
