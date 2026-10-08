# Render audit: decode, streams, duration, loudness, loop

**Issue:** `avg-3th.3` (epic `avg-3th`, QA, signed review and direct edits)
**Unblocks:** `avg-dcf.6` (Il lampo long end to end)
**Relates:** `avg-z6c.3` (the fuller delivery report: frame sampling, black and frozen frames, silence, captions — not here)
**Date:** 2026-10-09

## Problem

`renderEpisode` renders to `output/<render-id>.mp4` and moves `output/current.json` as soon as Remotion and loudnorm return. Nothing checks the file itself, so `current.json` can name a deliverable that:
- does not decode cleanly;
- has the wrong size, frame rate, pixel format or codecs;
- is longer or shorter than its timeline;
- missed its loudness target;
- breaks a loop the series promises (CreativeStudio's rule: the last frame is the first).

CreativeStudio refused such files before delivery. This studio should refuse them too.

## Decisions

Taken autonomously, as the user delegated the run.

1. **The audit is the composer's.** It reads a rendered file with FFmpeg, and the composer already owns FFmpeg (loudness, probe). The function `auditRender(file, expect)` returns findings. It never throws for a bad file, only when FFmpeg cannot run. FFmpeg and FFprobe paths are parameters, by default the ones every other step of a render uses (`FFMPEG_PATH`, `FFPROBE_PATH`, else on the PATH), so a host that sets them renders and audits with the same binaries.
2. **What it checks.** Each failed check is a finding `{code, message, measured, expected}`.
   - **decode** (`decode-errors`): `ffmpeg -v error -i <file> -f null -` prints nothing.
   - **streams**:
     - video is H.264, `yuv420p`, at the timeline's width × height and fps (`wrong-video`);
     - with audio, AAC at 48 kHz (`wrong-audio`);
     - without audio expected, an audio track is allowed (Remotion always writes one).
   - **duration** (`wrong-duration`): the video stream lasts `durationInFrames / fps`, give or take one frame; with sound, the sound lasts as long, give or take 0.2 s (AAC priming and padding).
   - **loudness** (`loudness-off`): when the timeline has audio, integrated loudness is within 1 LU of the profile's target and true peak at most 0.3 dB above it.
   - **loop** (`loop-broken`): when the timeline declares `loop: true`, the first and last frames, scaled to 64×36 grey, differ by a mean of at most 2 levels out of 255. That bound allows compression noise but no change of scene.
3. **The loop is declared in the timeline.** `EditTimeline` (v1alpha2) gains an optional top-level `loop: boolean`, in the contract schema and the composer's zod schema alike. Compilers set it.
   - The short's released compiler (`dentro-i-versi-short@1.0.0`) is frozen and cannot set it: its timelines are audited without the loop check until `avg-d1x` brings a new compiler release.
   - The long compiler (`avg-dcf.6`) sets it from the start.
4. **Only an audited render becomes current.** `renderEpisode` audits the finished file before anything is promoted.
   - **If it passes**, it proceeds as today, and the report gains `audit: {passed: true, checks}`.
   - **If the audit cannot run** (FFmpeg missing or failing), the render is kept the same way with `audit: {passed: false, error}` in its report, and `RenderAuditError` carries one finding `audit-unavailable`. The timeline is checked against the composer's schema before rendering, so a timeline the audit could not read is refused before minutes of render.
   - **If it fails**, the video stays at `output/<render-id>.mp4` with its timeline snapshot and its report, so it can be looked at. The report gains `audit: {passed: false, findings}`. `output/current.json` does not move. `renderEpisode` throws `RenderAuditError` (`code: "render-audit"`, `problems`: the findings). The agent tool and the series adapter already report any `code` and `problems`.
5. **Not here:** frame sampling, black, frozen or blank frames, silence and clipping, captions, provenance and budget assertions (`avg-z6c.3`).

## Design

- `packages/remotion-composer/src/audit.ts`:
  - `auditRender(file, {width, height, fps, durationInFrames, audio: boolean, loudness?: LoudnessTarget, loop: boolean}, tools?)` returns `{passed, checks: string[], findings: AuditFinding[]}`;
  - `auditExpectation(timeline)` derives the expectation from a validated timeline: audio when an unmuted audio track has items, the profile's loudness target, `timeline.loop === true`.
  - Both are exported from the package with the `AuditFinding` and `AuditResult` types.
- `renderTimeline` is unchanged. A render and its audit stay separate steps, so the audit can also run on files rendered elsewhere.
- `studio/episode/src/episode-render.ts`: `RenderAuditError`, the audit between the render and `current.json`, the report's `audit`, and `EpisodeRender.audit`.
- Contract: `studio/contracts/schemas/v1alpha2/edit-timeline.schema.json` gains `loop`. Bindings are regenerated. The composer's `EditTimelineSchema` gains `loop: z.boolean().optional()`.

## Testing

- **Composer `test/audit.test.ts`** renders real short files with FFmpeg's test sources (`testsrc2`, `sine`):
  - a good file passes;
  - a wrong size, fps, codec, pixel format and duration each give their finding;
  - a truncated file gives `decode-errors`;
  - a quiet file gives `loudness-off`;
  - a file whose last frame differs from its first gives `loop-broken`, while a static one passes;
  - `auditExpectation` reads audio, loudness and loop from timelines.
- **Episode tests** (render mocked):
  - a passing audit writes `audit` into the report and moves `current.json`;
  - a failing audit keeps the video and report, leaves `current.json` as it was, and throws `RenderAuditError` with the findings.
  - Existing mocks of `@av/remotion-composer` gain an `auditRender` that passes.
- **Contract tests:** a timeline with `loop: true` validates, and `loop: "yes"` is refused at `$.loop`.

## Documentation

- The composer README: the audit.
- `docs/workspace.md`: an output becomes current only after its audit passes.
