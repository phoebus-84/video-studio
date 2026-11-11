"""Transcription: what a take actually says, word by word (avg-8hs.3).

Whisper large-v3-turbo through mlx-whisper hears the take with no knowledge
of the text it should say, which is the point: forced alignment always finds
every word of the text, even one never said (it squeezes it into a few
milliseconds); a transcription does not. The studio compares the two. The
model is loaded on first use and kept by mlx-whisper; a first use downloads it.
On a 40 s Italian recital it runs in about 8 s on Apple silicon.
"""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Any, Callable

from qwen_tts_worker.alignment import AlignError, audio_seconds

#: The longest audio transcribed in one pass, in seconds.
TRANSCRIBE_MAX_SECONDS = 600

#: Whisper's languages the studio uses, by ISO 639-1 code (it knows many more).
LANGUAGES = {
    "it": "Italian", "en": "English", "fr": "French", "de": "German", "es": "Spanish", "pt": "Portuguese",
    "nl": "Dutch", "ru": "Russian", "zh": "Chinese", "ja": "Japanese", "ko": "Korean", "pl": "Polish",
    "ca": "Catalan", "el": "Greek", "la": "Latin", "ro": "Romanian", "sv": "Swedish", "tr": "Turkish",
}


class TranscribeError(Exception):
    """Why a take cannot be transcribed; ``code`` is stable for callers."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def language_code(language: str) -> str | None:
    """The code for a language given by code (a region allowed: it-IT) or by name; None when unknown."""
    key = language.strip().lower().replace("_", "-").split("-")[0]
    if key in LANGUAGES:
        return key
    return next((code for code, name in LANGUAGES.items() if name.lower() == key), None)


def _default_run(path: str, **kwargs: Any) -> dict[str, Any]:
    from qwen_tts_worker.backends import backend_name
    if backend_name() != "mlx":
        raise RuntimeError("Transcription is currently MLX-only; portable TTS does not imply portable ASR")
    import mlx_whisper

    return mlx_whisper.transcribe(path, **kwargs)


class Transcriber:
    """One transcription model; ``run`` is mlx_whisper.transcribe unless a test gives another."""

    def __init__(self, model_id: str, run: Callable[..., dict[str, Any]] | None = None, fake: bool = False) -> None:
        self.model_id = "fake-transcriber" if fake else model_id
        self._run = run or _default_run
        self._fake = fake
        self._used = False
        self._lock = threading.Lock()

    @property
    def loaded(self) -> bool:
        return self._used

    def transcribe(self, audio_path: str, language: str) -> dict[str, Any]:
        """The words heard in ``audio_path``, with start, end and the model's confidence."""
        code = language_code(language)
        if code is None:
            raise TranscribeError("unsupported-language", f"no language {language!r}; known: {', '.join(sorted(LANGUAGES))}")
        try:
            seconds = audio_seconds(audio_path)
        except AlignError as error:
            raise TranscribeError("bad-audio", error.message) from None
        if seconds > TRANSCRIBE_MAX_SECONDS:
            raise TranscribeError("too-long", f"the audio lasts {seconds:.1f} s; transcribe at most {TRANSCRIBE_MAX_SECONDS} s at a time")
        if self._fake:
            return {"text": "", "words": [], "model": self.model_id, "language": code}
        with self._lock:
            try:
                # Without the previous text as a prompt: a repeated or missing line is heard as it is, not as expected.
                result = self._run(audio_path, path_or_hf_repo=self.model_id, language=code, word_timestamps=True, condition_on_previous_text=False)
            except Exception as error:  # a first download without network, a bad repo id, the model itself
                raise TranscribeError("transcriber-failed", f"{self.model_id} could not transcribe: {error}") from None
            self._used = True
        words = [
            {"text": str(w["word"]).strip(), "start": round(float(w["start"]), 3), "end": round(float(w["end"]), 3),
             "probability": round(float(w.get("probability", 0.0)), 3)}
            for segment in result.get("segments", []) for w in segment.get("words", []) if str(w.get("word", "")).strip()
        ]
        return {"text": str(result.get("text", "")).strip(), "words": words, "model": self.model_id, "language": code}
