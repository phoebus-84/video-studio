"""Voice profile models for the TTS worker.

Voice profiles are persistent descriptors that identify a narration voice
independently of any one generated audio file, as defined in the workspace
contracts. They capture synthesis mode, speaker identity, language, and
performance defaults.
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class SynthesisMode(str, Enum):
    """How a voice is synthesized."""

    PRESET = "preset"
    """Use a built-in Qwen3-TTS preset voice."""
    CLONE = "clone"
    """Clone from a short reference audio sample."""
    DESIGN = "design"
    """Synthesize a voice from textual description (VoiceDesign)."""


class VoiceProfile(BaseModel):
    """A complete, persisted voice profile."""

    id: UUID = Field(default_factory=uuid4, description="Immutable profile identifier.")
    name: str = Field(..., min_length=1, max_length=128, description="Human-readable label.")
    mode: SynthesisMode = Field(..., description="Synthesis method for this voice.")

    # Preset-specific
    preset_name: str | None = Field(
        default=None,
        description="Qwen3-TTS preset name. Required when mode is ``preset``.",
    )

    # Clone-specific
    reference_audio_path: str | None = Field(
        default=None,
        description="Path to the reference audio sample for cloning. "
        "Required when mode is ``clone``.",
    )

    # Design-specific
    description: str | None = Field(
        default=None,
        description="Natural-language voice description for VoiceDesign. "
        "Required when mode is ``design``.",
    )

    # Shared
    language: str = Field(
        default="en",
        min_length=2,
        max_length=8,
        description="BCP-47 language tag for the primary language.",
    )

    speed: float = Field(
        default=1.0,
        ge=0.5,
        le=2.0,
        description="Speech speed multiplier. 1.0 is default.",
    )

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class VoiceProfileCreate(BaseModel):
    """Payload for creating a new voice profile."""

    name: str = Field(..., min_length=1, max_length=128)
    mode: SynthesisMode
    preset_name: str | None = None
    reference_audio_path: str | None = None
    description: str | None = None
    language: str = "en"
    speed: float = 1.0


class VoiceProfileUpdate(BaseModel):
    """Payload for updating an existing voice profile.

    All fields are optional; only provided fields are changed.
    """

    name: str | None = Field(default=None, min_length=1, max_length=128)
    speed: float | None = Field(default=None, ge=0.5, le=2.0)
    language: str | None = Field(default=None, min_length=2, max_length=8)


class VoiceProfilePreview(BaseModel):
    """Lightweight voice profile summary for list endpoints."""

    id: UUID
    name: str
    mode: SynthesisMode
    language: str
    updated_at: datetime
