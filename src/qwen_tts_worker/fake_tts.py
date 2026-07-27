# ---------------------------------------------------------------------------
# Fake TTS — deterministic no-model test harness
# ---------------------------------------------------------------------------
# Generates minimal valid WAV files without loading ML models.
# All outputs are small, deterministic, and repeatable — suitable for CI.
# ---------------------------------------------------------------------------

import struct
import hashlib
import io
import wave
import time
import json
from dataclasses import dataclass, field
from typing import Optional

# ── Constants ─────────────────────────────────────────────────────────────────

SAMPLE_RATE = 24000
BITS_PER_SAMPLE = 16
NUM_CHANNELS = 1
DEFAULT_DURATION_MS = 100  # 100ms of silence per segment


@dataclass
class SynthesisResult:
    """Result of a fake synthesis call."""
    segment_id: str
    text: str
    wav_bytes: bytes
    duration_ms: float
    sample_rate: int
    sha256: str
    word_count: int
    created_at: str


@dataclass
class FakeTTSConfig:
    """Configuration for the fake TTS provider."""
    sample_rate: int = SAMPLE_RATE
    seed: int = 42
    fail_mode: bool = False
    processing_delay_ms: int = 0


def _generate_silence_wav(duration_ms: float, sample_rate: int = SAMPLE_RATE) -> bytes:
    """Generate a minimal valid WAV file containing silence."""
    num_samples = int(sample_rate * duration_ms / 1000)
    num_bytes = num_samples * NUM_CHANNELS * (BITS_PER_SAMPLE // 8)

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(NUM_CHANNELS)
        wf.setsampwidth(BITS_PER_SAMPLE // 8)
        wf.setframerate(sample_rate)
        wf.writeframes(b"\x00" * num_bytes)

    return buf.getvalue()


def _compute_sha256(data: bytes) -> str:
    """Compute SHA-256 hash of binary data."""
    return hashlib.sha256(data).hexdigest()


def _estimate_word_count(text: str) -> int:
    """Simple word counter for metadata."""
    return len(text.strip().split()) if text.strip() else 1


class FakeTTSProvider:
    """Deterministic fake TTS provider for contract testing."""

    def __init__(self, config: Optional[FakeTTSConfig] = None):
        self.config = config or FakeTTSConfig()
        self._synthesis_count = 0
        self._results: dict[str, SynthesisResult] = {}

    def synthesize(self, text: str, segment_id: Optional[str] = None) -> SynthesisResult:
        """Synthesize a single segment.

        Returns a deterministic WAV file containing silence.
        Duration scales with text length (capped).
        """
        if self.config.fail_mode:
            raise RuntimeError("FakeTTSProvider: fail_mode enabled — simulated synthesis failure")

        if self.config.processing_delay_ms > 0:
            time.sleep(self.config.processing_delay_ms / 1000.0)

        self._synthesis_count += 1

        sid = segment_id or f"seg-{self._synthesis_count}"
        word_count = _estimate_word_count(text)

        # Duration scales with word count, min 100ms
        duration_ms = max(DEFAULT_DURATION_MS, word_count * 500)

        wav_bytes = _generate_silence_wav(duration_ms, self.config.sample_rate)
        sha256 = _compute_sha256(wav_bytes)

        result = SynthesisResult(
            segment_id=sid,
            text=text,
            wav_bytes=wav_bytes,
            duration_ms=duration_ms,
            sample_rate=self.config.sample_rate,
            sha256=sha256,
            word_count=word_count,
            created_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        )

        self._results[sid] = result
        return result

    def synthesize_batch(
        self, segments: list[tuple[str, str]]
    ) -> list[SynthesisResult]:
        """Synthesize multiple segments.

        Args:
            segments: List of (segment_id, text) tuples.
        """
        results = []
        for segment_id, text in segments:
            results.append(self.synthesize(text, segment_id))
        return results

    def get_result(self, segment_id: str) -> Optional[SynthesisResult]:
        """Retrieve a previously synthesized result (idempotency check)."""
        return self._results.get(segment_id)

    @property
    def synthesis_count(self) -> int:
        return self._synthesis_count

    def reset(self) -> None:
        """Clear all stored results (simulated restart)."""
        self._results.clear()
        self._synthesis_count = 0


def create_fake_tts() -> FakeTTSProvider:
    """Create a default fake TTS suitable for contract tests."""
    return FakeTTSProvider(FakeTTSConfig(seed=42))


def create_failing_tts() -> FakeTTSProvider:
    """Create a fake TTS that always fails (error-path testing)."""
    return FakeTTSProvider(FakeTTSConfig(seed=42, fail_mode=True))


def create_slow_tts(delay_ms: int = 5000) -> FakeTTSProvider:
    """Create a fake TTS with configurable delay (restart/resume testing)."""
    return FakeTTSProvider(FakeTTSConfig(seed=42, processing_delay_ms=delay_ms))
