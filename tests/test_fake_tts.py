# ---------------------------------------------------------------------------
# Fake TTS provider tests
# ---------------------------------------------------------------------------

import pytest
from qwen_tts_worker.fake_tts import (
    FakeTTSProvider,
    FakeTTSConfig,
    create_fake_tts,
    create_failing_tts,
    create_slow_tts,
    SynthesisResult,
)


class TestFakeTTSProvider:
    """Contract tests for the fake TTS provider."""

    def test_synthesize_returns_valid_wav(self):
        """Synthesis produces a valid WAV byte stream."""
        tts = create_fake_tts()
        result = tts.synthesize("Hello world", "seg-1")

        assert isinstance(result, SynthesisResult)
        assert result.segment_id == "seg-1"
        assert len(result.wav_bytes) > 0

        # Validate WAV header
        assert result.wav_bytes[:4] == b"RIFF"
        assert result.wav_bytes[8:12] == b"WAVE"

    def test_synthesis_is_deterministic(self):
        """Same input produces identical output."""
        tts_a = create_fake_tts()
        tts_b = create_fake_tts()

        result_a = tts_a.synthesize("test", "seg-1")
        result_b = tts_b.synthesize("test", "seg-1")

        assert result_a.sha256 == result_b.sha256
        assert result_a.wav_bytes == result_b.wav_bytes

    def test_duration_scales_with_text_length(self):
        """Longer text produces longer WAV files."""
        tts = create_fake_tts()
        short = tts.synthesize("Hi", "short")
        long = tts.synthesize("This is a much longer piece of text with many words", "long")

        assert long.duration_ms > short.duration_ms
        assert len(long.wav_bytes) > len(short.wav_bytes)

    def test_batch_synthesis(self):
        """Batch synthesis returns correct results."""
        tts = create_fake_tts()
        segments = [
            ("a", "First segment"),
            ("b", "Second segment"),
            ("c", "Third segment"),
        ]
        results = tts.synthesize_batch(segments)

        assert len(results) == 3
        assert results[0].segment_id == "a"
        assert results[1].segment_id == "b"
        assert results[2].segment_id == "c"

    def test_idempotency(self):
        """Previously synthesized results are retrievable."""
        tts = create_fake_tts()
        tts.synthesize("Hello", "idem-1")

        prev = tts.get_result("idem-1")
        assert prev is not None
        assert prev.segment_id == "idem-1"
        assert prev.text == "Hello"

    def test_synthesis_count(self):
        """Provider tracks total synthesis count."""
        tts = create_fake_tts()
        tts.synthesize("a")
        tts.synthesize("b")
        tts.synthesize("c")

        assert tts.synthesis_count == 3

    def test_fail_mode_raises(self):
        """Fail mode propagates errors for testing."""
        tts = create_failing_tts()
        with pytest.raises(RuntimeError, match="fail_mode enabled"):
            tts.synthesize("test")

    def test_reset_clears_state(self):
        """Reset simulates a restart."""
        tts = create_fake_tts()
        tts.synthesize("test", "seg-1")
        assert tts.synthesis_count == 1

        tts.reset()
        assert tts.synthesis_count == 0
        assert tts.get_result("seg-1") is None

    def test_slow_tts_creates_with_delay(self):
        """Slow mode creates a provider with configurable delay."""
        tts = create_slow_tts(100)
        assert tts.config.processing_delay_ms == 100

    def test_result_metadata(self):
        """Result includes expected metadata fields."""
        tts = create_fake_tts()
        result = tts.synthesize("hello world", "meta-1")

        assert result.word_count == 2
        assert result.sample_rate == 24000
        assert result.duration_ms > 0
        assert result.sha256 is not None
        assert result.created_at is not None
