# Render Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `avg-3th.3`. A render becomes current only after its file passes an audit. The audit checks:
- that the file decodes;
- its streams (codecs, size, frame rate, pixel format, audio);
- its duration;
- its loudness;
- when the timeline declares a loop, that the first frame is the last.

**Architecture:**
- `@av/remotion-composer` gains `auditRender(file, expectation)` and `auditExpectation(timeline)`. They read the file with FFmpeg and return findings, never exceptions, for a bad file.
- The v1alpha2 `EditTimeline` gains an optional `loop: boolean`, in the contract and in the composer's zod schema.
- `@studio/episode`'s `renderEpisode` audits the finished file and writes the result into the report. On failure it leaves `output/current.json` alone and throws `RenderAuditError` (`code: "render-audit"`).

**Tech Stack:**
- TypeScript;
- FFmpeg and FFprobe (already used by the composer);
- JSON Schema and ajv contracts (`node:test`);
- the composer (`node:test`) and `@studio/episode` (vitest).

**Spec:** `docs/superpowers/specs/2026-10-09-render-audit-design.md`, on this branch.

Every line of code below was run before this plan was written, in the prototype: the local commit `7fc47c4` on branch `scratch/audit`. Never push it, never merge it. What was run there:
- contracts `npm run check` (390 tests);
- composer 420 tests;
- episode 202 tests;
- the real render of the Dentro i versi short golden episode (`REMOTION_E2E=1`): 1129 frames, audited, passed.

## Global Constraints

- Work on branch `feat/render-audit`, in the main checkout. It holds the spec commit.
- Never push or merge without the user's go.
- Leave the checkout's unrelated changes alone: `.beads/`, `studio/gateway/src/workspace/filesystem-service.ts`, `studio/gateway/test/workspace-filesystem.test.ts`. Never stage them; never run `bd`.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Use `git add` with explicit paths only.
- Code goes in exactly as shown. Where a step shows a diff, the file must end up exactly as the diff says.
- No dependency changes. New code reads no environment variable: FFmpeg and FFprobe paths are parameters.
- `@studio/episode` consumes the composer through `dist/`: run `npm run build --workspace @av/remotion-composer` before its tests.
- VitePress fails on a double opening curly brace outside fenced code in any Markdown under `docs/`.

## Review Focus

- **A file that does not decode.** It must be refused at once (`decode-errors`), with no other check run on it. Task 2's truncated-file test pins this.
- **A render whose audit fails.** It must never become current. The video, its timeline snapshot and its report (saying why) stay in `output/`, `current.json` still names the previous render, and the error carries `code` and `problems` the agent tool and the series adapter already print. Task 3's tests pin this.
- **A timeline without sound, or with only muted sound.** The audit must expect no audio and skip loudness, and Remotion's silent audio track must not count against it. Task 2's `auditExpectation` tests pin this.
- **Compression noise on a looping video.** A still or looping picture must pass the loop check despite h264 noise, while a moving picture must fail it. Task 2's loop test pins both.
- **Timelines written before this change.** With no `loop` field they must stay valid and be audited without the loop check. Task 1's contract test and Task 3's expectation test pin this.

---

### Task 1: The timeline declares its loop (contract)

**Files:**
- Modify:
  - `studio/contracts/schemas/v1alpha2/edit-timeline.schema.json`;
  - `studio/contracts/bindings/ts/v1alpha2/edit-timeline.ts` (generated);
  - `studio/contracts/test/edit-timeline.test.mjs`.

- [ ] **Step 1: Write the failing test**

````diff
diff --git a/studio/contracts/test/edit-timeline.test.mjs b/studio/contracts/test/edit-timeline.test.mjs
index 74d3c43..ebaf92f 100644
--- a/studio/contracts/test/edit-timeline.test.mjs
+++ b/studio/contracts/test/edit-timeline.test.mjs
@@ -42,6 +42,14 @@ describe("validateEditTimeline", () => {
     assert.ok(problems.some((p) => p.path === "$.tracks[2].items[0].from"));
   });
 
+  it("accepts a timeline that declares its loop, and refuses a loop that is not a boolean", () => {
+    const doc = lesson();
+    doc.loop = true;
+    assert.deepEqual(validateEditTimeline(doc), []);
+    doc.loop = "yes";
+    assert.ok(validateEditTimeline(doc).some((p) => p.code === "schema" && p.path === "$.loop"));
+  });
+
   it("reports a resolution that is not its profile's, and a safe zone that leaves nothing", () => {
     const doc = lesson();
     doc.resolution = { width: 1280, height: 720 };
````

Run: `cd studio/contracts && node --test test/edit-timeline.test.mjs`
Expected: FAIL. `loop: true` is refused, because the schema doesn't know the field.

- [ ] **Step 2: The schema**

````diff
diff --git a/studio/contracts/schemas/v1alpha2/edit-timeline.schema.json b/studio/contracts/schemas/v1alpha2/edit-timeline.schema.json
index f169fe5..2a68395 100644
--- a/studio/contracts/schemas/v1alpha2/edit-timeline.schema.json
+++ b/studio/contracts/schemas/v1alpha2/edit-timeline.schema.json
@@ -261,6 +261,10 @@
           "type": "array",
           "items": { "$ref": "#/$defs/Section" }
         },
+        "loop": {
+          "type": "boolean",
+          "description": "The last frame is the first; the render audit checks it (avg-3th.3)."
+        },
         "metadata": { "type": "object" }
       }
     }
````

Run: `npm run bindings:generate`. The binding must equal the prototype's: `git diff --exit-code 7fc47c4 -- bindings/ts/v1alpha2/edit-timeline.ts`.

- [ ] **Step 3: Run the contracts check**

Run: `npm run check`
Expected: PASS, 390 tests.

- [ ] **Step 4: Commit**

```bash
git add studio/contracts/schemas/v1alpha2/edit-timeline.schema.json studio/contracts/bindings/ts/v1alpha2/edit-timeline.ts studio/contracts/test/edit-timeline.test.mjs
git commit -m "EditTimeline v1alpha2 may declare its loop: the last frame is the first (avg-3th.3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `auditRender` in the composer

**Files:**
- Create:
  - `packages/remotion-composer/src/audit.ts`;
  - `packages/remotion-composer/test/audit.test.ts`.
- Modify:
  - `packages/remotion-composer/src/schema.ts`;
  - `packages/remotion-composer/src/index.ts`;
  - `packages/remotion-composer/README.md`.

**Interfaces:**
- Produces:
  - `auditRender(file: string, expect: AuditExpectation, tools?: {ffmpeg?: string; ffprobe?: string}): Promise<AuditResult>`;
  - `auditExpectation(timeline: EditTimeline): AuditExpectation`;
  - `AuditResult = {passed: boolean; checks: string[]; findings: AuditFinding[]}`;
  - `AuditFinding = {code: 'decode-errors' | 'wrong-video' | 'wrong-audio' | 'wrong-duration' | 'loudness-off' | 'loop-broken'; message; measured?; expected?}`;
  - `LOUDNESS_TOLERANCE`, `TRUE_PEAK_TOLERANCE`, `LOOP_TOLERANCE`;
  - `EditTimeline.loop?: boolean`.

- [ ] **Step 1: Write the failing test**

Create `packages/remotion-composer/test/audit.test.ts`:

````ts
// The render audit (avg-3th.3) on real files made with FFmpeg's test sources:
// what it accepts, and the finding each fault gives.
import {after, before, describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {auditExpectation, auditRender, type AuditExpectation} from '../src/audit.js';
import {EditTimelineSchema} from '../src/schema.js';

let dir: string;
before(() => (dir = mkdtempSync(path.join(tmpdir(), 'audit-'))));
after(() => rmSync(dir, {recursive: true, force: true}));

/** A 2 s file at 30 fps: `video` is an lavfi source, `audio` one too (or none). */
function make(name: string, {video = 'testsrc2=size=320x180:rate=30', audio = 'sine=frequency=440:sample_rate=48000' as string | null, seconds = 2, codec = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p'], audioCodec = ['-c:a', 'aac'], volume = '0.3'} = {}): string {
  const file = path.join(dir, name);
  const args = ['-v', 'error', '-y', '-f', 'lavfi', '-i', video, ...(audio ? ['-f', 'lavfi', '-i', audio] : []), '-t', String(seconds), ...codec,
    ...(audio ? [...audioCodec, '-af', `volume=${volume}`] : []), '-shortest', file];
  const out = spawnSync('ffmpeg', args, {encoding: 'utf8'});
  assert.equal(out.status, 0, out.stderr);
  return file;
}

const EXPECT: AuditExpectation = {width: 320, height: 180, fps: 30, durationInFrames: 60, audio: true, loop: false};
const codes = (r: {findings: {code: string}[]}) => r.findings.map((f) => f.code);

describe('auditRender', () => {
  it('passes a file that is what its timeline promised', async () => {
    const r = await auditRender(make('good.mp4'), EXPECT);
    assert.deepEqual(codes(r), []);
    assert.equal(r.passed, true);
    assert.deepEqual(r.checks, ['decode', 'streams', 'duration']);
  });

  it('refuses the wrong size, frame rate and pixel format, and says what it measured', async () => {
    const r = await auditRender(make('wrong.mp4', {video: 'testsrc2=size=640x360:rate=25', codec: ['-c:v', 'libx264', '-pix_fmt', 'yuv444p']}), EXPECT);
    assert.ok(codes(r).includes('wrong-video'));
    const f = r.findings.find((x) => x.code === 'wrong-video')!;
    assert.deepEqual(f.measured, {codec: 'h264', pixelFormat: 'yuv444p', width: 640, height: 360, fps: 25});
  });

  it('refuses audio that is not AAC at 48 kHz', async () => {
    const r = await auditRender(make('mp3.mkv', {audio: 'sine=frequency=440:sample_rate=44100', audioCodec: ['-c:a', 'libmp3lame']}), EXPECT);
    assert.ok(codes(r).includes('wrong-audio'));
  });

  it('refuses a file that lasts more than a frame longer or shorter than its timeline', async () => {
    assert.ok(codes(await auditRender(make('long.mp4', {seconds: 2.5}), EXPECT)).includes('wrong-duration'));
    assert.deepEqual(codes(await auditRender(make('exact.mp4', {seconds: 2}), {...EXPECT, durationInFrames: 61})), []);
  });

  it('refuses a truncated file at once, with nothing else checked', async () => {
    const good = readFileSync(make('whole.mp4', {seconds: 2}));
    const cut = path.join(dir, 'cut.mp4');
    writeFileSync(cut, good.subarray(0, Math.floor(good.length / 2)));
    const r = await auditRender(cut, EXPECT);
    assert.deepEqual(codes(r), ['decode-errors']);
    assert.deepEqual(r.checks, ['decode']);
  });

  it('measures loudness against the target when there is sound', async () => {
    const target = {integrated: -14, truePeak: -1, range: 11};
    const quiet = await auditRender(make('quiet.mp4', {volume: '0.01'}), {...EXPECT, loudness: target});
    assert.ok(quiet.checks.includes('loudness'));
    assert.ok(codes(quiet).includes('loudness-off'));
  });

  it('checks the loop only when the timeline declares one: a still loops, a moving picture does not', async () => {
    const still = make('still.mp4', {video: 'color=c=navy:size=320x180:rate=30'});
    const moving = make('moving.mp4');
    assert.deepEqual(codes(await auditRender(still, {...EXPECT, loop: true})), []);
    assert.deepEqual(codes(await auditRender(moving, {...EXPECT, loop: true})), ['loop-broken']);
    assert.deepEqual(codes(await auditRender(moving, EXPECT)), []);
  });
});

describe('auditExpectation', () => {
  const base = {
    apiVersion: 'studio.video/v1alpha2', kind: 'EditTimeline', episodeRef: {channel: 'c', series: 's', episode: 'e'}, revision: 1, fps: 30, durationInFrames: 90,
    resolution: {width: 1920, height: 1080},
    profile: {id: 'youtube-1920x1080', width: 1920, height: 1080, safeZone: {top: 54, right: 96, bottom: 54, left: 96}, loudness: {integrated: -14, truePeak: -1, range: 11}},
    assets: {v: {kind: 'audio', path: 'a.wav', hash: `sha256:${'0'.repeat(64)}`}},
  };
  const visual = {type: 'visual', id: 'main', items: [{id: 'i', kit: {name: 'still', version: '1.0.0'}, from: 0, duration: 90, props: {}}]};
  const sound = (muted: boolean) => ({type: 'audio', id: 'voice', muted, items: [{id: 'a', asset: 'v', from: 0, duration: 90}]});

  it('reads sound, loudness and loop from the timeline', () => {
    const t = EditTimelineSchema.parse({...base, tracks: [visual, sound(false)], loop: true});
    assert.deepEqual(auditExpectation(t), {width: 1920, height: 1080, fps: 30, durationInFrames: 90, audio: true, loudness: {integrated: -14, truePeak: -1, range: 11}, loop: true});
  });

  it('expects no sound from muted tracks, and no loop unless declared', () => {
    const t = EditTimelineSchema.parse({...base, tracks: [visual, sound(true)]});
    assert.deepEqual(auditExpectation(t), {width: 1920, height: 1080, fps: 30, durationInFrames: 90, audio: false, loop: false});
  });
});
````

Run: `cd packages/remotion-composer && node --import tsx --test test/audit.test.ts`
Expected: FAIL — `Cannot find module '…/src/audit.js'`.

- [ ] **Step 2: The audit, the schema field, the export**

Create `packages/remotion-composer/src/audit.ts`:

````ts
// auditRender: is a rendered file what its timeline promised? It decodes
// cleanly; its streams have the timeline's codecs, size, frame rate and pixel
// format; it lasts the timeline's frames; its loudness is on target; and,
// when the timeline loops, its last frame is its first. Findings, never
// exceptions, for a bad file: the caller decides what a failed audit means.

import {spawn} from 'node:child_process';
import type {LoudnessTarget} from './loudness.js';
import {isAudioItem, type EditTimeline} from './schema.js';

export interface AuditExpectation {
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  /** The file must carry the timeline's sound: AAC at 48 kHz, on its loudness target. */
  audio: boolean;
  loudness?: LoudnessTarget;
  /** The last frame must be the first (a loop). */
  loop: boolean;
}

export interface AuditFinding {
  code: 'decode-errors' | 'wrong-video' | 'wrong-audio' | 'wrong-duration' | 'loudness-off' | 'loop-broken';
  message: string;
  measured?: unknown;
  expected?: unknown;
}

export interface AuditResult {
  passed: boolean;
  /** The checks that ran, in order. */
  checks: string[];
  findings: AuditFinding[];
}

export interface AuditTools {
  ffmpeg?: string;
  ffprobe?: string;
}

/** Loudness may miss its target by this much (LU); true peak may exceed its ceiling by this much (dB). */
export const LOUDNESS_TOLERANCE = 1;
export const TRUE_PEAK_TOLERANCE = 0.3;
/** Mean difference (0–255) allowed between first and last frame at 64×36 grey: compression noise, not a change of scene. */
export const LOOP_TOLERANCE = 2;

function run(command: string, args: string[]): Promise<{code: number; stdout: Buffer; stderr: string}> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {stdio: ['ignore', 'pipe', 'pipe']});
    const out: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({code: code ?? -1, stdout: Buffer.concat(out), stderr}));
  });
}

interface Stream {codec_type: string; codec_name?: string; width?: number; height?: number; pix_fmt?: string; avg_frame_rate?: string; sample_rate?: string; nb_frames?: string; duration?: string}

const rate = (r: string | undefined) => {
  const [n, d] = (r ?? '0/1').split('/').map(Number);
  return d ? n! / d : 0;
};

/** The expectation a validated timeline sets for its render. */
export function auditExpectation(timeline: EditTimeline): AuditExpectation {
  const audio = timeline.tracks.some((t) => t.type === 'audio' && !t.muted && t.items.some(isAudioItem));
  return {
    width: timeline.resolution.width,
    height: timeline.resolution.height,
    fps: timeline.fps,
    durationInFrames: timeline.durationInFrames,
    audio,
    ...(audio ? {loudness: timeline.profile.loudness} : {}),
    loop: timeline.loop === true,
  };
}

/** One frame of the file, scaled to 64×36 grey, as raw bytes. */
async function frame(ffmpeg: string, file: string, index: number): Promise<Buffer> {
  const {code, stdout, stderr} = await run(ffmpeg, ['-v', 'error', '-i', file, '-vf', `select=eq(n\\,${index}),scale=64:36,format=gray`, '-frames:v', '1', '-f', 'rawvideo', '-']);
  if (code !== 0) throw new Error(`ffmpeg could not read frame ${index}: ${stderr.slice(-400)}`);
  return stdout;
}

export async function auditRender(file: string, expect: AuditExpectation, tools: AuditTools = {}): Promise<AuditResult> {
  const ffmpeg = tools.ffmpeg ?? 'ffmpeg';
  const ffprobe = tools.ffprobe ?? 'ffprobe';
  const checks: string[] = [];
  const findings: AuditFinding[] = [];

  checks.push('decode');
  const decoded = await run(ffmpeg, ['-v', 'error', '-i', file, '-f', 'null', '-']);
  const errors = decoded.stderr.trim();
  if (decoded.code !== 0 || errors) {
    findings.push({code: 'decode-errors', message: `the file does not decode cleanly: ${errors.split('\n').slice(0, 3).join(' | ') || `ffmpeg exited ${decoded.code}`}`});
    // Nothing else can be trusted about a file that does not decode.
    return {passed: false, checks, findings};
  }

  checks.push('streams');
  const probed = await run(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,pix_fmt,avg_frame_rate,sample_rate,nb_frames,duration', '-of', 'json', file]);
  if (probed.code !== 0) throw new Error(`ffprobe could not read ${file}: ${probed.stderr.slice(-400)}`);
  const streams = (JSON.parse(probed.stdout.toString()) as {streams: Stream[]}).streams;
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');
  const wanted = {codec: 'h264', pixelFormat: 'yuv420p', width: expect.width, height: expect.height, fps: expect.fps};
  const got = video ? {codec: video.codec_name, pixelFormat: video.pix_fmt, width: video.width, height: video.height, fps: Math.round(rate(video.avg_frame_rate) * 1000) / 1000} : null;
  if (!got || got.codec !== wanted.codec || got.pixelFormat !== wanted.pixelFormat || got.width !== wanted.width || got.height !== wanted.height || Math.abs(got.fps - wanted.fps) > 0.01) {
    findings.push({code: 'wrong-video', message: got ? `the video is ${got.codec} ${got.pixelFormat} ${got.width}×${got.height} at ${got.fps} fps, not h264 yuv420p ${wanted.width}×${wanted.height} at ${wanted.fps} fps` : 'the file has no video stream', measured: got, expected: wanted});
  }
  if (expect.audio && (!audio || audio.codec_name !== 'aac' || audio.sample_rate !== '48000')) {
    findings.push({code: 'wrong-audio', message: audio ? `the audio is ${audio.codec_name} at ${audio.sample_rate} Hz, not aac at 48000 Hz` : 'the file has no audio stream', measured: audio ? {codec: audio.codec_name, sampleRate: Number(audio.sample_rate)} : null, expected: {codec: 'aac', sampleRate: 48000}});
  }

  checks.push('duration');
  if (video) {
    const frames = video.nb_frames && Number(video.nb_frames) > 0 ? Number(video.nb_frames) : Math.round(Number(video.duration ?? 0) * expect.fps);
    if (Math.abs(frames - expect.durationInFrames) > 1) {
      findings.push({code: 'wrong-duration', message: `the video lasts ${frames} frames, not ${expect.durationInFrames} (± 1)`, measured: frames, expected: expect.durationInFrames});
    }
  }

  if (expect.audio && expect.loudness && audio) {
    checks.push('loudness');
    const t = expect.loudness;
    const measured = await run(ffmpeg, ['-hide_banner', '-i', file, '-af', `loudnorm=I=${t.integrated}:TP=${t.truePeak}:LRA=${t.range}:print_format=json`, '-f', 'null', '-']);
    const start = measured.stderr.lastIndexOf('{');
    const end = measured.stderr.lastIndexOf('}');
    if (measured.code !== 0 || start < 0 || end < start) throw new Error(`ffmpeg could not measure the loudness of ${file}`);
    const report = JSON.parse(measured.stderr.slice(start, end + 1)) as Record<string, string>;
    const integrated = Number(report.input_i);
    const truePeak = Number(report.input_tp);
    if (!(Math.abs(integrated - t.integrated) <= LOUDNESS_TOLERANCE) || !(truePeak <= t.truePeak + TRUE_PEAK_TOLERANCE)) {
      findings.push({code: 'loudness-off', message: `the loudness is ${integrated} LUFS with a true peak of ${truePeak} dBTP, not ${t.integrated} ± ${LOUDNESS_TOLERANCE} LUFS under ${t.truePeak} dBTP`, measured: {integrated, truePeak}, expected: {integrated: t.integrated, truePeak: t.truePeak}});
    }
  }

  if (expect.loop) {
    checks.push('loop');
    const first = await frame(ffmpeg, file, 0);
    const last = await frame(ffmpeg, file, expect.durationInFrames - 1);
    const n = Math.min(first.length, last.length);
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Math.abs(first[i]! - last[i]!);
    const mean = n ? sum / n : 255;
    if (!n || mean > LOOP_TOLERANCE) {
      findings.push({code: 'loop-broken', message: `the last frame is not the first: they differ by ${mean.toFixed(1)} levels on average (at most ${LOOP_TOLERANCE})`, measured: Math.round(mean * 10) / 10, expected: LOOP_TOLERANCE});
    }
  }

  return {passed: findings.length === 0, checks, findings};
}
````

````diff
diff --git a/packages/remotion-composer/src/index.ts b/packages/remotion-composer/src/index.ts
index dacbcb6..f6d64c1 100644
--- a/packages/remotion-composer/src/index.ts
+++ b/packages/remotion-composer/src/index.ts
@@ -8,4 +8,5 @@ export {listKits, previewPath, resolveKit, kitVersions, KIT_VERSIONS, type KitLi
 export {ComposerError, type ComposerErrorCode, type ComposerProblem} from './errors.js';
 export {BUNDLED_FAMILIES} from './kits/lib/fonts/1.1.0.js';
 export {type LoudnessTarget, type LoudnessResult} from './loudness.js';
+export {auditRender, auditExpectation, LOUDNESS_TOLERANCE, TRUE_PEAK_TOLERANCE, LOOP_TOLERANCE, type AuditExpectation, type AuditFinding, type AuditResult, type AuditTools} from './audit.js';
 export {EditTimelineSchema, OutputProfileSchema, type EditTimeline, type OutputProfile} from './schema.js';
diff --git a/packages/remotion-composer/src/schema.ts b/packages/remotion-composer/src/schema.ts
index 9fb1a3f..cc9ca11 100644
--- a/packages/remotion-composer/src/schema.ts
+++ b/packages/remotion-composer/src/schema.ts
@@ -108,6 +108,8 @@ export const EditTimelineSchema = z.object({
     source: specPath.optional(),
     chapter: z.object({number: z.number().int().min(1).optional(), title: z.string().min(1)}).strict().optional(),
   }).strict()).optional(),
+  /** The last frame is the first: the render audit checks it (avg-3th.3). */
+  loop: z.boolean().optional(),
   metadata: z.record(z.unknown()).optional(),
 }).strict();
 
````

- [ ] **Step 3: Run it, then everything**

Run: `node --import tsx --test test/audit.test.ts`
Expected: PASS, 9 tests.

Run: `npx tsc --noEmit && npm test`
Expected: PASS, 420 tests (2 skipped).

- [ ] **Step 4: README**

````diff
diff --git a/packages/remotion-composer/README.md b/packages/remotion-composer/README.md
index 25d77c1..b6c754c 100644
--- a/packages/remotion-composer/README.md
+++ b/packages/remotion-composer/README.md
@@ -162,6 +162,30 @@ Failures throw `ComposerError` with a `code` (`invalid-timeline`,
 `render-failed`, `loudness-failed`, `bad-sheet`, `sheet-failed`) and, for
 validation, `problems` with JSON paths.
 
+### Render audit
+
+`auditRender(file, expectation)` says whether a rendered file is what its
+timeline promised (avg-3th.3); `auditExpectation(timeline)` reads that promise
+from a validated timeline:
+
+```ts
+const audit = await auditRender('out.mp4', auditExpectation(timeline));
+// audit = {passed, checks: ['decode', 'streams', 'duration', 'loudness'?, 'loop'?], findings}
+```
+
+| Check | Finding | Passes when |
+|---|---|---|
+| decode | `decode-errors` | FFmpeg decodes the whole file without an error (nothing else is checked otherwise) |
+| streams | `wrong-video`, `wrong-audio` | H.264 `yuv420p` at the timeline's size and frame rate; AAC at 48 kHz when the timeline has sound |
+| duration | `wrong-duration` | the video lasts the timeline's frames, ± 1 |
+| loudness | `loudness-off` | with sound: integrated loudness within 1 LU of the profile's target, true peak at most 0.3 dB over it |
+| loop | `loop-broken` | when the timeline sets `loop: true`: first and last frame, at 64×36 grey, differ by at most 2 levels on average |
+
+A bad file gives findings, never an exception; it throws only when FFmpeg or
+FFprobe cannot run (their paths are the optional third argument). What a
+failed audit means is the caller's: `@studio/episode` never makes such a
+render current.
+
 ### Layout sheet
 
 `renderLayoutSheet` renders a timeline's stills at the frames the caller
````

- [ ] **Step 5: Commit**

```bash
git add packages/remotion-composer/src/audit.ts packages/remotion-composer/test/audit.test.ts packages/remotion-composer/src/schema.ts packages/remotion-composer/src/index.ts packages/remotion-composer/README.md
git commit -m "auditRender: a rendered file decodes, has its timeline's streams, duration and loudness, and loops when it says it does (avg-3th.3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Only an audited render becomes current

**Files:**
- Create: `studio/episode/tests/render-audit.test.ts`.
- Modify:
  - `studio/episode/src/episode-render.ts`;
  - `studio/episode/tests/render-snapshot.test.ts`;
  - `docs/workspace.md`.

**Interfaces:**
- Consumes: Task 2's `auditRender`, `auditExpectation`, `EditTimelineSchema`, `AuditFinding`, `AuditResult`.
- Produces:
  - `RenderAuditError` (`code: "render-audit"`, `renderId`, `findings`, `problems: {code, message, path}[]`);
  - `EpisodeRender.audit: AuditResult`;
  - the report's `audit: {passed, checks, findings?}`.

- [ ] **Step 1: Write the failing tests**

Create `studio/episode/tests/render-audit.test.ts`:

````ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { renderEpisode, RenderAuditError } from "../src/episode-render.js";
import { sha256, specEpisode } from "../src/testing.js";

/**
 * Only an audited render becomes current (avg-3th.3). The render and the
 * audit are faked; @av/remotion-composer audits real files in its own tests.
 */

let findings: { code: string; message: string }[] = [];
let expectation: unknown = null;

vi.mock("@av/remotion-composer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@av/remotion-composer")>();
  return {
    ...actual,
    renderTimeline: async (options: { timeline: any; outputPath: string }) => {
      mkdirSync(dirname(options.outputPath), { recursive: true });
      writeFileSync(options.outputPath, "fake mp4");
      return {
        path: options.outputPath,
        durationSeconds: options.timeline.durationInFrames / options.timeline.fps,
        sizeBytes: 8,
        hash: sha256("fake mp4"),
        kits: [],
        profile: options.timeline.profile.id,
        loudness: null,
      };
    },
    auditRender: async (_file: string, expect: unknown) => {
      expectation = expect;
      return { passed: findings.length === 0, checks: ["decode", "streams", "duration"], findings };
    },
  };
});

const REF = { channel: "sample", series: "poetry", episode: "morning" };
let root: string;
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
const at = (relative: string) => join(dir(), relative);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "render-audit-"));
  specEpisode(dir(), REF);
  findings = [];
  expectation = null;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("renderEpisode audits the file before it becomes current", () => {
  it("records a passed audit in the report and moves current.json", async () => {
    const render = await renderEpisode(dir(), { episodeRef: REF });
    expect(render.audit.passed).toBe(true);
    const report = JSON.parse(readFileSync(render.reportPath, "utf-8"));
    expect(report.audit).toEqual({ passed: true, checks: ["decode", "streams", "duration"] });
    expect(JSON.parse(readFileSync(at("output/current.json"), "utf-8")).renderId).toBe(render.renderId);
  });

  it("audits against what the timeline promised", async () => {
    await renderEpisode(dir(), { episodeRef: REF });
    const timeline = JSON.parse(readFileSync(at("artifacts/edit-timeline.json"), "utf-8"));
    expect(expectation).toMatchObject({
      width: timeline.resolution.width,
      height: timeline.resolution.height,
      fps: timeline.fps,
      durationInFrames: timeline.durationInFrames,
      loop: false,
    });
  });

  it("keeps a failed render to be looked at, leaves current.json where it was, and says why", async () => {
    const first = await renderEpisode(dir(), { episodeRef: REF });
    findings = [{ code: "loudness-off", message: "the loudness is -30 LUFS, not -14" }];
    const error = await renderEpisode(dir(), { episodeRef: REF, label: "second" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RenderAuditError);
    const audit = error as RenderAuditError;
    expect(audit.code).toBe("render-audit");
    expect(audit.problems).toEqual([{ code: "loudness-off", message: "the loudness is -30 LUFS, not -14", path: `output/${audit.renderId}.mp4` }]);
    expect(existsSync(at(`output/${audit.renderId}.mp4`))).toBe(true);
    expect(existsSync(at(`output/${audit.renderId}.timeline.json`))).toBe(true);
    const report = JSON.parse(readFileSync(at(`output/${audit.renderId}.report.json`), "utf-8"));
    expect(report.audit).toEqual({ passed: false, checks: ["decode", "streams", "duration"], findings });
    expect(JSON.parse(readFileSync(at("output/current.json"), "utf-8")).renderId).toBe(first.renderId);
  });
});
````

````diff
diff --git a/studio/episode/tests/render-snapshot.test.ts b/studio/episode/tests/render-snapshot.test.ts
index 7d56b96..8fdc42d 100644
--- a/studio/episode/tests/render-snapshot.test.ts
+++ b/studio/episode/tests/render-snapshot.test.ts
@@ -31,6 +31,7 @@ vi.mock("@av/remotion-composer", async (importOriginal) => {
         loudness: null,
       };
     },
+    auditRender: async () => ({ passed: true, checks: ["decode", "streams", "duration"], findings: [] }),
   };
 });
 
````

Run: `npm run build --workspace @av/remotion-composer && cd studio/episode && npx vitest run tests/render-audit.test.ts`
Expected: FAIL — `RenderAuditError` is not exported, and the report has no `audit`.

- [ ] **Step 2: The audit in `renderEpisode`**

````diff
diff --git a/studio/episode/src/episode-render.ts b/studio/episode/src/episode-render.ts
index 9087352..6a47c92 100644
--- a/studio/episode/src/episode-render.ts
+++ b/studio/episode/src/episode-render.ts
@@ -6,13 +6,14 @@
 // otherwise rendered exactly as it stands — a hand edit, on the web or on
 // disk, is never overwritten. Renders are immutable: output/<render-id>.mp4
 // with the timeline it rendered (<render-id>.timeline.json, avg-jao.5) and a
-// report beside it, and output/current.json moved last.
+// report beside it, and output/current.json moved last — only once the file
+// passed its audit (avg-3th.3).
 // ---------------------------------------------------------------------------
 
 import { createHash } from "node:crypto";
 import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
 import { dirname, join } from "node:path";
-import { renderTimeline, type RenderResult } from "@av/remotion-composer";
+import { auditExpectation, auditRender, EditTimelineSchema, renderTimeline, type AuditFinding, type AuditResult, type RenderResult } from "@av/remotion-composer";
 import { validateEditTimeline } from "@studio/contracts/src/edit-timeline.mjs";
 import { outputProfile } from "@studio/contracts/src/output-profiles.mjs";
 import {
@@ -56,6 +57,21 @@ export class SeriesRulesError extends TimelineBuildError {
   }
 }
 
+/**
+ * The rendered file is not what its timeline promised (avg-3th.3). The video,
+ * its timeline and its report stay in output/ to be looked at; current.json
+ * was not moved.
+ */
+export class RenderAuditError extends Error {
+  readonly code = "render-audit";
+  readonly problems: { code: string; message: string; path: string }[];
+  constructor(readonly renderId: string, readonly findings: AuditFinding[]) {
+    super(`the render ${renderId} failed its audit, so it did not become current: ${findings.map((f) => `${f.code}: ${f.message}`).join("; ")}`);
+    this.name = "RenderAuditError";
+    this.problems = findings.map((f) => ({ code: f.code, message: f.message, path: `output/${renderId}.mp4` }));
+  }
+}
+
 const errorsOf = (validation: Validation | null) => validation?.findings.filter((f) => f.severity === "error") ?? [];
 
 /** What to do about a refusal: the edit, the spec and takes, or the studio itself. */
@@ -322,6 +338,8 @@ export interface EpisodeRender {
   compiledBy: CompiledBy | null;
   validation: Validation | null;
   result: RenderResult;
+  /** What the audit checked; it passed, or the render would have thrown RenderAuditError. */
+  audit: AuditResult;
 }
 
 /**
@@ -366,6 +384,7 @@ export async function renderEpisode(episodeDir: string, options: EpisodeRenderOp
     throw error;
   }
   result = { ...result, path: outputPath };
+  const audit = await auditRender(outputPath, auditExpectation(EditTimelineSchema.parse(current.timeline)));
 
   // The exact text rendered: a later version is compared with it section by section.
   writeAtomically(join(outputDir, snapshot), decision.text);
@@ -378,7 +397,9 @@ export async function renderEpisode(episodeDir: string, options: EpisodeRenderOp
     ...(current.rebuilt ? { rebuilt: current.rebuilt } : {}),
     ...(current.warnings.length > 0 ? { warnings: current.warnings } : {}),
     render: { ...result, path: `${renderId}.mp4` },
+    audit: audit.passed ? { passed: true, checks: audit.checks } : { passed: false, checks: audit.checks, findings: audit.findings },
   }));
+  if (!audit.passed) throw new RenderAuditError(renderId, audit.findings);
   writeAtomically(join(outputDir, "current.json"), serialize({ renderId, path: `${renderId}.mp4` }));
 
   return {
@@ -391,5 +412,6 @@ export async function renderEpisode(episodeDir: string, options: EpisodeRenderOp
     compiledBy: current.compiledBy,
     validation: current.validation,
     result,
+    audit,
   };
 }
````

- [ ] **Step 3: Run it, then everything**

Run: `npx vitest run tests/render-audit.test.ts`
Expected: PASS, 3 tests.

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS, 202 tests (3 skipped, the e2e).

- [ ] **Step 4: The workspace doc**

````diff
diff --git a/docs/workspace.md b/docs/workspace.md
index 4da2667..c2014d5 100755
--- a/docs/workspace.md
+++ b/docs/workspace.md
@@ -111,7 +111,7 @@ are `seriesTemplatePath` and `seriesReferencePath` in `layout.mjs`;
 
 ## Editing rules
 
-Canonical text writes use compare-and-swap revisions plus atomic rename. A direct edit increments the revision and triggers dependency staleness. Generated attempts are never overwritten. `output/current.json` points to the current render rather than relying on an ambiguous filename or symlink.
+Canonical text writes use compare-and-swap revisions plus atomic rename. A direct edit increments the revision and triggers dependency staleness. Generated attempts are never overwritten. `output/current.json` points to the current render rather than relying on an ambiguous filename or symlink. A render becomes current only after its file passes the render audit (decode, streams, duration, loudness, and the loop when the timeline declares one); a render that fails stays in `output/` with its report, which says why.
 
 ## Git and storage
 
````

- [ ] **Step 5: Commit**

```bash
git add studio/episode/src/episode-render.ts studio/episode/tests/render-audit.test.ts studio/episode/tests/render-snapshot.test.ts docs/workspace.md
git commit -m "Only an audited render becomes current: a failed audit keeps the file and its report, leaves current.json, and says why (avg-3th.3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Whole-branch checks

- [ ] **Step 1:** Run `git diff --stat 7fc47c4 HEAD -- packages studio docs/workspace.md`. It must show no difference.
- [ ] **Step 2:** From the root, run `npm run check && npm run docs:build`. Expected: PASS.
- [ ] **Step 3:** No commit. Report the test counts.
