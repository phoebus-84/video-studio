"""Tests for the API models (Pydantic).

Covers:
- Model construction with valid data.
- Validation failures for invalid data.
- Enum value round-trips.
- JSON serialisation/deserialisation.
"""

from __future__ import annotations

import json
from uuid import uuid4

import pytest
from pydantic import ValidationError

from qwen_tts_worker.models.health import (
    DependencyCheck,
    DependencyStatus,
    HealthResponse,
    ModelStatus,
    ServiceStatus,
)
from qwen_tts_worker.models.errors import ErrorDetail, ErrorEnvelope
from qwen_tts_worker.models.voices import (
    SynthesisMode,
    VoiceProfile,
    VoiceProfileCreate,
    VoiceProfilePreview,
    VoiceProfileUpdate,
)
from qwen_tts_worker.models.jobs import (
    JobPhase,
    JobStatus,
    NarrationSegmentRequest,
    SegmentResult,
    SynthesisJob,
)


# ---------------------------------------------------------------------------
# Health models
# ---------------------------------------------------------------------------

class TestHealthModels:
    def test_service_status_values(self) -> None:
        assert ServiceStatus.HEALTHY.value == "healthy"
        assert ServiceStatus.DEGRADED.value == "degraded"
        assert ServiceStatus.UNHEALTHY.value == "unhealthy"

    def test_model_status_values(self) -> None:
        assert ModelStatus.NONE.value == "none"
        assert ModelStatus.LOADING.value == "loading"
        assert ModelStatus.READY.value == "ready"
        assert ModelStatus.ERROR.value == "error"

    def test_dependency_check_ok(self) -> None:
        d = DependencyCheck(name="filesystem", status=DependencyStatus.OK, latency_ms=1.5)
        assert d.status == DependencyStatus.OK
        assert d.detail is None
        assert d.latency_ms == 1.5

    def test_dependency_check_unavailable(self) -> None:
        d = DependencyCheck(
            name="model-registry",
            status=DependencyStatus.UNAVAILABLE,
            detail="Connection refused",
        )
        assert d.status == DependencyStatus.UNAVAILABLE
        assert d.detail == "Connection refused"

    def test_health_response_full(self) -> None:
        from datetime import datetime, timezone
        hr = HealthResponse(
            service=ServiceStatus.HEALTHY,
            model=ModelStatus.NONE,
            dependencies=[
                DependencyCheck(name="fs", status=DependencyStatus.OK),
            ],
            uptime_seconds=12.3,
            timestamp=datetime(2026, 7, 27, 12, 0, 0, tzinfo=timezone.utc),
            version="0.1.0",
        )
        assert hr.service == ServiceStatus.HEALTHY
        assert hr.uptime_seconds == 12.3
        assert hr.version == "0.1.0"

    def test_health_response_json(self) -> None:
        from datetime import datetime, timezone
        hr = HealthResponse(
            service=ServiceStatus.HEALTHY,
            model=ModelStatus.NONE,
            dependencies=[],
            uptime_seconds=1.0,
            timestamp=datetime(2026, 7, 27, 12, 0, 0, tzinfo=timezone.utc),
            version="0.1.0",
        )
        data = hr.model_dump(mode="json")
        assert data["service"] == "healthy"
        assert data["model"] == "none"
        assert data["uptime_seconds"] == 1.0


# ---------------------------------------------------------------------------
# Error models
# ---------------------------------------------------------------------------

class TestErrorModels:
    def test_error_detail(self) -> None:
        ed = ErrorDetail(loc=["body", "name"], msg="Field required", type="missing")
        assert ed.loc == ["body", "name"]

    def test_error_envelope_json(self) -> None:
        env = ErrorEnvelope(error="Bad request", request_id="r-1")
        raw = env.model_dump(mode="json")
        assert json.loads(json.dumps(raw)) == raw


# ---------------------------------------------------------------------------
# Voice models
# ---------------------------------------------------------------------------

class TestVoiceModels:
    def test_synthesis_mode_values(self) -> None:
        assert SynthesisMode.PRESET.value == "preset"
        assert SynthesisMode.CLONE.value == "clone"
        assert SynthesisMode.DESIGN.value == "design"

    def test_voice_profile_creation_valid(self) -> None:
        vp = VoiceProfile(name="Narrator", mode=SynthesisMode.PRESET, preset_name="en-female-1")
        assert vp.name == "Narrator"
        assert vp.language == "en-US"
        assert vp.speed == 1.0

    def test_voice_profile_speed_range(self) -> None:
        """Speed must be between 0.5 and 2.0."""
        with pytest.raises(ValidationError):
            VoiceProfile(name="N", mode=SynthesisMode.PRESET, preset_name="p", speed=0.1)
        with pytest.raises(ValidationError):
            VoiceProfile(name="N", mode=SynthesisMode.PRESET, preset_name="p", speed=3.0)

    def test_voice_profile_create_validation(self) -> None:
        payload = VoiceProfileCreate(name="Test", mode="preset", preset_name="en-male-1")
        assert payload.name == "Test"
        assert payload.mode == SynthesisMode.PRESET

    def test_voice_profile_create_empty_name(self) -> None:
        with pytest.raises(ValidationError):
            VoiceProfileCreate(name="", mode="preset")

    def test_voice_profile_update_partial(self) -> None:
        """Only provided fields must be set."""
        payload = VoiceProfileUpdate(name="Renamed")
        assert payload.name == "Renamed"
        assert payload.language is None

    def test_voice_profile_preview(self) -> None:
        vid = uuid4()
        from datetime import datetime, timezone
        vp = VoiceProfilePreview(
            id=vid, name="Preview", mode=SynthesisMode.CLONE, language="fr", updated_at=datetime.now(timezone.utc)
        )
        assert vp.id == vid
        assert vp.language == "fr"


# ---------------------------------------------------------------------------
# Job models
# ---------------------------------------------------------------------------

class TestJobModels:
    def test_job_phase_values(self) -> None:
        assert JobPhase.QUEUED.value == "queued"
        assert JobPhase.RUNNING.value == "running"
        assert JobPhase.COMPLETED.value == "completed"
        assert JobPhase.FAILED.value == "failed"
        assert JobPhase.CANCELLED.value == "cancelled"

    def test_narration_segment_request_valid(self) -> None:
        req = NarrationSegmentRequest(
            text="Hello world",
            voice_profile_id=uuid4(),
            segment_id="seg-001",
        )
        assert req.text == "Hello world"
        assert req.speed == 1.0

    def test_narration_segment_text_too_long(self) -> None:
        with pytest.raises(ValidationError):
            NarrationSegmentRequest(
                text="x" * 5000,
                voice_profile_id=uuid4(),
                segment_id="seg-001",
            )

    def test_narration_segment_text_empty(self) -> None:
        with pytest.raises(ValidationError):
            NarrationSegmentRequest(text="", voice_profile_id=uuid4(), segment_id="seg-001")

    def test_segment_result_valid(self) -> None:
        sr = SegmentResult(
            wav_path="/outputs/seg-001.wav",
            duration_seconds=2.5,
            sample_rate=24000,
            word_count=3,
        )
        assert sr.duration_seconds == 2.5

    def test_synthesis_job_defaults_queued(self) -> None:
        jid = uuid4()
        req = NarrationSegmentRequest(
            text="Test", voice_profile_id=uuid4(), segment_id="s1"
        )
        job = SynthesisJob(job_id=jid, request=req)
        assert job.phase == JobPhase.QUEUED
        assert job.result is None

    def test_job_status_lightweight(self) -> None:
        from datetime import datetime, timezone
        js = JobStatus(
            job_id=uuid4(),
            phase=JobPhase.COMPLETED,
            segment_id="seg-1",
            created_at=datetime.now(timezone.utc),
        )
        data = js.model_dump(mode="json")
        assert data["phase"] == "completed"
        assert "result" not in data  # lightweight
