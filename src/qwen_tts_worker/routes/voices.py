"""Voice profile CRUD endpoints.

Provides create, read, update, delete, and list operations for voice
profiles. Profiles are stored on the filesystem as JSON documents until
a persistence backend is introduced.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, HTTPException, status

from qwen_tts_worker.models.voices import (
    VoiceProfile,
    VoiceProfileCreate,
    VoiceProfilePreview,
    VoiceProfileUpdate,
)

router = APIRouter()

# In-memory store for development; replaced by a persistence layer later.
_profiles: dict[UUID, VoiceProfile] = {}


def _profiles_dir() -> Path:
    """Resolve the voices directory from settings. Defaults to ./voices."""
    from qwen_tts_worker.config import Settings

    try:
        settings = Settings()
        return settings.voices_dir
    except Exception:
        return Path("voices")


def _ensure_dir() -> None:
    _profiles_dir().mkdir(parents=True, exist_ok=True)


@router.get("/voices", response_model=list[VoiceProfilePreview])
async def list_voices() -> list[VoiceProfilePreview]:
    """List all voice profiles."""
    _ensure_dir()
    _load_from_disk()
    return [
        VoiceProfilePreview(
            id=p.id,
            name=p.name,
            mode=p.mode,
            language=p.language,
            updated_at=p.updated_at,
        )
        for p in _profiles.values()
    ]


@router.post("/voices", response_model=VoiceProfile, status_code=status.HTTP_201_CREATED)
async def create_voice(payload: VoiceProfileCreate) -> VoiceProfile:
    """Create a new voice profile."""
    _ensure_dir()
    profile = VoiceProfile(**payload.model_dump())
    _profiles[profile.id] = profile
    _save_to_disk()
    return profile


@router.get("/voices/{voice_id}", response_model=VoiceProfile)
async def get_voice(voice_id: UUID) -> VoiceProfile:
    """Get a single voice profile by ID."""
    _load_from_disk()
    profile = _profiles.get(voice_id)
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Voice profile '{voice_id}' not found.",
        )
    return profile


@router.patch("/voices/{voice_id}", response_model=VoiceProfile)
async def update_voice(voice_id: UUID, payload: VoiceProfileUpdate) -> VoiceProfile:
    """Update an existing voice profile. Only provided fields are changed."""
    _load_from_disk()
    profile = _profiles.get(voice_id)
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Voice profile '{voice_id}' not found.",
        )
    update_data = payload.model_dump(exclude_unset=True)
    updated = profile.model_copy(update=update_data)
    from datetime import datetime, timezone
    updated.updated_at = datetime.now(timezone.utc)
    _profiles[voice_id] = updated
    _save_to_disk()
    return updated


@router.delete("/voices/{voice_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_voice(voice_id: UUID) -> None:
    """Delete a voice profile."""
    _load_from_disk()
    if voice_id not in _profiles:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Voice profile '{voice_id}' not found.",
        )
    del _profiles[voice_id]
    _save_to_disk()


def _profiles_path() -> Path:
    return _profiles_dir() / "profiles.json"


def _save_to_disk() -> None:
    _ensure_dir()
    data = {
        str(pid): p.model_dump(mode="json")
        for pid, p in _profiles.items()
    }
    with open(_profiles_path(), "w") as f:
        json.dump(data, f, indent=2)


def _load_from_disk() -> None:
    path = _profiles_path()
    if not path.exists():
        return
    try:
        with open(path) as f:
            raw = json.load(f)
    except (json.JSONDecodeError, OSError):
        return
    _profiles.clear()
    for pid_str, data in raw.items():
        profile = VoiceProfile(**data)
        _profiles[profile.id] = profile
