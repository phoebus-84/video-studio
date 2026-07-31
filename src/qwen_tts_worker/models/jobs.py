"""Synthesis job models aligned with workspace-contract vocabulary.

Jobs are the unit of work for the TTS worker: a single narration segment
request becomes one synthesis job, producing one canonical WAV output.
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class JobPhase(str, Enum):
    """Lifecycle phases of a synthesis job."""

    QUEUED = "queued"
    """Job accepted and waiting to be picked up."""
    RUNNING = "running"
    """Job is actively being synthesized."""
    COMPLETED = "completed"
    """Synthesis succeeded and output is available."""
    FAILED = "failed"
    """Synthesis failed with an error."""
    CANCELLED = "cancelled"
    """Job was cancelled before completion."""


class NarrationSegmentRequest(BaseModel):
    """Request to synthesize a single narration segment.

    Aligned with the ``NarrationSegment`` vocabulary from workspace contracts:
    an independently synthesized and addressable portion of narration linked
    to a script revision and timing intent.
    """

    text: str = Field(
        ...,
        min_length=1,
        max_length=4096,
        description="Text to synthesize as speech.",
    )
    voice_profile_id: UUID = Field(
        ...,
        description="Voice profile to use for synthesis.",
    )
    segment_id: str = Field(
        ...,
        min_length=1,
        description="Caller-provided identifier for this narration segment. "
        "Must be unique within the caller's scope for idempotency.",
    )
    script_revision: str | None = Field(
        default=None,
        description="Source script revision this segment was derived from.",
    )
    speed: float = Field(
        default=1.0,
        ge=0.5,
        le=2.0,
        description="Per-segment speed override.",
    )


class SegmentResult(BaseModel):
    """Output of a completed narration segment synthesis."""

    wav_path: str = Field(
        ...,
        description="Filesystem path to the canonical WAV output.",
    )
    duration_seconds: float = Field(
        ...,
        ge=0.0,
        description="Duration of the synthesized audio in seconds.",
    )
    sample_rate: int = Field(
        ...,
        description="Sample rate of the output WAV in Hz.",
    )
    word_count: int = Field(
        ...,
        ge=0,
        description="Number of words in the input text.",
    )


class SynthesisJob(BaseModel):
    """Full state of a synthesis job, returned to callers."""

    job_id: UUID = Field(default_factory=uuid4, description="Immutable job identifier.")
    phase: JobPhase = Field(default=JobPhase.QUEUED, description="Current lifecycle phase.")
    request: NarrationSegmentRequest = Field(
        ..., description="The original synthesis request."
    )
    result: SegmentResult | None = Field(
        default=None,
        description="Synthesis result, populated only when phase is ``completed``.",
    )
    error: str | None = Field(
        default=None,
        description="Error description, populated only when phase is ``failed``.",
    )
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    started_at: datetime | None = None
    completed_at: datetime | None = None


class JobStatus(BaseModel):
    """Lightweight job status for list endpoints and polling."""

    job_id: UUID
    phase: JobPhase
    segment_id: str
    created_at: datetime
    completed_at: datetime | None = None
