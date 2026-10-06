# Timeline Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The studio composes an episode by building a v1alpha2 edit timeline (`artifacts/edit-timeline.json`) and rendering it with `@av/remotion-composer` to `output/<render-id>.mp4`; `composeEpisodeVideo()` and its FFmpeg calls are deleted.

**Architecture:** `edit-timeline-builder.ts` turns an episode's scene images, timing and narration into a timeline validated by both the contracts and the composer, listing the hash of every file it read. `episode-render.ts` decides whether the timeline on disk still describes the episode (rebuild on changed inputs or another profile, otherwise render it as it stands), renders through a `.partial` file, writes the report and moves `output/current.json` last. `capability-tools.ts` registers `pva_build_timeline` and the new `pva_compose_video`. Config, `doctor`, docs, skill and ADR-0036 follow.

**Tech Stack:** TypeScript (agent: vitest, bundler resolution), `@av/remotion-composer` (Remotion 4.0.505, consumed through `dist/`), `@studio/contracts` (`output-profiles.mjs`, `edit-timeline.mjs`), FFmpeg/ffprobe in tests only.

**Spec:** `docs/superpowers/specs/2026-10-06-timeline-cutover-design.md`

## Global Constraints

- fps 30; crossfade 12 frames centred on each scene boundary (incoming starts 6 frames early, outgoing ends 6 late); none around a scene of 12 frames or fewer; kits exactly `still@1.0.0` (`fit: "contain"`) and `captions@1.1.0` (`position: "bottom"`).
- Default profile `youtube-1920x1080`; a rebuild without a `profile` keeps the stored timeline's profile.
- Timeline path `artifacts/edit-timeline.json`; render id `<label>-<Date.now()>-<first 8 hex of the timeline file's sha256>`; label `^[a-z0-9]+(-[a-z0-9]+)*$`, default `render`; video written as `output/.<render-id>.partial.mp4` then renamed; report `output/<render-id>.report.json`; `output/current.json` written last, inside `withFileMutationQueue`.
- No FFmpeg in `studio/agent/src/` for composition. `canonicalNarrationPath`, `resolveSceneFrames`, `naturalSegmentOrder` stay; `concatScript` and its tests go.
- The agent writes narration manifests as `narration-manifest/v1`: captions come from the agent's `validateNarrationManifest` + `manifest.captions`, **not** from `@av/video-composer`'s `narrationCompositionInput` (it accepts only `schemaVersion 0.1.0`).
- `@av/remotion-composer` is consumed through `dist/`: it joins `REQUIRED` in `tools/build-required.mjs`, and the agent's tests need it built (`npm run build --workspace @av/remotion-composer`, or `node tools/build-required.mjs`).
- `bun.lock` is edited by hand (bun 1.2.0); then `bun install --frozen-lockfile` from the root must pass.
- No double opening curly braces outside fenced code blocks in Markdown (VitePress).
- Do not touch `studio/runtime`, `packages/`, or the multitrack composer.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Deviations from the spec (found while prototyping; the spec is updated)

- Captions read with the agent's own manifest validator (see Global Constraints), not `narrationCompositionInput`.
- A canonical manifest without a final WAV plays its entries' WAVs in order with lead-in and pauses (before the scene-WAV fallback).
- `buildEditTimeline` takes `episodeRef` from its caller; problems add `bad-manifest` and `missing-narration`.
- The `blender` profile composes the agent too, so it gains `remotion-composer` and the default.
- `skills/studio/compose-video.md` goes to version 0.2.0 and the pipeline's pin follows.

## Review Focus

- A person edits `artifacts/edit-timeline.json` by hand and renders: the edit must be rendered, never silently replaced (test in Task 2).
- A new scene image appears (`s3.png`) without any listed input changing: the timeline must be rebuilt (inputs compared as sets: added, changed, removed — test in Task 2).
- A render fails halfway: `output/current.json` must still name the previous render and no `.partial` file may remain (test in Task 2).
- Narration longer than the scenes: the last scene must hold until it ends, never a black tail (tests in Tasks 1 and 3).
- An episode with ten or more scenes plays `s10` after `s9`, not after `s1` (tests in Tasks 1 and 3).

## File map

| File | Responsibility | Task |
|---|---|---|
| `studio/agent/src/edit-timeline-builder.ts`, `studio/agent/tests/edit-timeline-builder.test.ts` | Build the timeline | 1 |
| `studio/agent/package.json`, `bun.lock`, `tools/build-required.mjs` | The agent depends on the composer | 1 |
| `studio/agent/src/episode-render.ts`, `studio/agent/src/capability-tools.ts`, `studio/agent/src/scene-images.ts`, `studio/agent/src/slash-commands.ts` | Render, tools, deletion | 2 |
| `studio/agent/tests/compose-video.test.ts`, `scene-images.test.ts`, `extension.test.ts`, `e2e-scenarios.test.ts` | Tool tests | 2 |
| `studio/agent/tests/compose-video.e2e.test.ts` | Real renders (`REMOTION_E2E=1`) | 3 |
| `compose.config.json`, `tools/doctor.mjs`, `docs/install.md`, `docs/running.md`, `docs/index.md`, `docs/adr/0036-…`, `docs/notes/remotion-composer-design.md`, `docs/packages/remotion-composer.md` (generated), `skills/studio/compose-video.md`, `studio/pipelines/pipelines/narrated-illustrated-video.yaml` | Config, docs, ADR | 4 |

Work on branch `feat/timeline-cutover` (the spec is committed there). Commands run from the repository root unless a step says otherwise.

---

### Task 1: Build the edit timeline from an episode

**Files:**
- Create: `studio/agent/src/edit-timeline-builder.ts`, `studio/agent/tests/edit-timeline-builder.test.ts`
- Modify: `studio/agent/package.json`, `bun.lock`, `tools/build-required.mjs`

**Interfaces:**
- Consumes: `resolveSceneFrames(episodeDir)` (`./scene-images.js`); `naturalSegmentOrder`, `readWavFacts`, `validateNarrationManifest` (`./narration-manifest.js`); `outputProfile` (`@studio/contracts/src/output-profiles.mjs`); `validateEditTimeline` (`@studio/contracts/src/edit-timeline.mjs`); `validateTimeline` (`@av/remotion-composer`).
- Produces: `buildEditTimeline(episodeDir, {episodeRef, profile?}) → {ok: true, timeline: EditTimelineDoc, warnings: string[]} | {ok: false, problems: BuildProblem[]}`; constants `TIMELINE_FPS` (30), `CROSSFADE_FRAMES` (12), `DEFAULT_PROFILE`, `EDIT_TIMELINE_PATH` (`"artifacts/edit-timeline.json"`); types `BuildOptions`, `BuildProblem {code, message, path?}`, `EditTimelineDoc` (with `metadata.inputs: Record<path, "sha256:…">`).

- [ ] **Step 1: Depend on the composer**

Apply to `studio/agent/package.json`:

```diff
@@ -60,6 +60,7 @@
   "dependencies": {
     "@av/blender": "workspace:*",
     "@av/terminal-recorder": "workspace:*",
+    "@av/remotion-composer": "workspace:*",
     "@av/video-composer": "workspace:*",
     "js-yaml": "^5.2.2",
     "ws": "^8.21.1",
```

In the root `bun.lock`, under `"studio/agent": {` → `"dependencies"`, add the line `"@av/remotion-composer": "workspace:*",` between `"@av/fal-media"` and `"@av/terminal-recorder"`.

Apply to `tools/build-required.mjs`:

```diff
@@ -20,7 +20,7 @@ import { spawnSync } from "node:child_process";
 const ROOT = resolve(import.meta.dirname, "..");
 
 /** Workspaces whose `exports` resolve into `dist/`. */
-const REQUIRED = ["packages/fal-media", "packages/video-composer", "studio/runtime", "studio/adapters"];
+const REQUIRED = ["packages/fal-media", "packages/video-composer", "packages/remotion-composer", "studio/runtime", "studio/adapters"];
 
 /**
  * Nothing must depend on a `dist/` that install does not build.
```

Run: `bun install --frozen-lockfile && node tools/build-required.mjs`
Expected: install succeeds; the build list includes `building @av/remotion-composer … ok`.

- [ ] **Step 2: Write the tests** — `studio/agent/tests/edit-timeline-builder.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { validateEditTimeline } from "@studio/contracts/src/edit-timeline.mjs";
import { buildEditTimeline, CROSSFADE_FRAMES } from "../src/edit-timeline-builder.js";

/**
 * The studio's edit timeline, built from an episode on disk (avg-tk7.6). No
 * render here: these pin what the timeline says. Images are never decoded by
 * the builder, so any bytes will do; WAVs are read for their length.
 */

const REF = { channel: "c", series: "s", episode: "e" };
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "edit-timeline-builder-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function file(relative: string, content: string | Buffer): void {
  mkdirSync(dirname(join(dir, relative)), { recursive: true });
  writeFileSync(join(dir, relative), content);
}

/** A silent 16-bit mono WAV of the given length. */
function wav(relative: string, seconds: number, sampleRate = 8000): void {
  const data = Math.round(seconds * sampleRate) * 2;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data, 40);
  file(relative, Buffer.concat([header, Buffer.alloc(data)]));
}

function scenes(lengths: Record<string, number>): void {
  for (const id of Object.keys(lengths)) file(`assets/images/${id}.png`, `image ${id}`);
  file("artifacts/timing.json", JSON.stringify({
    scenes: Object.entries(lengths).map(([sceneId, durationSeconds]) => ({ sceneId, durationSeconds })),
  }));
}

function build(profile?: string) {
  const result = buildEditTimeline(dir, { episodeRef: REF, ...(profile ? { profile } : {}) });
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result;
}

const track = (timeline: { tracks: Array<{ id: string; items: any[] }> }, id: string) =>
  timeline.tracks.find((t) => t.id === id)?.items ?? [];

describe("buildEditTimeline", () => {
  it("lays the scenes out in reading order, for their lengths, with crossfades centred on each boundary", () => {
    scenes({ s1: 2, s2: 3, s10: 1 });
    const { timeline } = build();
    expect(timeline.durationInFrames).toBe(180);
    expect(track(timeline, "scenes").map((it) => [it.id, it.from, it.duration, it.transitionIn?.duration ?? null])).toEqual([
      ["scene-s1", 0, 66, null],
      ["scene-s2", 54, 102, CROSSFADE_FRAMES],
      ["scene-s10", 144, 36, CROSSFADE_FRAMES],
    ]);
    expect(track(timeline, "scenes").every((it) => it.kit.name === "still" && it.props.fit === "contain")).toBe(true);
    expect(validateEditTimeline(timeline)).toEqual([]);
  });

  it("gives a very short scene no crossfade on either side", () => {
    scenes({ s1: 2, s2: 0.3, s3: 2 });
    const { timeline } = build();
    expect(track(timeline, "scenes").map((it) => [it.from, it.duration, it.transitionIn ?? null])).toEqual([
      [0, 60, null],
      [60, 9, null],
      [69, 60, null],
    ]);
  });

  it("plays the manifest's final WAV, captions its lines, and holds the last scene to the end of the narration", () => {
    scenes({ s1: 3, s2: 3 });
    wav("artifacts/narration/final.wav", 7);
    wav("artifacts/narration/s1.wav", 3);
    file("artifacts/narration/narration-manifest.json", JSON.stringify({
      schemaVersion: "narration-manifest/v1",
      entries: [{ segmentId: "s1", wav: { path: "artifacts/narration/s1.wav", durationSeconds: 3 }, pauseAfterMs: 0 }],
      finalWav: { path: "artifacts/narration/final.wav", durationSeconds: 7 },
      captions: [
        { segmentId: "s1", index: 1, startSeconds: 0.25, endSeconds: 3, text: "C'era una volta" },
        { segmentId: "s2", index: 2, startSeconds: 3.5, endSeconds: 6.9, text: "  un lampo.  " },
      ],
    }));
    const { timeline } = build();
    expect(timeline.durationInFrames).toBe(210);
    expect(track(timeline, "scenes").at(-1)).toMatchObject({ from: 84, duration: 126 });
    expect(track(timeline, "voice")).toEqual([{ id: "narration", from: 0, duration: 210, asset: "narration" }]);
    expect(timeline.assets.narration).toMatchObject({ path: "artifacts/narration/final.wav", kind: "audio" });
    expect(track(timeline, "captions").map((it) => [it.from, it.duration, it.kit.version, it.props])).toEqual([
      [8, 82, "1.1.0", { text: "C'era una volta", position: "bottom" }],
      [105, 102, "1.1.0", { text: "un lampo.", position: "bottom" }],
    ]);
  });

  it("plays a manifest's segments in order, with lead-in and pauses, when it has no final WAV", () => {
    scenes({ s1: 2, s2: 2 });
    wav("artifacts/narration/s1.wav", 1.5);
    wav("artifacts/narration/s2.wav", 1);
    file("artifacts/narration/narration-manifest.json", JSON.stringify({
      schemaVersion: "narration-manifest/v1",
      leadInSilenceSeconds: 0.5,
      entries: [
        { segmentId: "s1", wav: { path: "artifacts/narration/s1.wav", durationSeconds: 1.5 }, pauseAfterMs: 500 },
        { segmentId: "s2", wav: { path: "artifacts/narration/s2.wav", durationSeconds: 1 }, pauseAfterMs: 0 },
      ],
    }));
    const { timeline } = build();
    expect(track(timeline, "voice").map((it) => [it.id, it.from, it.duration])).toEqual([
      ["narration-s1", 15, 45],
      ["narration-s2", 75, 30],
    ]);
  });

  it("falls back to the scene WAVs, in reading order, and says it is deprecated", () => {
    scenes({ s1: 1, s2: 1, s10: 1 });
    wav("artifacts/narration/s10.wav", 1);
    wav("artifacts/narration/s2.wav", 1);
    wav("artifacts/narration/s1.wav", 1);
    const result = build();
    expect(track(result.timeline, "voice").map((it) => [it.id, it.from])).toEqual([
      ["narration-s1", 0], ["narration-s2", 30], ["narration-s10", 60],
    ]);
    expect(result.warnings.join(" ")).toMatch(/DEPRECATED/);
  });

  it("keeps the narration but drops the captions of a manifest that is not canonical, and says why", () => {
    scenes({ s1: 2 });
    wav("artifacts/narration/final.wav", 2);
    file("artifacts/narration/narration-manifest.json", JSON.stringify({
      segments: [{ id: "s1" }],
      finalWav: { path: "artifacts/narration/final.wav" },
      captions: [{ startSeconds: 0, endSeconds: 1, text: "hidden" }],
    }));
    const result = build();
    expect(track(result.timeline, "voice")).toHaveLength(1);
    expect(track(result.timeline, "captions")).toEqual([]);
    expect(result.warnings.join(" ")).toMatch(/not canonical.*no captions.*'segments' but no 'entries'/);
  });

  it("lists every file it read, with its hash", () => {
    scenes({ s1: 1, s2: 1 });
    wav("artifacts/narration/narration-full.wav", 2);
    const { timeline } = build();
    expect(Object.keys(timeline.metadata.inputs)).toEqual([
      "artifacts/narration/narration-full.wav",
      "artifacts/timing.json",
      "assets/images/s1.png",
      "assets/images/s2.png",
    ]);
    expect(Object.values(timeline.metadata.inputs).every((h) => /^sha256:[a-f0-9]{64}$/.test(h))).toBe(true);
    expect(timeline.assets["scene-s1"]!.hash).toBe(timeline.metadata.inputs["assets/images/s1.png"]);
  });

  it("copies the chosen output profile and takes its size", () => {
    scenes({ s1: 1 });
    const { timeline } = build("vertical-1080x1920");
    expect(timeline.resolution).toEqual({ width: 1080, height: 1920 });
    expect(timeline.profile).toMatchObject({ id: "vertical-1080x1920", safeZone: { bottom: 380 }, loudness: { integrated: -14 } });
  });

  it("refuses an episode without scene images, and an unknown profile", () => {
    expect(buildEditTimeline(dir, { episodeRef: REF })).toMatchObject({ ok: false, problems: [{ code: "no-scenes" }] });
    scenes({ s1: 1 });
    expect(buildEditTimeline(dir, { episodeRef: REF, profile: "square" })).toMatchObject({ ok: false, problems: [{ code: "unknown-profile" }] });
  });

  it("refuses a manifest whose final WAV is missing", () => {
    scenes({ s1: 1 });
    file("artifacts/narration/narration-manifest.json", JSON.stringify({
      schemaVersion: "narration-manifest/v1",
      entries: [{ segmentId: "s1", wav: { path: "artifacts/narration/s1.wav", durationSeconds: 1 } }],
      finalWav: { path: "artifacts/narration/gone.wav" },
    }));
    expect(buildEditTimeline(dir, { episodeRef: REF })).toMatchObject({ ok: false, problems: [{ code: "missing-narration" }] });
  });
});
```

- [ ] **Step 3: Run them and watch them fail**

Run: `cd studio/agent && npx vitest run tests/edit-timeline-builder.test.ts`
Expected: FAIL — `Failed to load url ../src/edit-timeline-builder.js`.

- [ ] **Step 4: Write the builder** — `studio/agent/src/edit-timeline-builder.ts`:

```ts
// ---------------------------------------------------------------------------
// An episode's edit timeline, built from what is on disk (avg-tk7.6)
// ---------------------------------------------------------------------------
// The studio no longer runs FFmpeg to compose an episode. It writes a
// studio.video/v1alpha2 edit timeline — the reviewable account of what the
// render will be — and @av/remotion-composer renders it (ADR-0036).
//
// This builder decides nothing the old FFmpeg path did not already decide:
// the same scene images in the same order for the same lengths, the same
// narration. What it adds is what the compose-video skill always promised:
// captions from the narration manifest, short crossfades between scenes, and
// the loudness and safe zone of an output profile.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { validateTimeline } from "@av/remotion-composer";
import { validateEditTimeline } from "@studio/contracts/src/edit-timeline.mjs";
import { outputProfile } from "@studio/contracts/src/output-profiles.mjs";
import { naturalSegmentOrder, readWavFacts, validateNarrationManifest } from "./narration-manifest.js";
import { resolveSceneFrames } from "./scene-images.js";

export const TIMELINE_FPS = 30;
/** Frames a crossfade between two scenes lasts, centred on their boundary. */
export const CROSSFADE_FRAMES = 12;
export const DEFAULT_PROFILE = "youtube-1920x1080";
/** Where the timeline lives in an episode. */
export const EDIT_TIMELINE_PATH = "artifacts/edit-timeline.json";

const MANIFEST_PATH = "artifacts/narration/narration-manifest.json";
const FULL_NARRATION_PATH = "artifacts/narration/narration-full.wav";
const SCENE_WAV = /^(?:s|scene-?)\d+[a-z]?\.wav$/i;

export interface BuildProblem {
  code: string;
  message: string;
  path?: string;
}

export interface BuildOptions {
  episodeRef: { channel: string; series: string; episode: string };
  /** An output profile id of the contracts' catalog. */
  profile?: string;
}

export type BuildResult =
  | { ok: true; timeline: EditTimelineDoc; warnings: string[] }
  | { ok: false; problems: BuildProblem[] };

/** The timeline as this builder writes it (the contracts own the full type). */
export interface EditTimelineDoc {
  apiVersion: "studio.video/v1alpha2";
  kind: "EditTimeline";
  episodeRef: { channel: string; series: string; episode: string };
  revision: number;
  fps: number;
  durationInFrames: number;
  resolution: { width: number; height: number };
  profile: Record<string, unknown> & { id: string; width: number; height: number };
  assets: Record<string, { path: string; hash: string; kind: "image" | "audio" }>;
  tracks: Array<Record<string, unknown> & { id: string; items: Array<Record<string, unknown>> }>;
  metadata: { builtBy: string; inputs: Record<string, string> };
}

const frames = (seconds: number) => Math.round(seconds * TIMELINE_FPS);

/** One audio file and when it plays, in seconds of the timeline. */
interface AudioSpan {
  id: string;
  path: string;
  startSeconds: number;
  durationSeconds: number;
}

/**
 * Build the edit timeline of an episode.
 *
 * Reads files only; writes nothing. Every file it reads is listed with its
 * hash in `metadata.inputs`, which is how a later render knows whether the
 * timeline still describes the episode.
 */
export function buildEditTimeline(episodeDir: string, options: BuildOptions): BuildResult {
  const profileId = options.profile ?? DEFAULT_PROFILE;
  const profile = outputProfile(profileId);
  if (!profile) {
    return { ok: false, problems: [{ code: "unknown-profile", message: `no output profile "${profileId}"` }] };
  }

  const inputs: Record<string, string> = {};
  const read = (relative: string): Buffer => {
    const bytes = readFileSync(join(episodeDir, relative));
    inputs[relative] = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    return bytes;
  };
  const warnings: string[] = [];

  // ── Scenes ────────────────────────────────────────────────────────────────
  const scenes = resolveSceneFrames(episodeDir);
  if (scenes.length === 0) {
    return { ok: false, problems: [{ code: "no-scenes", message: "no scene images in assets/images (s1.png, s4a.jpg, …)" }] };
  }
  if (existsSync(join(episodeDir, "artifacts/timing.json"))) read("artifacts/timing.json");

  // ── Narration and captions ────────────────────────────────────────────────
  let manifest: Record<string, any> | null = null;
  if (existsSync(join(episodeDir, MANIFEST_PATH))) {
    try {
      manifest = JSON.parse(read(MANIFEST_PATH).toString("utf-8"));
    } catch (error) {
      return { ok: false, problems: [{ code: "bad-manifest", message: `${MANIFEST_PATH} is not JSON: ${(error as Error).message}` }] };
    }
  }
  const manifestProblems = manifest ? validateNarrationManifest(manifest) : [];
  if (manifest && manifestProblems.length > 0) {
    warnings.push(`${MANIFEST_PATH} is not canonical, so the render has no captions: ${manifestProblems.join("; ")}`);
  }

  const audio: AudioSpan[] = [];
  const wavSeconds = (relative: string) => {
    read(relative);
    return readWavFacts(join(episodeDir, relative), relative).durationSeconds;
  };
  const finalWav = manifest?.finalWav?.path;
  if (typeof finalWav === "string" && finalWav.length > 0) {
    if (!existsSync(join(episodeDir, finalWav))) {
      return { ok: false, problems: [{ code: "missing-narration", message: `the manifest's final WAV is missing: ${finalWav}` }] };
    }
    audio.push({ id: "narration", path: finalWav, startSeconds: 0, durationSeconds: wavSeconds(finalWav) });
  } else if (existsSync(join(episodeDir, FULL_NARRATION_PATH))) {
    audio.push({ id: "narration", path: FULL_NARRATION_PATH, startSeconds: 0, durationSeconds: wavSeconds(FULL_NARRATION_PATH) });
  } else if (manifest && manifestProblems.length === 0) {
    // A manifest of segments with no assembled final: play its entries in
    // order, each followed by its pause, after the lead-in silence.
    let cursor = Number(manifest.leadInSilenceSeconds) || 0;
    for (const entry of manifest.entries as Array<Record<string, any>>) {
      const path = String(entry.wav.path);
      const seconds = wavSeconds(path);
      audio.push({ id: `narration-${entry.segmentId}`, path, startSeconds: cursor, durationSeconds: seconds });
      cursor += seconds + (Number(entry.pauseAfterMs) || 0) / 1000;
    }
  } else {
    const narrationDir = join(episodeDir, "artifacts", "narration");
    const files = existsSync(narrationDir)
      ? readdirSync(narrationDir).filter((f) => SCENE_WAV.test(f))
        .sort((a, b) => naturalSegmentOrder(a.replace(/\.wav$/i, ""), b.replace(/\.wav$/i, "")))
      : [];
    if (files.length > 0) {
      warnings.push("DEPRECATED: narration taken from scene WAV filenames; write narration-manifest.json");
      let cursor = 0;
      for (const file of files) {
        const path = `artifacts/narration/${file}`;
        const seconds = wavSeconds(path);
        audio.push({ id: `narration-${file.replace(/\.wav$/i, "")}`, path, startSeconds: cursor, durationSeconds: seconds });
        cursor += seconds;
      }
    }
  }

  // ── Frames ────────────────────────────────────────────────────────────────
  // Absolute times are rounded, never a start and a length separately, so
  // scenes that touch in seconds still touch in frames.
  const bounds: number[] = [0];
  let seconds = 0;
  for (const scene of scenes) {
    seconds += scene.durationSeconds;
    bounds.push(frames(seconds));
  }
  const audioEnd = Math.max(0, ...audio.map((a) => frames(a.startSeconds + a.durationSeconds)));
  const durationInFrames = Math.max(bounds[bounds.length - 1]!, audioEnd, 1);
  bounds[bounds.length - 1] = durationInFrames; // the last scene holds to the end

  // ── Assets and tracks ─────────────────────────────────────────────────────
  const assets: EditTimelineDoc["assets"] = {};
  const half = CROSSFADE_FRAMES / 2;
  const length = (i: number) => bounds[i + 1]! - bounds[i]!;
  const fades = (i: number) => i > 0 && length(i - 1) > CROSSFADE_FRAMES && length(i) > CROSSFADE_FRAMES;

  const sceneItems = scenes.map((scene, i) => {
    const path = `assets/images/${scene.file}`;
    read(path);
    const asset = `scene-${scene.id}`;
    assets[asset] = { path, hash: inputs[path]!, kind: "image" };
    const from = bounds[i]! - (fades(i) ? half : 0);
    const end = bounds[i + 1]! + (i + 1 < scenes.length && fades(i + 1) ? half : 0);
    return {
      id: asset,
      from,
      duration: end - from,
      kit: { name: "still", version: "1.0.0" },
      props: { src: { $asset: asset }, fit: "contain" },
      ...(fades(i) ? { transitionIn: { type: "crossfade", duration: CROSSFADE_FRAMES } } : {}),
    };
  });

  const tracks: EditTimelineDoc["tracks"] = [{ id: "scenes", type: "visual", z: 0, items: sceneItems }];

  const captions = manifest && manifestProblems.length === 0 && Array.isArray(manifest.captions) ? manifest.captions : [];
  const captionItems = (captions as Array<Record<string, any>>)
    .filter((c) => typeof c.text === "string" && c.text.trim() && Number(c.endSeconds) > Number(c.startSeconds))
    .map((c, i) => {
      const from = Math.min(frames(Number(c.startSeconds)), durationInFrames - 1);
      const end = Math.min(Math.max(frames(Number(c.endSeconds)), from + 1), durationInFrames);
      return {
        id: `caption-${i + 1}`,
        from,
        duration: end - from,
        kit: { name: "captions", version: "1.1.0" },
        props: { text: String(c.text).trim(), position: "bottom" },
      };
    });
  if (captionItems.length > 0) tracks.push({ id: "captions", type: "visual", z: 10, items: captionItems });

  if (audio.length > 0) {
    tracks.push({
      id: "voice",
      type: "audio",
      items: audio.map((a) => {
        assets[a.id] = { path: a.path, hash: inputs[a.path]!, kind: "audio" };
        const from = frames(a.startSeconds);
        return { id: a.id, from, duration: Math.max(1, frames(a.startSeconds + a.durationSeconds) - from), asset: a.id };
      }),
    });
  }

  const timeline: EditTimelineDoc = {
    apiVersion: "studio.video/v1alpha2",
    kind: "EditTimeline",
    episodeRef: options.episodeRef,
    revision: 1,
    fps: TIMELINE_FPS,
    durationInFrames,
    resolution: { width: profile.width, height: profile.height },
    profile: structuredClone(profile) as unknown as EditTimelineDoc["profile"],
    assets,
    tracks,
    metadata: { builtBy: "studio/agent buildEditTimeline", inputs: Object.fromEntries(Object.entries(inputs).sort()) },
  };

  const problems: BuildProblem[] = [...validateEditTimeline(timeline)];
  if (problems.length === 0) {
    const composer = validateTimeline(timeline);
    if (!composer.ok) problems.push(...composer.problems);
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, timeline, warnings };
}
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `cd studio/agent && npx vitest run tests/edit-timeline-builder.test.ts && npm run typecheck`
Expected: 10 tests pass; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add studio/agent/src/edit-timeline-builder.ts studio/agent/tests/edit-timeline-builder.test.ts studio/agent/package.json bun.lock tools/build-required.mjs
git commit -m "feat(agent): build an episode's edit timeline from its material (avg-tk7.6)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Render through the timeline; delete the FFmpeg composer

**Files:**
- Create: `studio/agent/src/episode-render.ts`
- Modify: `studio/agent/src/capability-tools.ts`, `studio/agent/src/scene-images.ts`, `studio/agent/src/slash-commands.ts`, `studio/agent/tests/compose-video.test.ts` (rewritten), `studio/agent/tests/scene-images.test.ts`, `studio/agent/tests/extension.test.ts`, `studio/agent/tests/e2e-scenarios.test.ts`

**Interfaces:**
- Consumes: Task 1's `buildEditTimeline`, `DEFAULT_PROFILE`, `EDIT_TIMELINE_PATH`, `BuildOptions`, `BuildProblem`, `EditTimelineDoc`; `renderTimeline`, `RenderResult`, `ComposerError` (`@av/remotion-composer`).
- Produces: `writeEditTimeline(episodeDir, options) → {timeline, hash, warnings}`; `currentEditTimeline(episodeDir, options) → {timeline, hash, warnings, rebuilt: string | null}`; `renderEpisode(episodeDir, {episodeRef, profile?, label?, onProgress?}) → Promise<{renderId, outputPath, reportPath, rebuilt, warnings, result}>`; `TimelineBuildError` (`problems`). Tools `pva_build_timeline {channel, series, episode, profile?}` and `pva_compose_video {channel, series, episode, profile?, label?}`.

- [ ] **Step 1: Write the tool tests** — replace `studio/agent/tests/compose-video.test.ts` with:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * pva_build_timeline and pva_compose_video (avg-tk7.6, ADR-0036). The render
 * itself is @av/remotion-composer's and has its own tests; here it is a fake
 * that writes a small file, or fails when asked, so these tests pin what the
 * studio decides: which timeline is rendered, and where the render goes.
 * Real renders are in compose-video.e2e.test.ts.
 */

const renders: Array<{ timeline: any; outputPath: string }> = [];
let failNext: Error | null = null;

vi.mock("@av/remotion-composer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@av/remotion-composer")>();
  return {
    ...actual,
    renderTimeline: async (options: { timeline: any; outputPath: string }) => {
      renders.push({ timeline: options.timeline, outputPath: options.outputPath });
      mkdirSync(dirname(options.outputPath), { recursive: true });
      writeFileSync(options.outputPath, "fake mp4");
      if (failNext) {
        const error = failNext;
        failNext = null;
        throw error;
      }
      return {
        path: options.outputPath,
        durationSeconds: options.timeline.durationInFrames / options.timeline.fps,
        sizeBytes: 8,
        hash: `sha256:${"0".repeat(64)}`,
        kits: [{ name: "still", version: "1.0.0" }],
        profile: options.timeline.profile.id,
        loudness: null,
      };
    },
  };
});

const CHANNEL = "video-storici";
const SERIES = "roma-pills";
const EPISODE = "giulio-cesare";

let root: string;
let previousRoot: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pva-compose-"));
  previousRoot = process.env.AVG_LIBRARY_ROOT;
  process.env.AVG_LIBRARY_ROOT = root;
  renders.length = 0;
  failNext = null;
});

afterEach(() => {
  if (previousRoot === undefined) delete process.env.AVG_LIBRARY_ROOT;
  else process.env.AVG_LIBRARY_ROOT = previousRoot;
  rmSync(root, { recursive: true, force: true });
});

const episodeDir = () => join(root, CHANNEL, "series", SERIES, "episodes", EPISODE);
const at = (relative: string) => join(episodeDir(), relative);

function file(relative: string, content: string): void {
  mkdirSync(dirname(at(relative)), { recursive: true });
  writeFileSync(at(relative), content);
}

function episode(): void {
  file("assets/images/s1.png", "red");
  file("assets/images/s2.png", "blue");
  file("artifacts/timing.json", JSON.stringify({ scenes: [{ sceneId: "s1", durationSeconds: 2 }, { sceneId: "s2", durationSeconds: 3 }] }));
}

async function tool(name: string, params: Record<string, unknown> = {}) {
  const { registerCapabilityTools } = await import("../src/capability-tools.js");
  const tools = new Map<string, { execute: (...a: unknown[]) => Promise<any> }>();
  registerCapabilityTools({ registerTool: (t: { name: string }) => tools.set(t.name, t as never) } as never);
  return tools.get(name)!.execute("call-1", { channel: CHANNEL, series: SERIES, episode: EPISODE, ...params }, undefined, undefined, undefined);
}

const readJson = (relative: string) => JSON.parse(readFileSync(at(relative), "utf-8"));
const sha256 = (relative: string) => `sha256:${createHash("sha256").update(readFileSync(at(relative))).digest("hex")}`;

describe("pva_build_timeline", () => {
  it("writes the episode's edit timeline and says what is in it", async () => {
    episode();
    const result = await tool("pva_build_timeline");
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toMatch(/artifacts\/edit-timeline\.json: 2 scenes, 0 captions, 5\.0s, youtube-1920x1080/);
    expect(readJson("artifacts/edit-timeline.json")).toMatchObject({ apiVersion: "studio.video/v1alpha2", durationInFrames: 150 });
    expect(readdirSync(at("artifacts")).filter((f) => f.includes(".tmp"))).toEqual([]);
  });

  it("says what is wrong instead of writing a timeline", async () => {
    file("assets/images/opening-shot.png", "red");
    const result = await tool("pva_build_timeline");
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/no-scenes/);
    expect(existsSync(at("artifacts/edit-timeline.json"))).toBe(false);
  });
});

describe("pva_compose_video", () => {
  it("builds a missing timeline, renders it to output/<render-id>.mp4 with a report, and moves current.json last", async () => {
    episode();
    const result = await tool("pva_compose_video");
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toMatch(/timeline rebuilt: there was no timeline yet/);

    const current = readJson("output/current.json");
    expect(current.renderId).toMatch(/^render-\d+-[a-f0-9]{8}$/);
    expect(current.path).toBe(`${current.renderId}.mp4`);
    expect(existsSync(at(`output/${current.path}`))).toBe(true);
    const report = readJson(`output/${current.renderId}.report.json`);
    expect(report.timeline).toEqual({ path: "artifacts/edit-timeline.json", hash: sha256("artifacts/edit-timeline.json") });
    expect(report.render).toMatchObject({ path: current.path, profile: "youtube-1920x1080" });
    expect(current.renderId.endsWith(report.timeline.hash.slice(7, 15))).toBe(true);
    expect(readdirSync(at("output")).filter((f) => f.includes("partial"))).toEqual([]);
  });

  it("renders the timeline as it stands when nothing changed", async () => {
    episode();
    await tool("pva_build_timeline");
    const before = sha256("artifacts/edit-timeline.json");
    const result = await tool("pva_compose_video");
    expect(result.content[0].text).toMatch(/rendered artifacts\/edit-timeline\.json as it stands/);
    expect(sha256("artifacts/edit-timeline.json")).toBe(before);
  });

  it("renders a hand-edited timeline without overwriting it", async () => {
    episode();
    await tool("pva_build_timeline");
    const edited = readJson("artifacts/edit-timeline.json");
    edited.tracks[0].items[0].props.fit = "cover";
    writeFileSync(at("artifacts/edit-timeline.json"), JSON.stringify(edited));
    await tool("pva_compose_video");
    expect(renders[0]!.timeline.tracks[0].items[0].props.fit).toBe("cover");
    expect(readJson("artifacts/edit-timeline.json").tracks[0].items[0].props.fit).toBe("cover");
  });

  it("rebuilds when the episode's material changed, and names what changed", async () => {
    episode();
    await tool("pva_build_timeline");
    file("assets/images/s2.png", "green");
    file("assets/images/s3.png", "white");
    const result = await tool("pva_compose_video");
    expect(result.content[0].text).toMatch(/timeline rebuilt: assets\/images\/s2\.png changed, assets\/images\/s3\.png added/);
    expect(renders[0]!.timeline.tracks[0].items).toHaveLength(3);
  });

  it("rebuilds for another profile, and keeps the timeline's profile when none is asked for", async () => {
    episode();
    await tool("pva_build_timeline");
    const vertical = await tool("pva_compose_video", { profile: "vertical-1080x1920" });
    expect(vertical.content[0].text).toMatch(/the profile changed from youtube-1920x1080 to vertical-1080x1920/);
    expect(renders[0]!.timeline.resolution).toEqual({ width: 1080, height: 1920 });
    file("assets/images/s2.png", "green");
    await tool("pva_compose_video");
    expect(renders[1]!.timeline.profile.id).toBe("vertical-1080x1920");
  });

  it("leaves output/ and current.json as they were when the render fails, and passes the composer's code on", async () => {
    episode();
    await tool("pva_compose_video", { label: "first" });
    const current = readFileSync(at("output/current.json"), "utf-8");
    const filesBefore = readdirSync(at("output")).sort();

    const { ComposerError } = await import("@av/remotion-composer");
    failNext = new ComposerError("render-failed", "Remotion could not render the timeline: boom");
    const result = await tool("pva_compose_video", { label: "second" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/^❌ render-failed: Remotion could not render the timeline: boom/);
    expect(readFileSync(at("output/current.json"), "utf-8")).toBe(current);
    expect(readdirSync(at("output")).sort()).toEqual(filesBefore);
  });

  it("refuses a label that is not kebab-case, before rendering", async () => {
    episode();
    const result = await tool("pva_compose_video", { label: "Final Cut" });
    expect(result.isError).toBe(true);
    expect(renders).toHaveLength(0);
  });

  it("refuses an episode without scene images and lists why", async () => {
    file("assets/images/opening-shot.png", "red");
    const result = await tool("pva_compose_video");
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/no-scenes/);
    expect(existsSync(at("output"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd studio/agent && npx vitest run tests/compose-video.test.ts`
Expected: FAIL — `pva_build_timeline` is not registered (`Cannot read properties of undefined (reading 'execute')`), and the `pva_compose_video` tests find no `output/current.json`.

- [ ] **Step 3: Write `studio/agent/src/episode-render.ts`**

```ts
// ---------------------------------------------------------------------------
// Rendering an episode through its edit timeline (avg-tk7.6, ADR-0036)
// ---------------------------------------------------------------------------
// `artifacts/edit-timeline.json` is the reviewable account of a render. It is
// rebuilt from the episode's material when that material changed, and is
// otherwise rendered exactly as it stands — a hand edit, on the web or on
// disk, is never overwritten. Renders are immutable: output/<render-id>.mp4
// with a sibling report, and output/current.json moved last.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { renderTimeline, type RenderResult } from "@av/remotion-composer";
import {
  buildEditTimeline,
  DEFAULT_PROFILE,
  EDIT_TIMELINE_PATH,
  type BuildOptions,
  type BuildProblem,
  type EditTimelineDoc,
} from "./edit-timeline-builder.js";

const LABEL = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The builder refused the episode; `problems` say why. */
export class TimelineBuildError extends Error {
  constructor(readonly problems: BuildProblem[]) {
    super(`the edit timeline cannot be built: ${problems.map((p) => `${p.code}${p.path ? ` at ${p.path}` : ""}: ${p.message}`).join("; ")}`);
    this.name = "TimelineBuildError";
  }
}

const sha256 = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const serialize = (timeline: unknown) => `${JSON.stringify(timeline, null, 2)}\n`;

/** Write through a temporary file, so no reader ever sees half a document. */
function writeAtomically(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, text, "utf-8");
  renameSync(temp, path);
}

export interface WrittenTimeline {
  timeline: EditTimelineDoc;
  /** sha256 hex of the file as written. */
  hash: string;
  warnings: string[];
}

/** Build the timeline and write it to artifacts/edit-timeline.json. */
export function writeEditTimeline(episodeDir: string, options: BuildOptions): WrittenTimeline {
  const built = buildEditTimeline(episodeDir, options);
  if (!built.ok) throw new TimelineBuildError(built.problems);
  const text = serialize(built.timeline);
  writeAtomically(join(episodeDir, EDIT_TIMELINE_PATH), text);
  return { timeline: built.timeline, hash: sha256(text), warnings: built.warnings };
}

export interface CurrentTimeline extends WrittenTimeline {
  /** Why it was rebuilt, or null when the timeline on disk was used as it is. */
  rebuilt: string | null;
}

/**
 * The timeline to render: the one on disk when it still describes the
 * episode's material and the profile asked for, otherwise a fresh one.
 */
export function currentEditTimeline(episodeDir: string, options: BuildOptions): CurrentTimeline {
  const path = join(episodeDir, EDIT_TIMELINE_PATH);
  let stored: { text: string; doc: any } | null = null;
  let unreadable: string | null = null;
  if (existsSync(path)) {
    const text = readFileSync(path, "utf-8");
    try {
      stored = { text, doc: JSON.parse(text) };
    } catch (error) {
      unreadable = `${EDIT_TIMELINE_PATH} is not JSON (${(error as Error).message})`;
    }
  }

  const profile = options.profile ?? stored?.doc?.profile?.id ?? DEFAULT_PROFILE;
  const fresh = buildEditTimeline(episodeDir, { ...options, profile });
  if (!fresh.ok) throw new TimelineBuildError(fresh.problems);

  let reason: string | null = unreadable;
  if (!stored && !reason) reason = "there was no timeline yet";
  if (stored && !reason && stored.doc?.profile?.id !== profile) {
    reason = `the profile changed from ${stored.doc?.profile?.id ?? "none"} to ${profile}`;
  }
  if (stored && !reason) {
    const before: Record<string, string> = stored.doc?.metadata?.inputs ?? {};
    const after = fresh.timeline.metadata.inputs;
    const changes = [
      ...Object.keys(after).filter((p) => p in before && before[p] !== after[p]).map((p) => `${p} changed`),
      ...Object.keys(after).filter((p) => !(p in before)).map((p) => `${p} added`),
      ...Object.keys(before).filter((p) => !(p in after)).map((p) => `${p} removed`),
    ];
    if (changes.length > 0) reason = changes.join(", ");
  }

  if (reason === null && stored) {
    return { timeline: stored.doc, hash: sha256(stored.text), warnings: fresh.warnings, rebuilt: null };
  }
  const text = serialize(fresh.timeline);
  writeAtomically(path, text);
  return { timeline: fresh.timeline, hash: sha256(text), warnings: fresh.warnings, rebuilt: reason };
}

export interface EpisodeRenderOptions extends BuildOptions {
  /** Lowercase kebab-case; the render id starts with it. */
  label?: string;
  onProgress?: (progress: number) => void;
}

export interface EpisodeRender {
  renderId: string;
  outputPath: string;
  reportPath: string;
  rebuilt: string | null;
  warnings: string[];
  result: RenderResult;
}

/**
 * Render the episode's current timeline to output/<render-id>.mp4.
 *
 * The video is written beside its final name and renamed when complete; the
 * report follows; output/current.json moves last. A failure leaves output/
 * as it was. The caller serialises renders of one episode (current.json).
 */
export async function renderEpisode(episodeDir: string, options: EpisodeRenderOptions): Promise<EpisodeRender> {
  const label = options.label ?? "render";
  if (!LABEL.test(label)) throw new Error(`label "${label}" must be lowercase kebab-case`);
  const current = currentEditTimeline(episodeDir, options);

  const outputDir = join(episodeDir, "output");
  mkdirSync(outputDir, { recursive: true });
  const renderId = `${label}-${Date.now()}-${current.hash.slice(0, 8)}`;
  const outputPath = join(outputDir, `${renderId}.mp4`);
  const partialPath = join(outputDir, `.${renderId}.partial.mp4`);
  const reportPath = join(outputDir, `${renderId}.report.json`);

  let result: RenderResult;
  try {
    result = await renderTimeline({
      timeline: current.timeline,
      assetRoot: episodeDir,
      outputPath: partialPath,
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    });
    renameSync(partialPath, outputPath);
  } catch (error) {
    rmSync(partialPath, { force: true });
    throw error;
  }
  result = { ...result, path: outputPath };

  writeAtomically(reportPath, serialize({
    renderId,
    createdAt: new Date().toISOString(),
    timeline: { path: EDIT_TIMELINE_PATH, hash: `sha256:${current.hash}` },
    ...(current.rebuilt ? { rebuilt: current.rebuilt } : {}),
    ...(current.warnings.length > 0 ? { warnings: current.warnings } : {}),
    render: { ...result, path: `${renderId}.mp4` },
  }));
  writeAtomically(join(outputDir, "current.json"), serialize({ renderId, path: `${renderId}.mp4` }));

  return { renderId, outputPath, reportPath, rebuilt: current.rebuilt, warnings: current.warnings, result };
}
```

- [ ] **Step 4: Delete `composeEpisodeVideo` and register the two tools**

```diff
@@ -39,13 +39,13 @@ import {
   assembleNarrationSegments,
   buildNarrationManifest,
   findFinalWav,
-  naturalSegmentOrder,
   silenceFromLegacyManifest,
   validateNarrationManifest,
   writeNarrationManifest,
   type NarrationSegmentInput,
 } from "./narration-manifest.js";
-import { concatScript, resolveSceneFrames } from "./scene-images.js";
+import { EDIT_TIMELINE_PATH } from "./edit-timeline-builder.js";
+import { renderEpisode, writeEditTimeline } from "./episode-render.js";
 
 // ── Inline fal client (avoids dynamic import complexity in Pi) ──────────────
 
@@ -196,7 +196,7 @@ async function synthesizeSpeech(text: string, voice: string, speed: number, inst
   return { audioPath: body.result.wav_path, durationSec: body.result.duration_sec };
 }
 
-// ── FFmpeg composition ─────────────────────────────────────────────────────
+// ── Narration ──────────────────────────────────────────────────────────────
 
 export function canonicalNarrationPath(episodeDir: string): string | null {
   const manifestPath = join(episodeDir, "artifacts", "narration", "narration-manifest.json");
@@ -224,131 +224,6 @@ export function canonicalNarrationPath(episodeDir: string): string | null {
   return resolved;
 }
 
-async function composeEpisodeVideo(
-  episodeDir: string,
-  outputPath: string,
-): Promise<{ outputPath: string; durationSec: number; fileSize: number }> {
-  const { execSync } = await import("node:child_process");
-  const scenesDir = join(episodeDir, "assets", "images");
-  let narrationFile = join(episodeDir, "artifacts", "narration", "narration-full.wav");
-  const narrationManifestPath = join(episodeDir, "artifacts", "narration", "narration-manifest.json");
-  narrationFile = canonicalNarrationPath(episodeDir) ?? narrationFile;
-
-  const { execSync: es } = await import("node:child_process");
-
-  // The scenes to render, each with the time it is on screen. Selecting them
-  // used to be `filter(f => f.match(/^s\d+\.jpg$/)).sort()`, which found no
-  // images at all in an episode drawn as PNG, dropped any scene numbered `s4a`,
-  // and ordered `s10` between `s1` and `s2`.
-  const frames = resolveSceneFrames(episodeDir);
-  if (frames.length === 0) {
-    const present = existsSync(scenesDir)
-      ? (await import("node:fs")).readdirSync(scenesDir).length
-      : 0;
-    throw new Error(
-      present > 0
-        ? `No scene images found in assets/images: ${present} file(s) are there, but none are named like a scene (s1.png, s4a.jpg, …)`
-        : "No scene images found in assets/images",
-    );
-  }
-
-  // Concatenate scene narration files if present
-  const narrationDir = join(episodeDir, "artifacts", "narration");
-  if (!existsSync(narrationManifestPath) && existsSync(narrationDir) && !existsSync(narrationFile)) {
-    console.warn("DEPRECATED: composing narration by scene WAV filenames; write narration-manifest.json");
-    // Same defect as the images: `^s\d+\.wav$` silently drops the narration for
-    // a scene numbered `s4a`, leaving the audio shorter than the picture.
-    const wavFiles = (await import("node:fs")).readdirSync(narrationDir)
-      .filter(f => /^(?:s|scene-?)\d+[a-z]?\.wav$/i.test(f))
-      .sort((a, b) => naturalSegmentOrder(a.replace(/\.wav$/i, ""), b.replace(/\.wav$/i, "")));
-    if (wavFiles.length > 0) {
-      const concatList = join(episodeDir, "artifacts", "narration", "concat.txt");
-      const listContent = wavFiles.map(f => `file '${join(narrationDir, f)}'`).join("\n");
-      (await import("node:fs")).writeFileSync(concatList, listContent);
-      es(`ffmpeg -y -f concat -safe 0 -i "${concatList}" -c copy "${narrationFile}" 2>/dev/null`);
-    }
-  }
-
-  // Normalise every scene to one frame size, whatever it was drawn at.
-  const frameDir = join(episodeDir, "artifacts", "frames");
-  mkdirSync(frameDir, { recursive: true });
-
-  // Run through spawnSync rather than a shell string: these paths come from
-  // the episode directory, and a filename holding a quote would otherwise be
-  // pasted straight into a command line.
-  const ffmpeg = (args: string[]): void => {
-    const result = spawnSync("ffmpeg", args, { encoding: "utf-8" });
-    if (result.status !== 0) {
-      throw new Error(`FFmpeg failed: ${(result.stderr || result.stdout || "").trim().slice(-800)}`);
-    }
-  };
-
-  const normalized: Array<{ path: string; durationSeconds: number }> = [];
-  for (const [index, frame] of frames.entries()) {
-    const src = join(scenesDir, frame.file);
-    const dst = join(frameDir, `frame${String(index + 1).padStart(3, "0")}.png`);
-    if (!existsSync(dst)) {
-      ffmpeg([
-        "-y", "-i", src,
-        "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2",
-        "-frames:v", "1", dst,
-      ]);
-    }
-    normalized.push({ path: dst, durationSeconds: frame.durationSeconds });
-  }
-
-  // A concat script rather than a fixed framerate: `-framerate 1/10` holds
-  // every scene for ten seconds whatever its narration says, so the picture
-  // and the audio drift apart and `-shortest` amputates whichever ends first.
-  const concatPath = join(frameDir, "frames.concat.txt");
-  (await import("node:fs")).writeFileSync(concatPath, concatScript(normalized));
-
-  const args = [
-    "-y",
-    "-f", "concat",
-    "-safe", "0",
-    "-i", concatPath,
-  ];
-
-  // The concat script repeats its final entry so the closing scene is not one
-  // frame long, and that repeat is then held for a further beat of its own.
-  // Capping the output at the scenes' own total trims it back off.
-  const sceneTotalSeconds = normalized.reduce((total, f) => total + f.durationSeconds, 0);
-
-  if (existsSync(narrationFile)) {
-    args.push("-i", narrationFile);
-  }
-
-  args.push(
-    "-t", sceneTotalSeconds.toFixed(6),
-    "-vf", "fps=30,format=yuv420p",
-    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
-    "-pix_fmt", "yuv420p", "-movflags", "+faststart",
-  );
-
-  if (existsSync(narrationFile)) {
-    args.push("-c:a", "aac", "-b:a", "128k", "-shortest");
-  }
-
-  args.push(outputPath);
-  ffmpeg(args);
-
-  // Probe duration
-  const probeOut = es(
-    `ffprobe -v quiet -show_entries format=duration,size -of default=noprint_wrappers=1 "${outputPath}"`,
-    { encoding: "utf-8" },
-  ).toString();
-  const durMatch = probeOut.match(/duration=([\d.]+)/);
-  const sizeMatch = probeOut.match(/size=(\d+)/);
-  const fileSize = existsSync(outputPath) ? (await import("node:fs")).statSync(outputPath).size : 0;
-
-  return {
-    outputPath,
-    durationSec: durMatch ? parseFloat(durMatch[1]!) : 0,
-    fileSize,
-  };
-}
-
 // ── Tools ───────────────────────────────────────────────────────────────────
 
 export function registerCapabilityTools(pi: ExtensionAPI): void {
@@ -1011,35 +886,82 @@ export function registerCapabilityTools(pi: ExtensionAPI): void {
     },
   });
 
-  // --- Tool: pva_compose_video (via FFmpeg) -------------------------------
+  // --- Tools: pva_build_timeline and pva_compose_video (ADR-0036) ---------
+  // The episode is composed through its edit timeline: a reviewable document
+  // in artifacts/, rendered by @av/remotion-composer. No FFmpeg runs here.
+
+  const profileParam = Type.Optional(Type.String({
+    description: "Output profile id: youtube-1920x1080 (default) or vertical-1080x1920",
+  }));
 
   pi.registerTool({
-    name: "pva_compose_video",
-    label: "Compose Video",
-    description: "Compose the final MP4 from scene images and narration audio using FFmpeg.",
+    name: "pva_build_timeline",
+    label: "Build Edit Timeline",
+    description: `Build the episode's edit timeline (${EDIT_TIMELINE_PATH}) from its scene images, timing and narration: the reviewable account of what pva_compose_video will render.`,
     parameters: Type.Object({
       channel: Type.String({ description: "Channel slug" }),
       series: Type.String({ description: "Series slug" }),
       episode: Type.String({ description: "Episode slug" }),
-      outputName: Type.Optional(Type.String({ default: "final.mp4", description: "Output filename" })),
+      profile: profileParam,
     }),
-    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
+    async execute(_toolCallId, params) {
       try {
         const dir = episodeDir(params.channel, params.series, params.episode);
-        const outPath = join(dir, "artifacts", params.outputName ?? "final.mp4");
-        mkdirSync(join(dir, "artifacts"), { recursive: true });
-
-        const result = await composeEpisodeVideo(dir, outPath);
-
-        const mb = (result.fileSize / 1024 / 1024).toFixed(1);
+        const episodeRef = { channel: params.channel, series: params.series, episode: params.episode };
+        const { timeline, warnings } = writeEditTimeline(dir, { episodeRef, ...(params.profile ? { profile: params.profile } : {}) });
+        const count = (id: string) => timeline.tracks.find((t) => t.id === id)?.items.length ?? 0;
+        const lines = [
+          `✅ ${EDIT_TIMELINE_PATH}: ${count("scenes")} scenes, ${count("captions")} captions, `
+            + `${(timeline.durationInFrames / timeline.fps).toFixed(1)}s, ${timeline.profile.id}`,
+          ...warnings.map((w) => `⚠️ ${w}`),
+        ];
+        return { content: [{ type: "text" as const, text: lines.join("\n") }], details: { path: EDIT_TIMELINE_PATH, timeline, warnings } as Record<string, unknown> };
+      } catch (err) {
         return {
-          content: [{ type: "text" as const, text: `✅ ${params.outputName ?? "final.mp4"} — ${result.durationSec.toFixed(1)}s, ${mb}MB` }],
-          details: result,
+          content: [{ type: "text" as const, text: `❌ Failed: ${err instanceof Error ? err.message : String(err)}` }],
+          details: {} as Record<string, unknown>,
+          isError: true as unknown as boolean,
         };
+      }
+    },
+  });
+
+  pi.registerTool({
+    name: "pva_compose_video",
+    label: "Compose Video",
+    description: `Render the episode's edit timeline (${EDIT_TIMELINE_PATH}) with Remotion to output/<render-id>.mp4 and move output/current.json. Rebuilds the timeline first when it is missing, when the episode's material changed, or when another profile is asked for; otherwise renders it as it stands, hand edits included.`,
+    parameters: Type.Object({
+      channel: Type.String({ description: "Channel slug" }),
+      series: Type.String({ description: "Series slug" }),
+      episode: Type.String({ description: "Episode slug" }),
+      profile: profileParam,
+      label: Type.Optional(Type.String({ default: "render", description: "Lowercase kebab-case render label" })),
+    }),
+    async execute(_toolCallId, params, signal) {
+      const dir = episodeDir(params.channel, params.series, params.episode);
+      const episodeRef = { channel: params.channel, series: params.series, episode: params.episode };
+      try {
+        return await withFileMutationQueue(join(dir, "output", "current.json"), async () => {
+          if (signal?.aborted) throw new Error("cancelled");
+          const render = await renderEpisode(dir, {
+            episodeRef,
+            ...(params.profile ? { profile: params.profile } : {}),
+            ...(params.label ? { label: params.label } : {}),
+          });
+          const mb = (render.result.sizeBytes / 1024 / 1024).toFixed(1);
+          const lines = [
+            `✅ output/${render.renderId}.mp4 — ${render.result.durationSeconds.toFixed(1)}s, ${mb}MB, ${render.result.profile}`,
+            ...(render.rebuilt ? [`timeline rebuilt: ${render.rebuilt}`] : [`rendered ${EDIT_TIMELINE_PATH} as it stands`]),
+            ...render.warnings.map((w) => `⚠️ ${w}`),
+          ];
+          return { content: [{ type: "text" as const, text: lines.join("\n") }], details: render as unknown as Record<string, unknown> };
+        });
       } catch (err) {
+        const e = err as { message?: string; code?: string; problems?: Array<{ code: string; message: string; path?: string }> };
+        const problems = (e.problems ?? []).map((p) => `  - ${p.code}${p.path ? ` at ${p.path}` : ""}: ${p.message}`);
         return {
-          content: [{ type: "text" as const, text: `❌ Failed: ${err instanceof Error ? err.message : String(err)}` }],
-          details: {},
+          content: [{ type: "text" as const, text: [`❌ ${e.code ? `${e.code}: ` : ""}${e.message ?? String(err)}`, ...problems].join("\n") }],
+          details: { code: e.code ?? null, problems: e.problems ?? [] } as Record<string, unknown>,
           isError: true as unknown as boolean,
         };
       }
```

- [ ] **Step 5: Remove `concatScript` and its tests**

```diff
@@ -129,24 +129,3 @@ export function resolveSceneFrames(episodeDir: string): SceneFrame[] {
     };
   });
 }
-
-/**
- * An ffmpeg concat demuxer script holding each frame for its own duration.
- *
- * The final entry is repeated without a duration: the demuxer applies a
- * `duration` to the transition into the *next* entry, so the last image is
- * dropped to a single frame without it.
- */
-export function concatScript(frames: Array<{ path: string; durationSeconds: number }>): string {
-  if (frames.length === 0) throw new Error("No frames to concatenate");
-  const lines: string[] = [];
-  for (const frame of frames) {
-    // Single quotes are the demuxer's own escaping; a path containing one would
-    // otherwise end the argument early.
-    const quoted = frame.path.replace(/'/g, "'\\''");
-    lines.push(`file '${quoted}'`);
-    lines.push(`duration ${frame.durationSeconds.toFixed(6)}`);
-  }
-  lines.push(`file '${frames[frames.length - 1]!.path.replace(/'/g, "'\\''")}'`);
-  return `${lines.join("\n")}\n`;
-}
```

```diff
@@ -5,7 +5,6 @@ import { join } from "node:path";
 import {
   listSceneImages,
   resolveSceneFrames,
-  concatScript,
   DEFAULT_SCENE_SECONDS,
 } from "../src/scene-images.js";
 
@@ -133,31 +132,4 @@ describe("scene images", () => {
         .toEqual([4, DEFAULT_SCENE_SECONDS]);
     });
   });
-
-  describe("concat script", () => {
-    it("repeats the final entry so the last scene is not one frame long", () => {
-      // The demuxer applies `duration` to the transition into the next entry,
-      // so without a repeat the closing image flashes past.
-      const script = concatScript([
-        { path: "/e/frame001.png", durationSeconds: 2 },
-        { path: "/e/frame002.png", durationSeconds: 3 },
-      ]);
-      expect(script.trimEnd().split("\n")).toEqual([
-        "file '/e/frame001.png'",
-        "duration 2.000000",
-        "file '/e/frame002.png'",
-        "duration 3.000000",
-        "file '/e/frame002.png'",
-      ]);
-    });
-
-    it("escapes a quote in a path instead of ending the argument early", () => {
-      const script = concatScript([{ path: "/e/it's.png", durationSeconds: 1 }]);
-      expect(script).toContain("file '/e/it'\\''s.png'");
-    });
-
-    it("refuses to build an empty script", () => {
-      expect(() => concatScript([])).toThrow("No frames");
-    });
-  });
 });
```

- [ ] **Step 6: The tool lists and the `/render` prompt**

```diff
@@ -129,13 +129,14 @@ describe("extensions/index.ts — tool registration", () => {
   });
 
   it("registers the expected suite of production tools", () => {
-    expect(mockPi.tools.length).toBe(42);
+    expect(mockPi.tools.length).toBe(43);
     const names = mockPi.tools.map((t) => t.name).sort();
     expect(names).toEqual([
       "pva_blender_create_scene",
       "pva_blender_probe",
       "pva_blender_render",
       "pva_budget_status",
+      "pva_build_timeline",
       "pva_capability_status",
       "pva_channels",
       "pva_check_staleness",
```

```diff
@@ -172,7 +172,7 @@ describe("Package release checks", () => {
       "pva_budget_status", "pva_journal",
       "pva_generate_image", "pva_synthesize_speech", "pva_synthesize_nonverbal_audio",
       "pva_render_graphics", "pva_render_terminal", "pva_render_vector_animation",
-      "pva_compose_video", "pva_compose_multitrack_video", "pva_probe_media", "pva_capability_status",
+      "pva_build_timeline", "pva_compose_video", "pva_compose_multitrack_video", "pva_probe_media", "pva_capability_status",
       "pva_list_skills", "pva_load_skill", "pva_gather_context",
       "pva_rpc_health",
     ];
```

```diff
@@ -79,9 +79,10 @@ export function registerSlashCommands(pi: ExtensionAPI): void {
       ctx.ui.notify(`${preview ? "Preview" : "Full"} render: ${path}`, "info");
       pi.sendUserMessage(
         `Compose the video for episode ${path}. ` +
-        `Use pva_compose_video to trigger composition with FFmpeg. ` +
+        `Use pva_compose_video: it renders the episode's edit timeline (artifacts/edit-timeline.json) with Remotion, ` +
+        `rebuilding it first if the episode's material changed. ` +
         `${preview ? "Use preview/rough quality settings." : "Use full production quality."} ` +
-        `After composition, report the output path, file size, and duration.`
+        `After composition, report the output path, file size, duration and whether the timeline was rebuilt.`
       );
     },
   });
```

- [ ] **Step 7: Run the agent suite**

Run: `cd studio/agent && npm run typecheck && npx vitest run`
Expected: typecheck clean; 218 tests pass. `grep -n "ffmpeg\|execSync" studio/agent/src/capability-tools.ts` still shows the unrelated video-clip and image tools, but nothing named `composeEpisodeVideo`, `concatScript` or `artifacts/frames`.

- [ ] **Step 8: Commit**

```bash
git add studio/agent/src studio/agent/tests
git commit -m "feat(agent): compose through the edit timeline with Remotion; delete composeEpisodeVideo (avg-tk7.6)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Real renders of an episode

**Files:**
- Create: `studio/agent/tests/compose-video.e2e.test.ts`

**Interfaces:**
- Consumes: the `pva_compose_video` tool (Task 2), a built `@av/remotion-composer`.

- [ ] **Step 1: Write the test** — `studio/agent/tests/compose-video.e2e.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A real episode rendered through pva_compose_video: timeline built from disk,
 * rendered by Remotion, loudness normalised (avg-tk7.6). Slow, and needs
 * headless Chrome (Remotion downloads it the first time) and a built
 * @av/remotion-composer: only with REMOTION_E2E=1.
 *
 * The checks the FFmpeg composer's tests made — scenes in reading order, each
 * for its own length, nothing cut off — are kept here against the new path.
 */

const enabled = process.env.REMOTION_E2E === "1";
const CHANNEL = "video-storici";
const SERIES = "roma-pills";
const EPISODE = "giulio-cesare";

function ffmpeg(args: string[]): void {
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { encoding: "utf-8" });
  if (r.status !== 0) throw new Error(r.stderr);
}

describe.skipIf(!enabled)("composing a real episode", () => {
  let root: string;
  let previousRoot: string | undefined;
  const dir = () => join(root, CHANNEL, "series", SERIES, "episodes", EPISODE);

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "pva-compose-e2e-"));
    previousRoot = process.env.AVG_LIBRARY_ROOT;
    process.env.AVG_LIBRARY_ROOT = root;
    // Three dark scenes (red, green, blue) for 1 s each, s10 last: a
    // lexicographic sort would play it second.
    mkdirSync(join(dir(), "assets", "images"), { recursive: true });
    for (const [id, colour] of [["s1", "0x600000"], ["s2", "0x006000"], ["s10", "0x000060"]]) {
      ffmpeg(["-f", "lavfi", "-i", `color=c=${colour}:s=1280x720`, "-frames:v", "1", join(dir(), "assets", "images", `${id}.png`)]);
    }
    mkdirSync(join(dir(), "artifacts", "narration"), { recursive: true });
    writeFileSync(join(dir(), "artifacts", "timing.json"), JSON.stringify({
      scenes: ["s1", "s2", "s10"].map((sceneId) => ({ sceneId, durationSeconds: 1 })),
    }));
    // 3.5 s of narration: the last scene must hold to its end, not be cut.
    ffmpeg(["-f", "lavfi", "-i", "sine=frequency=330:duration=3.5", "-af", "volume=0.3", "-ar", "48000", "-ac", "1",
      join(dir(), "artifacts", "narration", "final.wav")]);
    ffmpeg(["-f", "lavfi", "-i", "sine=frequency=330:duration=3.5", "-ar", "48000", "-ac", "1",
      join(dir(), "artifacts", "narration", "s1.wav")]);
    writeFileSync(join(dir(), "artifacts", "narration", "narration-manifest.json"), JSON.stringify({
      schemaVersion: "narration-manifest/v1",
      entries: [{ segmentId: "s1", wav: { path: "artifacts/narration/s1.wav", durationSeconds: 3.5 }, pauseAfterMs: 0 }],
      finalWav: { path: "artifacts/narration/final.wav", durationSeconds: 3.5 },
      captions: [{ segmentId: "s1", index: 1, startSeconds: 2, endSeconds: 3.5, text: "Veni, vidi, vici" }],
    }));
  });

  afterEach(() => {
    if (previousRoot === undefined) delete process.env.AVG_LIBRARY_ROOT;
    else process.env.AVG_LIBRARY_ROOT = previousRoot;
    rmSync(root, { recursive: true, force: true });
  });

  async function compose(params: Record<string, unknown> = {}) {
    const { registerCapabilityTools } = await import("../src/capability-tools.js");
    const tools = new Map<string, { execute: (...a: unknown[]) => Promise<any> }>();
    registerCapabilityTools({ registerTool: (t: { name: string }) => tools.set(t.name, t as never) } as never);
    const result = await tools.get("pva_compose_video")!.execute(
      "call-1", { channel: CHANNEL, series: SERIES, episode: EPISODE, ...params }, undefined, undefined, undefined,
    );
    if (result.isError) throw new Error(result.content[0].text);
    const current = JSON.parse(readFileSync(join(dir(), "output", "current.json"), "utf-8"));
    return join(dir(), "output", current.path);
  }

  const probe = (file: string) => JSON.parse(spawnSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { encoding: "utf-8" }).stdout);

  /** The dominant channel of the frame shown at `seconds`. */
  function channelAt(file: string, seconds: number): "r" | "g" | "b" {
    const out = spawnSync("ffmpeg", ["-v", "quiet", "-ss", String(seconds), "-i", file, "-frames:v", "1",
      "-vf", "crop=iw:ih/2:0:0,scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { encoding: "buffer" }).stdout;
    const [r, g, b] = out;
    if (r! >= g! && r! >= b!) return "r";
    return g! >= b! ? "g" : "b";
  }

  /** The brightest luma in the bottom third of the frame at `seconds` (white caption text is near 235). */
  function bottomBrightness(file: string, seconds: number): number {
    const out = spawnSync("ffmpeg", ["-v", "error", "-ss", String(seconds), "-i", file, "-frames:v", "1",
      "-vf", "crop=iw:ih/3:0:2*ih/3,signalstats,metadata=print:file=-", "-f", "null", "-"], { encoding: "utf-8" }).stdout;
    return Number(/lavfi\.signalstats\.YMAX=(\d+)/.exec(out)?.[1]);
  }

  function loudness(file: string): number {
    const err = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-af", "loudnorm=print_format=json", "-f", "null", "-"], { encoding: "utf-8" }).stderr;
    return Number(JSON.parse(err.slice(err.lastIndexOf("{"), err.lastIndexOf("}") + 1)).input_i);
  }

  it("renders 16:9 in reading order, holds the last scene to the end of the narration, captions it, at -15 LUFS", async () => {
    const out = await compose();
    const video = probe(out).streams.find((s: any) => s.codec_type === "video");
    expect([video.width, video.height]).toEqual([1920, 1080]);
    // 3.5 s of narration at 30 fps: 105 frames (the container runs a little
    // longer because AAC pads its last packet).
    expect(Number(video.nb_frames)).toBe(105);
    expect([channelAt(out, 0.4), channelAt(out, 1.5), channelAt(out, 2.6), channelAt(out, 3.3)]).toEqual(["r", "g", "b", "b"]);
    expect(bottomBrightness(out, 0.5)).toBeLessThan(100);
    expect(bottomBrightness(out, 3)).toBeGreaterThan(200);
    expect(Math.abs(loudness(out) + 15)).toBeLessThanOrEqual(1);
  });

  it("renders 9:16 at 1080x1920 and -14 LUFS", async () => {
    const out = await compose({ profile: "vertical-1080x1920" });
    const video = probe(out).streams.find((s: any) => s.codec_type === "video");
    expect([video.width, video.height]).toEqual([1080, 1920]);
    expect(Math.abs(loudness(out) + 14)).toBeLessThanOrEqual(1);
  });
}, 300_000);
```

- [ ] **Step 2: Run it without and with renders**

Run: `cd studio/agent && npx vitest run tests/compose-video.e2e.test.ts` → 2 skipped.
Run: `cd studio/agent && REMOTION_E2E=1 npx vitest run tests/compose-video.e2e.test.ts` → 2 pass (about 15 s; the first render may download headless Chrome). The 16:9 render is 105 frames, red/green/blue in reading order with `s10` last and held to the end of the narration, the caption visible at 3 s and absent at 0.5 s, −15 ± 1 LUFS; the 9:16 render is 1080×1920 at −14 ± 1 LUFS.
Afterwards `ls "${TMPDIR:-/tmp}" | grep -E "^pva-compose|^remotion-composer-"` prints nothing.

- [ ] **Step 3: Commit**

```bash
git add studio/agent/tests/compose-video.e2e.test.ts
git commit -m "test(agent): real renders of an episode through the timeline, 16:9 and 9:16 (avg-tk7.6)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Defaults, doctor, docs, skill and ADR-0036

**Files:**
- Create: `docs/adr/0036-the-studio-renders-episodes-through-the-edit-timeline.md`
- Modify: `compose.config.json`, `tools/doctor.mjs`, `docs/install.md`, `docs/running.md`, `docs/index.md`, `docs/notes/remotion-composer-design.md`, `skills/studio/compose-video.md` (rewritten), `studio/pipelines/pipelines/narrated-illustrated-video.yaml`, `docs/packages/remotion-composer.md` (generated)

- [ ] **Step 1: Flip the default provider; the `blender` profile gains the composer**

```diff
@@ -229,7 +229,7 @@
       "defaultProviders": {
         "image.generate": "fal-media",
         "image.edit": "fal-media",
-        "video.compose": "video-composer"
+        "video.compose": "remotion-composer"
       },
       "$comment": "image.generate has two providers. fal-media is the default because it is metered per image and predictable; codex-image bills against a ChatGPT plan and is selected per series with `image.provider: openai-codex` in pipeline.yaml."
     },
@@ -259,7 +259,7 @@
       "defaultProviders": {
         "image.generate": "fal-media",
         "image.edit": "fal-media",
-        "video.compose": "video-composer"
+        "video.compose": "remotion-composer"
       }
     },
     "headless": {
@@ -283,13 +283,16 @@
       "defaultProviders": {
         "image.generate": "fal-media",
         "image.edit": "fal-media",
-        "video.compose": "video-composer"
+        "video.compose": "remotion-composer"
       }
     },
     "blender": {
       "summary": "Local 3D production with the agent and browser; no cloud image or MLX voice requirement.",
-      "components": ["blender", "video-composer", "contracts", "runtime", "pipelines", "agent", "adapters", "gateway", "web"],
-      "skills": ["shared", "studio"]
+      "components": ["blender", "video-composer", "remotion-composer", "contracts", "runtime", "pipelines", "agent", "adapters", "gateway", "web"],
+      "skills": ["shared", "studio"],
+      "defaultProviders": {
+        "video.compose": "remotion-composer"
+      }
     },
     "voice": {
       "summary": "Only the standalone voice tool. No studio, no pipelines.",
@@ -310,7 +313,7 @@
         "shared"
       ],
       "defaultProviders": {
-        "video.compose": "video-composer"
+        "video.compose": "remotion-composer"
       }
     }
   },
```

Run: `for p in full studio headless render blender; do node tools/compose.mjs --profile=$p | grep "video.compose"; done`
Expected: five lines `✓ video.compose        <- remotion-composer`. (This writes `composed.json`, which is git-ignored; leave the profile you normally use composed last.)

- [ ] **Step 2: `doctor` reports headless Chrome**

```diff
@@ -43,6 +43,19 @@ function probe(bin, args = ["--version"]) {
   }
 }
 
+/**
+ * Remotion's headless Chrome, which the Remotion composer renders with. It is
+ * not a system binary: Remotion downloads it into node_modules/.remotion of
+ * the package that first renders, so its absence only means no render ran yet.
+ */
+function headlessChrome() {
+  for (const dir of ["node_modules", "packages/remotion-composer/node_modules", "studio/agent/node_modules"]) {
+    const version = join(ROOT, dir, ".remotion", "chrome-headless-shell", "VERSION");
+    if (existsSync(version)) return `chrome-headless-shell ${readFileSync(version, "utf-8").trim()}`;
+  }
+  return null;
+}
+
 const checks = [
   { name: "node", detail: probe("node"), required: true },
   { name: "bun", detail: probe("bun"), required: true },
@@ -50,6 +63,12 @@ const checks = [
   { name: "ffprobe", detail: probe("ffprobe", ["-version"]), required: false },
   { name: "python3", detail: probe("python3"), required: false },
   { name: "blender", detail: probe("blender"), required: false },
+  {
+    name: "chrome",
+    detail: headlessChrome(),
+    required: false,
+    missing: "not downloaded yet: Remotion fetches it on the first render (video.compose)",
+  },
 ];
 
 console.log(`\nProfile: ${composed.profile}\n`);
@@ -58,7 +77,7 @@ let fatal = 0;
 for (const c of checks) {
   if (c.detail) console.log(`  ✓ ${c.name.padEnd(10)} ${c.detail}`);
   else {
-    console.log(`  ${c.required ? "✗" : "!"} ${c.name.padEnd(10)} not found`);
+    console.log(`  ${c.required ? "✗" : "!"} ${c.name.padEnd(10)} ${c.missing ?? "not found"}`);
     if (c.required) fatal++;
   }
 }
```

Run: `npm run doctor | grep chrome`
Expected: `✓ chrome     chrome-headless-shell <version>` if a render ran on this machine, otherwise `! chrome     not downloaded yet: …`.

- [ ] **Step 3: ADR-0036** — `docs/adr/0036-the-studio-renders-episodes-through-the-edit-timeline.md`:

```markdown
# ADR-0036: The studio renders episodes through the edit timeline

## Status

Accepted. `studio/agent/src/edit-timeline-builder.ts` and
`studio/agent/src/episode-render.ts`; tools `pva_build_timeline` and
`pva_compose_video`; renderer `@av/remotion-composer`. Completes what ADR-0009
and ADR-0034 required.

## Context

ADR-0009 and ADR-0034 say an episode's editorial intent is a declarative,
reviewable timeline, never render commands written in the agent. What actually
rendered episodes was `composeEpisodeVideo()`, a private function in the agent
that ran FFmpeg directly: it held each scene image for its length, laid the
narration underneath and wrote `artifacts/final.mp4`, with no captions, no
transitions, no loudness target, one frame size, and no record of how the
video was built. The Remotion composer, the kit registry and the output
profiles were in place, and nothing in the studio used them.

## Decision

- The studio **builds** a `studio.video/v1alpha2` edit timeline from an
  episode's material — scene images, timing, narration and its captions — and
  writes it to `artifacts/edit-timeline.json`. It must pass both the contracts'
  `validateEditTimeline` and the composer's `validateTimeline` before it is
  written. The timeline lists the hash of every file it was built from.
- `@av/remotion-composer` **renders** it. No composition path runs FFmpeg from
  the agent; FFmpeg remains the composer's loudness pass and the QA probe.
- The timeline is the **artifact to review**. A render rebuilds it only when
  the material it was built from changed, or another output profile is asked
  for; otherwise it renders the timeline as it stands, so a deliberate hand
  edit is never overwritten.
- Renders are **immutable**: `output/<render-id>.mp4`, a sibling
  `<render-id>.report.json` naming the hash of the timeline that was rendered,
  and `output/current.json` moved last. A failed render leaves `output/` as it
  was.
- `remotion-composer` is the default `video.compose` provider in every profile
  that composes the agent.

## Consequences

Every delivered video can be traced to the exact timeline that produced it,
and that timeline can be read, commented on and edited before rendering.
Captions, crossfades and the profile's loudness and safe zone come with every
render. Headless Chrome becomes a runtime requirement (Remotion downloads it
on the first render), and renders are slower than FFmpeg's concatenation
(the benchmark of `avg-tk7.2` measured 383 s against 270 s for eight minutes
at 1080p30). `artifacts/final.mp4` is no longer written; readers use
`output/current.json`.
```

```diff
@@ -54,7 +54,7 @@ synced into the site at build time from where they live next to the code.
 
 ## Decision records
 
-[`adr/`](./adr/0035-shared-material-is-pinned-never-copied) holds 35 accepted
+[`adr/`](./adr/0036-the-studio-renders-episodes-through-the-edit-timeline) holds 36 accepted
 decisions. The ones that most shape the code:
 
 | ADR | Decision |
@@ -67,6 +67,7 @@ decisions. The ones that most shape the code:
 | [0032](./adr/0032-single-repository-with-reusable-packages) | One repository, split into reusable packages and the product |
 | [0034](./adr/0034-a-layered-kit-based-edit-timeline) | The edit timeline is layered, kit-based and derived from the spec |
 | [0035](./adr/0035-shared-material-is-pinned-never-copied) | Shared material is pinned with an inventory, never copied |
+| [0036](./adr/0036-the-studio-renders-episodes-through-the-edit-timeline) | The studio renders episodes through the edit timeline, with Remotion |
 
 ADR-0022 (independent repositories per module) is superseded by 0032.
 ADR-0009 (FFmpeg compiles a typed edit timeline) is superseded by 0034.
```

- [ ] **Step 4: Install, running, design note**

```diff
@@ -7,6 +7,7 @@
 | Node ≥ 22 | everything | |
 | Bun | dependency installation | the workspace lockfile is a `bun.lock` |
 | FFmpeg + ffprobe | `video.compose`, `media.probe`, `graphics.animate` | `brew install ffmpeg` |
+| Headless Chrome | `video.compose` (Remotion renders in it) | nothing to install: Remotion downloads `chrome-headless-shell` into `node_modules/.remotion` on the first render; `npm run doctor` says whether it is there |
 | ImageMagick | vector animation in the agent | `brew install imagemagick` |
 | Python 3 | `packages/voice` (MLX speech) | Apple Silicon for MLX acceleration |
 | Blender 4.2–4.x or 5.2.x LTS | `scene.create`, `scene.render` | 5.2.1 live tested; bundled Python; set `BLENDER_BIN` if needed |
```

```diff
@@ -94,8 +94,8 @@ Pipeline: `pva_snapshot`, `pva_run_pipeline`, `pva_run_stage`, `pva_request_appr
 
 Production: `pva_generate_image`, `pva_synthesize_speech`,
 `pva_synthesize_nonverbal_audio`, `pva_render_graphics`,
-`pva_render_terminal`, `pva_render_vector_animation`, `pva_compose_video`,
-`pva_compose_multitrack_video`, `pva_probe_media`
+`pva_render_terminal`, `pva_render_vector_animation`, `pva_build_timeline`,
+`pva_compose_video`, `pva_compose_multitrack_video`, `pva_probe_media`
 
 A tool whose capability is not ready will fail rather than silently degrade.
 `npm run doctor` tells you which are ready; `pva_capability_status` tells the
```

```diff
@@ -1,6 +1,10 @@
 # Remotion composes the typed edit timeline
 
-Design, 2026-08-29. Status: approved, not yet implemented.
+Design, 2026-08-29. Status: approved; M1 and M2 done (2026-10-06: `avg-tk7.1`,
+`avg-tk7.2`, `avg-tk7.6`), M3's registry and previews done (`avg-tk7.3`). What
+renders episodes now is described in
+[ADR-0036](../adr/0036-the-studio-renders-episodes-through-the-edit-timeline);
+the sections below describe the state before it.
 
 ## Why
 
@@ -223,7 +227,9 @@ M1 also measures render speed on a real episode (see Risks).
 
 **M2 — cut the studio over.** Timeline construction replaces
 `composeEpisodeVideo()`, which is deleted. `defaultProviders` flips for the
-`full` profile. New ADR superseding 0009.
+`full` profile. New ADR superseding 0009. *Done in `avg-tk7.6`: ADR-0036, the
+flip in every profile that composes the agent, and `artifacts/edit-timeline.json`
+as the reviewable artifact.*
 
 **M3 — the kit extension mechanism.** Kit authoring contract, registry
 versioning, a `remotion-studio` preview entry point for the agent, docs page.
```

- [ ] **Step 5: The `compose-video` skill** — replace `skills/studio/compose-video.md` with:

````markdown
---
name: compose-video
version: "0.2.0"
description: Compose the final video through the episode's edit timeline, rendered with Remotion
inputs:
  - name: illustrations
    type: image/png
    description: Scene illustrations in assets/images (s1.png, s4a.jpg, …)
  - name: narration
    type: audio/wav
    description: The narration manifest and its final WAV
  - name: captions
    type: application/json
    description: Caption cues from the narration manifest
  - name: timing
    type: application/json
    description: Per-scene timing data (artifacts/timing.json)
outputs:
  - artifacts/edit-timeline.json:
      kind: file
      description: >
        The reviewable account of the render: a studio.video/v1alpha2 edit
        timeline listing every file it was built from.
  - output/:
      kind: directory
      description: >
        Rendered video written to output/<render-id>.mp4 with sibling
        <render-id>.report.json. output/current.json points at the current
        render id. GUI visibility is derived from current.json, never from
        filenames.
capabilities:
  - video.compose
---

# Compose Video

The episode is composed through its **edit timeline** (ADR-0036), not by
running FFmpeg: the timeline is a document you can read, review and edit, and
`@av/remotion-composer` renders exactly what it says.

## Tools

1. `pva_build_timeline` writes `artifacts/edit-timeline.json` from the
   episode's material and says how many scenes and captions it has, how long
   it is, and which output profile it uses. Use it to show the person the plan
   before spending a render on it.
2. `pva_compose_video` renders it. It rebuilds the timeline first when there
   is none, when a file it was built from changed, appeared or disappeared, or
   when you ask for another `profile` — and says why. Otherwise it renders the
   timeline **as it stands**, including a hand edit made on the web or on
   disk: never rebuild over a person's edit to "refresh" it.

Profiles: `youtube-1920x1080` (default, −15 LUFS) and `vertical-1080x1920`
(9:16, −14 LUFS, safe zone clear of the platforms' interface).

## What the timeline holds

- **Scenes** in reading order (`s1, s2, s4a, s10`), each for its length from
  `timing.json`, else its narration, else 10 s; `still@1.0.0`, letterboxed
  (`fit: contain`) when the image's shape differs from the profile.
- **Crossfades** of 12 frames centred on each scene boundary; none around a
  scene shorter than 13 frames.
- **Narration**: the manifest's final WAV, else `narration-full.wav`, else the
  manifest's segments in order with their pauses, else (deprecated) the scene
  WAVs by filename. The last scene holds until the narration ends.
- **Captions**: one `captions@1.1.0` per cue of a canonical narration
  manifest, inside the profile's safe zone. A manifest that is not canonical
  gives narration without captions, and the tool says why.

## Output Layout

```
episode/
├── artifacts/edit-timeline.json
├── output/
│   ├── current.json     ← { "renderId": "<id>", "path": "<id>.mp4" }
│   ├── <render-id>.mp4
│   └── <render-id>.report.json   ← duration, size, sha256, kits, profile,
│                                   loudness, and the hash of the timeline
```

- Render ids are `<label>-<timestamp>-<first 8 hex of the timeline's hash>`.
- `current.json` moves only after the video and its report are complete; a
  failed render changes nothing in `output/`.
- Never look for `final.mp4`: read `output/current.json`.

## Quality Checks

- Every scene appears, in order, for its length; the last is not cut short.
- Captions sit inside the safe zone and match the narration.
- Loudness is the profile's (the report records it).
- The report's timeline hash matches the `edit-timeline.json` you reviewed.
````

and pin it in the pipeline:

```diff
@@ -203,7 +203,7 @@ pipeline:
           tokens: 0
       skills:
         - skill: compose-video
-          version: "0.1.0"
+          version: "0.2.0"
       depends_on:
         - illustrations
         - terminal-recordings
```

- [ ] **Step 6: Regenerate docs and run everything**

```bash
node tools/gen-docs.mjs && git diff --stat docs/packages
node tools/check-boundaries.mjs
(cd studio/pipelines && npm test)
npm run check
npm run docs:build
```

Expected: `docs/packages/remotion-composer.md` now lists the `blender` profile (one line changed); boundaries green; pipelines 37 pass; `npm run check` exits 0; the docs site builds.

- [ ] **Step 7: Commit**

```bash
git add compose.config.json tools/doctor.mjs docs/install.md docs/running.md docs/index.md docs/adr/0036-the-studio-renders-episodes-through-the-edit-timeline.md docs/notes/remotion-composer-design.md docs/packages/remotion-composer.md skills/studio/compose-video.md studio/pipelines/pipelines/narrated-illustrated-video.yaml
git commit -m "docs,config: Remotion is the default video.compose; ADR-0036 (avg-tk7.6)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review against the spec

| Spec item | Where |
|---|---|
| Builder: scenes, crossfades, narration chain, captions, duration, assets, profile, provenance, both validators | Task 1 |
| `pva_build_timeline` | Task 2 |
| `pva_compose_video`: rebuild rules, render as it stands, `.partial`, report with timeline hash, `current.json` last, errors with code | Task 2 |
| Deletion of `composeEpisodeVideo`, frames, concat | Task 2 |
| Agent depends on the composer; build-required | Task 1 |
| Default providers | Task 4 |
| Headless Chrome in install and doctor | Task 4 |
| ADR-0036 | Task 4 |
| Skill, design note, agent docs | Task 4 (and `/render` prompt in Task 2) |
| Real renders, 16:9 and 9:16, old FFmpeg test's checks kept | Task 3 |
| Root checks and docs build | Task 4 Step 6 |
