"""Typed API models for the TTS worker.

All request and response models use Pydantic v2 for validation and
serialization. The FastAPI application auto-generates OpenAPI 3.1
schemas from these models.
"""

from qwen_tts_worker.models.health import (
    DependencyStatus,
    HealthResponse,
    ModelStatus,
    ServiceStatus,
)
from qwen_tts_worker.models.errors import ErrorDetail, ErrorEnvelope
from qwen_tts_worker.models.registry import (
    InstallStatus,
    ModelEntry,
    ModelProfile,
    ModelRegistry,
    ModelSize,
    ModelStatusReport,
)
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
from qwen_tts_worker.models.quality import (
    CONTRACT_VERSION,
    AttemptFailure,
    AttemptPhase,
    DeliveryDelta,
    MasteringMetrics,
    ModelIdentity,
    NarrationEntry,
    NarrationManifest,
    PronunciationEntry,
    QualityCheck,
    QualityDecision,
    SamplingProfile,
    SegmentContext,
    SegmentPlan,
    SegmentQualityReport,
    SignalMetrics,
    SourceDocument,
    SourceFormat,
    SourceSpan,
    SpeechRole,
    SpokenBlock,
    SynthesisAttempt,
    SynthesisProfile,
    TextChange,
    VoiceDirection,
    WavArtifact,
    synthesis_fingerprint,
)

__all__ = [
    # Health
    "DependencyStatus",
    "HealthResponse",
    "ModelStatus",
    "ServiceStatus",
    # Errors
    "ErrorDetail",
    "ErrorEnvelope",
    # Registry
    "InstallStatus",
    "ModelEntry",
    "ModelProfile",
    "ModelRegistry",
    "ModelSize",
    "ModelStatusReport",
    # Voices
    "SynthesisMode",
    "VoiceProfile",
    "VoiceProfileCreate",
    "VoiceProfilePreview",
    "VoiceProfileUpdate",
    # Jobs
    "JobPhase",
    "JobStatus",
    "NarrationSegmentRequest",
    "SegmentResult",
    "SynthesisJob",
    # Quality pipeline
    "CONTRACT_VERSION",
    "AttemptFailure",
    "AttemptPhase",
    "DeliveryDelta",
    "MasteringMetrics",
    "ModelIdentity",
    "NarrationEntry",
    "NarrationManifest",
    "PronunciationEntry",
    "QualityCheck",
    "QualityDecision",
    "SamplingProfile",
    "SegmentContext",
    "SegmentPlan",
    "SegmentQualityReport",
    "SignalMetrics",
    "SourceDocument",
    "SourceFormat",
    "SourceSpan",
    "SpeechRole",
    "SpokenBlock",
    "SynthesisAttempt",
    "SynthesisProfile",
    "TextChange",
    "VoiceDirection",
    "WavArtifact",
    "synthesis_fingerprint",
]
