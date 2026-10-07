# speech.align: word timing by forced alignment

**Issue:** `avg-8hs.2` — speech.align capability: forced alignment, local and ElevenLabs
**Epic:** `avg-8hs` — voice capabilities: ElevenLabs, alignment, take verification (the `cs-port` plan)
**Builds on:** the `WordTiming` and `NarrationTakes` contracts (`avg-7zp.1`, `avg-7zp.4`); the spend ledger (`avg-91o`); the local voice worker (`packages/voice`)
**Blocks:** `avg-8hs.3` (take verification), `avg-dcf.2` (poem source pipeline), every series episode whose takes need timing
**Source:** `../CreativeStudio/services/audio-sync/sync.py`, `../CreativeStudio/docs/workflow/audio.md` — read only
**Date:** 2026-10-07

## Problem

A series episode's narration takes each need a `WordTiming` — every word of
the written text with its start and end in the take's audio — and nothing in
the studio can measure one: the series compiler reads timing files that a
person had to supply. CreativeStudio transcribes with whisper.cpp and snaps
the transcription to the script. The user's standing rule: Qwen stays the
local speech engine; ElevenLabs is an option a person can choose, never a
replacement.

## The spike (2026-10-07)

On a real Italian recital (CreativeStudio's San Martino, ElevenLabs voice,
30.8 s, 62 words), Qwen3-ForcedAligner-0.6B (MLX, 8-bit, through `mlx-audio`
0.4.6, already a dependency of the voice worker) against mlx-whisper small:

- Qwen kept the exact text (62/62 words, `gl'irti`, `de' tini`); whisper
  misheard several words ("ghierti", "più viginando", "come soli") and only
  51 of its words mapped back to the script.
- Raw, the two agreed within 40 ms (median, start and end), but Qwen let the
  word before a pause run over it ("sale" to 4.8 s, the silence from 3.89 s)
  and gave three words zero length.
- Snapping to the silences ffmpeg measures (−35 dB, 0.10 s) and an 80 ms
  minimum: ends agree within 80 ms (p90), max 0.13 s; where starts still
  differ, the silences show whisper wrong and Qwen right.
- 2.2 s to align once loaded; the first load downloads the model (about
  1.3 GB). Italian is among the model's 11 languages.

CreativeStudio's recitals run 19–43 s; one pass of up to 300 s is enough.

## Decisions taken with the user

1. **Local: Qwen3-ForcedAligner in the existing voice worker**, with silence
   snapping and a minimum word length; no whisper.
2. **`speech.align` is one capability with two providers**: `qwen-local`
   (default, free) and `elevenlabs` (optional, paid, through the spend
   ledger). Never an automatic switch from one to the other.
3. **Alignment is against the written text**; post-processing is the
   studio's, the same for both providers.

## Design

### Vocabulary

`speech.align` joins `CAPABILITIES` in `studio/contracts/src/vocabulary.mjs`
and the vocabulary schema's enum (kept identical by `check-vocabulary`).

### The worker — `POST /align` (`packages/voice`)

- Request `{ "audio_path": str, "text": str, "language": str }` (language a
  name the model knows, e.g. `"Italian"`, or an ISO code mapped to it: `it`,
  `en`, `fr`, `de`, `es`, `pt`, `ru`, `ja`, `ko`, `zh`).
- Response `{ "words": [{ "text", "start", "end" }], "model": str,
  "language": str }` — the model's own tokens and seconds, unprocessed.
- The aligner model (`ALIGN_MODEL`, default
  `mlx-community/Qwen3-ForcedAligner-0.6B-8bit`) is loaded on first use and
  kept, as the speech model is; the worker's health reports whether it is
  loaded.
- Errors (`{ "code", "message" }`, HTTP 4xx): `too-long` (audio over 300 s),
  `unsupported-language`, `bad-audio` (unreadable or missing), `empty-text`.
- Under `tts_mode = "fake"` (the worker's explicit CI mode) alignment is fake
  too: words spread evenly over the audio's duration, model `fake-aligner`.
  A live failure never falls back to it.

### `@av/elevenlabs` (new package, `packages/elevenlabs`)

```ts
forcedAlignment(options: {
  audioPath: string; text: string;
  apiKey: string;                 // the caller reads ELEVENLABS_API_KEY
  baseUrl?: string;               // tests
  signal?: AbortSignal;
}): Promise<{ words: { text: string; start: number; end: number; loss?: number }[]; loss?: number }>
ELEVENLABS_PROFILES: { forcedAlignment: { usdPerMinute: number; estimate: true } }
class ElevenLabsError { code: "auth" | "quota" | "rate-limited" | "bad-request" | "server" | "uncertain"; status?: number; message }
```

- `POST https://api.elevenlabs.io/v1/forced-alignment`, multipart (`file`,
  `text`), header `xi-api-key`.
- Rate rules (CreativeStudio UP-39): one call at a time per process; at most
  two retries, only for 429 and 5xx answered before any processing, waiting
  `Retry-After` (or 2 s, 4 s); never retry 401/403 (`auth`) or a quota error
  (`quota`); a connection lost after the request was sent is `uncertain`,
  never retried.
- The key never appears in an error, a log line or a thrown message.
- The price is an estimate in the profile, documented as such and editable;
  ElevenLabs returns no price for alignment.
- Workspace package: TypeScript, `dist/`, `node --test` like
  `@av/fal-media`; registered in `tools/build-required.mjs` and the
  boundaries check like the other `packages/*`.

### Post-processing — `@studio/episode`, `speech-align.ts`

```ts
interface RawWord { text: string; start: number; end: number; confidence?: number }
mapToText(text: string, raw: RawWord[]): { words: Word[]; unmapped: number[] }
snapToSilences(words: Word[], silences: [number, number][], durationSeconds: number): Word[]
measureSilences(audioPath: string): Promise<{ silences: [number, number][]; speech: [number, number][]; durationSeconds: number }>
```

1. **Tokens.** The written text's tokens are its whitespace-separated
   pieces (the `WordTiming` rule: one token, no whitespace). Each is matched
   with the provider's words in order on a normalised form (lower case,
   letters and digits only, apostrophes and accents kept as letters), with
   a sequence match so a provider that splits or merges a word does not
   shift the rest. A token matched to several provider words takes their
   span; one matched to none takes the gap between its neighbours,
   `confidence: 0`, and is listed in `unmapped`. More than 10% of tokens
   unmapped → `alignment-mismatch`.
2. **Silences** from `ffmpeg -af silencedetect=noise=-35dB:d=0.10`.
   `speech` is the complement. No word runs into a silence: an end inside a
   word that a silence starts after is clipped to the silence's start; a
   start that a silence ends after is moved to the silence's end.
3. **Minimum length** 80 ms: a shorter word takes the time from its
   following neighbour when that one is longer than 200 ms, otherwise from
   its preceding one; never overlapping a neighbour, never past the audio.
4. Times are rounded to the millisecond; words stay in order and
   non-overlapping.

### `alignTake` — `@studio/episode`, `take-align.ts`

```ts
alignTake(episodeDir: string, options: {
  episodeRef: EpisodeRef;
  take: string;
  provider?: "qwen-local" | "elevenlabs";      // default qwen-local
  workerUrl?: string;                         // default the agent's configured worker URL
  elevenlabs?: { apiKey: string; spend: (call) => Promise<…> };  // supplied by the caller
}): Promise<{ timing: WordTiming; path: string; unmapped: string[]; pauses: number[] }>
```

1. Reads `artifacts/narration/takes.json` (`validateNarrationTakes`), finds
   the take (`no-such-take`), checks its audio's hash (`audio-changed`).
2. Calls the provider with the take's audio, its `text`, its `language`
   (`no-language` when the take has none). `qwen-local` through the
   worker (`worker-unreachable` when it does not answer); `elevenlabs`
   through `@av/elevenlabs`, wrapped by the caller's spend function.
3. Post-processes, builds the `WordTiming` — `take: {id, source?}`,
   `audio` (path, hash, duration), `text`, `spokenText` when the take has
   one, `language`, `alignment: {provider, model, method: "forced",
   createdAt}`, `words`, `speech` — and checks it with
   `validateWordTiming(doc, {audioHash})`.
4. Writes `artifacts/narration/timing/<take>.json` atomically, then
   rewrites `takes.json` with that take's `timing: {path, hash}` set and
   nothing else changed (parsed, the one field set, serialised in the same
   two-space form; a `takes.json` not in that form is rewritten in it — the
   result is checked with `validateNarrationTakes` before it replaces the
   file).
5. `pauses`: the silences longer than 0.35 s inside speech, in seconds —
   reported, not judged (judging is `avg-8hs.3`).

The library never reads an environment variable: the agent supplies the
worker URL, the ElevenLabs key and the spend function.

### Agent — `pva_align_take`

- Parameters: `channel, series, episode, take, provider?`.
- `provider: "elevenlabs"`: the key from `ELEVENLABS_API_KEY` (`no-key`
  when unset), the call through `paidCall` (capability `speech.align`,
  provider `elevenlabs`, estimate from the profile × the take's minutes);
  a budget that cannot hold the estimate refuses before sending.
- Replies: `✅ <take>: <n> words, <provider> (<model>) → <path>`, the pauses
  over 0.35 s, the unmapped words. Errors with their code.
- `pva_capability_status` reports `speech.align` for both providers: the
  worker reachable, the key set.

### Errors

| Code | When |
|---|---|
| `no-such-take` | the take is not in `takes.json` |
| `audio-changed` | the take's audio is not the file `takes.json` names |
| `no-language` | the take has no language |
| `worker-unreachable` | the voice worker does not answer |
| `too-long`, `unsupported-language`, `bad-audio`, `empty-text` | from the worker |
| `no-key` | ElevenLabs asked for, no key |
| `auth`, `quota`, `rate-limited`, `uncertain`, `server` | from ElevenLabs |
| `budget` | the spend ledger refuses the estimate |
| `alignment-mismatch` | more than 10% of the text's tokens found no word |

All are `AlignError { code, message }`; nothing is written unless the timing
is valid.

### Documentation

ADR-0038 "Word timing comes from forced alignment against the text" (the
choice, the spike's numbers, the 300 s limit, Qwen local by default and
ElevenLabs by choice); `docs/running.md` (aligning a take, the model's first
download, `ELEVENLABS_API_KEY`); the voice worker's README (`/align`); the
new package's README.

## Testing

- Worker (pytest): `/align` with a fake model returns words; `too-long`,
  `unsupported-language`, `bad-audio`, `empty-text`; the model is loaded
  once; fake mode spreads words evenly. A real test with the Qwen model is
  opt-in (an environment variable), on a short generated clip.
- `@av/elevenlabs` (a local fake HTTP server): success; 429 with
  `Retry-After` then success; 401 and quota never retried; a connection cut
  after the request is `uncertain` and not retried; the key absent from
  every error.
- Post-processing (unit): punctuation dropped by the provider, apostrophes
  (`gl'irti`, `de'`), split and merged words, an unmapped token,
  `alignment-mismatch`, snapping with the spike's words (`sale`,
  `rallegrar`) as fixtures, the 80 ms minimum, the result valid.
- `alignTake` (integration, ffmpeg-generated audio with silences, worker
  faked): the timing file, the hash in `takes.json`, the rest of
  `takes.json` unchanged; `audio-changed`, `no-such-take`; the ElevenLabs
  path through a spend function, refused when over budget.
- Agent: `pva_align_take` registered (49 tools), its reply, an error reply,
  `no-key`.

## Out of scope

- Splitting audio longer than 300 s.
- Speech synthesis with ElevenLabs (`avg-8hs.1`).
- Verifying a take against its text (`avg-8hs.3`).
- An automatic fallback between providers (`avg-8hs.6`).
- A pipeline stage that aligns on its own.
