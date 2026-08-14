"""Validated preset, designed, and consented local clone voice profiles."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from enum import Enum
from typing import Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field, model_validator


class SynthesisMode(str, Enum):
    PRESET = "preset"
    CLONE = "clone"
    DESIGN = "design"


class ConsentSource(str, Enum):
    SELF_RECORDED = "self_recorded"
    LICENSED = "licensed"
    SYNTHETIC = "synthetic"


class VoiceConsent(BaseModel):
    confirmed: Literal[True]
    source: ConsentSource
    statement: str = Field(..., min_length=10, max_length=1000)
    license_or_terms: str = Field(..., min_length=2, max_length=500)
    recorded_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class VoiceProfile(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    name: str = Field(..., min_length=1, max_length=128)
    mode: SynthesisMode
    preset_name: str | None = None
    reference_audio_path: str | None = None
    reference_audio_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    reference_duration_seconds: float | None = Field(default=None, ge=3, le=30)
    reference_text: str | None = Field(default=None, min_length=1, max_length=2000)
    reference_text_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    consent: VoiceConsent | None = None
    description: str | None = Field(default=None, min_length=10, max_length=1000)
    language: str = Field(default="en-US", min_length=2, max_length=35)
    speed: Literal[1.0] = 1.0
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @model_validator(mode="after")
    def fields_match_mode(self) -> VoiceProfile:
        clone_values = (
            self.reference_audio_path, self.reference_audio_sha256,
            self.reference_duration_seconds, self.reference_text,
            self.reference_text_sha256, self.consent,
        )
        if self.mode == SynthesisMode.PRESET:
            if not self.preset_name: raise ValueError("preset mode requires preset_name")
            if any(value is not None for value in clone_values) or self.description is not None:
                raise ValueError("preset mode cannot contain clone or design fields")
        elif self.mode == SynthesisMode.CLONE:
            if any(value is None for value in clone_values):
                raise ValueError("clone mode requires canonical reference audio, exact transcript, hashes, duration, and consent")
            if self.preset_name is not None or self.description is not None:
                raise ValueError("clone mode cannot contain preset/design fields")
            expected = hashlib.sha256(self.reference_text.encode("utf-8")).hexdigest()
            if self.reference_text_sha256 != expected:
                raise ValueError("reference_text_sha256 does not match reference_text")
        else:
            if not self.description: raise ValueError("design mode requires description")
            if self.preset_name is not None or any(value is not None for value in clone_values):
                raise ValueError("design mode cannot contain preset/clone fields")
        return self

    @property
    def revision_sha256(self) -> str:
        material = self.model_dump(mode="json", exclude={"updated_at"})
        return hashlib.sha256(json.dumps(material, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


class VoiceProfileCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    mode: Literal[SynthesisMode.PRESET, SynthesisMode.DESIGN]
    preset_name: str | None = None
    description: str | None = Field(default=None, min_length=10, max_length=1000)
    language: str = Field(default="en-US", min_length=2, max_length=35)
    speed: Literal[1.0] = 1.0

    @model_validator(mode="after")
    def valid_mode(self) -> VoiceProfileCreate:
        if self.mode == SynthesisMode.PRESET and not self.preset_name:
            raise ValueError("preset mode requires preset_name")
        if self.mode == SynthesisMode.DESIGN and not self.description:
            raise ValueError("design mode requires description")
        return self


class CloneEnrollmentRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    reference_audio_path: str = Field(..., min_length=1, max_length=4096)
    reference_text: str = Field(..., min_length=1, max_length=2000)
    language: str = Field(default="en-US", min_length=2, max_length=35)
    consent: VoiceConsent


class VoiceProfileUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    language: str | None = Field(default=None, min_length=2, max_length=35)


class VoiceProfilePreview(BaseModel):
    id: UUID
    name: str
    mode: SynthesisMode
    language: str
    updated_at: datetime
