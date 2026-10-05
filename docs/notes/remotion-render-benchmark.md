# Remotion render benchmark

Issue `avg-tk7.2`, 2026-10-06. Measured before deciding the cutover from the
FFmpeg composer to `@av/remotion-composer` (`avg-tk7.6`), as the
[design note](remotion-composer-design.md) requires: "if it is an order of
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
- Re-run this benchmark when the "Dentro i versi" kits exist (`avg-dcf.4`).
