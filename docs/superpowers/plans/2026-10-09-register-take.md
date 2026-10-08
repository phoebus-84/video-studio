# Register a Synthesized Take Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `avg-dcf.6.6`. Pi can turn a speech tool's file into a take of `artifacts/narration/takes.json`, in a unit, so that `pva_align_take` and the series compilers can use it.

**Architecture:**
- `@studio/episode` gains `registerTake(episodeDir, options)` (`take-register.ts`, beside `take-align.ts`). It copies the audio to `assets/takes/<take>.<ext>`, hashes and measures it, records text and voice, and places the take in a unit's sequence. It validates with `validateNarrationTakes` before writing anything.
- `@studio/agent` gains the tool `pva_register_take`.

**Tech Stack:** TypeScript, vitest, FFmpeg/FFprobe (through `measureSilences`).

**Spec:** `docs/superpowers/specs/2026-10-09-register-take-design.md`, on this branch.

Prototype: the local commit `d2ce43a` on `scratch/register-take`. Never push it or merge it. It passed:
- episode: 221 tests;
- agent: 210 tests;
- `docs:check`.

## Global Constraints

- Work on branch `feat/register-take`, in the main checkout.
- Never push or merge without the user's go.
- Never stage `.beads/`, `studio/gateway/src/workspace/filesystem-service.ts` or `studio/gateway/test/workspace-filesystem.test.ts`, and never run `bd`. Use explicit `git add` paths.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Code goes in exactly as shown. No dependency changes.
- The agent reads `@studio/episode` from `dist/`: run `npm run build --workspace @studio/episode` before the agent's tests.

## Review Focus

- **Audio from outside the episode** (an absolute path elsewhere, `../`, a symlink out). It must be refused as `bad-audio`, with nothing written. Task 1's refusal test pins this.
- **A take registered again.** It must keep its place in its unit, and its timing must be dropped exactly when the audio or the text changed. Task 1 pins both.
- **A unit's pauses.** The first take has no `pauseBefore`, a later take gets 0 when none is given, and a pause over 10 s is refused. Task 1 pins all three.
- **The path to alignment.** A registered take must align with `alignTake` unchanged. Task 1 pins this.
- **The tool's errors.** `bad-audio` and `bad-take` must reach Pi as `❌ <code>: …`. Task 2 pins this.

---

### Task 1: `registerTake` (episode)

**Files:**
- Create: `studio/episode/src/take-register.ts`, `studio/episode/tests/take-register.test.ts`.
- Modify: `studio/episode/src/index.ts`.

**Interfaces:**
- Produces: `registerTake(episodeDir, {take, audio, text, spokenText?, language?, role?, voice: {provider, model?, voiceId?, settings?, direction?}, unit?: {id, pauseBefore?}})`, which returns `{take, audioPath, sequence?, timingDropped}`.
- Also produces: `RegisterTakeError` (`code: "bad-audio" | "bad-take"`) and `takeAudioPathFor`.

- [ ] **Step 1: Write the failing test**

Create `studio/episode/tests/take-register.test.ts`:

````ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { alignTake } from "../src/take-align.js";
import { registerTake, RegisterTakeError } from "../src/take-register.js";
import { sha256 } from "../src/testing.js";

/**
 * registerTake (avg-dcf.6.6): a speech tool's file becomes a take of
 * artifacts/narration/takes.json, in its unit — and then aligns.
 */

let root: string;
const at = (relative: string) => join(root, relative);
const takes = () => JSON.parse(readFileSync(at("artifacts/narration/takes.json"), "utf-8"));
const QWEN = { provider: "qwen3-tts-local", voiceId: "Vivian" };

/** A tone `seconds` long, at `relative`. */
function tone(relative: string, seconds: number, frequency = 300): void {
  mkdirSync(join(root, relative, ".."), { recursive: true });
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `sine=frequency=${frequency}:duration=${seconds}`, "-ac", "1", "-ar", "24000", at(relative)]);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "take-register-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("registerTake", () => {
  it("makes the file a take: copied to assets/takes, hashed, measured, in a new unit", async () => {
    tone("artifacts/narration/titolo.wav", 2);
    const out = await registerTake(root, { take: "titolo", audio: "artifacts/narration/titolo.wav", text: "Il lampo, di Giovanni Pascoli.", language: "it", voice: QWEN, unit: { id: "recital" } });
    expect(out.audioPath).toBe("assets/takes/titolo.wav");
    expect(readFileSync(at("assets/takes/titolo.wav"))).toEqual(readFileSync(at("artifacts/narration/titolo.wav")));
    const doc = takes();
    expect(doc.takes).toEqual([{
      id: "titolo",
      audio: { path: "assets/takes/titolo.wav", hash: sha256(readFileSync(at("assets/takes/titolo.wav"))), durationSeconds: expect.closeTo(2, 1) },
      text: "Il lampo, di Giovanni Pascoli.",
      language: "it",
      voice: QWEN,
    }]);
    expect(doc.units).toEqual([{ id: "recital", sequence: [{ take: "titolo" }] }]);
  });

  it("appends a second take to the unit with its pause, and keeps a take's place when registered again", async () => {
    tone("artifacts/narration/titolo.wav", 2);
    tone("artifacts/narration/recita.wav", 3);
    await registerTake(root, { take: "titolo", audio: "artifacts/narration/titolo.wav", text: "Il lampo.", voice: QWEN, unit: { id: "recital" } });
    await registerTake(root, { take: "recita", audio: "artifacts/narration/recita.wav", text: "E cielo e terra si mostrò qual era:", voice: QWEN, unit: { id: "recital", pauseBefore: 1 } });
    expect(takes().units[0].sequence).toEqual([{ take: "titolo" }, { take: "recita", pauseBefore: 1 }]);
    await registerTake(root, { take: "titolo", audio: "artifacts/narration/titolo.wav", text: "Il lampo.", voice: QWEN, unit: { id: "recital", pauseBefore: 5 } });
    expect(takes().units[0].sequence).toEqual([{ take: "titolo" }, { take: "recita", pauseBefore: 1 }]);
    expect(takes().takes.map((t: { id: string }) => t.id)).toEqual(["titolo", "recita"]);
  });

  it("gives a later take a zero pause when none is given", async () => {
    tone("a.wav", 1);
    tone("b.wav", 1);
    await registerTake(root, { take: "a", audio: "a.wav", text: "a", voice: QWEN, unit: { id: "u" } });
    await registerTake(root, { take: "b", audio: "b.wav", text: "b", voice: QWEN, unit: { id: "u" } });
    expect(takes().units[0].sequence[1]).toEqual({ take: "b", pauseBefore: 0 });
  });

  it("records what the tool was given when it differs, and the voice's provenance", async () => {
    tone("a.wav", 1);
    const voice = { provider: "qwen3-tts-local", model: "Qwen3-TTS-1.7B", voiceId: "Ryan", settings: { speed: 0.95 }, direction: "warm, unhurried legato recitation" };
    await registerTake(root, { take: "a", audio: "a.wav", text: "S'aprì.", spokenText: "Saprì.", role: "recitante", voice });
    expect(takes().takes[0]).toMatchObject({ text: "S'aprì.", spokenText: "Saprì.", role: "recitante", voice });
  });

  it("drops a timing that measured other audio or text, and keeps one that still holds", async () => {
    tone("a.wav", 1);
    await registerTake(root, { take: "a", audio: "a.wav", text: "uno", voice: QWEN });
    const timed = takes();
    timed.takes[0].timing = { path: "artifacts/timing/a.json", hash: sha256("timing") };
    writeFileSync(at("artifacts/narration/takes.json"), JSON.stringify(timed));
    expect((await registerTake(root, { take: "a", audio: "a.wav", text: "uno", voice: QWEN })).timingDropped).toBe(false);
    expect(takes().takes[0].timing).toBeDefined();
    tone("a.wav", 1, 500);
    expect((await registerTake(root, { take: "a", audio: "a.wav", text: "uno", voice: QWEN })).timingDropped).toBe(true);
    expect(takes().takes[0].timing).toBeUndefined();
  });

  it("refuses audio outside the episode, missing, or of another kind, and an invalid take, writing nothing", async () => {
    const code = (p: Promise<unknown>) => p.then(() => null, (e: RegisterTakeError) => e.code);
    const outsider = mkdtempSync(join(tmpdir(), "outside-"));
    writeFileSync(join(outsider, "x.wav"), "x");
    expect(await code(registerTake(root, { take: "a", audio: join(outsider, "x.wav"), text: "a", voice: QWEN }))).toBe("bad-audio");
    expect(await code(registerTake(root, { take: "a", audio: "../x.wav", text: "a", voice: QWEN }))).toBe("bad-audio");
    expect(await code(registerTake(root, { take: "a", audio: "missing.wav", text: "a", voice: QWEN }))).toBe("bad-audio");
    writeFileSync(at("notes.txt"), "not audio");
    expect(await code(registerTake(root, { take: "a", audio: "notes.txt", text: "a", voice: QWEN }))).toBe("bad-audio");
    tone("a.wav", 1);
    tone("b.wav", 1);
    expect(await code(registerTake(root, { take: "a b", audio: "a.wav", text: "a", voice: QWEN }))).toBe("bad-take");
    await registerTake(root, { take: "a", audio: "a.wav", text: "a", voice: QWEN, unit: { id: "u" } });
    expect(await code(registerTake(root, { take: "b", audio: "b.wav", text: "b", voice: QWEN, unit: { id: "u", pauseBefore: 11 } }))).toBe("bad-take");
    expect(existsSync(at("assets/takes/b.wav"))).toBe(false);
    expect(takes().takes.map((t: { id: string }) => t.id)).toEqual(["a"]);
    rmSync(outsider, { recursive: true, force: true });
  });

  it("registers a take alignTake then aligns", async () => {
    tone("artifacts/narration/recita.wav", 2.6);
    await registerTake(root, { take: "recita", audio: "artifacts/narration/recita.wav", text: "E cielo e terra", language: "it", voice: QWEN, unit: { id: "recital" } });
    const worker: Server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const tokens = String(JSON.parse(raw).text).split(/\s+/);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ words: tokens.map((text, i) => ({ text, start: i * 0.6, end: (i + 1) * 0.6 })), model: "fake" }));
      });
    });
    await new Promise<void>((resolve) => worker.listen(0, "127.0.0.1", resolve));
    try {
      const result = await alignTake(root, { take: "recita", workerUrl: `http://127.0.0.1:${(worker.address() as { port: number }).port}` });
      expect(result.timing.words.map((w) => w.text)).toEqual(["E", "cielo", "e", "terra"]);
      expect(takes().takes[0].timing.path).toBe("artifacts/timing/recita.json");
    } finally {
      worker.closeAllConnections();
      await new Promise<void>((resolve) => worker.close(() => resolve()));
    }
  });
});
````

Run: `cd studio/episode && npx vitest run tests/take-register.test.ts`
Expected: FAIL — `../src/take-register.js` does not exist.

- [ ] **Step 2: The module and its export**

Create `studio/episode/src/take-register.ts`:

````ts
// ---------------------------------------------------------------------------
// Registering a synthesized take (avg-dcf.6.6)
// ---------------------------------------------------------------------------
// A speech tool leaves a file; a series reads takes. registerTake makes the
// file a take of artifacts/narration/takes.json: its audio copied to
// assets/takes/<take>.<ext>, hashed and measured, its text and the voice that
// said it recorded, and the take placed in a unit's sequence (the short's
// "recital": titolo, then recita). Then pva_align_take measures its words and
// the compiler lays it out. Nothing is written unless the document is valid.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { validateNarrationTakes } from "@studio/contracts/src/narration-takes.mjs";
import { measureSilences } from "./speech-align.js";
import { TAKES_PATH } from "./take-align.js";

/** Where a take's audio is kept. */
export const takeAudioPathFor = (takeId: string, ext: string) => `assets/takes/${takeId}${ext}`;
const AUDIO = new Set([".wav", ".mp3", ".m4a"]);

export class RegisterTakeError extends Error {
  constructor(readonly code: "bad-audio" | "bad-take", message: string) {
    super(message);
    this.name = "RegisterTakeError";
  }
}

export interface RegisterTakeOptions {
  take: string;
  /** The audio a speech tool made, relative to the episode (or absolute, inside it). */
  audio: string;
  /** The written text the take says. */
  text: string;
  /** What the tool was given, when it differs from `text`. */
  spokenText?: string;
  /** ISO 639-1, e.g. "it". */
  language?: string;
  role?: string;
  /** Provenance only: what made the take. */
  voice: { provider: string; model?: string; voiceId?: string; settings?: Record<string, unknown>; direction?: string };
  /** The unit the take plays in; appended to its sequence, or kept in place when already there. */
  unit?: { id: string; pauseBefore?: number };
}

export interface RegisteredTake {
  take: Record<string, unknown>;
  /** Relative to the episode. */
  audioPath: string;
  /** The unit's sequence after registering. */
  sequence?: { take: string; pauseBefore?: number }[];
  /** The take was there before, timed, with other audio or text: its timing was dropped. */
  timingDropped: boolean;
}

const sha256 = (bytes: Buffer | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
let temporaries = 0;

function writeAtomically(path: string, data: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${temporaries++}.tmp`;
  writeFileSync(temp, data);
  renameSync(temp, path);
}

const outside = (base: string, full: string) => {
  const rel = relative(base, full);
  return rel === "" || rel.startsWith("..") || isAbsolute(rel);
};

/** Register (or replace) a take in artifacts/narration/takes.json. */
export async function registerTake(episodeDir: string, options: RegisterTakeOptions): Promise<RegisteredTake> {
  const root = realpathSync(episodeDir);
  const source = resolve(episodeDir, options.audio);
  if (outside(episodeDir, source) || !existsSync(source) || outside(root, realpathSync(source)) || !statSync(source).isFile()) {
    throw new RegisterTakeError("bad-audio", `${options.audio} is not a file of this episode`);
  }
  const ext = extname(source).toLowerCase();
  if (!AUDIO.has(ext)) throw new RegisterTakeError("bad-audio", `${options.audio} is not audio this studio takes (${[...AUDIO].join(", ")})`);

  const bytes = readFileSync(source);
  let durationSeconds: number;
  try {
    ({ durationSeconds } = await measureSilences(source));
  } catch (error) {
    throw new RegisterTakeError("bad-audio", `${options.audio} cannot be measured: ${(error as Error).message}`);
  }
  const audioPath = takeAudioPathFor(options.take, ext);
  const audio = { path: audioPath, hash: sha256(bytes), durationSeconds: Math.round(durationSeconds * 1000) / 1000 };

  const takesFile = join(episodeDir, TAKES_PATH);
  const doc: any = existsSync(takesFile)
    ? JSON.parse(readFileSync(takesFile, "utf-8"))
    : { apiVersion: "studio.video/v1alpha1", kind: "NarrationTakes", takes: [], units: [] };

  const previous = doc.takes.find((t: { id: string }) => t.id === options.take);
  // A timing measures one audio saying one text: either changed, it no longer holds.
  const timingDropped = !!previous?.timing && (previous.audio?.hash !== audio.hash || previous.text !== options.text);
  const take: Record<string, unknown> = {
    id: options.take,
    audio,
    text: options.text,
    ...(options.spokenText !== undefined && options.spokenText !== options.text ? { spokenText: options.spokenText } : {}),
    ...(options.role !== undefined ? { role: options.role } : {}),
    ...(options.language !== undefined ? { language: options.language } : {}),
    voice: options.voice,
    ...(previous?.timing && !timingDropped ? { timing: previous.timing } : {}),
    ...(previous?.source ? { source: previous.source } : {}),
  };
  doc.takes = previous ? doc.takes.map((t: { id: string }) => (t.id === options.take ? take : t)) : [...doc.takes, take];

  let sequence: RegisteredTake["sequence"];
  if (options.unit) {
    let unit = doc.units.find((u: { id: string }) => u.id === options.unit!.id);
    if (!unit) {
      unit = { id: options.unit.id, sequence: [] };
      doc.units.push(unit);
    }
    const at = unit.sequence.findIndex((e: { take: string }) => e.take === options.take);
    if (at < 0) unit.sequence.push({ take: options.take });
    const entry = unit.sequence[at < 0 ? unit.sequence.length - 1 : at];
    // The first take of a unit starts it; every later one says how long after the one before.
    if (unit.sequence.indexOf(entry) === 0) delete entry.pauseBefore;
    else entry.pauseBefore = options.unit.pauseBefore ?? entry.pauseBefore ?? 0;
    sequence = unit.sequence;
  }

  const problems = validateNarrationTakes(doc);
  if (problems.length > 0) {
    throw new RegisterTakeError("bad-take", `${TAKES_PATH} would not be valid: ${problems.map((p: { code: string; path: string; message: string }) => `${p.code} at ${p.path}: ${p.message}`).join("; ")}`);
  }
  const target = join(episodeDir, audioPath);
  if (resolve(target) !== source) {
    mkdirSync(dirname(target), { recursive: true });
    const temp = `${target}.${process.pid}.${temporaries++}.tmp`;
    copyFileSync(source, temp);
    renameSync(temp, target);
  }
  // A take registered before with another extension: its old file is no longer named anywhere.
  if (previous?.audio?.path && previous.audio.path !== audioPath && String(previous.audio.path).startsWith("assets/takes/")) {
    rmSync(join(episodeDir, previous.audio.path), { force: true });
  }
  writeAtomically(takesFile, `${JSON.stringify(doc, null, 2)}\n`);
  return { take, audioPath, ...(sequence ? { sequence } : {}), timingDropped };
}
````

````diff
diff --git a/studio/episode/src/index.ts b/studio/episode/src/index.ts
index 4ca3240..f491f19 100644
--- a/studio/episode/src/index.ts
+++ b/studio/episode/src/index.ts
@@ -15,3 +15,4 @@ export * from "./version-diff.js";
 export * from "./version-compare.js";
 export * from "./speech-align.js";
 export * from "./take-align.js";
+export * from "./take-register.js";
````

- [ ] **Step 3: Run it, then everything**

Run: `npx vitest run tests/take-register.test.ts`
Expected: PASS, 7 tests.

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS, 221 tests (3 skipped).

- [ ] **Step 4: Commit**

```bash
git add studio/episode/src/take-register.ts studio/episode/tests/take-register.test.ts studio/episode/src/index.ts
git commit -m "registerTake: a speech tool's file becomes a take of takes.json, in its unit (avg-dcf.6.6)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `pva_register_take` (agent) and docs

**Files:**
- Create: `studio/agent/tests/register-take.test.ts`.
- Modify:
  - `studio/agent/src/capability-tools.ts`;
  - `studio/agent/tests/extension.test.ts`;
  - `docs/running.md`.

- [ ] **Step 1: Write the failing tests**

Create `studio/agent/tests/register-take.test.ts`:

````ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * pva_register_take (avg-dcf.6.6): Pi makes a synthesized file a take of
 * takes.json, in its unit. @studio/episode tests the registration itself.
 */

const REF = { channel: "dentro-i-versi", series: "short", episode: "il-lampo" };
let root: string;
let saved: string | undefined;
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pva-register-"));
  mkdirSync(join(dir(), "artifacts", "narration"), { recursive: true });
  for (const [name, seconds] of [["titolo", 2], ["recita", 3]] as const) {
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `sine=frequency=300:duration=${seconds}`, "-ac", "1", join(dir(), "artifacts", "narration", `${name}.wav`)]);
  }
  saved = process.env.AVG_LIBRARY_ROOT;
  process.env.AVG_LIBRARY_ROOT = root;
});

afterEach(() => {
  if (saved === undefined) delete process.env.AVG_LIBRARY_ROOT;
  else process.env.AVG_LIBRARY_ROOT = saved;
  rmSync(root, { recursive: true, force: true });
});

async function tool(params: Record<string, unknown>) {
  const { registerCapabilityTools } = await import("../src/capability-tools.js");
  const tools = new Map<string, { execute: (...a: unknown[]) => Promise<any> }>();
  registerCapabilityTools({ registerTool: (t: { name: string }) => tools.set(t.name, t as never) } as never);
  return tools.get("pva_register_take")!.execute("call-1", { ...REF, ...params }, undefined, undefined, undefined);
}

describe("pva_register_take", () => {
  it("registers the short's two takes in its recital unit", async () => {
    const first = await tool({ take: "titolo", audio: "artifacts/narration/titolo.wav", text: "Il lampo, di Giovanni Pascoli.", language: "it", provider: "qwen3-tts-local", voiceId: "Serena", unit: "recital" });
    expect(first.isError).toBeUndefined();
    expect(first.content[0].text).toMatch(/✅ take titolo: 2\.\d\ds → assets\/takes\/titolo\.wav/);
    const second = await tool({ take: "recita", audio: "artifacts/narration/recita.wav", text: "E cielo e terra si mostrò qual era:", language: "it", provider: "qwen3-tts-local", voiceId: "Ryan", direction: "warm, unhurried legato", unit: "recital", pauseBefore: 1 });
    expect(second.content[0].text).toMatch(/unit recital: titolo → \+1s recita/);
    const doc = JSON.parse(readFileSync(join(dir(), "artifacts", "narration", "takes.json"), "utf-8"));
    expect(doc.units).toEqual([{ id: "recital", sequence: [{ take: "titolo" }, { take: "recita", pauseBefore: 1 }] }]);
    expect(doc.takes[1].voice).toEqual({ provider: "qwen3-tts-local", voiceId: "Ryan", direction: "warm, unhurried legato" });
  });

  it("says what is wrong with its code", async () => {
    const result = await tool({ take: "titolo", audio: "../elsewhere.wav", text: "x", provider: "qwen3-tts-local" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/^❌ bad-audio: /);
  });
});
````

````diff
diff --git a/studio/agent/tests/extension.test.ts b/studio/agent/tests/extension.test.ts
index 3a932a1..15623be 100644
--- a/studio/agent/tests/extension.test.ts
+++ b/studio/agent/tests/extension.test.ts
@@ -129,7 +129,7 @@ describe("extensions/index.ts — tool registration", () => {
   });
 
   it("registers the expected suite of production tools", () => {
-    expect(mockPi.tools.length).toBe(49);
+    expect(mockPi.tools.length).toBe(50);
     const names = mockPi.tools.map((t) => t.name).sort();
     expect(names).toEqual([
       "pva_align_take",
@@ -167,6 +167,7 @@ describe("extensions/index.ts — tool registration", () => {
       "pva_poly_haven",
       "pva_probe_media",
       "pva_propose_reference",
+      "pva_register_take",
       "pva_render_graphics",
       "pva_render_terminal",
       "pva_render_vector_animation",
````

Run: `npm run build --workspace @studio/episode && cd studio/agent && npx vitest run tests/register-take.test.ts tests/extension.test.ts`
Expected: FAIL. The tool does not exist, and there are 49 tools, not 50.

- [ ] **Step 2: The tool**

````diff
diff --git a/studio/agent/src/capability-tools.ts b/studio/agent/src/capability-tools.ts
index 5df5e73..f5f734f 100644
--- a/studio/agent/src/capability-tools.ts
+++ b/studio/agent/src/capability-tools.ts
@@ -48,6 +48,7 @@ import {
   EDIT_TIMELINE_PATH,
   alignTake,
   AlignError,
+  registerTake,
   elevenLabsAlignmentUsd,
   compareVersions,
   initEpisodeSpec,
@@ -1277,6 +1278,67 @@ export function registerCapabilityTools(pi: ExtensionAPI): void {
     },
   });
 
+  // --- Tool: pva_register_take (avg-dcf.6.6) ----------------------------
+
+  pi.registerTool({
+    name: "pva_register_take",
+    label: "Register Take",
+    description: "Make an audio file a narration take of artifacts/narration/takes.json (what pva_align_take and the series compilers read): copied to assets/takes/<take>.<ext>, hashed, measured, with its text and the voice that said it, and placed in a unit's sequence — e.g. a short's unit \"recital\": titolo, then recita with pauseBefore 1. Registering a take again replaces it in place; a timing that measured other audio or text is dropped (align it again).",
+    parameters: Type.Object({
+      channel: Type.String({ description: "Channel slug" }),
+      series: Type.String({ description: "Series slug" }),
+      episode: Type.String({ description: "Episode slug" }),
+      take: Type.String({ description: "The take's id (letters, digits, . _ -), e.g. titolo, recita" }),
+      audio: Type.String({ description: "The audio file a speech tool made, relative to the episode, e.g. artifacts/narration/titolo.wav" }),
+      text: Type.String({ description: "The written text the take says, exactly as shown on screen" }),
+      spokenText: Type.Optional(Type.String({ description: "What the speech tool was given, when it differs from text (pronunciation spellings)" })),
+      language: Type.Optional(Type.String({ description: "ISO 639-1, e.g. it" })),
+      role: Type.Optional(Type.String({ description: "Who says it, e.g. guida, recitante" })),
+      provider: Type.String({ description: "What made it, e.g. qwen3-tts-local, elevenlabs" }),
+      model: Type.Optional(Type.String()),
+      voiceId: Type.Optional(Type.String({ description: "The preset, designed or cloned voice used" })),
+      direction: Type.Optional(Type.String({ description: "The instruction sent with the text (Qwen's direction)" })),
+      settings: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Provider parameters, as sent" })),
+      unit: Type.Optional(Type.String({ description: "The unit the take plays in, e.g. recital" })),
+      pauseBefore: Type.Optional(Type.Number({ description: "Seconds of silence before this take in its unit (0–10; ignored for the unit's first take)" })),
+    }),
+    async execute(_toolCallId, params) {
+      const dir = episodeDir(params.channel, params.series, params.episode);
+      try {
+        const result = await registerTake(dir, {
+          take: params.take,
+          audio: params.audio,
+          text: params.text,
+          ...(params.spokenText !== undefined ? { spokenText: params.spokenText } : {}),
+          ...(params.language !== undefined ? { language: params.language } : {}),
+          ...(params.role !== undefined ? { role: params.role } : {}),
+          voice: {
+            provider: params.provider,
+            ...(params.model !== undefined ? { model: params.model } : {}),
+            ...(params.voiceId !== undefined ? { voiceId: params.voiceId } : {}),
+            ...(params.direction !== undefined ? { direction: params.direction } : {}),
+            ...(params.settings !== undefined ? { settings: params.settings as Record<string, unknown> } : {}),
+          },
+          ...(params.unit !== undefined ? { unit: { id: params.unit, ...(params.pauseBefore !== undefined ? { pauseBefore: params.pauseBefore } : {}) } } : {}),
+        });
+        const audio = result.take.audio as { durationSeconds: number };
+        const lines = [
+          `✅ take ${params.take}: ${audio.durationSeconds.toFixed(2)}s → ${result.audioPath}`,
+          ...(result.sequence ? [`unit ${params.unit}: ${result.sequence.map((e) => (e.pauseBefore !== undefined ? `+${e.pauseBefore}s ${e.take}` : e.take)).join(" → ")}`] : []),
+          ...(result.timingDropped ? ["⚠️ its timing measured other audio or text and was dropped: run pva_align_take"] : []),
+        ];
+        return { content: [{ type: "text" as const, text: lines.join("\n") }], details: result as unknown as Record<string, unknown> };
+      } catch (err) {
+        const e = err as { message?: string; code?: string };
+        return {
+          content: [{ type: "text" as const, text: `❌ ${e.code ? `${e.code}: ` : ""}${e.message ?? String(err)}` }],
+          details: { code: e.code ?? null } as Record<string, unknown>,
+          isError: true as unknown as boolean,
+        };
+      }
+    },
+  });
+
   // --- Tool: pva_render_terminal (via VHS) -----------------------------
 
   pi.registerTool({
````

- [ ] **Step 3: Run it, then everything**

Run: `npx tsc --noEmit -p . && npx vitest run`
Expected: PASS, 210 tests (3 skipped).

- [ ] **Step 4: Docs**

````diff
diff --git a/docs/running.md b/docs/running.md
index d53e2e8..6ec8b00 100644
--- a/docs/running.md
+++ b/docs/running.md
@@ -92,7 +92,7 @@ Pipeline: `pva_snapshot`, `pva_run_pipeline`, `pva_run_stage`, `pva_request_appr
 `pva_plan_rerun`, `pva_check_staleness`, `pva_budget_status`,
 `pva_capability_status`
 
-Production: `pva_generate_image`, `pva_synthesize_speech`,
+Production: `pva_generate_image`, `pva_synthesize_speech`, `pva_register_take`,
 `pva_synthesize_nonverbal_audio`, `pva_render_graphics`,
 `pva_render_terminal`, `pva_render_vector_animation`, `pva_init_spec`,
 `pva_propose_reference`,
@@ -186,6 +186,18 @@ There is no supervisor that starts the worker for you: the agent will report
 `speech.synthesize` as unavailable rather than launching a multi-gigabyte model
 server behind your back.
 
+### Registering a take
+
+A speech tool leaves a file; a series reads takes. `pva_register_take` makes a
+file a take of `artifacts/narration/takes.json` (avg-dcf.6.6):
+- its audio is copied to `assets/takes/<take>.<ext>`, hashed and measured;
+- its text, the voice that said it, and its language and role are recorded;
+- it is placed in a unit's sequence. A short's `recital`, for example, is
+  `titolo`, then `recita` with `pauseBefore` 1.
+
+Registering a take again replaces it in place. A timing that measured other
+audio or text is dropped, so align the take again.
+
 ### Word timing: aligning a take
 
 A take's word timing — when each word of its text is said — is measured by
````

Run from the root: `npm run docs:check`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add studio/agent/src/capability-tools.ts studio/agent/tests/register-take.test.ts studio/agent/tests/extension.test.ts docs/running.md
git commit -m "pva_register_take: Pi registers a synthesized take in its unit (avg-dcf.6.6)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Whole-branch checks

- [ ] **Step 1:** Run `git diff --stat d2ce43a HEAD -- studio docs/running.md`. It must be empty.
- [ ] **Step 2:** From the root, run `npm run check`. Expected: PASS.
- [ ] **Step 3:** No commit. Report the test counts.
