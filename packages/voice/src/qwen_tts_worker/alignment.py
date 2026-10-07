"""Forced alignment: when each word of a known text is spoken (avg-8hs.2).

Qwen3-ForcedAligner (through mlx-audio) aligns a take's audio with the
text it says and returns each word's start and end in seconds. The model is
loaded on first use and kept, as the speech model is. Its words are returned
raw: mapping them onto the written text and snapping them to the measured
silences is the studio's work, the same for every provider.
"""

from __future__ import annotations

import json
import subprocess
import threading
from pathlib import Path
from typing import Any, Callable

#: The longest audio aligned in one pass, in seconds.
ALIGN_MAX_SECONDS = 300

#: The model's languages, by ISO 639-1 code.
LANGUAGES = {
    "zh": "Chinese", "en": "English", "yue": "Cantonese", "fr": "French", "de": "German",
    "it": "Italian", "ja": "Japanese", "ko": "Korean", "pt": "Portuguese", "ru": "Russian", "es": "Spanish",
}


class AlignError(Exception):
    """Why a take cannot be aligned; ``code`` is stable for callers."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def language_name(language: str) -> str | None:
    """The model's name for a language given by code or by name; None when it has none."""
    key = language.strip().lower()
    if key in LANGUAGES:
        return LANGUAGES[key]
    return next((name for name in LANGUAGES.values() if name.lower() == key), None)


def audio_seconds(audio_path: str) -> float:
    """The audio's duration, read with ffprobe; ``bad-audio`` when it is not readable audio."""
    path = Path(audio_path)
    if not path.is_absolute() or not path.is_file():
        raise AlignError("bad-audio", f"{audio_path} is not an absolute path to a file")
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "format=duration", "-of", "json", str(path)],
        capture_output=True, text=True,
    )
    try:
        return float(json.loads(probe.stdout)["format"]["duration"])
    except (ValueError, KeyError, TypeError):
        raise AlignError("bad-audio", f"{audio_path} is not audio ffprobe can read") from None


def _default_loader(repo: str) -> Any:
    from mlx_audio.stt.utils import load_model

    return load_model(repo)


class Aligner:
    """One forced-alignment model, loaded on first use and kept."""

    def __init__(self, model_id: str, loader: Callable[[str], Any] | None = None, fake: bool = False) -> None:
        self.model_id = "fake-aligner" if fake else model_id
        self._loader = loader or _default_loader
        self._fake = fake
        self._model: Any = None
        self._lock = threading.Lock()

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def align(self, audio_path: str, text: str, language: str) -> dict[str, Any]:
        """The words of ``text`` with their start and end in ``audio_path``, as the model gives them."""
        if not text.strip():
            raise AlignError("empty-text", "there is no text to align")
        name = language_name(language)
        if name is None:
            raise AlignError("unsupported-language", f"the aligner has no language {language!r}; it knows {', '.join(sorted(LANGUAGES))}")
        seconds = audio_seconds(audio_path)
        if seconds > ALIGN_MAX_SECONDS:
            raise AlignError("too-long", f"the audio lasts {seconds:.1f} s; align at most {ALIGN_MAX_SECONDS} s at a time")
        if self._fake:
            tokens = text.split()
            step = seconds / len(tokens)
            words = [{"text": t, "start": round(i * step, 3), "end": round((i + 1) * step, 3)} for i, t in enumerate(tokens)]
            return {"words": words, "model": self.model_id, "language": name}
        with self._lock:
            if self._model is None:
                self._model = self._loader(self.model_id)
            model = self._model
            supported = model.get_supported_languages()
            if supported is not None and name.lower() not in supported:
                raise AlignError("unsupported-language", f"{self.model_id} does not align {name}")
            result = model.generate(audio_path, text, language=name)
        words = [{"text": item.text, "start": round(float(item.start_time), 3), "end": round(float(item.end_time), 3)} for item in result]
        return {"words": words, "model": self.model_id, "language": name}
