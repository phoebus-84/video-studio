# Local voice cloning

Qwen TTS Worker supports consented, local reference-audio cloning on Apple Silicon. Cloning is a distinct **Base-checkpoint** workflow. CustomVoice checkpoints contain named preset speakers; passing reference audio to CustomVoice does not turn a preset checkpoint into a cloning model.

## Safety and consent boundary

Only enroll a voice that you recorded, licensed for cloning, or generated synthetically under terms that permit reuse. Never impersonate a person, conceal synthetic media where disclosure is expected, or use a recording obtained without authorization. The worker enforces an explicit consent record and preserves provenance, but software validation cannot prove that a submitted statement is truthful. The operator remains responsible for law, contract, platform policy, and disclosure.

The service is intended to bind to loopback on one Mac. Enrollment lets the process read an explicit local path, so do not expose an unauthenticated worker to other users or a network. Reference audio and consent metadata remain local unless the operator copies them.

## Install the right checkpoint

```bash
cd qwen-tts-worker
.venv/bin/python -m qwen_tts_worker.cli 1.7B --profile base
.venv/bin/python -m qwen_tts_worker.cli 1.7B --profile custom_voice  # optional presets
```

The downloader pins an upstream revision, verifies checkpoint type and critical SHA-256 values, and publishes atomically. `GET /models` must report the requested Base entry as `complete` with `verified: true` before live clone synthesis.

## Prepare a reference

Use one clean speaker with:

- 3-30 seconds of speech (roughly 6-12 seconds is a practical starting point);
- no music, effects, reverb, overlapping speaker, clipping, or long silence;
- a normal, consistent speaking style;
- an exact Unicode transcript containing every spoken word and no invented words.

Enrollment uses FFmpeg to create mono 24 kHz signed 16-bit PCM. It rejects malformed, near-silent, shorter, or longer material. The canonical copy and exact transcript are independently hashed. Do not normalize, summarize, or ask an LLM to infer an uncertain transcript: correct the source or mark it for human review.

## Enroll

```bash
curl -sS http://127.0.0.1:8000/voices/enroll \
  -H 'content-type: application/json' \
  -d @- <<'JSON'
{
  "name": "My local narrator",
  "reference_audio_path": "/absolute/path/to/recordings/reference.wav",
  "reference_text": "This is the exact text spoken in my reference recording.",
  "language": "en-US",
  "consent": {
    "confirmed": true,
    "source": "self_recorded",
    "statement": "I recorded this voice and consent to this local cloning profile.",
    "license_or_terms": "Recording owner consent"
  }
}
JSON
```

The response includes the UUID, canonical relative path, reference duration, hashes, and consent provenance. The copied WAV and `profile.json` are mode `0600` inside a mode `0700` profile directory. Deleting the original source does not break the profile.

## Synthesize

```bash
VOICE_ID='<enrollment UUID>'
curl -sS "http://127.0.0.1:8000/voices/$VOICE_ID/synthesize" \
  -H 'content-type: application/json' \
  -d '{
    "text": "The archive remains private on this Mac.",
    "language": "english",
    "model_size": "1.7B",
    "seed": 51001
  }'
```

The response identifies `model_profile: "base"`, exact pinned revision, loaded model identity, voice revision, reference hashes, output hash, WAV properties, and seed. Output is immutable under `outputs/voices/<voice-id>/<synthesis-id>.wav`. A changed reference hash fails closed.

Set `QTW_TTS_MODE=fake` only for CI/API tests. Fake clone responses are silent fixtures labeled `provider_mode: "fake"` and `must not be published`; they cannot satisfy publication signal gates.

## Revoke and delete

```bash
curl -X DELETE "http://127.0.0.1:8000/voices/$VOICE_ID"
```

Revocation atomically removes the profile, exact transcript, consent record, and canonical reference copy. Already generated WAV outputs remain for audit/reproducibility; delete their output directory explicitly if policy requires erasure. Subsequent synthesis with the removed UUID fails.

## Reproducibility and limitations

A successful local live smoke on the pinned 1.7B Base 8-bit revision `e7dd0585652209fa0d7783659aad4e8a324de11c` produced a valid mono 24 kHz, 3.12-second WAV, with one model load and no fallback. This establishes functional compatibility, not speaker-similarity or listener-quality acceptance.

Identity similarity and naturalness vary with reference quality, language, text, seed, and checkpoint. The worker does not currently ship a calibrated speaker-verification model, watermark, misuse classifier, or a human quality claim. Production teams should run repeated representative prompts, retain provenance, disclose synthetic speech where appropriate, and complete a predeclared blinded listening review before claiming equivalence or improvement.
