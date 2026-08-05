"""Atomic local voice profiles, consented enrollment, synthesis, and revocation."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, HTTPException, status

from qwen_tts_worker.cloning import (
    CloneError, CloneSynthesisRequest, CloneSynthesisResult, enroll_clone, synthesize_clone,
)
from qwen_tts_worker.config import Settings
from qwen_tts_worker.models.voices import (
    CloneEnrollmentRequest, VoiceProfile, VoiceProfileCreate, VoiceProfilePreview, VoiceProfileUpdate,
)
from qwen_tts_worker.voice_store import VoiceStore, VoiceStoreError


router = APIRouter()


def _store() -> VoiceStore:
    return VoiceStore(Settings().voices_dir)


def _not_found(exc: VoiceStoreError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.get("/voices", response_model=list[VoiceProfilePreview])
async def list_voices() -> list[VoiceProfilePreview]:
    try: profiles = _store().list()
    except VoiceStoreError as exc: raise HTTPException(500, detail=str(exc)) from exc
    return [VoiceProfilePreview.model_validate(profile, from_attributes=True) for profile in profiles]


@router.post("/voices", response_model=VoiceProfile, status_code=status.HTTP_201_CREATED)
async def create_voice(payload: VoiceProfileCreate) -> VoiceProfile:
    """Create a preset or VoiceDesign descriptor; clone enrollment is separate."""
    try: return _store().create(VoiceProfile(**payload.model_dump()))
    except VoiceStoreError as exc: raise HTTPException(409, detail=str(exc)) from exc


@router.post("/voices/enroll", response_model=VoiceProfile, status_code=status.HTTP_201_CREATED)
async def enroll_voice(payload: CloneEnrollmentRequest) -> VoiceProfile:
    """Canonicalize and privately copy a consented local reference plus exact transcript."""
    try: return enroll_clone(payload, Settings())
    except CloneError as exc: raise HTTPException(422, detail=str(exc)) from exc


@router.get("/voices/{voice_id}", response_model=VoiceProfile)
async def get_voice(voice_id: UUID) -> VoiceProfile:
    try: return _store().get(voice_id)
    except VoiceStoreError as exc: raise _not_found(exc) from exc


@router.patch("/voices/{voice_id}", response_model=VoiceProfile)
async def update_voice(voice_id: UUID, payload: VoiceProfileUpdate) -> VoiceProfile:
    store = _store()
    try: profile = store.get(voice_id)
    except VoiceStoreError as exc: raise _not_found(exc) from exc
    updated = profile.model_copy(update={
        **payload.model_dump(exclude_unset=True), "updated_at": datetime.now(timezone.utc),
    })
    try: return store.update(updated)
    except VoiceStoreError as exc: raise HTTPException(409, detail=str(exc)) from exc


@router.post("/voices/{voice_id}/synthesize", response_model=CloneSynthesisResult)
async def synthesize_enrolled_voice(voice_id: UUID, payload: CloneSynthesisRequest) -> CloneSynthesisResult:
    try: return synthesize_clone(voice_id, payload, Settings())
    except CloneError as exc: raise HTTPException(409, detail=str(exc)) from exc


@router.delete("/voices/{voice_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_voice(voice_id: UUID) -> None:
    """Revoke the profile by deleting metadata and its private reference copy."""
    try: _store().delete(voice_id)
    except VoiceStoreError as exc: raise _not_found(exc) from exc
