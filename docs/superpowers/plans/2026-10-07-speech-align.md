# speech.align Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `speech.align` (avg-8hs.2): a take's WordTiming by forced alignment against its written text — Qwen3-ForcedAligner in the local voice worker by default, ElevenLabs when a person asks — post-processed the same way for both, written beside the take and named in `takes.json`; the agent's `pva_align_take`.

**Architecture:** The worker's new `POST /align` returns Qwen's raw words; the new `@av/elevenlabs` package returns ElevenLabs'. `@studio/episode` maps either onto the written text's tokens letter by letter, keeps every word out of the silences ffmpeg measures and at least 80 ms long, builds and validates the WordTiming, and writes it with `takes.json` atomically. The agent supplies the worker URL, the ElevenLabs key and the spend ledger; no library reads the environment.

**Tech Stack:** Python 3.12 / FastAPI / mlx-audio 0.4.6 (worker, pytest), TypeScript (new package, episode, agent; vitest), JSON Schema contracts (`node:test`), ffmpeg/ffprobe.

**Spec:** `docs/superpowers/specs/2026-10-07-speech-align-design.md`

Every line of code below was run in a scratch worktree before this plan was written: the worker's suite (with a real Italian alignment, opt-in), the new package's tests against a fake API, the episode and agent suites, the repository's checks (all but `check:paths`, which only the scratch worktree's symlinks trip) and `npm run docs:build`. The post-processing was also run on the spike's real Qwen output (San Martino, 62 words): every word placed, none under 80 ms — which is how the "silence inside a word" rule was found.

## Global Constraints

- Branch `feat/speech-align` (holds the spec commits). Never push or merge without the user's go.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; `git add` explicit paths only; never stage `.beads/`; never run `bd`.
- Code goes in exactly as shown. Where a step shows a diff, the file must end up exactly as the diff says.
- The only dependency changes are workspace ones: the new `packages/elevenlabs` workspace (Task 3) and `@studio/episode` depending on it (Task 5). After each, run `bun install --lockfile-only --ignore-scripts` then `bun install --frozen-lockfile` in this checkout (never in a worktree); `git diff bun.lock` must show only workspace entries for `@av/elevenlabs` — no new registry package.
- Qwen stays the local default; ElevenLabs is used only when asked, never as an automatic fallback (the user's standing rule).
- No library reads an environment variable: the worker URL, the ElevenLabs key and the spend function come from the agent.
- Rebuild what is consumed through `dist/`: `npm run build --workspace @av/elevenlabs` (episode imports it), `npm run build --workspace @studio/episode` (the agent imports it).
- Worker tests: the worker's `.venv` has no pytest. Make a throwaway test environment outside the repository that sees the worker's packages (Task 2 Step 2), and run pytest without `QTW_PORT`/`QTW_URL` (mise sets them; one existing test expects the default port).
- VitePress fails on a double opening curly brace outside fenced code in any Markdown under `docs/`.

## Review Focus

- A provider that drops punctuation, splits, merges or mishears a word → every token of the written text still placed, in order, never overlapping (Task 4 tests "gives every token…", "joins a word the provider split…", "keeps going after a misheard word", "keeps words in order…").
- The word before a pause swallowing it, or a word starting just before one → kept out of the silence (Task 4 tests "keeps a word out of the pause after it", "keeps the side of a word with more speech…"; Task 5 test "no word runs into the 0.6 s pause").
- A take whose audio was edited after `takes.json` was written → `audio-changed`, nothing written (Task 5 test "refuses what it cannot align, writing nothing").
- ElevenLabs asked for without a key, or with a budget too small → nothing sent (Task 5 test "sends nothing without a key…", Task 6 test "never reaches ElevenLabs without its key").
- A connection to ElevenLabs cut after the request left → `uncertain`, not retried (it may have been billed) (Task 3 test "calls a connection cut after the request uncertain…").

---

### Task 1: Contracts — `speech.align` in the vocabulary

**Files:**
- Modify: `studio/contracts/src/vocabulary.mjs`, `studio/contracts/schemas/v1alpha1/vocabulary.schema.json`, `studio/contracts/schemas/v1alpha1/capability-binding.schema.json`, `studio/contracts/schemas/v1alpha1/provider-job.schema.json`, `studio/contracts/fixtures/vocabulary/valid/bindings.json`
- Regenerate: `studio/contracts/bindings/ts/vocabulary.ts`, `capability-binding.ts`, `provider-job.ts`
- Test: `studio/contracts/test/bindings.test.mjs`

**Interfaces:**
- Produces: the capability `"speech.align"` everywhere a capability is named.

- [ ] **Step 1: Write the failing test**

````diff
diff --git a/studio/contracts/test/bindings.test.mjs b/studio/contracts/test/bindings.test.mjs
index a001a20..428d90d 100644
--- a/studio/contracts/test/bindings.test.mjs
+++ b/studio/contracts/test/bindings.test.mjs
@@ -29,6 +29,12 @@ describe("TypeScript bindings", () => {
     assert.ok(content.includes('"speech.synthesize"'), "vocabulary.ts should contain speech.synthesize");
   });
 
+  it("knows speech.align wherever a capability is named (avg-8hs.2)", () => {
+    for (const name of ["vocabulary", "capability-binding", "provider-job"]) {
+      assert.ok(readBinding(name).includes('"speech.align"'), `${name}.ts should contain speech.align`);
+    }
+  });
+
   it("generates journal event type with stage.started", () => {
     const content = readBinding("journal-event");
     assert.ok(content.includes('"stage.started"'), "journal-event.ts should contain stage.started");
````

Apply with `git apply` (save the block to a file first) or by hand; the result must match exactly.

- [ ] **Step 2: Run it to see it fail**

Run: `node --test studio/contracts/test/bindings.test.mjs`
Expected: 1 fail — `vocabulary.ts should contain speech.align`.

- [ ] **Step 3: Add the capability**

````diff
diff --git a/studio/contracts/fixtures/vocabulary/valid/bindings.json b/studio/contracts/fixtures/vocabulary/valid/bindings.json
index a858630..15e8ee6 100644
--- a/studio/contracts/fixtures/vocabulary/valid/bindings.json
+++ b/studio/contracts/fixtures/vocabulary/valid/bindings.json
@@ -15,6 +15,11 @@
       "provider": "qwen-tts",
       "model": "qwen-tts-v1"
     },
+    {
+      "capability": "speech.align",
+      "provider": "qwen-local",
+      "model": "mlx-community/Qwen3-ForcedAligner-0.6B-8bit"
+    },
     {
       "capability": "graphics.render",
       "provider": "studio-graphics-renderer",
diff --git a/studio/contracts/schemas/v1alpha1/capability-binding.schema.json b/studio/contracts/schemas/v1alpha1/capability-binding.schema.json
index 0ce2f60..7f5690a 100644
--- a/studio/contracts/schemas/v1alpha1/capability-binding.schema.json
+++ b/studio/contracts/schemas/v1alpha1/capability-binding.schema.json
@@ -31,6 +31,7 @@
             "image.generate",
             "image.edit",
             "speech.synthesize",
+            "speech.align",
             "graphics.render",
             "terminal.record",
             "video.compose",
diff --git a/studio/contracts/schemas/v1alpha1/provider-job.schema.json b/studio/contracts/schemas/v1alpha1/provider-job.schema.json
index b7adb04..40a97d1 100644
--- a/studio/contracts/schemas/v1alpha1/provider-job.schema.json
+++ b/studio/contracts/schemas/v1alpha1/provider-job.schema.json
@@ -51,6 +51,7 @@
             "image.generate",
             "image.edit",
             "speech.synthesize",
+            "speech.align",
             "graphics.render",
             "terminal.record",
             "video.compose",
diff --git a/studio/contracts/schemas/v1alpha1/vocabulary.schema.json b/studio/contracts/schemas/v1alpha1/vocabulary.schema.json
index f5f696e..4dd3097 100644
--- a/studio/contracts/schemas/v1alpha1/vocabulary.schema.json
+++ b/studio/contracts/schemas/v1alpha1/vocabulary.schema.json
@@ -10,6 +10,7 @@
         "image.generate",
         "image.edit",
         "speech.synthesize",
+        "speech.align",
         "graphics.render",
         "graphics.animate",
         "scene.create",
diff --git a/studio/contracts/src/vocabulary.mjs b/studio/contracts/src/vocabulary.mjs
index d2e8c7c..8a27254 100644
--- a/studio/contracts/src/vocabulary.mjs
+++ b/studio/contracts/src/vocabulary.mjs
@@ -10,6 +10,8 @@ export const CAPABILITIES = Object.freeze([
   "image.generate",
   "image.edit",
   "speech.synthesize",
+  // Word timing from audio and the text it says (avg-8hs.2): forced alignment.
+  "speech.align",
   "graphics.render",
   // Motion graphics rendered frame-accurately, as distinct from a still
   // graphic: a different provider, different outputs, and a stage should be
````

Apply with `git apply` (save the block to a file first) or by hand; the result must match exactly.

Regenerate the bindings: `npm run bindings:generate --workspace @studio/contracts`. The result:

````diff
diff --git a/studio/contracts/bindings/ts/capability-binding.ts b/studio/contracts/bindings/ts/capability-binding.ts
index 73ea000..6a08398 100644
--- a/studio/contracts/bindings/ts/capability-binding.ts
+++ b/studio/contracts/bindings/ts/capability-binding.ts
@@ -11,7 +11,7 @@ export type BindingDecision = "pi" | "user" | "default";
 export interface CapabilityBinding {
   apiVersion: "studio.video/v1alpha1";
   kind: "CapabilityBinding";
-  capability: "image.generate" | "image.edit" | "speech.synthesize" | "graphics.render" | "terminal.record" | "video.compose" | "media.probe";
+  capability: "image.generate" | "image.edit" | "speech.synthesize" | "speech.align" | "graphics.render" | "terminal.record" | "video.compose" | "media.probe";
   /** Provider identifier (e.g. 'fal-ai', 'qwen-tts', 'studio-graphics-renderer'). */
   provider: string;
   adapter: unknown;
diff --git a/studio/contracts/bindings/ts/provider-job.ts b/studio/contracts/bindings/ts/provider-job.ts
index 23a2c65..7745e5f 100644
--- a/studio/contracts/bindings/ts/provider-job.ts
+++ b/studio/contracts/bindings/ts/provider-job.ts
@@ -22,7 +22,7 @@ export interface ProviderJob {
   apiVersion: "studio.video/v1alpha1";
   kind: "ProviderJob";
   id: string;
-  capability: "image.generate" | "image.edit" | "speech.synthesize" | "graphics.render" | "terminal.record" | "video.compose" | "media.probe";
+  capability: "image.generate" | "image.edit" | "speech.synthesize" | "speech.align" | "graphics.render" | "terminal.record" | "video.compose" | "media.probe";
   provider: string;
   profile: string;
   /** Provider-side request identifier. Persisted before polling so the job survives restarts. */
diff --git a/studio/contracts/bindings/ts/vocabulary.ts b/studio/contracts/bindings/ts/vocabulary.ts
index d749646..3703c46 100644
--- a/studio/contracts/bindings/ts/vocabulary.ts
+++ b/studio/contracts/bindings/ts/vocabulary.ts
@@ -4,6 +4,6 @@
  * Auto-generated — do not edit directly.
  */
 
-export type Capability = "image.generate" | "image.edit" | "speech.synthesize" | "graphics.render" | "graphics.animate" | "scene.create" | "scene.render" | "terminal.record" | "video.generate" | "video.compose" | "media.probe";
+export type Capability = "image.generate" | "image.edit" | "speech.synthesize" | "speech.align" | "graphics.render" | "graphics.animate" | "scene.create" | "scene.render" | "terminal.record" | "video.generate" | "video.compose" | "media.probe";
 
 export type ArtifactKind = "markdown" | "json" | "yaml" | "audio" | "video" | "image" | "captions" | "tape" | "directory";
````

Apply with `git apply` (save the block to a file first) or by hand; the result must match exactly.

- [ ] **Step 4: Run the contracts' checks**

Run: `npm run check --workspace @studio/contracts`
Expected: `All vocabulary checks passed: 12 capabilities, 9 artifact kinds`; bindings up to date; 378 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add studio/contracts/src/vocabulary.mjs studio/contracts/schemas/v1alpha1/vocabulary.schema.json \
  studio/contracts/schemas/v1alpha1/capability-binding.schema.json studio/contracts/schemas/v1alpha1/provider-job.schema.json \
  studio/contracts/fixtures/vocabulary/valid/bindings.json studio/contracts/bindings/ts/vocabulary.ts \
  studio/contracts/bindings/ts/capability-binding.ts studio/contracts/bindings/ts/provider-job.ts studio/contracts/test/bindings.test.mjs
git commit -m "feat(contracts): the speech.align capability (avg-8hs.2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: The voice worker aligns — `POST /align`

**Files:**
- Create: `packages/voice/src/qwen_tts_worker/alignment.py`, `packages/voice/src/qwen_tts_worker/routes/alignment.py`
- Modify: `packages/voice/src/qwen_tts_worker/routes/__init__.py`, `packages/voice/src/qwen_tts_worker/config.py`, `packages/voice/README.md`, `packages/voice/docs/API.md`
- Test: `packages/voice/tests/test_alignment.py`

**Interfaces:**
- Produces: `GET /align` → `{model, loaded, maxSeconds}`; `POST /align` with `{audio_path (absolute), text, language (ISO code or name)}` → `200 {words: [{text, start, end}], model, language}` or `422` with the error envelope, `detail[0].type` ∈ `too-long | unsupported-language | bad-audio | empty-text`. Setting `QTW_ALIGN_MODEL` (default `mlx-community/Qwen3-ForcedAligner-0.6B-8bit`). Under `QTW_TTS_MODE=fake`, model `fake-aligner`, words spread evenly.

- [ ] **Step 1: Write the failing tests**

`packages/voice/tests/test_alignment.py` (new):

````python
"""POST /align (avg-8hs.2): word timing by forced alignment against known text.

The live aligner is Qwen3-ForcedAligner through mlx-audio; these tests use the
worker's explicit fake mode and an injected model, so nothing is downloaded.
A real alignment is opt-in: QTW_ALIGN_LIVE=1 (macOS ``say`` makes the speech).
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from qwen_tts_worker.alignment import AlignError, Aligner, language_name


def _tone(path: Path, seconds: float) -> Path:
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
         f"sine=frequency=220:duration={seconds}", "-ar", "16000", str(path)],
        check=True,
    )
    return path


@pytest.fixture
def fake_client(tmp_path, monkeypatch) -> TestClient:
    monkeypatch.setenv("QTW_TTS_MODE", "fake")
    for name in ("MODELS", "VOICES", "OUTPUTS", "ATTEMPT_STORE"):
        monkeypatch.setenv(f"QTW_{name}_DIR", str(tmp_path / name.lower()))
    from qwen_tts_worker.app import create_app
    from qwen_tts_worker.routes import alignment
    alignment.reset()
    return TestClient(create_app())


def _code(response) -> str:
    return response.json()["detail"][0]["type"]


class TestAlignRoute:
    def test_fake_mode_spreads_the_words_over_the_audio(self, fake_client, tmp_path):
        audio = _tone(tmp_path / "take.wav", 2.0)
        response = fake_client.post("/align", json={"audio_path": str(audio), "text": "La nebbia sale", "language": "it"})
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["model"] == "fake-aligner"
        assert body["language"] == "Italian"
        assert [w["text"] for w in body["words"]] == ["La", "nebbia", "sale"]
        assert body["words"][0]["start"] == 0
        assert abs(body["words"][-1]["end"] - 2.0) < 0.05
        starts = [w["start"] for w in body["words"]]
        assert starts == sorted(starts)

    def test_reports_the_aligner(self, fake_client):
        body = fake_client.get("/align").json()
        assert body == {"model": "fake-aligner", "loaded": False, "maxSeconds": 300}

    def test_refuses_audio_over_five_minutes(self, fake_client, tmp_path):
        audio = _tone(tmp_path / "long.wav", 301)
        response = fake_client.post("/align", json={"audio_path": str(audio), "text": "parole", "language": "it"})
        assert response.status_code == 422
        assert _code(response) == "too-long"

    def test_refuses_what_it_cannot_read_or_align(self, fake_client, tmp_path):
        audio = _tone(tmp_path / "take.wav", 1.0)
        cases = [
            ({"audio_path": str(tmp_path / "missing.wav"), "text": "parole", "language": "it"}, "bad-audio"),
            ({"audio_path": str(tmp_path), "text": "parole", "language": "it"}, "bad-audio"),
            ({"audio_path": str(audio), "text": "   ", "language": "it"}, "empty-text"),
            ({"audio_path": str(audio), "text": "parole", "language": "klingon"}, "unsupported-language"),
            ({"audio_path": "relative.wav", "text": "parole", "language": "it"}, "bad-audio"),
        ]
        for body, code in cases:
            response = fake_client.post("/align", json=body)
            assert response.status_code == 422, (body, response.text)
            assert _code(response) == code, body


class _FakeItem(SimpleNamespace):
    pass


class TestAligner:
    def _model(self, calls: list[str]):
        def generate(audio, text, language):
            calls.append(language)
            return [_FakeItem(text=t, start_time=i * 0.5, end_time=i * 0.5 + 0.4) for i, t in enumerate(text.split())]
        return SimpleNamespace(generate=generate, get_supported_languages=lambda: ["english", "italian"])

    def test_loads_the_model_once_and_keeps_it(self, tmp_path):
        loads: list[str] = []
        calls: list[str] = []
        model = self._model(calls)
        aligner = Aligner("some/aligner", loader=lambda repo: loads.append(repo) or model)
        audio = _tone(tmp_path / "take.wav", 2.0)
        assert not aligner.loaded
        first = aligner.align(str(audio), "uno due", "Italian")
        aligner.align(str(audio), "tre", "en")
        assert loads == ["some/aligner"]
        assert aligner.loaded
        assert calls == ["Italian", "English"]
        assert first["words"] == [{"text": "uno", "start": 0.0, "end": 0.4}, {"text": "due", "start": 0.5, "end": 0.9}]
        assert first["model"] == "some/aligner"

    def test_refuses_a_language_the_model_does_not_list(self, tmp_path):
        aligner = Aligner("some/aligner", loader=lambda repo: self._model([]))
        with pytest.raises(AlignError) as raised:
            aligner.align(str(_tone(tmp_path / "take.wav", 1.0)), "bonjour", "fr")
        assert raised.value.code == "unsupported-language"

    def test_names_languages_from_codes_and_names(self):
        assert language_name("it") == "Italian"
        assert language_name("IT") == "Italian"
        assert language_name("italian") == "Italian"
        assert language_name("Portuguese") == "Portuguese"
        assert language_name("xx") is None


@pytest.mark.skipif(os.environ.get("QTW_ALIGN_LIVE") != "1" or shutil.which("say") is None,
                    reason="set QTW_ALIGN_LIVE=1 on macOS to align with the real model")
def test_live_alignment_of_italian_speech(tmp_path):
    aiff = tmp_path / "take.aiff"
    subprocess.run(["say", "-v", "Alice", "-o", str(aiff), "La nebbia agli irti colli piovigginando sale"], check=True)
    wav = tmp_path / "take.wav"
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(aiff), "-ar", "16000", str(wav)], check=True)
    result = Aligner("mlx-community/Qwen3-ForcedAligner-0.6B-8bit").align(str(wav), "La nebbia agli irti colli piovigginando sale", "it")
    assert [w["text"] for w in result["words"]] == ["La", "nebbia", "agli", "irti", "colli", "piovigginando", "sale"]
    ends = [w["end"] for w in result["words"]]
    assert ends == sorted(ends) and ends[-1] > 1.0
````

- [ ] **Step 2: A test environment, and the tests failing**

The worker's `.venv` has no pytest. Make a throwaway environment outside the repository that sees the worker's packages and adds only pytest:

```bash
V="${TMPDIR:-/tmp}/voice-test-venv"
packages/voice/.venv/bin/python -m venv "$V"
echo "$PWD/packages/voice/.venv/lib/python3.12/site-packages" > "$V/lib/python3.12/site-packages/voice-worker.pth"
"$V/bin/pip" install -q pytest pytest-asyncio
```

Run: `cd packages/voice && env -u QTW_PORT -u QTW_URL PYTHONPATH=src "$V/bin/python" -m pytest -q -p no:cacheprovider tests/test_alignment.py`
Expected: collection error — `No module named 'qwen_tts_worker.alignment'`.

- [ ] **Step 3: Implement**

`packages/voice/src/qwen_tts_worker/alignment.py` (new):

````python
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
````

`packages/voice/src/qwen_tts_worker/routes/alignment.py` (new):

````python
"""``POST /align`` and ``GET /align``: forced alignment of a take (avg-8hs.2)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from qwen_tts_worker.alignment import ALIGN_MAX_SECONDS, AlignError, Aligner
from qwen_tts_worker.config import Settings

router = APIRouter()

_aligner: Aligner | None = None


def reset() -> None:
    """Forget the aligner (tests: each application gets its own)."""
    global _aligner
    _aligner = None


def _get() -> Aligner:
    global _aligner
    if _aligner is None:
        settings = Settings()
        _aligner = Aligner(settings.align_model, fake=settings.tts_mode == "fake")
    return _aligner


class AlignRequest(BaseModel):
    audio_path: str = Field(..., description="Absolute path to the take's audio.")
    text: str = Field(..., description="The text the audio says.")
    language: str = Field(..., description="An ISO 639-1 code (it) or a language name (Italian).")


class AlignedWord(BaseModel):
    text: str
    start: float
    end: float


class AlignResponse(BaseModel):
    words: list[AlignedWord]
    model: str
    language: str


@router.get("/align")
async def aligner_status() -> dict:
    aligner = _get()
    return {"model": aligner.model_id, "loaded": aligner.loaded, "maxSeconds": ALIGN_MAX_SECONDS}


@router.post("/align", response_model=AlignResponse)
async def align(request: AlignRequest) -> AlignResponse:
    try:
        result = await run_in_threadpool(_get().align, request.audio_path, request.text, request.language)
    except AlignError as error:
        raise HTTPException(status_code=422, detail=[{"msg": error.message, "type": error.code}]) from None
    return AlignResponse(**result)
````

````diff
diff --git a/packages/voice/src/qwen_tts_worker/config.py b/packages/voice/src/qwen_tts_worker/config.py
index 17f1021..60546dc 100644
--- a/packages/voice/src/qwen_tts_worker/config.py
+++ b/packages/voice/src/qwen_tts_worker/config.py
@@ -67,6 +67,11 @@ class Settings(BaseSettings):
         description="Synthesis provider mode. 'fake' is an explicit CI-only mode; live failures never fall back to it.",
     )
 
+    align_model: str = Field(
+        default="mlx-community/Qwen3-ForcedAligner-0.6B-8bit",
+        description="Forced-alignment model for POST /align (avg-8hs.2), loaded on first use.",
+    )
+
     model_idle_timeout_seconds: float | None = Field(
         default=None,
         ge=1.0,
diff --git a/packages/voice/src/qwen_tts_worker/routes/__init__.py b/packages/voice/src/qwen_tts_worker/routes/__init__.py
index 6098cac..0b3e1f1 100644
--- a/packages/voice/src/qwen_tts_worker/routes/__init__.py
+++ b/packages/voice/src/qwen_tts_worker/routes/__init__.py
@@ -14,6 +14,7 @@ from qwen_tts_worker.routes.models import router as models_router
 from qwen_tts_worker.routes.synthesis import router as synthesis_router
 from qwen_tts_worker.routes.attempts import router as attempts_router
 from qwen_tts_worker.routes.narrations import router as narrations_router
+from qwen_tts_worker.routes.alignment import router as alignment_router
 
 api_router = APIRouter()
 api_router.include_router(health_router, tags=["health"])
@@ -22,3 +23,4 @@ api_router.include_router(models_router, tags=["models"])
 api_router.include_router(synthesis_router, tags=["synthesis"])
 api_router.include_router(attempts_router, tags=["attempts"])
 api_router.include_router(narrations_router, tags=["narrations"])
+api_router.include_router(alignment_router, tags=["alignment"])
````

Apply with `git apply` (save the block to a file first) or by hand; the result must match exactly.

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd packages/voice && env -u QTW_PORT -u QTW_URL PYTHONPATH=src "$V/bin/python" -m pytest -q -p no:cacheprovider tests/test_alignment.py`
Expected: 7 passed, 1 skipped.

Then the whole worker: `env -u QTW_PORT -u QTW_URL PYTHONPATH=src "$V/bin/python" -m pytest -q -p no:cacheprovider`
Expected: 380 passed, 5 skipped.

The real alignment (macOS, downloads the model the first time, about 1.3 GB): `QTW_ALIGN_LIVE=1 env -u QTW_PORT -u QTW_URL PYTHONPATH=src "$V/bin/python" -m pytest -q -p no:cacheprovider tests/test_alignment.py -k live` — Expected: 1 passed.

- [ ] **Step 5: Document and commit**

````diff
diff --git a/packages/voice/README.md b/packages/voice/README.md
index f4d522e..90176a1 100644
--- a/packages/voice/README.md
+++ b/packages/voice/README.md
@@ -6,6 +6,8 @@ Persistent local Qwen3-TTS service optimized for Apple Silicon through MLX.
 
 Model discovery/download state, load and unload lifecycle, one reusable model cache, voice profiles, synthesis job queue, progress, cancellation, segment outputs, health/resource diagnostics, and canonical WAV metadata.
 
+It also aligns: `POST /align` returns when each word of a known text is said in an audio file, with Qwen3-ForcedAligner (`QTW_ALIGN_MODEL`, default `mlx-community/Qwen3-ForcedAligner-0.6B-8bit`, downloaded and loaded on first use). See [the API contract](docs/API.md#forced-alignment).
+
 ## Design correction over the prototype
 
 The worker does not spawn and reload Python for every Pi tool call. A typed local API keeps models warm and makes narration jobs resumable and observable. Audio transcoding and final mixing remain FFmpeg composer responsibilities.
@@ -35,6 +37,7 @@ API docs: `http://127.0.0.1:8000/docs`. For a private per-user LaunchAgent, diag
 ```bash
 pytest
 pytest --cov=src/qwen_tts_worker --cov-report=term-missing
+QTW_ALIGN_LIVE=1 pytest tests/test_alignment.py   # also a real alignment (macOS `say` speaks Italian)
 ```
 
 ## Documentation
diff --git a/packages/voice/docs/API.md b/packages/voice/docs/API.md
index 0610433..5612ec8 100644
--- a/packages/voice/docs/API.md
+++ b/packages/voice/docs/API.md
@@ -405,3 +405,46 @@ The following endpoints will be added in subsequent issues:
 
 - `POST /models/load` — Load a model explicitly
 - `POST /models/unload` — Unload the current model
+
+## Forced alignment
+
+When each word of a known text is said in an audio file (avg-8hs.2). The
+model (`QTW_ALIGN_MODEL`, default `mlx-community/Qwen3-ForcedAligner-0.6B-8bit`)
+is loaded on first use and kept. Under `QTW_TTS_MODE=fake` alignment is fake
+too: the words spread evenly over the audio.
+
+### `GET /align`
+
+```json
+{ "model": "mlx-community/Qwen3-ForcedAligner-0.6B-8bit", "loaded": false, "maxSeconds": 300 }
+```
+
+### `POST /align`
+
+```json
+{ "audio_path": "/abs/path/take.wav", "text": "La nebbia a gl'irti colli", "language": "it" }
+```
+
+`language` is an ISO 639-1 code or a name: Chinese, English, Cantonese,
+French, German, Italian, Japanese, Korean, Portuguese, Russian, Spanish.
+
+#### Response `200 OK`
+
+```json
+{
+  "words": [{ "text": "La", "start": 0.0, "end": 0.24 }, { "text": "nebbia", "start": 0.24, "end": 0.72 }],
+  "model": "mlx-community/Qwen3-ForcedAligner-0.6B-8bit",
+  "language": "Italian"
+}
+```
+
+The model's own words and seconds (80 ms resolution), unprocessed: mapping
+them onto the written text and onto the measured silences is the studio's
+work.
+
+#### Response `422`
+
+The error envelope, `detail[0].type` one of `too-long` (over 300 s),
+`unsupported-language`, `bad-audio` (not an absolute path to readable
+audio), `empty-text`.
+
````

Apply with `git apply` (save the block to a file first) or by hand; the result must match exactly.

```bash
git add packages/voice/src/qwen_tts_worker/alignment.py packages/voice/src/qwen_tts_worker/routes/alignment.py \
  packages/voice/src/qwen_tts_worker/routes/__init__.py packages/voice/src/qwen_tts_worker/config.py \
  packages/voice/tests/test_alignment.py packages/voice/README.md packages/voice/docs/API.md
git commit -m "feat(voice): POST /align — Qwen3-ForcedAligner word timing in the worker (avg-8hs.2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: `@av/elevenlabs` — forced alignment, with the rate rules

**Files:**
- Create: `packages/elevenlabs/package.json`, `packages/elevenlabs/tsconfig.json`, `packages/elevenlabs/vitest.config.ts`, `packages/elevenlabs/src/errors.ts`, `packages/elevenlabs/src/profiles.ts`, `packages/elevenlabs/src/request.ts`, `packages/elevenlabs/src/alignment.ts`, `packages/elevenlabs/src/index.ts`, `packages/elevenlabs/README.md`
- Modify: `package.json` (workspaces), `tools/build-required.mjs`, `bun.lock`
- Test: `packages/elevenlabs/test/alignment.test.ts`

**Interfaces:**
- Produces (from `@av/elevenlabs`): `forcedAlignment({audioPath, text, apiKey, baseUrl?, signal?, sleep?}) → Promise<{words: {text, start, end, loss?}[]; loss?}>`; `ElevenLabsError {code: "auth" | "quota" | "rate-limited" | "bad-request" | "server" | "unreachable" | "uncertain"; status?}`; `ELEVENLABS_PROFILES.forcedAlignment = {usdPerMinute: 0.0067, estimate: true}`; `DEFAULT_BASE_URL`; type `RequestOptions`.

- [ ] **Step 1: The package's skeleton**

`packages/elevenlabs/package.json` (new):

````json
{
  "name": "@av/elevenlabs",
  "version": "0.1.0",
  "description": "ElevenLabs API client: forced alignment (avg-8hs.2), with the studio's rate and retry rules",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": [
    "dist/**"
  ],
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "typescript": "^5.3.3",
    "vitest": "^1.2.0"
  },
  "engines": {
    "node": ">=18"
  },
  "license": "UNLICENSED",
  "private": true
}
````

`packages/elevenlabs/tsconfig.json` (new):

````json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": false
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "test"]
}
````

`packages/elevenlabs/vitest.config.ts` (new):

````ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
````

````diff
diff --git a/package.json b/package.json
index fad6698..415df77 100644
--- a/package.json
+++ b/package.json
@@ -11,6 +11,7 @@
   "workspaces": [
     "packages/blender",
     "packages/codex-image",
+    "packages/elevenlabs",
     "packages/fal-media",
     "packages/graphics",
     "packages/infographics",
diff --git a/tools/build-required.mjs b/tools/build-required.mjs
index 15defd2..c3a4bca 100644
--- a/tools/build-required.mjs
+++ b/tools/build-required.mjs
@@ -20,7 +20,7 @@ import { spawnSync } from "node:child_process";
 const ROOT = resolve(import.meta.dirname, "..");
 
 /** Workspaces whose `exports` resolve into `dist/`. */
-const REQUIRED = ["packages/fal-media", "packages/video-composer", "packages/remotion-composer", "studio/series", "studio/episode", "studio/runtime", "studio/adapters"];
+const REQUIRED = ["packages/fal-media", "packages/elevenlabs", "packages/video-composer", "packages/remotion-composer", "studio/series", "studio/episode", "studio/runtime", "studio/adapters"];
 
 /**
  * Nothing must depend on a `dist/` that install does not build.
````

Apply with `git apply` (save the block to a file first) or by hand; the result must match exactly.

Then, in this checkout: `bun install --lockfile-only --ignore-scripts && bun install --frozen-lockfile`. `git diff bun.lock` must show only the new workspace (`packages/elevenlabs` and `@av/elevenlabs@workspace:packages/elevenlabs`), no new registry package.

- [ ] **Step 2: Write the failing tests**

`packages/elevenlabs/test/alignment.test.ts` (new):

````ts
// forcedAlignment against a local fake of the ElevenLabs API: what is sent,
// how answers and failures are read, and the retry rules (UP-39).

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ElevenLabsError, forcedAlignment } from "../src/index.js";

const KEY = "sk_test_never_print_me";
type Handler = (req: IncomingMessage, body: Buffer, res: ServerResponse) => void;
let server: Server;
let baseUrl: string;
let handlers: Handler[];
let requests: { headers: IncomingMessage["headers"]; body: string }[];
let dir: string;
let audio: string;
const waits: number[] = [];
const sleep = async (ms: number) => { waits.push(ms); };

beforeEach(async () => {
  handlers = [];
  requests = [];
  waits.length = 0;
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      requests.push({ headers: req.headers, body: body.toString("latin1") });
      const handler = handlers.shift();
      if (!handler) { res.writeHead(500); res.end(); return; }
      handler(req, body, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${address.port}`;
  dir = mkdtempSync(join(tmpdir(), "elevenlabs-"));
  audio = join(dir, "take.wav");
  writeFileSync(audio, "RIFF fake audio");
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true });
});

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Handler => (_req, _body, res) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};
const WORDS = { words: [{ text: "La", start: 0.1, end: 0.3, loss: 0.2 }, { text: "nebbia", start: 0.3, end: 0.8, loss: 0.1 }], loss: 0.15 };
const align = () => forcedAlignment({ audioPath: audio, text: "La nebbia", apiKey: KEY, baseUrl, sleep });
const failure = (promise: Promise<unknown>) => promise.then(() => { throw new Error("expected a failure"); }, (e: unknown) => e as ElevenLabsError);

describe("forcedAlignment", () => {
  it("sends the audio and the text with the key, and reads the words", async () => {
    handlers.push(json(200, WORDS));
    const result = await align();
    expect(result).toEqual(WORDS);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.headers["xi-api-key"]).toBe(KEY);
    expect(requests[0]!.headers["content-type"]).toMatch(/^multipart\/form-data/);
    expect(requests[0]!.body).toContain('name="text"');
    expect(requests[0]!.body).toContain("La nebbia");
    expect(requests[0]!.body).toContain('filename="take.wav"');
    expect(requests[0]!.body).toContain("RIFF fake audio");
  });

  it("waits Retry-After on 429, at most twice, then succeeds", async () => {
    handlers.push(json(429, { detail: "slow down" }, { "retry-after": "3" }), json(503, {}), json(200, WORDS));
    expect((await align()).words).toHaveLength(2);
    expect(waits).toEqual([3000, 4000]);
  });

  it("gives up after two retries", async () => {
    handlers.push(json(429, {}), json(429, {}), json(429, { detail: "still too fast" }));
    const error = await failure(align());
    expect(error.code).toBe("rate-limited");
    expect(requests).toHaveLength(3);
  });

  it("never retries a refused key or a spent quota", async () => {
    handlers.push(json(401, { detail: { status: "invalid_api_key", message: `key ${KEY} is not valid` } }));
    const auth = await failure(align());
    expect(auth.code).toBe("auth");
    expect(auth.message).not.toContain(KEY);
    handlers.push(json(401, { detail: { status: "quota_exceeded", message: "no credits left" } }));
    expect((await failure(align())).code).toBe("quota");
    expect(requests).toHaveLength(2);
    expect(waits).toEqual([]);
  });

  it("reports a bad request without retrying", async () => {
    handlers.push(json(422, { detail: "text is empty" }));
    const error = await failure(align());
    expect([error.code, error.status, error.message]).toEqual(["bad-request", 422, "ElevenLabs refused the request: text is empty"]);
  });

  it("calls a connection cut after the request uncertain, and does not retry it", async () => {
    handlers.push((_req, _body, res) => res.socket?.destroy());
    const error = await failure(align());
    expect(error.code).toBe("uncertain");
    expect(requests).toHaveLength(1);
  });

  it("says nothing was sent when no connection could be made", async () => {
    // A port that was just freed: nothing listens there.
    const spare = createServer();
    await new Promise<void>((resolve) => spare.listen(0, "127.0.0.1", resolve));
    const { port } = spare.address() as { port: number };
    await new Promise<void>((resolve) => spare.close(() => resolve()));
    const error = await failure(forcedAlignment({ audioPath: audio, text: "La", apiKey: KEY, baseUrl: `http://127.0.0.1:${port}`, sleep }));
    expect(error.code).toBe("unreachable");
  });

  it("keeps the key out of every error", async () => {
    for (const handler of [json(500, { detail: `boom ${KEY}` }), json(500, {}), json(500, {})]) handlers.push(handler);
    const error = await failure(align());
    expect(error.code).toBe("server");
    expect(JSON.stringify({ message: error.message, stack: error.stack })).not.toContain(KEY);
  });

  it("sends one request at a time", async () => {
    let open = 0;
    let most = 0;
    const slow: Handler = (_req, _body, res) => {
      open++;
      most = Math.max(most, open);
      setTimeout(() => { open--; json(200, WORDS)(_req, _body, res); }, 30);
    };
    handlers.push(slow, slow, slow);
    await Promise.all([align(), align(), align()]);
    expect(most).toBe(1);
  });
});
````

Run: `npm test --workspace @av/elevenlabs`
Expected: FAIL — cannot resolve `../src/index.js`.

- [ ] **Step 3: Implement**

`packages/elevenlabs/src/errors.ts` (new):

````ts
/** Why an ElevenLabs call failed; `code` is what callers branch on. */
export type ElevenLabsErrorCode =
  | "auth"          // 401/403: the key is wrong or lacks the permission; never retried
  | "quota"         // the account's quota is used up; never retried
  | "rate-limited"  // 429 after the retries
  | "bad-request"   // 400/422: the request itself is wrong
  | "server"        // 5xx after the retries
  | "unreachable"   // no connection was made: nothing was sent
  | "uncertain";    // the connection broke after the request left: it may have been processed

export class ElevenLabsError extends Error {
  constructor(readonly code: ElevenLabsErrorCode, message: string, readonly status?: number) {
    super(message);
    this.name = "ElevenLabsError";
  }
}
````

`packages/elevenlabs/src/profiles.ts` (new):

````ts
// What ElevenLabs calls are estimated to cost. ElevenLabs returns no price for
// forced alignment, so the spend ledger settles at this estimate: edit it when
// the plan's price changes.

export interface PriceProfile {
  /** US dollars per minute of audio. */
  usdPerMinute: number;
  /** Always true: a published price, not one the provider reported. */
  estimate: true;
}

export const ELEVENLABS_PROFILES: Readonly<{ forcedAlignment: PriceProfile }> = Object.freeze({
  // Billed like speech-to-text: about $0.40 an hour of audio.
  forcedAlignment: Object.freeze({ usdPerMinute: 0.0067, estimate: true as const }),
});
````

`packages/elevenlabs/src/request.ts` (new):

````ts
// One ElevenLabs request at a time per process, with CreativeStudio's rules
// (UP-39): at most two retries, only for 429 and 5xx — answers that say the
// request was not processed — waiting Retry-After (or 2 s, then 4 s); never a
// retry for auth or quota; a connection lost after the request left is
// `uncertain` and is not retried, since it may have been processed (and
// billed). The key never appears in an error.

import { ElevenLabsError } from "./errors.js";

export const DEFAULT_BASE_URL = "https://api.elevenlabs.io";
const MAX_RETRIES = 2;
const MAX_WAIT_MS = 30_000;

export interface RequestOptions {
  apiKey: string;
  baseUrl?: string;
  signal?: AbortSignal;
  /** Tests: how to wait between retries. */
  sleep?: (ms: number) => Promise<void>;
}

let queue: Promise<unknown> = Promise.resolve();

/** Run `task` after every earlier ElevenLabs request of this process has finished. */
function oneAtATime<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Errors raised before any byte left: nothing was sent, so nothing was processed. */
const NOT_SENT = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH"]);

function causeCode(error: unknown): string | undefined {
  const cause = (error as { cause?: { code?: string } })?.cause;
  return cause?.code;
}

async function describe(response: Response, apiKey: string): Promise<{ message: string; status?: string }> {
  let detail: unknown;
  try {
    detail = (await response.json() as { detail?: unknown }).detail;
  } catch {
    detail = undefined;
  }
  const status = typeof detail === "object" && detail !== null ? String((detail as { status?: unknown }).status ?? "") : "";
  const message = typeof detail === "string"
    ? detail
    : typeof detail === "object" && detail !== null && typeof (detail as { message?: unknown }).message === "string"
      ? (detail as { message: string }).message
      : `HTTP ${response.status}`;
  return { message: message.split(apiKey).join("[key]"), status };
}

function waitFor(response: Response, attempt: number): number {
  const header = Number(response.headers.get("retry-after"));
  return Number.isFinite(header) && header > 0 ? Math.min(header * 1000, MAX_WAIT_MS) : 2000 * 2 ** attempt;
}

/** POST `path` with `body` and return the parsed JSON answer. */
export function postForm(path: string, body: () => FormData, options: RequestOptions): Promise<unknown> {
  const sleep = options.sleep ?? defaultSleep;
  const url = `${options.baseUrl ?? DEFAULT_BASE_URL}${path}`;
  return oneAtATime(async () => {
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await fetch(url, { method: "POST", headers: { "xi-api-key": options.apiKey }, body: body(), signal: options.signal ?? null });
      } catch (error) {
        if (options.signal?.aborted) throw error;
        const code = causeCode(error);
        if (code && NOT_SENT.has(code)) throw new ElevenLabsError("unreachable", `ElevenLabs could not be reached (${code}); nothing was sent`);
        throw new ElevenLabsError("uncertain", `the connection to ElevenLabs broke after the request was sent (${code ?? "no answer"}); it may have been processed`);
      }
      if (response.ok) {
        try {
          return await response.json();
        } catch {
          throw new ElevenLabsError("uncertain", "ElevenLabs answered, but not with JSON; the request may have been processed");
        }
      }
      const { message, status } = await describe(response, options.apiKey);
      if (status === "quota_exceeded" || response.status === 402) throw new ElevenLabsError("quota", `ElevenLabs quota: ${message}`, response.status);
      if (response.status === 401 || response.status === 403) throw new ElevenLabsError("auth", `ElevenLabs refused the key: ${message}`, response.status);
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < MAX_RETRIES) {
        await sleep(waitFor(response, attempt));
        continue;
      }
      if (response.status === 429) throw new ElevenLabsError("rate-limited", `ElevenLabs is rate limiting: ${message}`, 429);
      if (response.status >= 500) throw new ElevenLabsError("server", `ElevenLabs failed: ${message}`, response.status);
      throw new ElevenLabsError("bad-request", `ElevenLabs refused the request: ${message}`, response.status);
    }
  });
}
````

`packages/elevenlabs/src/alignment.ts` (new):

````ts
// Forced alignment (avg-8hs.2): when each word of a known text is spoken in
// an audio file. https://elevenlabs.io/docs/api-reference/forced-alignment/create

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { ElevenLabsError } from "./errors.js";
import { postForm, type RequestOptions } from "./request.js";

export interface AlignedWord {
  text: string;
  start: number;
  end: number;
  /** ElevenLabs' alignment loss for the word: lower is better. */
  loss?: number;
}

export interface ForcedAlignmentResult {
  words: AlignedWord[];
  /** The whole transcript's average loss. */
  loss?: number;
}

export interface ForcedAlignmentOptions extends RequestOptions {
  audioPath: string;
  text: string;
}

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export async function forcedAlignment(options: ForcedAlignmentOptions): Promise<ForcedAlignmentResult> {
  const audio = await readFile(options.audioPath);
  const answer = await postForm("/v1/forced-alignment", () => {
    const form = new FormData();
    form.append("file", new Blob([audio]), basename(options.audioPath));
    form.append("text", options.text);
    return form;
  }, options) as { words?: unknown; loss?: unknown };
  if (!Array.isArray(answer?.words)) throw new ElevenLabsError("uncertain", "ElevenLabs answered without words");
  const words = answer.words.flatMap((w: { text?: unknown; start?: unknown; end?: unknown; loss?: unknown }) =>
    typeof w?.text === "string" && isNumber(w.start) && isNumber(w.end)
      ? [{ text: w.text, start: w.start, end: w.end, ...(isNumber(w.loss) ? { loss: w.loss } : {}) }]
      : []);
  return { words, ...(isNumber(answer.loss) ? { loss: answer.loss } : {}) };
}
````

`packages/elevenlabs/src/index.ts` (new):

````ts
export { forcedAlignment, type AlignedWord, type ForcedAlignmentOptions, type ForcedAlignmentResult } from "./alignment.js";
export { ElevenLabsError, type ElevenLabsErrorCode } from "./errors.js";
export { ELEVENLABS_PROFILES, type PriceProfile } from "./profiles.js";
export { DEFAULT_BASE_URL, type RequestOptions } from "./request.js";
````

- [ ] **Step 4: Run the tests to see them pass, build**

Run: `npm test --workspace @av/elevenlabs && npm run typecheck --workspace @av/elevenlabs && npm run build --workspace @av/elevenlabs`
Expected: 9 passed; no type errors; `packages/elevenlabs/dist/index.js` exists.

- [ ] **Step 5: Document and commit**

`packages/elevenlabs/README.md` (new):

````markdown
# @av/elevenlabs

A small client for the ElevenLabs API, with the studio's rate and retry
rules. Today it does forced alignment (avg-8hs.2); speech synthesis joins it
with avg-8hs.1.

```ts
import { forcedAlignment, ELEVENLABS_PROFILES, ElevenLabsError } from "@av/elevenlabs";

const { words, loss } = await forcedAlignment({
  audioPath: "/abs/take.wav",
  text: "La nebbia a gl'irti colli",
  apiKey: process.env.ELEVENLABS_API_KEY!,   // the caller reads the key; this package reads no environment
});
// words: [{ text, start, end, loss? }]
```

## Rules

- One request at a time per process.
- At most two retries, only for 429 and 5xx — answers that say the request
  was not processed — waiting `Retry-After` (or 2 s, then 4 s, at most 30 s).
- Never a retry for a refused key (`auth`) or a spent quota (`quota`).
- A connection lost after the request left is `uncertain` and not retried:
  it may have been processed, and billed. No connection at all is
  `unreachable`: nothing was sent.
- The key never appears in an error.

`ElevenLabsError.code`: `auth`, `quota`, `rate-limited`, `bad-request`,
`server`, `unreachable`, `uncertain`.

## Price

ElevenLabs returns no price for alignment; `ELEVENLABS_PROFILES.forcedAlignment.usdPerMinute`
is an estimate the studio's spend ledger reserves and settles at. Edit it
when the plan's price changes.

## Tests

```bash
npm test --workspace @av/elevenlabs   # against a local fake of the API; no key, no network
```
````

```bash
git add packages/elevenlabs/package.json packages/elevenlabs/tsconfig.json packages/elevenlabs/vitest.config.ts \
  packages/elevenlabs/src packages/elevenlabs/test packages/elevenlabs/README.md package.json tools/build-required.mjs bun.lock
git commit -m "feat(elevenlabs): @av/elevenlabs — forced alignment with the studio's rate and retry rules (avg-8hs.2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: Post-processing — a provider's words become the take's words

**Files:**
- Create: `studio/episode/src/speech-align.ts`
- Modify: `studio/episode/src/index.ts`
- Test: `studio/episode/tests/speech-align.test.ts`

**Interfaces:**
- Produces: `AlignErrorCode` (the spec's error codes), `class AlignError {code; message}`; `RawWord {text, start, end}`; `TimedWord {text, start, end, confidence?}`; `MAX_UNMAPPED_SHARE = 0.1`; `MIN_WORD_SECONDS = 0.08`; `SILENCE = {noise: "-35dB", seconds: 0.1}`; `mapToText(text, raw: RawWord[]) → {words: TimedWord[]; unmapped: number[]}` (throws `alignment-mismatch`); `snapToSilences(words, silences: [number, number][], durationSeconds) → TimedWord[]`; `measureSilences(audioPath) → Promise<{silences; speech; durationSeconds}>` (throws `bad-audio`).

- [ ] **Step 1: Write the failing tests**

`studio/episode/tests/speech-align.test.ts` (new):

````ts
import { describe, expect, it } from "vitest";
import { AlignError, mapToText, snapToSilences } from "../src/speech-align.js";

/**
 * Turning a provider's words into a take's WordTiming words (avg-8hs.2):
 * the written text's own tokens, each with the provider's times, kept out of
 * the measured silences and never shorter than 80 ms. The fixtures are the
 * spike's: Qwen3-ForcedAligner on CreativeStudio's San Martino recital.
 */

const w = (text: string, start: number, end: number) => ({ text, start, end });

describe("mapToText", () => {
  it("gives every token of the written text the time of its word, punctuation and all", () => {
    const { words, unmapped } = mapToText("La nebbia, sale.", [w("La", 0, 0.24), w("nebbia", 0.24, 0.72), w("sale", 0.72, 1.1)]);
    expect(words).toEqual([w("La", 0, 0.24), w("nebbia,", 0.24, 0.72), w("sale.", 0.72, 1.1)]);
    expect(unmapped).toEqual([]);
  });

  it("matches apostrophes and accents whatever the provider does with them", () => {
    const { words } = mapToText("a gl'irti colli de' tini", [w("a", 0, 0.1), w("glirti", 0.1, 0.5), w("colli", 0.5, 0.9), w("de", 0.9, 1), w("tini", 1, 1.4)]);
    expect(words.map((x) => [x.text, x.start, x.end])).toEqual([["a", 0, 0.1], ["gl'irti", 0.1, 0.5], ["colli", 0.5, 0.9], ["de'", 0.9, 1], ["tini", 1, 1.4]]);
  });

  it("joins a word the provider split, and splits none it merged", () => {
    const split = mapToText("gl'irti colli", [w("gl", 0.1, 0.2), w("irti", 0.2, 0.5), w("colli", 0.5, 0.9)]).words;
    expect(split).toEqual([w("gl'irti", 0.1, 0.5), w("colli", 0.5, 0.9)]);
    const merged = mapToText("dal ribollir", [w("dalribollir", 1, 2)]).words;
    // A merged word is shared by length: 3 letters of 11, then 8.
    expect(merged).toEqual([w("dal", 1, 1.273), w("ribollir", 1.273, 2)]);
  });

  it("gives a token no word matched the gap between its neighbours, with no confidence", () => {
    // One word in ten unmatched is within the limit.
    const rest = ["tre", "quattro", "cinque", "sei", "sette", "otto", "nove", "dieci"].map((t, i) => w(t, 0.9 + i * 0.4, 1.3 + i * 0.4));
    const { words, unmapped } = mapToText("uno due tre quattro cinque sei sette otto nove dieci", [w("uno", 0, 0.5), ...rest]);
    expect(words[1]).toEqual({ text: "due", start: 0.5, end: 0.9, confidence: 0 });
    expect(unmapped).toEqual([1]);
  });

  it("keeps going after a misheard word", () => {
    const { words, unmapped } = mapToText("più vigili colli", [w("piu", 0, 0.3), w("viginando", 0.3, 0.8), w("colli", 0.8, 1.2)]);
    expect(words.map((x) => x.text)).toEqual(["più", "vigili", "colli"]);
    expect(words[2]).toEqual(w("colli", 0.8, 1.2));
    expect(unmapped).toEqual([]);
  });

  it("refuses an alignment that left more than one token in ten unmatched", () => {
    expect(() => mapToText("uno due tre quattro cinque", [w("uno", 0, 0.5), w("cinque", 2, 2.5)])).toThrow(AlignError);
    try {
      mapToText("uno due tre quattro cinque", [w("uno", 0, 0.5), w("cinque", 2, 2.5)]);
    } catch (e) {
      expect((e as AlignError).code).toBe("alignment-mismatch");
      expect((e as AlignError).message).toMatch(/3 of 5 words/);
    }
  });

  it("keeps words in order and never overlapping", () => {
    const { words } = mapToText("a b c", [w("a", 0, 0.6), w("b", 0.5, 0.9), w("c", 0.85, 1.2)]);
    for (let i = 1; i < words.length; i++) expect(words[i]!.start).toBeGreaterThanOrEqual(words[i - 1]!.end);
  });
});

describe("snapToSilences", () => {
  // The spike's San Martino: silences measured at -35 dB, 0.10 s.
  const silences: [number, number][] = [[1.663, 2.689], [3.887, 4.936], [6.028, 7.004], [16.554, 17.854]];

  it("keeps a word out of the pause after it", () => {
    const [sale, rallegrar] = snapToSilences([w("sale", 3.36, 4.8), w("rallegrar", 15.84, 17.84)], silences, 30.8);
    expect(sale).toEqual(w("sale", 3.36, 3.887));
    expect(rallegrar).toEqual(w("rallegrar", 15.84, 16.554));
  });

  it("starts a word where the pause before it ends", () => {
    const [urla] = snapToSilences([w("urla", 5.92, 7.36)], [[5.9, 7.004]], 30.8);
    expect(urla).toEqual(w("urla", 7.004, 7.36));
  });

  it("keeps the side of a word with more speech when a silence falls inside it", () => {
    // Qwen starts "piovigginando" 63 ms before a one-second pause: it is said after it.
    const [word] = snapToSilences([w("piovigginando", 1.6, 3.36)], silences, 30.8);
    expect(word).toEqual(w("piovigginando", 2.689, 3.36));
  });

  it("makes every word at least 80 ms, taking the time from a long neighbour", () => {
    const words = snapToSilences([w("a", 0.72, 0.72), w("gl'irti", 0.72, 1.12), w("colli", 1.12, 1.6)], [], 30.8);
    expect(words).toEqual([w("a", 0.72, 0.8), w("gl'irti", 0.8, 1.12), w("colli", 1.12, 1.6)]);
    const last = snapToSilences([w("lungo", 0, 1), w("a", 1, 1)], [], 1.05);
    expect(last[1]!.end - last[1]!.start).toBeGreaterThanOrEqual(0.05);
    expect(last[1]!.end).toBeLessThanOrEqual(1.05);
    expect(last[0]!.end).toBeLessThanOrEqual(last[1]!.start);
  });

  it("rounds to the millisecond and keeps the order", () => {
    const words = snapToSilences([w("a", 0.12345, 0.45678), w("b", 0.45678, 0.91234)], [], 2);
    expect(words).toEqual([w("a", 0.123, 0.457), w("b", 0.457, 0.912)]);
  });
});
````

- [ ] **Step 2: Run them to see them fail**

Run: `cd studio/episode && npx vitest run tests/speech-align.test.ts`
Expected: FAIL — cannot resolve `../src/speech-align.js`.

- [ ] **Step 3: Implement**

`studio/episode/src/speech-align.ts` (new):

````ts
// ---------------------------------------------------------------------------
// From a provider's words to a take's WordTiming words (avg-8hs.2)
// ---------------------------------------------------------------------------
// Every aligner returns its own tokens: Qwen drops punctuation, a provider
// may split or merge a word, and the word before a pause tends to swallow
// it. A WordTiming's words are the written text's own tokens. This maps the
// provider's words onto them letter by letter, keeps each word out of the
// silences ffmpeg measures, and makes none shorter than 80 ms — the same for
// every provider, measured on a real recital in the spike (ADR-0038).
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export type AlignErrorCode =
  | "no-such-take"
  | "audio-changed"
  | "no-language"
  | "worker-unreachable"
  | "too-long"
  | "unsupported-language"
  | "bad-audio"
  | "empty-text"
  | "no-key"
  | "auth"
  | "quota"
  | "rate-limited"
  | "bad-request"
  | "server"
  | "unreachable"
  | "uncertain"
  | "budget"
  | "alignment-mismatch";

/** Why a take could not be aligned; nothing was written. */
export class AlignError extends Error {
  constructor(readonly code: AlignErrorCode, message: string) {
    super(message);
    this.name = "AlignError";
  }
}

export interface RawWord {
  text: string;
  start: number;
  end: number;
}

export interface TimedWord {
  text: string;
  start: number;
  end: number;
  confidence?: number;
}

/** More than this share of tokens without a word is a failed alignment. */
export const MAX_UNMAPPED_SHARE = 0.1;
/** No word is shorter (seconds). */
export const MIN_WORD_SECONDS = 0.08;
/** What ffmpeg's silencedetect counts as silence. */
export const SILENCE = { noise: "-35dB", seconds: 0.1 } as const;

/** Letters and digits only, lower case, without accents: what two spellings of one word share. */
const letters = (s: string) => [...s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()].filter((c) => /[\p{L}\p{N}]/u.test(c));

/** How far ahead a misread stretch may run before the two texts agree again. */
const RESYNC = 12;
const WINDOW = 3;

/**
 * Pair the letters of the text with the letters of the provider's words, in
 * order; where they disagree (a misheard word), skip ahead on either side to
 * the nearest point where three letters agree again.
 */
function pairLetters(a: string[], b: string[]): [number, number][] {
  const pairs: [number, number][] = [];
  const agree = (i: number, j: number) => {
    for (let k = 0; k < WINDOW; k++) if (i + k >= a.length || j + k >= b.length || a[i + k] !== b[j + k]) return k > 0 && (i + k >= a.length || j + k >= b.length);
    return true;
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pairs.push([i++, j++]);
      continue;
    }
    let best: [number, number] | null = null;
    for (let total = 1; total <= 2 * RESYNC && !best; total++) {
      for (let di = 0; di <= Math.min(total, RESYNC) && !best; di++) {
        const dj = total - di;
        if (dj <= RESYNC && agree(i + di, j + dj)) best = [di, dj];
      }
    }
    // No agreement close by: a substitution, letter for letter.
    const [di, dj] = best ?? [1, 1];
    if (!best) pairs.push([i, j]);
    i += di;
    j += dj;
  }
  return pairs;
}

/**
 * The written text's tokens, each with the time of the provider words its
 * letters matched. A provider word matched by several tokens is shared
 * between them by length; a token nothing matched takes the gap between its
 * neighbours with confidence 0. Throws `alignment-mismatch` when more than
 * one token in ten found no word.
 */
export function mapToText(text: string, raw: RawWord[]): { words: TimedWord[]; unmapped: number[] } {
  const tokens = text.split(/\s+/).filter(Boolean);
  const tokenOf: number[] = [];
  const tokenLetters = tokens.flatMap((t, index) => letters(t).map((c) => (tokenOf.push(index), c)));
  const wordOf: number[] = [];
  const wordLetters = raw.flatMap((w, index) => letters(w.text).map((c) => (wordOf.push(index), c)));

  // shares[token] → Map(word → letters matched)
  const shares = tokens.map(() => new Map<number, number>());
  for (const [i, j] of pairLetters(tokenLetters, wordLetters)) {
    const share = shares[tokenOf[i]!]!;
    share.set(wordOf[j]!, (share.get(wordOf[j]!) ?? 0) + 1);
  }
  // Each word's span, cut between the tokens that matched it, by letters matched.
  const spans: { start: number; end: number }[][] = tokens.map(() => []);
  raw.forEach((word, k) => {
    const claimants = shares.flatMap((share, t) => (share.has(k) ? [[t, share.get(k)!] as const] : []));
    const total = claimants.reduce((sum, [, n]) => sum + n, 0);
    let at = word.start;
    for (const [t, n] of claimants) {
      const end = at + ((word.end - word.start) * n) / total;
      spans[t]!.push({ start: at, end });
      at = end;
    }
  });

  const unmapped = tokens.flatMap((_, t) => (spans[t]!.length === 0 ? [t] : []));
  if (unmapped.length > tokens.length * MAX_UNMAPPED_SHARE) {
    throw new AlignError("alignment-mismatch", `${unmapped.length} of ${tokens.length} words found no match in the aligner's words: is this the right text for this audio?`);
  }
  const words: TimedWord[] = tokens.map((t, i) => {
    const s = spans[i]!;
    return s.length > 0
      ? { text: t, start: Math.min(...s.map((x) => x.start)), end: Math.max(...s.map((x) => x.end)) }
      : { text: t, start: Number.NaN, end: Number.NaN, confidence: 0 };
  });
  // Unmatched tokens fill the gap between their neighbours.
  words.forEach((word, i) => {
    if (!Number.isNaN(word.start)) return;
    const before = words.slice(0, i).reverse().find((x) => !Number.isNaN(x.end));
    const after = words.slice(i + 1).find((x) => !Number.isNaN(x.start));
    word.start = before?.end ?? after?.start ?? 0;
    word.end = after?.start ?? word.start;
  });
  // In order, never overlapping.
  for (let i = 1; i < words.length; i++) {
    const prev = words[i - 1]!;
    const word = words[i]!;
    word.start = Math.max(word.start, prev.end);
    word.end = Math.max(word.end, word.start);
  }
  return { words: words.map(round), unmapped };
}

const ms = (n: number) => Math.round(n * 1000) / 1000;
function round(w: TimedWord): TimedWord {
  return { ...w, start: ms(w.start), end: ms(w.end) };
}

/**
 * Keep every word out of the silences and at least MIN_WORD_SECONDS long:
 * a silence that falls in a word leaves it the side with more speech (an end
 * running into a pause is clipped, a start before one moves after it); a
 * short word takes time from a long neighbour.
 */
export function snapToSilences(input: TimedWord[], silences: [number, number][], durationSeconds: number): TimedWord[] {
  const words = input.map((w) => ({ ...w }));
  for (const word of words) {
    for (const [s, e] of silences) {
      if (e <= word.start || s >= word.end) continue;
      // A silence inside the word: the word is the side with more speech.
      const before = s - word.start;
      const after = word.end - e;
      if (before <= 0 && after <= 0) continue; // the whole word inside a silence: left to the aligner
      if (after > before) word.start = Math.max(word.start, e);
      else word.end = Math.min(word.end, s);
    }
  }
  words.forEach((word, i) => {
    if (word.end - word.start >= MIN_WORD_SECONDS) return;
    const next = words[i + 1];
    const prev = words[i - 1];
    if (next && next.end - next.start > 0.2) {
      word.end = word.start + MIN_WORD_SECONDS;
      next.start = Math.max(next.start, word.end);
    } else if (prev && prev.end - prev.start > 0.2) {
      word.start = Math.max(0, word.end - MIN_WORD_SECONDS);
      prev.end = Math.min(prev.end, word.start);
    } else {
      word.end = Math.min(durationSeconds, word.start + MIN_WORD_SECONDS);
      if (next) next.start = Math.max(next.start, word.end);
    }
  });
  return words.map(round);
}

/** The silences ffmpeg measures in the audio, the speech between them, and the audio's length. */
export async function measureSilences(audioPath: string): Promise<{ silences: [number, number][]; speech: [number, number][]; durationSeconds: number }> {
  let stderr: string;
  let durationSeconds: number;
  try {
    ({ stderr } = await exec("ffmpeg", ["-hide_banner", "-nostats", "-i", audioPath, "-af", `silencedetect=noise=${SILENCE.noise}:d=${SILENCE.seconds}`, "-f", "null", "-"], { maxBuffer: 16 * 1024 * 1024 }));
    const { stdout } = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", audioPath]);
    durationSeconds = Number(stdout.trim());
  } catch (error) {
    throw new AlignError("bad-audio", `ffmpeg could not read ${audioPath}: ${(error as Error).message}`);
  }
  if (!(durationSeconds > 0)) throw new AlignError("bad-audio", `${audioPath} has no duration ffprobe can read`);
  const starts = [...stderr.matchAll(/silence_start: (-?[\d.]+)/g)].map((m) => Math.max(0, Number(m[1])));
  const ends = [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  const silences = starts.map((s, i): [number, number] => [ms(s), ms(ends[i] ?? durationSeconds)]);
  const speech: [number, number][] = [];
  let at = 0;
  for (const [s, e] of silences) {
    if (s - at > 0.02) speech.push([ms(at), ms(s)]);
    at = e;
  }
  if (durationSeconds - at > 0.02) speech.push([ms(at), ms(durationSeconds)]);
  return { silences, speech, durationSeconds };
}
````

Append to `studio/episode/src/index.ts`:

```ts
export * from "./speech-align.js";
```

- [ ] **Step 4: Run them to see them pass**

Run: `cd studio/episode && npx vitest run tests/speech-align.test.ts && npx tsc --noEmit`
Expected: 12 passed; no type errors.

- [ ] **Step 5: Commit**

```bash
git add studio/episode/src/speech-align.ts studio/episode/src/index.ts studio/episode/tests/speech-align.test.ts
git commit -m "feat(episode): map an aligner's words onto the written text, out of the silences (avg-8hs.2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: `alignTake` — a take's WordTiming, local or ElevenLabs

**Files:**
- Create: `studio/episode/src/take-align.ts`
- Modify: `studio/episode/src/index.ts`, `studio/episode/package.json`, `bun.lock`, `studio/episode/README.md`
- Test: `studio/episode/tests/take-align.test.ts`

**Interfaces:**
- Consumes: Task 4's module; `forcedAlignment`, `ElevenLabsError`, `ELEVENLABS_PROFILES` (Task 3, through its `dist/`); `validateNarrationTakes`, `validateWordTiming`; `specEpisode` (tests).
- Produces: `TAKES_PATH`; `timingPathFor(takeId) → "artifacts/timing/<id>.json"`; `REPORTED_PAUSE_SECONDS = 0.35`; `AlignProvider = "qwen-local" | "elevenlabs"`; `elevenLabsAlignmentUsd(minutes) → number`; `AlignTakeOptions {take; provider?; language?; workerUrl?; elevenlabs?: {apiKey; baseUrl?; pay?<T>(minutes, call: () => Promise<T>): Promise<T>}}`; `alignTake(episodeDir, options) → Promise<AlignedTake {timing; path; unmapped: string[]; pauses: number[]}>`.

- [ ] **Step 1: The dependency**

````diff
diff --git a/studio/episode/package.json b/studio/episode/package.json
index bf54212..5f27afb 100644
--- a/studio/episode/package.json
+++ b/studio/episode/package.json
@@ -28,6 +28,7 @@
     "check": "npm run typecheck && npm test"
   },
   "dependencies": {
+    "@av/elevenlabs": "workspace:*",
     "@av/remotion-composer": "workspace:*",
     "@studio/contracts": "workspace:*",
     "@studio/series": "workspace:*"
````

Apply with `git apply` (save the block to a file first) or by hand; the result must match exactly.

Then `bun install --lockfile-only --ignore-scripts && bun install --frozen-lockfile`; `git diff bun.lock` shows only `"@av/elevenlabs": "workspace:*"` added under `studio/episode`.

- [ ] **Step 2: Write the failing tests**

`studio/episode/tests/take-align.test.ts` (new):

````ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateWordTiming } from "@studio/contracts/src/word-timing.mjs";
import { alignTake } from "../src/take-align.js";
import { AlignError } from "../src/speech-align.js";
import { sha256, specEpisode } from "../src/testing.js";

/**
 * alignTake (avg-8hs.2) on a poetry-short episode whose takes are real audio
 * (ffmpeg: a tone, a 0.6 s pause, a tone). The voice worker is a local fake
 * answering POST /align; ElevenLabs is a local fake of its API.
 */

const REF = { channel: "sample", series: "poetry", episode: "morning" };
let root: string;
let worker: Server;
let workerUrl: string;
let workerAnswers: ((body: any) => { status: number; body: unknown })[];
const workerCalls: any[] = [];
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
const at = (relative: string) => join(dir(), relative);
const takes = () => JSON.parse(readFileSync(at("artifacts/narration/takes.json"), "utf-8"));

/** A take: tone, 0.6 s of silence, tone — `seconds` long in all. */
function audio(path: string, _take: string, seconds: number): void {
  const half = ((seconds - 0.6) / 2).toFixed(3);
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `sine=frequency=300:duration=${half}`,
    "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono:d=0.6",
    "-f", "lavfi", "-i", `sine=frequency=300:duration=${half}`,
    "-filter_complex", "[0:a]aresample=24000[a];[2:a]aresample=24000[c];[a][1:a][c]concat=n=3:v=0:a=1", "-ac", "1", path]);
}

/** The worker's answer: the text's words, spread evenly over `seconds`, punctuation dropped as Qwen does. */
const evenly = (seconds: number) => (body: any) => {
  const tokens = String(body.text).split(/\s+/).map((t) => t.replace(/[.,;:!?]/g, ""));
  const step = seconds / tokens.length;
  return { status: 200, body: { words: tokens.map((text, i) => ({ text, start: i * step, end: (i + 1) * step })), model: "mlx-community/Qwen3-ForcedAligner-0.6B-8bit", language: "English" } };
};

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "take-align-"));
  specEpisode(dir(), REF, { audio });
  workerAnswers = [];
  workerCalls.length = 0;
  worker = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw);
      workerCalls.push({ path: req.url, ...body });
      const answer = (workerAnswers.shift() ?? evenly(2.6))(body);
      res.writeHead(answer.status, { "content-type": "application/json" });
      res.end(JSON.stringify(answer.body));
    });
  });
  await new Promise<void>((resolve) => worker.listen(0, "127.0.0.1", resolve));
  workerUrl = `http://127.0.0.1:${(worker.address() as { port: number }).port}`;
});
afterEach(async () => {
  worker.closeAllConnections();
  await new Promise<void>((resolve) => worker.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
});

describe("alignTake with the local aligner", () => {
  it("writes the take's WordTiming and points takes.json at it, changing nothing else", async () => {
    const before = takes();
    const result = await alignTake(dir(), { take: "light", language: "en", workerUrl });
    expect(workerCalls).toEqual([{ path: "/align", audio_path: at("assets/takes/light.wav"), text: "Light falls across the quiet room.", language: "en" }]);
    expect(result.path).toBe("artifacts/timing/light.json");
    const timing = JSON.parse(readFileSync(at(result.path), "utf-8"));
    expect(timing).toEqual(result.timing);
    expect(validateWordTiming(timing, { audioHash: before.takes[0].audio.hash })).toEqual([]);
    expect(timing.words.map((w: { text: string }) => w.text)).toEqual(["Light", "falls", "across", "the", "quiet", "room."]);
    expect(timing.alignment).toMatchObject({ provider: "qwen-local", model: "mlx-community/Qwen3-ForcedAligner-0.6B-8bit", method: "forced" });
    expect(timing.language).toBe("en");
    expect(timing.speech).toHaveLength(2);
    // No word runs into the 0.6 s pause in the middle.
    const [pauseStart, pauseEnd] = [timing.speech[0][1], timing.speech[1][0]];
    for (const w of timing.words) expect(w.end <= pauseStart + 0.001 || w.start >= pauseEnd - 0.001).toBe(true);
    expect(result.pauses).toHaveLength(1);
    expect(result.pauses[0]).toBeGreaterThan(0.5);

    const after = takes();
    expect(after.takes[0].timing).toEqual({ path: "artifacts/timing/light.json", hash: sha256(readFileSync(at(result.path))) });
    expect({ ...after, takes: after.takes.slice(1) }).toEqual({ ...before, takes: before.takes.slice(1) });
    expect({ ...after.takes[0], timing: null }).toEqual({ ...before.takes[0], timing: null });
  });

  it("says which words it could not place", async () => {
    workerAnswers.push(() => ({ status: 200, body: { words: [
      { text: "Light", start: 0, end: 0.3 }, { text: "falls", start: 0.3, end: 0.6 }, { text: "across", start: 0.6, end: 0.9 },
      { text: "the", start: 0.9, end: 1 }, { text: "quiet", start: 1.6, end: 2 }, { text: "room", start: 2, end: 2.5 },
    ], model: "m", language: "English" } }));
    // One of six would be over the limit: a text with an extra word nobody said.
    const take = takes();
    take.takes[0].text = "Light falls across the very quiet room and the bright window.";
    writeFileSync(at("artifacts/narration/takes.json"), JSON.stringify(take, null, 2));
    await expect(alignTake(dir(), { take: "light", language: "en", workerUrl })).rejects.toMatchObject({ code: "alignment-mismatch" });
  });

  it("refuses what it cannot align, writing nothing", async () => {
    const before = readFileSync(at("artifacts/narration/takes.json"), "utf-8");
    const code = (p: Promise<unknown>) => p.then(() => "none", (e) => (e instanceof AlignError ? e.code : String(e)));
    expect(await code(alignTake(dir(), { take: "nobody", language: "en", workerUrl }))).toBe("no-such-take");
    expect(await code(alignTake(dir(), { take: "light", workerUrl }))).toBe("no-language");
    workerAnswers.push(() => ({ status: 422, body: { error: "HTTP error", detail: [{ msg: "the audio lasts 301.0 s", type: "too-long" }] } }));
    expect(await code(alignTake(dir(), { take: "light", language: "en", workerUrl }))).toBe("too-long");
    expect(await code(alignTake(dir(), { take: "light", language: "en", workerUrl: "http://127.0.0.1:9" }))).toBe("worker-unreachable");
    writeFileSync(at("assets/takes/light.wav"), "edited by hand");
    expect(await code(alignTake(dir(), { take: "light", language: "en", workerUrl }))).toBe("audio-changed");
    expect(readFileSync(at("artifacts/narration/takes.json"), "utf-8")).toBe(before);
  });
});

describe("alignTake with ElevenLabs", () => {
  let api: Server;
  let baseUrl: string;
  let apiCalls = 0;
  beforeEach(async () => {
    apiCalls = 0;
    api = createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        apiCalls++;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ words: ["Light", "falls", "across", "the", "quiet", "room."].map((text, i) => ({ text, start: i * 0.4, end: i * 0.4 + 0.35, loss: 0.1 })), loss: 0.1 }));
      });
    });
    await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(api.address() as { port: number }).port}`;
  });
  afterEach(async () => {
    api.closeAllConnections();
    await new Promise<void>((resolve) => api.close(() => resolve()));
  });

  it("aligns through the caller's spend function, at the take's minutes", async () => {
    const paid: number[] = [];
    const result = await alignTake(dir(), {
      take: "light", language: "en", provider: "elevenlabs",
      elevenlabs: { apiKey: "sk_test", baseUrl, pay: async (minutes, call) => { paid.push(minutes); return call(); } },
    });
    expect(paid).toEqual([2.6 / 60]);
    expect(apiCalls).toBe(1);
    expect(result.timing.alignment).toMatchObject({ provider: "elevenlabs", model: "forced-alignment", method: "forced" });
    expect(workerCalls).toEqual([]);
  });

  it("sends nothing without a key, or when the spend function refuses", async () => {
    await expect(alignTake(dir(), { take: "light", language: "en", provider: "elevenlabs" })).rejects.toMatchObject({ code: "no-key" });
    const refuse = async () => { throw new AlignError("budget", "the budget cannot hold $0.0003"); };
    await expect(alignTake(dir(), { take: "light", language: "en", provider: "elevenlabs", elevenlabs: { apiKey: "sk_test", baseUrl, pay: refuse } }))
      .rejects.toMatchObject({ code: "budget" });
    expect(apiCalls).toBe(0);
  });
});
````

Run: `cd studio/episode && npx vitest run tests/take-align.test.ts`
Expected: FAIL — cannot resolve `../src/take-align.js`.

- [ ] **Step 3: Implement**

`studio/episode/src/take-align.ts` (new):

````ts
// ---------------------------------------------------------------------------
// Aligning a narration take (avg-8hs.2, ADR-0038)
// ---------------------------------------------------------------------------
// A take's WordTiming — every word of its written text with its start and
// end in the take's audio — measured by forced alignment: Qwen3-ForcedAligner
// in the local voice worker by default, ElevenLabs when a person asks for it,
// never one in place of the other. The provider's words go through the same
// post-processing either way (speech-align.ts); the timing is written beside
// the take and takes.json points at it.
//
// This module reads no environment: the caller supplies the worker's URL,
// the ElevenLabs key and the spend function that pays for its calls.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { ELEVENLABS_PROFILES, ElevenLabsError, forcedAlignment } from "@av/elevenlabs";
import { validateNarrationTakes } from "@studio/contracts/src/narration-takes.mjs";
import { validateWordTiming } from "@studio/contracts/src/word-timing.mjs";
import { AlignError, mapToText, measureSilences, snapToSilences, type RawWord } from "./speech-align.js";

export const TAKES_PATH = "artifacts/narration/takes.json";
/** Where a take's timing goes when takes.json names none. */
export const timingPathFor = (takeId: string) => `artifacts/timing/${takeId}.json`;
/** Pauses inside the speech longer than this are reported (judging them is avg-8hs.3). */
export const REPORTED_PAUSE_SECONDS = 0.35;

export type AlignProvider = "qwen-local" | "elevenlabs";

/** What aligning `minutes` of audio with ElevenLabs is estimated to cost, in US dollars (its profile). */
export const elevenLabsAlignmentUsd = (minutes: number) => minutes * ELEVENLABS_PROFILES.forcedAlignment.usdPerMinute;

export interface AlignTakeOptions {
  take: string;
  /** Default qwen-local. */
  provider?: AlignProvider;
  /** The take's language when takes.json gives none (ISO 639-1, e.g. "it"). */
  language?: string;
  /** The local voice worker; required for qwen-local. */
  workerUrl?: string;
  elevenlabs?: {
    apiKey: string;
    baseUrl?: string;
    /** Reserve and settle the call's estimated cost; may refuse (AlignError "budget"). */
    pay?: <T>(minutes: number, call: () => Promise<T>) => Promise<T>;
  };
}

export interface AlignedTake {
  /** The WordTiming written. */
  timing: Record<string, unknown> & { words: { text: string; start: number; end: number }[] };
  /** Relative to the episode. */
  path: string;
  /** Words of the text the aligner did not place (given the gap around them). */
  unmapped: string[];
  /** Pauses inside the speech longer than REPORTED_PAUSE_SECONDS, in seconds. */
  pauses: number[];
}

const sha256 = (bytes: Buffer | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
let temporaries = 0;

function writeAtomically(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${temporaries++}.tmp`;
  writeFileSync(temp, text, "utf-8");
  renameSync(temp, path);
}

/** A path takes.json names, confined to the episode. */
function inEpisode(episodeDir: string, path: unknown, what: string): string {
  const full = typeof path === "string" ? resolve(episodeDir, path) : "";
  const rel = relative(episodeDir, full);
  if (!full || rel === "" || rel.startsWith("..") || isAbsolute(rel)) throw new AlignError("no-such-take", `${what} ${String(path)} is not a file of this episode`);
  return full;
}

async function alignLocally(workerUrl: string | undefined, audioPath: string, text: string, language: string): Promise<{ words: RawWord[]; model: string }> {
  if (!workerUrl) throw new AlignError("worker-unreachable", "no voice worker URL was given");
  let response: Response;
  try {
    response = await fetch(`${workerUrl.replace(/\/$/, "")}/align`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ audio_path: audioPath, text, language }),
    });
  } catch {
    throw new AlignError("worker-unreachable", `the voice worker at ${workerUrl} does not answer: start it (mise run voice-serve)`);
  }
  const body = await response.json().catch(() => undefined) as { words?: RawWord[]; model?: string; detail?: { type?: string; msg?: string }[] } | undefined;
  if (!response.ok) {
    const detail = body?.detail?.[0];
    const known = ["too-long", "unsupported-language", "bad-audio", "empty-text"];
    const code = known.includes(detail?.type ?? "") ? detail!.type as "too-long" : "worker-unreachable";
    throw new AlignError(code, `the voice worker could not align: ${detail?.msg ?? `HTTP ${response.status}`}`);
  }
  if (!Array.isArray(body?.words)) throw new AlignError("worker-unreachable", "the voice worker answered without words");
  return { words: body.words, model: String(body.model ?? "unknown") };
}

async function alignWithElevenLabs(options: AlignTakeOptions["elevenlabs"], audioPath: string, text: string, minutes: number): Promise<{ words: RawWord[]; model: string }> {
  if (!options?.apiKey) throw new AlignError("no-key", "ElevenLabs needs its API key (ELEVENLABS_API_KEY)");
  const call = async () => {
    try {
      return await forcedAlignment({ audioPath, text, apiKey: options.apiKey, ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}) });
    } catch (error) {
      if (error instanceof ElevenLabsError) throw new AlignError(error.code, error.message);
      throw error;
    }
  };
  const result = options.pay ? await options.pay(minutes, call) : await call();
  return { words: result.words, model: "forced-alignment" };
}

/**
 * Align one take of artifacts/narration/takes.json and write its WordTiming;
 * takes.json then names it. Nothing is written unless the timing is valid.
 */
export async function alignTake(episodeDir: string, options: AlignTakeOptions): Promise<AlignedTake> {
  const provider = options.provider ?? "qwen-local";
  const takesPath = join(episodeDir, TAKES_PATH);
  let doc: any;
  try {
    doc = JSON.parse(readFileSync(takesPath, "utf-8"));
  } catch {
    throw new AlignError("no-such-take", `${TAKES_PATH} is missing or not JSON`);
  }
  const problems = validateNarrationTakes(doc);
  if (problems.length > 0) throw new AlignError("no-such-take", `${TAKES_PATH} is not valid: ${problems.map((p) => p.message).join("; ")}`);
  const index = doc.takes.findIndex((t: { id: string }) => t.id === options.take);
  if (index < 0) throw new AlignError("no-such-take", `${TAKES_PATH} has no take "${options.take}"`);
  const take = doc.takes[index];
  const language = take.language ?? options.language;
  if (!language) throw new AlignError("no-language", `take "${take.id}" has no language: give one (e.g. "it")`);

  const audioPath = inEpisode(episodeDir, take.audio.path, "audio");
  let audioBytes: Buffer;
  try {
    audioBytes = readFileSync(audioPath);
  } catch {
    throw new AlignError("audio-changed", `${take.audio.path} is missing`);
  }
  if (sha256(audioBytes) !== take.audio.hash) {
    throw new AlignError("audio-changed", `${take.audio.path} is not the audio ${TAKES_PATH} names: record the take again, or update it`);
  }

  const aligned = provider === "elevenlabs"
    ? await alignWithElevenLabs(options.elevenlabs, audioPath, take.text, take.audio.durationSeconds / 60)
    : await alignLocally(options.workerUrl, audioPath, take.text, language);
  const { words, unmapped } = mapToText(take.text, aligned.words);
  const measured = await measureSilences(audioPath);
  const timed = snapToSilences(words, measured.silences, measured.durationSeconds);

  const timing = {
    apiVersion: "studio.video/v1alpha1",
    kind: "WordTiming",
    take: { id: take.id, ...(take.source ? { source: take.source } : {}) },
    audio: { ...take.audio },
    text: take.text,
    ...(take.spokenText ? { spokenText: take.spokenText } : {}),
    language,
    alignment: { provider, model: aligned.model, method: "forced", createdAt: new Date().toISOString() },
    words: timed,
    speech: measured.speech,
  };
  const timingProblems = validateWordTiming(timing, { audioHash: take.audio.hash });
  if (timingProblems.length > 0) {
    throw new AlignError("alignment-mismatch", `the alignment is not a valid WordTiming: ${timingProblems.map((p) => `${p.code} at ${p.path}`).join("; ")}`);
  }

  const path = take.timing?.path ?? timingPathFor(take.id);
  const timingFile = inEpisode(episodeDir, path, "timing");
  const text = `${JSON.stringify(timing, null, 2)}\n`;
  const updated = structuredClone(doc);
  updated.takes[index].timing = { path, hash: sha256(text) };
  const updatedProblems = validateNarrationTakes(updated);
  if (updatedProblems.length > 0) throw new Error(`${TAKES_PATH} would not be valid: ${updatedProblems.map((p) => p.message).join("; ")}`);
  writeAtomically(timingFile, text);
  writeAtomically(takesPath, `${JSON.stringify(updated, null, 2)}\n`);

  const pauses = measured.silences
    .filter(([s, e]) => s > 0 && e < measured.durationSeconds && e - s > REPORTED_PAUSE_SECONDS)
    .map(([s, e]) => Math.round((e - s) * 1000) / 1000);
  return { timing, path, unmapped: unmapped.map((i) => words[i]!.text), pauses };
}
````

Append to `studio/episode/src/index.ts`:

```ts
export * from "./take-align.js";
```

- [ ] **Step 4: Run them to see them pass**

Run: `cd studio/episode && npx vitest run tests/take-align.test.ts && npx tsc --noEmit && npx vitest run`
Expected: 5 passed; no type errors; the whole suite 178 passed, 1 skipped.

- [ ] **Step 5: Document, build, commit**

````diff
diff --git a/studio/episode/README.md b/studio/episode/README.md
index 5200c44..d891985 100644
--- a/studio/episode/README.md
+++ b/studio/episode/README.md
@@ -6,7 +6,7 @@ its `episode-spec.json` by its series template's compiler — checked against it
 series' rules, shown on a layout sheet and rendered with `@av/remotion-composer`.
 
 The agent's tools (`pva_init_spec`, `pva_build_timeline`, `pva_check_episode`,
-`pva_layout_sheet`, `pva_compose_video`, `pva_compare_versions`, the narration tools) and the `series-production` stage
+`pva_layout_sheet`, `pva_compose_video`, `pva_compare_versions`, `pva_align_take`, the narration tools) and the `series-production` stage
 adapters both call this package, so a tool and a stage never disagree.
 
 ## What it offers
@@ -23,6 +23,8 @@ adapters both call this package, so a tool and a stage never disagree.
 | `sheet-instants.ts` | `sheetInstants`: the frames a layout sheet shows, from the timeline and the release's `sheet` rules (pure) |
 | `layout-sheet.ts` | `makeLayoutSheet`, `layoutSheetStatus`: `artifacts/layout-sheet/`, and whether it still shows what a render would use |
 | `version-diff.ts` | `alignInstants`, `measure`, `judge`: which frames two versions compare, how different they are, the verdict (pure) |
+| `speech-align.ts` | `mapToText`, `snapToSilences`, `measureSilences`: a provider's words made into a take's words (ADR-0038) |
+| `take-align.ts` | `alignTake`: a take's WordTiming by forced alignment, local or ElevenLabs, written beside it and named in `takes.json` |
 | `version-compare.ts` | `compareVersions`: two renders, or a render and a golden reference, decoded with ffmpeg at the same instants, into `reviews/compare/<old>--<new>/` |
 
 `@studio/episode/testing` exports `specEpisode`, `editSpec` and `sha256`: a
````

Apply with `git apply` (save the block to a file first) or by hand; the result must match exactly.

Run: `npm run build --workspace @studio/episode`

```bash
git add studio/episode/src/take-align.ts studio/episode/src/index.ts studio/episode/package.json bun.lock \
  studio/episode/tests/take-align.test.ts studio/episode/README.md
git commit -m "feat(episode): alignTake — a take's WordTiming by forced alignment, named in takes.json (avg-8hs.2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: Agent — `pva_align_take`, the spend ledger, the docs

**Files:**
- Create: `studio/agent/tests/align-take.test.ts`, `docs/adr/0038-word-timing-comes-from-forced-alignment.md`
- Modify: `studio/agent/src/capability-tools.ts`, `studio/agent/src/spend.ts`, `studio/agent/tests/extension.test.ts`, `docs/index.md`, `docs/running.md`

**Interfaces:**
- Consumes: `alignTake`, `AlignError`, `elevenLabsAlignmentUsd` from `@studio/episode` (Task 5, `dist/`); `SpendRefused`, `toMicros` from `@studio/contracts/src/budget.mjs`; `paidCall` (`spend.ts`), which gains `PaidCall.estimate?: {estimate: Money; priced: boolean; profile: string}`.
- Produces: tool `pva_align_take {channel, series, episode, take, provider?, language?}` (49 tools); `pva_capability_status` reports `speech-align-local` and `speech-align-elevenlabs`.

- [ ] **Step 1: Write the failing tests**

`studio/agent/tests/align-take.test.ts` (new):

````ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { specEpisode } from "@studio/episode/testing";

/**
 * pva_align_take (avg-8hs.2): Pi measures a take's word timing. The voice
 * worker is a local fake answering POST /align; @studio/episode tests the
 * alignment itself, ElevenLabs and the spend ledger.
 */

const REF = { channel: "sample", series: "poetry", episode: "morning" };
let root: string;
let worker: Server;
const saved: Record<string, string | undefined> = {};
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);

function audio(path: string, _take: string, seconds: number): void {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `sine=frequency=300:duration=${seconds}`, "-ac", "1", path]);
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "pva-align-"));
  specEpisode(dir(), REF, { audio });
  worker = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const tokens = String(JSON.parse(raw).text).split(/\s+/);
      const step = 2.6 / tokens.length;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ words: tokens.map((text, i) => ({ text, start: i * step, end: (i + 1) * step })), model: "mlx-community/Qwen3-ForcedAligner-0.6B-8bit", language: "English" }));
    });
  });
  await new Promise<void>((resolve) => worker.listen(0, "127.0.0.1", resolve));
  for (const name of ["AVG_LIBRARY_ROOT", "AVG_TTS_WORKER_URL", "ELEVENLABS_API_KEY"]) saved[name] = process.env[name];
  process.env.AVG_LIBRARY_ROOT = root;
  process.env.AVG_TTS_WORKER_URL = `http://127.0.0.1:${(worker.address() as { port: number }).port}`;
  delete process.env.ELEVENLABS_API_KEY;
});

afterEach(async () => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  worker.closeAllConnections();
  await new Promise<void>((resolve) => worker.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
});

async function tool(params: Record<string, unknown>) {
  const { registerCapabilityTools } = await import("../src/capability-tools.js");
  const tools = new Map<string, { execute: (...a: unknown[]) => Promise<any> }>();
  registerCapabilityTools({ registerTool: (t: { name: string }) => tools.set(t.name, t as never) } as never);
  return tools.get("pva_align_take")!.execute("call-1", { ...REF, ...params }, undefined, undefined, undefined);
}

describe("pva_align_take", () => {
  it("aligns a take with the local aligner and says where the timing went", async () => {
    const result = await tool({ take: "light", language: "en" });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toMatch(/^✅ light: 6 words, qwen-local \(mlx-community\/Qwen3-ForcedAligner-0\.6B-8bit\) → artifacts\/timing\/light\.json/);
    const timing = JSON.parse(readFileSync(join(dir(), "artifacts/timing/light.json"), "utf-8"));
    expect(timing.alignment.provider).toBe("qwen-local");
  });

  it("replies with the error's code", async () => {
    const result = await tool({ take: "light" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/^❌ no-language: take "light" has no language/);
    expect(result.details.code).toBe("no-language");
  });

  it("never reaches ElevenLabs without its key", async () => {
    const result = await tool({ take: "light", language: "en", provider: "elevenlabs" });
    expect(result.content[0].text).toMatch(/^❌ no-key: ElevenLabs needs its API key \(ELEVENLABS_API_KEY\)/);
  });
});
````

````diff
diff --git a/studio/agent/tests/extension.test.ts b/studio/agent/tests/extension.test.ts
index ff7b2f4..3a932a1 100644
--- a/studio/agent/tests/extension.test.ts
+++ b/studio/agent/tests/extension.test.ts
@@ -129,9 +129,10 @@ describe("extensions/index.ts — tool registration", () => {
   });
 
   it("registers the expected suite of production tools", () => {
-    expect(mockPi.tools.length).toBe(48);
+    expect(mockPi.tools.length).toBe(49);
     const names = mockPi.tools.map((t) => t.name).sort();
     expect(names).toEqual([
+      "pva_align_take",
       "pva_blender_create_scene",
       "pva_blender_probe",
       "pva_blender_render",
````

Apply with `git apply` (save the block to a file first) or by hand; the result must match exactly.

- [ ] **Step 2: Run them to see them fail**

Run: `cd studio/agent && npx vitest run tests/align-take.test.ts tests/extension.test.ts`
Expected: FAIL — no `pva_align_take` (48 tools).

- [ ] **Step 3: The spend override and the tool**

````diff
diff --git a/studio/agent/src/capability-tools.ts b/studio/agent/src/capability-tools.ts
index c3d8819..5df5e73 100644
--- a/studio/agent/src/capability-tools.ts
+++ b/studio/agent/src/capability-tools.ts
@@ -29,6 +29,7 @@ import {
 import { CodexImageClient } from "@av/codex-image";
 import { createFalClient, getProfile, FalHttpError, FalValidationError } from "@av/fal-media";
 import { paidCall, providerCost, type SpendCall } from "./spend.js";
+import { SpendRefused, toMicros } from "@studio/contracts/src/budget.mjs";
 import {
   CODEX_PROVIDER,
   DEFAULT_FAL_MODEL,
@@ -45,6 +46,9 @@ import {
   type NarrationSegmentInput,
   decideEditTimeline,
   EDIT_TIMELINE_PATH,
+  alignTake,
+  AlignError,
+  elevenLabsAlignmentUsd,
   compareVersions,
   initEpisodeSpec,
   makeLayoutSheet,
@@ -1204,6 +1208,75 @@ export function registerCapabilityTools(pi: ExtensionAPI): void {
     },
   });
 
+  pi.registerTool({
+    name: "pva_align_take",
+    label: "Align Take",
+    description: "Measure a narration take's word timing (speech.align): when each word of its written text is said in its audio, by forced alignment, written beside the take and named in artifacts/narration/takes.json — what the series compiler reads. Local Qwen3-ForcedAligner in the voice worker by default (free); provider \"elevenlabs\" only when the person asks for it (paid, through the spend ledger). Never switches provider on its own.",
+    parameters: Type.Object({
+      channel: Type.String({ description: "Channel slug" }),
+      series: Type.String({ description: "Series slug" }),
+      episode: Type.String({ description: "Episode slug" }),
+      take: Type.String({ description: "The take's id in takes.json" }),
+      provider: Type.Optional(Type.Union([Type.Literal("qwen-local"), Type.Literal("elevenlabs")], { description: "Default qwen-local" })),
+      language: Type.Optional(Type.String({ description: "ISO 639-1 code (it, en…) when the take does not give one" })),
+    }),
+    async execute(_toolCallId, params) {
+      const dir = episodeDir(params.channel, params.series, params.episode);
+      const provider = params.provider ?? "qwen-local";
+      try {
+        const apiKey = process.env.ELEVENLABS_API_KEY;
+        const result = await alignTake(dir, {
+          take: params.take,
+          provider,
+          ...(params.language ? { language: params.language } : {}),
+          workerUrl: process.env.AVG_TTS_WORKER_URL || DEFAULT_TTS_WORKER_URL,
+          ...(provider === "elevenlabs" && apiKey ? {
+            elevenlabs: {
+              apiKey,
+              // Through the episode's spend ledger (avg-91o), at the profile's price per minute.
+              pay: <T>(minutes: number, call: () => Promise<T>) => paidCall(
+                { libraryRoot: LIBRARY_ROOT, channel: params.channel, series: params.series, episode: params.episode },
+                {
+                  capability: "speech.align", provider: "elevenlabs", model: "forced-alignment", purpose: `align ${params.take}`,
+                  estimate: {
+                    estimate: { currency: "USD", micros: toMicros(elevenLabsAlignmentUsd(minutes)) },
+                    priced: true,
+                    profile: "elevenlabs-forced-alignment",
+                  },
+                },
+                async (spend) => {
+                  spend.sending();
+                  try {
+                    return { value: await call() };
+                  } catch (e) {
+                    // Refused before any processing: nothing was billed.
+                    if (e instanceof AlignError && ["auth", "quota", "rate-limited", "bad-request", "unreachable"].includes(e.code)) spend.refused();
+                    throw e;
+                  }
+                },
+              ),
+            },
+          } : {}),
+        });
+        const { timing } = result;
+        const lines = [
+          `✅ ${params.take}: ${timing.words.length} words, ${provider} (${(timing.alignment as { model: string }).model}) → ${result.path}`,
+          ...(result.pauses.length > 0 ? [`pauses over 0.35 s inside the speech: ${result.pauses.map((p) => `${p.toFixed(2)}s`).join(", ")}`] : []),
+          ...(result.unmapped.length > 0 ? [`⚠️ not placed by the aligner (given the gap around them): ${result.unmapped.join(" ")}`] : []),
+        ];
+        return { content: [{ type: "text" as const, text: lines.join("\n") }], details: result as unknown as Record<string, unknown> };
+      } catch (err) {
+        const e = err as { message?: string; code?: string; name?: string };
+        const code = e instanceof SpendRefused ? "budget" : e.code;
+        return {
+          content: [{ type: "text" as const, text: `❌ ${code ? `${code}: ` : ""}${e.message ?? String(err)}` }],
+          details: { code: code ?? null } as Record<string, unknown>,
+          isError: true as unknown as boolean,
+        };
+      }
+    },
+  });
+
   // --- Tool: pva_render_terminal (via VHS) -----------------------------
 
   pi.registerTool({
@@ -1422,6 +1495,18 @@ export function registerCapabilityTools(pi: ExtensionAPI): void {
         caps["text-to-speech"] = { available: false, detail: "TTS worker not reachable" };
       }
 
+      // speech.align (avg-8hs.2): the worker's aligner, and ElevenLabs when its key is set
+      try {
+        const ttsUrl = process.env.AVG_TTS_WORKER_URL || DEFAULT_TTS_WORKER_URL;
+        const aligner = await (await fetch(`${ttsUrl}/align`)).json() as { model?: string; loaded?: boolean };
+        caps["speech-align-local"] = { available: true, detail: `${aligner.model ?? "aligner"}${aligner.loaded ? " (loaded)" : " (loads on first use)"}` };
+      } catch {
+        caps["speech-align-local"] = { available: false, detail: "voice worker not reachable" };
+      }
+      caps["speech-align-elevenlabs"] = process.env.ELEVENLABS_API_KEY
+        ? { available: true, detail: "ELEVENLABS_API_KEY set" }
+        : { available: false, detail: "ELEVENLABS_API_KEY not set" };
+
       // FFmpeg
       try {
         const { execSync } = await import("node:child_process");
diff --git a/studio/agent/src/spend.ts b/studio/agent/src/spend.ts
index 48c21f3..4458dcb 100644
--- a/studio/agent/src/spend.ts
+++ b/studio/agent/src/spend.ts
@@ -41,6 +41,8 @@ export interface PaidCall {
   model: string;
   /** What the call is for, in a few words: "image s3", "clip shot-2". */
   purpose: string;
+  /** A price that is not fal's: the provider's own profile (ElevenLabs, avg-8hs.2). */
+  estimate?: { estimate: Money; priced: boolean; profile: string };
 }
 
 /** What a fal model costs per call, from its profile — or that nobody knows. */
@@ -70,7 +72,7 @@ export async function paidCall<T>(
   const ref = { channel: target.channel, series: target.series, episode: target.episode };
   const dir = episodePath(target.libraryRoot, ref.channel, ref.series, ref.episode);
   const { envelope } = await resolveBudgetEnvelope(target.libraryRoot, ref, (text) => loadYaml(text));
-  const { estimate, priced, profile } = falEstimate(call.model);
+  const { estimate, priced, profile } = call.estimate ?? falEstimate(call.model);
   return withSpend(dir, {
     episode: ref, actor: "pi",
     capability: call.capability, provider: call.provider, profile, purpose: call.purpose,
````

Apply with `git apply` (save the block to a file first) or by hand; the result must match exactly.

- [ ] **Step 4: Run the agent's tests to see them pass**

Run: `cd studio/agent && npx tsc --noEmit && npx vitest run`
Expected: no type errors; 208 passed, 3 skipped.

- [ ] **Step 5: The ADR and the docs**

`docs/adr/0038-word-timing-comes-from-forced-alignment.md` (new):

````markdown
# ADR-0038: Word timing comes from forced alignment against the text

## Status

Accepted (`avg-8hs.2`). `speech.align` is implemented: the local voice
worker's `POST /align` (Qwen3-ForcedAligner through mlx-audio), the
`@av/elevenlabs` client's forced alignment, the provider-neutral
post-processing and `alignTake` in `@studio/episode`, and the agent's
`pva_align_take`.

## Context

A series episode's narration takes each need a `WordTiming` (`avg-7zp.1`):
every word of the written text with its start and end in the take's audio.
Captions, cues and the series compilers are built on it. Nothing measured
one: a person had to supply the files. CreativeStudio transcribes with
whisper.cpp and reconciles the transcription with the script. The studio's
standing rule for audio: Qwen stays the local speech engine, ElevenLabs is
an option a person chooses, never a replacement.

## Decision

**Word timing is measured by forced alignment against the written text** —
the aligner is told what is said and finds when — not by transcribing and
reconciling. `speech.align` is one capability with two providers:

- `qwen-local`, the default: Qwen3-ForcedAligner-0.6B (MLX, 8-bit) in the
  voice worker, loaded on first use and kept, like the speech model. Free,
  offline after the first download (about 1.3 GB).
- `elevenlabs`, when a person asks for it: `POST /v1/forced-alignment`,
  paid, through the episode's spend ledger at an estimated price per
  minute (ElevenLabs returns none).

Nothing switches from one to the other on its own: an unreachable worker is
an error that says to start it.

Whatever the provider, its words go through the same post-processing in the
studio: they are mapped letter by letter onto the written text's own tokens
(a provider drops punctuation, splits or merges words, mishears one), kept
out of the silences ffmpeg measures (−35 dB, 0.10 s: a silence inside a
word leaves it the side with more speech), and made at least 80 ms long.
More than one token in ten without a word fails the alignment. The result is
a `WordTiming` (`method: "forced"`, provider and model recorded) written
beside the take, and `takes.json` names it.

One pass aligns at most 300 s of audio; longer takes are aligned in parts.

### The measurement behind it (2026-10-07)

On CreativeStudio's San Martino recital (Italian, 30.8 s, 62 words):
Qwen kept the exact text, 62 of 62 words; mlx-whisper small misheard
several ("ghierti", "più viginando", "come soli") and only 51 of its words
mapped back. Raw, the two agreed within 40 ms (median); Qwen's faults —
words running over the following pause, three of zero length — are what
the post-processing corrects, after which the ends agree within 80 ms
(p90), and where starts still differ the silences show Qwen right.
Alignment took 2.2 s once the model was loaded. CreativeStudio's recitals
run 19–43 s.

## Consequences

- Takes get their timing from their audio; a person no longer writes it.
- The voice worker gains a second model and a route; it stays one process.
- The ElevenLabs client (`@av/elevenlabs`) follows CreativeStudio's rate
  rules (one call at a time, two retries only for 429/5xx, `Retry-After`,
  never for auth or quota; a connection lost after sending is `uncertain`
  and not retried). Speech synthesis with ElevenLabs (`avg-8hs.1`) joins it.
- Verifying a take against its text (missing words, long pauses) is
  `avg-8hs.3`; this only reports the pauses over 0.35 s.
````

````diff
diff --git a/docs/index.md b/docs/index.md
index 0a42aad..a8abdf7 100644
--- a/docs/index.md
+++ b/docs/index.md
@@ -56,7 +56,7 @@ synced into the site at build time from where they live next to the code.
 
 ## Decision records
 
-[`adr/`](./adr/0036-the-studio-renders-episodes-through-the-edit-timeline) holds 36 accepted
+[`adr/`](./adr/0038-word-timing-comes-from-forced-alignment) holds 38 accepted
 decisions. The ones that most shape the code:
 
 | ADR | Decision |
@@ -70,6 +70,8 @@ decisions. The ones that most shape the code:
 | [0034](./adr/0034-a-layered-kit-based-edit-timeline) | The edit timeline is layered, kit-based and derived from the spec |
 | [0035](./adr/0035-shared-material-is-pinned-never-copied) | Shared material is pinned with an inventory, never copied |
 | [0036](./adr/0036-the-studio-renders-episodes-through-the-edit-timeline) | The studio renders episodes through the edit timeline, with Remotion |
+| [0037](./adr/0037-series-templates-pin-editorial-standards) | Series templates pin editorial standards |
+| [0038](./adr/0038-word-timing-comes-from-forced-alignment) | Word timing comes from forced alignment against the text |
 
 ADR-0022 (independent repositories per module) is superseded by 0032.
 ADR-0009 (FFmpeg compiles a typed edit timeline) is superseded by 0034.
diff --git a/docs/running.md b/docs/running.md
index 8062a10..4af9228 100644
--- a/docs/running.md
+++ b/docs/running.md
@@ -186,6 +186,25 @@ There is no supervisor that starts the worker for you: the agent will report
 `speech.synthesize` as unavailable rather than launching a multi-gigabyte model
 server behind your back.
 
+### Word timing: aligning a take
+
+A take's word timing — when each word of its text is said — is measured by
+forced alignment ([ADR-0038](adr/0038-word-timing-comes-from-forced-alignment.md)).
+Ask the agent to align a take (`pva_align_take`, with the take's id from
+`artifacts/narration/takes.json`); the timing is written beside it
+(`artifacts/timing/<take>.json`) and `takes.json` names it.
+
+- By default the voice worker aligns it locally with Qwen3-ForcedAligner. The
+  first alignment downloads the model (about 1.3 GB); after that it stays
+  loaded like the speech model. `GET /align` on the worker says which model
+  and whether it is loaded.
+- With `provider: "elevenlabs"` ElevenLabs aligns it instead — only when you
+  ask, never as a fallback. It needs `ELEVENLABS_API_KEY` in the agent's
+  environment, and each call goes through the episode's spend ledger at an
+  estimated price per minute of audio.
+- At most 300 s of audio at a time; a take without a `language` needs one
+  given (`it`, `en`…).
+
 ## 2. Agent plus gateway plus web studio
 
 The gateway owns Pi RPC processes and streams events to the browser. Start it
````

Apply with `git apply` (save the block to a file first) or by hand; the result must match exactly.

- [ ] **Step 6: The whole repository**

Run: `npm run check && npm run docs:build`
Expected: both succeed.

- [ ] **Step 7: Commit**

```bash
git add studio/agent/src/capability-tools.ts studio/agent/src/spend.ts studio/agent/tests/align-take.test.ts \
  studio/agent/tests/extension.test.ts docs/adr/0038-word-timing-comes-from-forced-alignment.md docs/index.md docs/running.md
git commit -m "feat(agent): pva_align_take — local by default, ElevenLabs by choice through the spend ledger; ADR-0038 (avg-8hs.2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
