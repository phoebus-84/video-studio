# Remotion render benchmark

Issue `avg-tk7.2`, 2026-10-06. Measured before deciding the cutover from the
FFmpeg composer to `@av/remotion-composer` (`avg-tk7.6`), as the
design note (since replaced by [ADR-0034](../adr/0034-a-layered-kit-based-edit-timeline.md)) required: "if it is an order of
magnitude slower, … the default-provider flip should be reconsidered".

## Verdict

**Go.** Remotion renders an 8-minute 1080p30 episode in **6 min 23 s**, about
**1.4× the FFmpeg equivalent** (4 min 30 s) — well short of the order of
magnitude that would argue against it, and faster than real time. Keep the
default concurrency. Optionally pass `chromiumOptions.gl = "angle"` on macOS:
the same speed with ~350 MB less memory. Never `swangle` (3.4× slower).

## Setup

- Machine: Apple M1, 8 cores, 16 GB, macOS 26.6.1; Node 22.23.2; FFmpeg 9.0.1;
  Remotion 4.0.505 with its own Chrome Headless Shell.
- Episode: a synthetic `studio.video/v1alpha2` timeline, validated with
  `validateEditTimeline`: 8 minutes at 1920×1080, 30 fps (14,400 frames);
  a still background; 24 pictures (1600×900) changing every 20 s with
  8-frame crossfades; 24 captions; 24 voice segments with fades; music under
  them, ducked (gain 0.4, attack 6, release 9). Kits: `still`, `captions`.
- Remotion runs went through `renderTimeline` (validation, asset hashing and
  staging, bundle, render, two-pass loudnorm), one configuration at a time.
  `chromiumOptions` was passed through a throwaway patch, not merged.
- FFmpeg baseline: the same content as one filter graph (looped stills,
  chained `xfade`, `overlay`, 24 `drawtext`, voice segments with `afade` and
  `adelay`, music ducked by `sidechaincompress`; libx264 `medium` CRF 18,
  AAC 192k), then the **same** two-pass loudnorm.
- Memory: peak resident size of the render process and everything it
  spawned (Chrome, FFmpeg), sampled every second.

## Results (8 minutes, 14,400 frames)

| Configuration | Total | Render | Render fps | Loudness | Peak memory |
|---|---:|---:|---:|---:|---:|
| Remotion, default concurrency (4 on this machine) | 383 s | 353 s | 40.7 | 28 s | 1.9 GB |
| Remotion, concurrency 2 | 596 s | 567 s | 25.4 | 28 s | 1.2 GB |
| Remotion, concurrency 6 | 370 s | 340 s | 42.4 | 29 s | 2.4 GB |
| Remotion, concurrency 8 | 373 s | 343 s | 42.0 | 29 s | 2.7 GB |
| Remotion, `gl: angle` (default concurrency) | 373 s | 343 s | 42.0 | 29 s | 1.5 GB |
| Remotion, `gl: swangle` (default concurrency) | 1,266 s | 1,235 s | 11.7 | 30 s | 1.9 GB |
| FFmpeg filter graph | 270 s | 242 s | 59.6 | 28 s | — |

Every output had 14,400 frames and integrated loudness −14.9 LUFS. Bundling
took under a second (cached webpack); loudness is the same ~28 s for both
engines. A 1-minute calibration gave the same ratio (Remotion 41 fps, FFmpeg
80 fps). No temporary directory was left behind by any run.

## Reading

- **Concurrency.** Beyond Remotion's default (half the cores) the gain is
  ≤ 4 % for +0.5–0.9 GB: the render is bound by the browser's compositing,
  not by worker count. Two workers cost 56 % more time.
- **GPU.** `angle` (Metal via ANGLE) matches the default's speed with less
  memory; `swangle` (software) is far slower. CreativeStudio's −36 % with
  `angle` was on Windows, where the default differs.
- **What the ratio means.** FFmpeg can only render what a filter graph can
  express (stills, crossfades, text); the kits that justify Remotion —
  characters, verse bars, effects — have no FFmpeg equivalent. On those
  timelines the frame cost will be higher than here: a heavier kit library
  should be re-measured (`avg-tk7.3`), and re-renders after small edits are
  what the segment cache (`avg-tk7.5`) is for.

## Follow-ups

- `avg-tk7.6` may proceed with the cutover.
- Optional: expose `chromiumOptions.gl` (default `angle` on macOS) in
  `renderTimeline` — a memory saving, not a speed-up.
- Re-run this benchmark on a timeline drawn with a channel's own stage kits.

## PR #73: Apple Silicon recheck (2026-10-18)

The sound/multi-browser optimizations were measured again **on Apple M1**,
not inferred from a PC result:

- macOS 26.6.1, arm64 Node 24.19.0, 8 cores, 16 GB;
- FFmpeg 9.0.1, Remotion 4.0.505, native mac-arm64 Chrome Headless Shell;
- 20 seconds, 600 frames, 1920×1080, **four tabs total** in both picture
  configurations; one browser of four versus two browsers of two;
- the first 20 seconds of a series template's stage timeline (kit version 1.0.0), with
  **synthetic media substituted in a temporary copy**: a 3840×2160 test
  picture and a 30-second 48 kHz tone. The episode's original media are not
  present on this machine, so this is a real kit with surrogate media,
  **not** a timing of the delivered production;
- two repetitions, alternating configuration order. Every picture pass uses
  a separate cold render cache. Original image bytes are preserved (no
  automatic downscaling). Assets/bundling are prepared once, outside the
  timed passes; browser startup, segment encoding/cutting and muxing are
  included in picture times. Final loudness normalization is not included.

| Pass | Repetition 1 | Repetition 2 | Mean |
|---|---:|---:|---:|
| Pictures, one browser × four tabs | 44.94 s | 48.82 s | 46.88 s |
| Pictures, two browsers × two tabs | 34.66 s | 36.59 s | 35.62 s |
| Sound, browser (two tabs, browser already open) | 5.44 s | 5.41 s | 5.42 s |
| Sound, Node/FFmpeg | 0.259 s | 0.250 s | 0.255 s |

On this sample the multi-browser picture pass takes **24% less time**
(about 1.32× throughput). The Node sound pass is **about 21× faster**.
Its WAV is byte-identical to the browser's in both repetitions:
`sha256:6f55bc165259b7682242b66b170aaae0051584d0689e5d55b3197481d8e322d7`.

The picture passes have the same frame count; PSNR versus the single-browser
reference is **56.56 dB**, rather than byte identity, because splitting the
encoding runs changes x264 lookahead. Repeating the single-browser pass
gives PSNR infinity. The end-to-end cache tests separately compare all frames
against a fresh single-browser and an uncached render.

### Repeating the comparison

`packages/remotion-composer/scripts/benchmark-passes.ts` takes a JSON file
with `timeline` (a timeline file), `assetRoot`, optional `sharedRoots` and
`kits` (the same sealed bundle descriptors as `renderTimeline`), plus
`seconds`, `concurrency`, `browsers` and `repetitions`. Paths are relative
to that JSON. For this comparison the last four were `20`, `4`,
`[1, 2]`, `2`. Run from the composer package after building it:

```bash
npm run build
node --import tsx scripts/benchmark-passes.ts /path/to/benchmark.json
```

It reports native platform/architecture, pass times, picture PSNR and WAV
hashes, rejects a picture comparison below 40 dB or nonidentical sound, and
removes its temporary output/cache directories. It never writes the episode.

This is evidence that these optimizations **also work on Apple Silicon**,
not a guarantee of the same gain on every M-series chip, kit, or memory
budget. In particular, peak memory was not measured here and a short sample
does not establish sustained whole-episode throughput. Keep
`AVG_RENDER_BROWSERS=1` as the comparison/override on a workload that
doesn't benefit. The unsafe image-downscaling optimization was removed,
not credited with these gains.
