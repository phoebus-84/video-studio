# Registering a synthesized take

**Issue:** `avg-dcf.6.6` (under `avg-dcf.6`, Il lampo long end to end)
**Found by:** Pi's first production run of Il lampo's source, 2026-10-09 (its report: `pva_synthesize_speech` writes a WAV, but nothing writes `artifacts/narration/takes.json`, which `pva_align_take` and the series compilers read)
**Date:** 2026-10-09

## Problem

The pieces of a series' takes stage don't connect.
- `pva_synthesize_speech` copies a WAV to `artifacts/narration/<sceneId>.wav`. It does not register it.
- `pva_align_take` needs the take already in `artifacts/narration/takes.json`.
- The series compilers need the takes there too, in the series' unit: the short expects unit `recital` with `titolo`, then `recita` about 1 s later.
- `takesFromNarrationManifest` (contracts) maps the explainer's narration manifest into one unit called `narration`, so it doesn't fit a series.

Nothing writes a take into a named unit, so Pi cannot complete the takes stage with its tools.

## Decisions

1. **`registerTake(episodeDir, options)` in `@studio/episode`** (`take-register.ts`, beside `take-align.ts`), and the Pi tool **`pva_register_take`**.
2. **The audio becomes the take's own file, named by its content.** The bytes are read once, then hashed, measured (FFprobe, as alignment does) and written to `assets/takes/<take>.<hash8>.<ext>`. Naming by content means two takes never overwrite each other, even on a case-insensitive disk with ids differing only in case. The new file is written first, then `takes.json`; only then is the take's previous file removed, and only if no take names it. `assets/takes` must stay inside the episode. (Final review, 2026-10-09.) The source must be a file inside the episode, and only `.wav`, `.mp3` and `.m4a` are accepted.
3. **The take carries the contract's fields.**
   - Required: `text` and `voice` (`provider`, plus optional `model`, `voiceId`, `settings` and `direction`, recorded as provenance).
   - Optional: `spokenText` (when the tool was given a different text), `language` and `role`.
4. **Re-registering a take replaces it.** It keeps its language, role and spoken text unless they are given again. Its timing is dropped when the audio, the text, the language or the spoken text changed, and kept otherwise.
5. **Units.** `unit: {id, pauseBefore?, position?}` appends the take to that unit's sequence, creating the unit if it doesn't exist. If the take is already in the unit, it stays where it is, unless `position` (0-based) puts it elsewhere, so a title registered after the poem can still come first. `pauseBefore` is updated when given. The first take of a unit carries no `pauseBefore`, and every later take has one (0 by default).
6. **Validation.** The document is checked with `validateNarrationTakes` before anything is written. The audio copy and `takes.json` are written atomically. An invalid result writes nothing.
7. **Not here:**
   - Qwen voice choice and direction: `pva_synthesize_speech`'s.
   - Judging pauses: `avg-8hs.3`.
   - Codex readiness in `pva_capability_status`: a follow-up note. Pi already reports `openai-codex` as selectable per series.

## Testing

- **Episode (vitest), on real short WAVs made with FFmpeg:**
  - register into a new `takes.json`;
  - a second take into the same unit, with `pauseBefore`;
  - re-registering keeps the position, and drops the timing when the audio changed or keeps it when the audio is the same;
  - refusals: audio outside the episode, a missing file, an unsupported extension, an invalid id, `pauseBefore` over 10 s.
  - Then `alignTake` accepts the registered take, using a fake worker answering `/align`.
- **Agent:** the tool's listing (`skill-discovery`/tool tests, if they enumerate tools).
