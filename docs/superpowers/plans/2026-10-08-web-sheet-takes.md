# The Web Studio's Sheet Review and Narration Takes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `avg-goz`. In the web studio, a spec-driven episode's tabs show:
- **Storyboard:** its layout sheet, with Approve and Reject for the operator.
- **Narration:** its registered takes, played with their words lit.

**Architecture:**
- **Gateway:** a new `routes/series-episode.ts`:
  - `GET layout-sheet`;
  - `POST layout-sheet/review` (operator only, signed by the runtime's `reviewSheet`);
  - `GET narration-takes`.
- **Runtime:** exports `reviewSheet` and `sheetReviewStatus`.
- **Web:**
  - pure helpers: `lib/sheet-review.ts`, `lib/narration-takes.ts` and `lib/episode-media.ts`;
  - `SheetReview` and `TakesPanel`, behind the `StoryboardTab` and `NarrationTab` wrappers, which fall back to the explainer's views.

**Tech Stack:** TypeScript, Fastify, Svelte 5 (runes), vitest.

**Spec:** `docs/superpowers/specs/2026-10-08-web-sheet-takes-design.md`, on this branch.

Prototype: the local commit `b5c1f0e` on `scratch/web-sheet`. Never push or merge it. It passed:
- gateway 7 new tests;
- web 186 (svelte-check 0 errors, eslint clean);
- root `npm run check`;
- an in-process smoke test on the real long Il lampo.

## Global Constraints

- Work on branch `feat/web-sheet`, in the main checkout.
- Never push or merge without the user's go.
- **Never stage `.beads/`, `studio/gateway/src/workspace/filesystem-service.ts` or `studio/gateway/test/workspace-filesystem.test.ts`.** They hold the user's unrelated local changes; leave them as they are. Never run `bd`. Use explicit `git add` paths.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Code goes in exactly as shown. No dependency changes.
- **The gateway reads `@studio/runtime` from `dist/`:** run `npm run build --workspace @studio/runtime` after Task 1's export, before the gateway's tests.
- **Web checks** run with bun, from `studio/web`:
  - `bun x svelte-check --tsconfig ./tsconfig.json`: 0 errors (the 9 existing warnings are not this work's);
  - `bun x tsc --noEmit`;
  - `bun x eslint --ext .ts,.svelte src test`;
  - `bun x vitest run`.
- Never read the gateway token or the operator key. Don't start a gateway.
- `ls` in this shell can hang. Use `/bin/ls`.

## Review Focus

- **Only the operator signs.** A request whose principal is not `operator`, or a gateway with no operator key, must get 403 with nothing written. Task 1 pins the first.
- **The person signs what they saw.** A `sheetHash` that isn't the grid on disk is 409 `sheet-changed`. Task 1 pins this.
- **No path escapes.**
  - A take's `audio.path` or `timing.path` containing `..` is dropped.
  - The episode params must be slugs.
  - A pin's series and episode must be slugs.
- **The token never goes in a URL.** Media is fetched with the bearer header into blob URLs, and those are revoked.
- **A non-spec episode is unchanged.** It keeps the scene Storyboard and the segment Narration.

---

### Task 1: The gateway's series-episode routes

**Files:**
- Create:
  - `studio/gateway/src/routes/series-episode.ts`;
  - `studio/gateway/test/series-episode-routes.test.ts`.
- Modify:
  - `studio/gateway/src/routes/index.ts`;
  - `studio/runtime/src/index.ts`.

**Interfaces:**
- Produces:
  - `registerSeriesEpisodeRoutes(app, {libraryRoot, operatorKey})`;
  - `layoutSheetOf(dir)`;
  - the runtime exports `reviewSheet`, `sheetReviewStatus`, `SheetOutcome` and `SheetReviewStatus`;
  - the routes `GET …/layout-sheet`, `POST …/layout-sheet/review` and `GET …/narration-takes`. Their errors follow the gateway's `{error: <code>, message}` shape.

- [ ] **Step 1: Write the failing test.**

Create `studio/gateway/test/series-episode-routes.test.ts`:

````ts
// ---------------------------------------------------------------------------
// A series episode in the web studio (avg-goz)
// ---------------------------------------------------------------------------
// The layout sheet and its review, and the narration takes, over HTTP — on a
// bare Fastify with a hook standing in for the auth middleware (a test header
// decides the principal), as take-routes.test.ts does. The sheet is laid out
// as makeLayoutSheet leaves it: sheet.json naming the grid and the stills by
// hash, and the timeline it pictured.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { verifySheetReview } from "@studio/contracts/src/sheet-reviews.mjs";
import { registerSeriesEpisodeRoutes } from "../src/routes/series-episode.js";

const KEY = "operator-key-for-series-episode-routes";
const REF = { channel: "dentro-i-versi", series: "long", episode: "il-lampo" };
const BASE = `/api/channels/${REF.channel}/series/${REF.series}/episodes/${REF.episode}`;
const sha = (bytes: string | Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function library() {
  const root = mkdtempSync(join(tmpdir(), "gw-series-episode-"));
  roots.push(root);
  const dirOf = (ref: typeof REF) => join(root, ref.channel, "series", ref.series, "episodes", ref.episode);
  const write = (ref: typeof REF, path: string, content: string | Buffer) => {
    mkdirSync(dirname(join(dirOf(ref), path)), { recursive: true });
    writeFileSync(join(dirOf(ref), path), content);
  };
  return { root, dir: dirOf(REF), dirOf, write };
}

async function appOn(root: string) {
  const app = Fastify();
  app.addHook("preHandler", async (req) => {
    (req as { principal?: string }).principal = req.headers["x-test-principal"] === "operator" ? "operator" : "agent";
  });
  registerSeriesEpisodeRoutes(app, { libraryRoot: root, operatorKey: KEY });
  await app.ready();
  return app;
}

/** A spec, a timeline, and a sheet of it: the grid and two stills. */
function laySheet(lib: ReturnType<typeof library>, grid = "grid pixels") {
  lib.write(REF, "episode-spec.json", "{}");
  lib.write(REF, "artifacts/edit-timeline.json", "timeline");
  lib.write(REF, "artifacts/layout-sheet/sheet.jpg", grid);
  lib.write(REF, "artifacts/layout-sheet/frames/000.jpg", "still 0");
  lib.write(REF, "artifacts/layout-sheet/frames/001.jpg", "still 1");
  lib.write(REF, "artifacts/layout-sheet/sheet.json", JSON.stringify({
    createdAt: "2026-10-08T18:24:18.796Z",
    inputsHash: sha("inputs"),
    scale: 0.25,
    timeline: { path: "artifacts/edit-timeline.json", hash: sha("timeline") },
    rules: { source: "dentro-i-versi-long@1.2.0" },
    sheet: { path: "sheet.jpg", hash: sha(grid), columns: 2, rows: 1 },
    frames: [
      { index: 0, frame: 0, seconds: 0, label: "first", path: "frames/000.jpg", hash: sha("still 0") },
      { index: 1, frame: 36, seconds: 1.2, label: "block-portale · start+1.2s", path: "frames/001.jpg", hash: sha("still 1") },
    ],
  }));
  return sha(grid);
}

describe("GET layout-sheet", () => {
  it("says a non-spec episode is not spec-driven, and a spec-driven one has no sheet yet", async () => {
    const lib = library();
    lib.write(REF, "artifacts/episode.json", "{}");
    const app = await appOn(lib.root);
    expect((await app.inject({ url: `${BASE}/layout-sheet` })).json()).toMatchObject({ specDriven: false, sheet: null });
    lib.write(REF, "episode-spec.json", "{}");
    expect((await app.inject({ url: `${BASE}/layout-sheet` })).json()).toMatchObject({ specDriven: true, sheet: null, review: { state: "no-sheet" } });
  });

  it("lists the sheet's stills with their times and labels, unreviewed, and says when the timeline moved", async () => {
    const lib = library();
    const hash = laySheet(lib);
    const app = await appOn(lib.root);
    const body = (await app.inject({ url: `${BASE}/layout-sheet` })).json();
    expect(body.sheet.grid).toEqual({ path: "artifacts/layout-sheet/sheet.jpg", hash });
    expect(body.sheet.frames).toEqual([
      { index: 0, frame: 0, seconds: 0, label: "first", path: "artifacts/layout-sheet/frames/000.jpg" },
      { index: 1, frame: 36, seconds: 1.2, label: "block-portale · start+1.2s", path: "artifacts/layout-sheet/frames/001.jpg" },
    ]);
    expect(body.timelineChanged).toBe(false);
    expect(body.review.state).toBe("unreviewed");
    lib.write(REF, "artifacts/edit-timeline.json", "another timeline");
    expect((await app.inject({ url: `${BASE}/layout-sheet` })).json().timelineChanged).toBe(true);
  });
});

describe("POST layout-sheet/review", () => {
  it("refuses the agent, and writes nothing", async () => {
    const lib = library();
    const hash = laySheet(lib);
    const app = await appOn(lib.root);
    const res = await app.inject({ method: "POST", url: `${BASE}/layout-sheet/review`, payload: { decision: "approved", sheetHash: hash } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("operator-only");
    expect(existsSync(join(lib.dir, "artifacts/layout-sheet/review.json"))).toBe(false);
  });

  it("signs the operator's approval of exactly the sheet shown, verifiable with the key", async () => {
    const lib = library();
    const hash = laySheet(lib);
    const app = await appOn(lib.root);
    const res = await app.inject({ method: "POST", url: `${BASE}/layout-sheet/review`, headers: { "x-test-principal": "operator" }, payload: { decision: "approved", sheetHash: hash } });
    expect(res.statusCode, res.body).toBe(200);
    const review = JSON.parse(readFileSync(join(lib.dir, "artifacts/layout-sheet/review.json"), "utf-8"));
    const sheetJson = readFileSync(join(lib.dir, "artifacts/layout-sheet/sheet.json"));
    const verdict = verifySheetReview({ review, key: KEY, episode: "dentro-i-versi/long/il-lampo", inputsHash: sha("inputs"), sheetHash: hash, reportHash: sha(sheetJson) });
    expect([verdict.state, verdict.verified]).toEqual(["approved", true]);
    const after = (await app.inject({ url: `${BASE}/layout-sheet` })).json();
    expect([after.review.state, after.review.verified]).toEqual(["approved", true]);
  });

  it("refuses a sheet that changed since it was shown, and a rejection without a note; records one with a note", async () => {
    const lib = library();
    laySheet(lib);
    const app = await appOn(lib.root);
    const operator = { "x-test-principal": "operator" };
    const stale = await app.inject({ method: "POST", url: `${BASE}/layout-sheet/review`, headers: operator, payload: { decision: "approved", sheetHash: sha("an older grid") } });
    expect([stale.statusCode, stale.json().error]).toEqual([409, "sheet-changed"]);
    const hash = sha("grid pixels");
    const bare = await app.inject({ method: "POST", url: `${BASE}/layout-sheet/review`, headers: operator, payload: { decision: "rejected", sheetHash: hash, note: "  " } });
    expect([bare.statusCode, bare.json().error]).toEqual([400, "note-required"]);
    const rejected = await app.inject({ method: "POST", url: `${BASE}/layout-sheet/review`, headers: operator, payload: { decision: "rejected", sheetHash: hash, note: "the hand covers the gloss at 4:43" } });
    expect(rejected.statusCode, rejected.body).toBe(200);
    const after = (await app.inject({ url: `${BASE}/layout-sheet` })).json();
    expect(after.review.state).toBe("rejected");
  });
});

describe("GET narration-takes", () => {
  it("answers empty lists without takes.json", async () => {
    const lib = library();
    lib.write(REF, "episode-spec.json", "{}");
    const app = await appOn(lib.root);
    expect((await app.inject({ url: `${BASE}/narration-takes` })).json()).toEqual({ specDriven: true, units: [], takes: [], sources: [] });
  });

  it("gives each take its audio's place and its words, and the pinned source's takes", async () => {
    const lib = library();
    const SOURCE = { ...REF, series: "short" };
    lib.write(REF, "episode-spec.json", "{}");
    lib.write(REF, "artifacts/timing/apertura.json", JSON.stringify({ words: [{ text: "Un", start: 0, end: 0.24 }, { text: "lampo", start: 0.3, end: 0.7 }] }));
    lib.write(REF, "artifacts/narration/takes.json", JSON.stringify({
      takes: [
        { id: "apertura", text: "Un lampo.", language: "it", role: "guida", voice: { provider: "qwen3-tts-local", voiceId: "serena" }, audio: { path: "assets/takes/apertura.1a2efe80.wav", durationSeconds: 20.24 }, timing: { path: "artifacts/timing/apertura.json" } },
        { id: "epoca", text: "L'Italia.", voice: { provider: "qwen3-tts-local", voiceId: "serena" }, audio: { path: "assets/takes/epoca.9dc43e40.wav", durationSeconds: 64 } },
      ],
      units: [{ id: "lesson", sequence: [{ take: "apertura" }, { take: "epoca", pauseBefore: 1 }] }],
    }));
    lib.write(REF, "source/pins/fonte.json", JSON.stringify({ id: "fonte", source: { kind: "episode", series: "short", episode: "il-lampo" } }));
    lib.write(SOURCE, "artifacts/narration/takes.json", JSON.stringify({
      takes: [{ id: "recita", text: "E cielo e terra", voice: { provider: "qwen3-tts-local", voiceId: "ryan" }, audio: { path: "assets/takes/recita.d8c20d6f.wav", durationSeconds: 27.68 } }],
      units: [{ id: "recital", sequence: [{ take: "recita" }] }],
    }));
    const app = await appOn(lib.root);
    const body = (await app.inject({ url: `${BASE}/narration-takes` })).json();
    expect(body.units).toEqual([{ id: "lesson", sequence: [{ take: "apertura" }, { take: "epoca", pauseBefore: 1 }] }]);
    expect(body.takes[0]).toEqual({
      id: "apertura", text: "Un lampo.", language: "it", role: "guida", voice: { provider: "qwen3-tts-local", voiceId: "serena" }, durationSeconds: 20.24,
      audio: { ...REF, path: "assets/takes/apertura.1a2efe80.wav" },
      words: [{ text: "Un", start: 0, end: 0.24 }, { text: "lampo", start: 0.3, end: 0.7 }],
    });
    expect(body.takes[1].words).toBeNull();
    expect(body.sources).toEqual([{
      pin: "fonte", episode: SOURCE,
      units: [{ id: "recital", sequence: [{ take: "recita" }] }],
      takes: [{ id: "recita", text: "E cielo e terra", voice: { provider: "qwen3-tts-local", voiceId: "ryan" }, durationSeconds: 27.68, audio: { ...SOURCE, path: "assets/takes/recita.d8c20d6f.wav" }, words: null }],
    }]);
  });
});
````

- [ ] **Step 2: Run it, and see it fail.** `cd studio/gateway && npx vitest run test/series-episode-routes.test.ts`. Expect the module not to be found.

- [ ] **Step 3: Implement.**

Create `studio/gateway/src/routes/series-episode.ts`:

````ts
// ---------------------------------------------------------------------------
// A series episode in the web studio (avg-goz)
// ---------------------------------------------------------------------------
// A spec-driven episode (episode-spec.json) has a layout sheet to review and
// narration takes to hear. These routes read them for the Storyboard and
// Narration tabs, and sign the operator's review of the sheet — the same
// runtime call as `vpr sheet approve|reject`, with the gateway's operator
// key, only for a request the operator key authenticated. Nothing else here
// writes.
// ---------------------------------------------------------------------------

import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { episodePath } from "@studio/contracts/src/layout.mjs";
import { reviewSheet, sheetReviewStatus } from "@studio/runtime";
import { ErrorCode, GatewayError } from "../errors/index.js";

interface EpisodeRef {
  channel: string;
  series: string;
  episode: string;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHEET_DIR = "artifacts/layout-sheet";
const TAKES = "artifacts/narration/takes.json";

function parseEpisode(params: Record<string, string>): EpisodeRef {
  const ref = { channel: params.channel ?? "", series: params.series ?? "", episode: params.episode ?? "" };
  if (![ref.channel, ref.series, ref.episode].every((part) => SLUG.test(part))) {
    throw new GatewayError({ code: ErrorCode.BAD_REQUEST, message: "channel, series and episode must be slugs" });
  }
  return ref;
}

const sha256 = (bytes: Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const readJson = (file: string): any => {
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
};

/** The layout sheet as the web shows it: its stills, and whether the timeline moved since. */
export function layoutSheetOf(dir: string) {
  const report = readJson(join(dir, SHEET_DIR, "sheet.json"));
  if (!report?.sheet || !Array.isArray(report.frames)) return { sheet: null, timelineChanged: false };
  const timelineFile = join(dir, report.timeline?.path ?? "artifacts/edit-timeline.json");
  const timelineChanged = !existsSync(timelineFile) || sha256(readFileSync(timelineFile)) !== report.timeline?.hash;
  return {
    sheet: {
      createdAt: report.createdAt ?? null,
      scale: report.scale ?? null,
      columns: report.sheet.columns ?? null,
      rows: report.sheet.rows ?? null,
      grid: { path: `${SHEET_DIR}/${report.sheet.path}`, hash: report.sheet.hash },
      rules: report.rules?.source ?? null,
      frames: (report.frames as { index: number; frame: number; seconds: number; label: string; path: string }[])
        .map(({ index, frame, seconds, label, path }) => ({ index, frame, seconds, label, path: `${SHEET_DIR}/${path}` })),
    },
    timelineChanged,
  };
}

interface TakeView {
  id: string;
  text: string;
  spokenText?: string;
  language?: string;
  role?: string;
  voice: unknown;
  durationSeconds: number | null;
  audio: (EpisodeRef & { path: string }) | null;
  words: { text: string; start: number; end: number }[] | null;
}

/** An episode's takes.json, each take with its audio's place and its timing's words. */
function takesOf(dir: string, ref: EpisodeRef): { units: unknown[]; takes: TakeView[] } {
  const doc = readJson(join(dir, TAKES));
  if (!doc || !Array.isArray(doc.takes)) return { units: [], takes: [] };
  const takes = (doc.takes as any[]).map((take): TakeView => {
    const timing = typeof take.timing?.path === "string" && !take.timing.path.includes("..") ? readJson(join(dir, take.timing.path)) : null;
    const words = Array.isArray(timing?.words)
      ? (timing.words as any[]).filter((w) => typeof w?.text === "string").map((w) => ({ text: w.text as string, start: Number(w.start), end: Number(w.end) }))
      : null;
    const audioPath = typeof take.audio?.path === "string" && !take.audio.path.includes("..") ? take.audio.path as string : null;
    return {
      id: take.id,
      text: take.text,
      ...(take.spokenText !== undefined ? { spokenText: take.spokenText } : {}),
      ...(take.language !== undefined ? { language: take.language } : {}),
      ...(take.role !== undefined ? { role: take.role } : {}),
      voice: take.voice ?? null,
      durationSeconds: typeof take.audio?.durationSeconds === "number" ? take.audio.durationSeconds : null,
      audio: audioPath ? { ...ref, path: audioPath } : null,
      words,
    };
  });
  return { units: Array.isArray(doc.units) ? doc.units : [], takes };
}

/** The episodes this one pins as its source (ADR-0035), and their takes, read-only. */
function sourcesOf(libraryRoot: string, dir: string, ref: EpisodeRef) {
  const pinsDir = join(dir, "source", "pins");
  if (!existsSync(pinsDir)) return [];
  return readdirSync(pinsDir).filter((name) => name.endsWith(".json") && !name.startsWith(".")).sort().flatMap((name) => {
    const pin = readJson(join(pinsDir, name));
    const source = pin?.source;
    if (source?.kind !== "episode" || !SLUG.test(source.series ?? "") || !SLUG.test(source.episode ?? "")) return [];
    const sourceRef = { channel: ref.channel, series: source.series as string, episode: source.episode as string };
    const sourceDir = episodePath(libraryRoot, sourceRef.channel, sourceRef.series, sourceRef.episode);
    return [{ pin: pin.id as string, episode: sourceRef, ...takesOf(sourceDir, sourceRef) }];
  });
}

export function registerSeriesEpisodeRoutes(app: FastifyInstance, options: { libraryRoot: string; operatorKey: string | null }): void {
  const { libraryRoot, operatorKey } = options;
  const dirOf = (ref: EpisodeRef) => episodePath(libraryRoot, ref.channel, ref.series, ref.episode);
  const episodeParams = {
    type: "object",
    required: ["channel", "series", "episode"],
    properties: { channel: { type: "string" }, series: { type: "string" }, episode: { type: "string" } },
  };

  app.get("/api/channels/:channel/series/:series/episodes/:episode/layout-sheet", {
    schema: { description: "A spec-driven episode's layout sheet, its stills and its review.", tags: ["series"], params: episodeParams },
  }, async (request) => {
    const ref = parseEpisode(request.params as Record<string, string>);
    const dir = dirOf(ref);
    const specDriven = existsSync(join(dir, "episode-spec.json"));
    const { sheet, timelineChanged } = layoutSheetOf(dir);
    const review = sheet ? sheetReviewStatus({ libraryRoot, ref, key: operatorKey }) : { state: "no-sheet", message: "no layout sheet yet" };
    return { specDriven, sheet, timelineChanged, review };
  });

  app.post("/api/channels/:channel/series/:series/episodes/:episode/layout-sheet/review", {
    schema: {
      description: "The operator's review of the layout sheet now on disk: approved, or rejected with a note. Only for the operator key.",
      tags: ["series"],
      params: episodeParams,
      body: {
        type: "object",
        required: ["decision", "sheetHash"],
        properties: {
          decision: { type: "string", enum: ["approved", "rejected"] },
          note: { type: "string" },
          sheetHash: { type: "string" },
        },
      },
    },
  }, async (request, reply) => {
    const ref = parseEpisode(request.params as Record<string, string>);
    const { decision, note, sheetHash } = request.body as { decision: "approved" | "rejected"; note?: string; sheetHash: string };
    if ((request as { principal?: string }).principal !== "operator" || !operatorKey) {
      return reply.status(403).send({ error: "operator-only", message: "only the operator reviews a sheet: sign in as operator" });
    }
    if (decision === "rejected" && !note?.trim()) {
      return reply.status(400).send({ error: "note-required", message: "a rejected sheet needs a note saying what is wrong" });
    }
    const { sheet } = layoutSheetOf(dirOf(ref));
    if (!sheet || sheet.grid.hash !== sheetHash) {
      return reply.status(409).send({ error: "sheet-changed", message: "the sheet changed since it was shown: look at it again" });
    }
    const outcome = reviewSheet({ libraryRoot, ref, key: operatorKey, decision, ...(note?.trim() ? { note: note.trim() } : {}) });
    if (!outcome.ok) return reply.status(409).send({ error: outcome.code, message: outcome.message });
    return { ok: true, review: outcome.value.review };
  });

  app.get("/api/channels/:channel/series/:series/episodes/:episode/narration-takes", {
    schema: { description: "A spec-driven episode's narration takes, their audio and words, and its pinned sources' takes.", tags: ["series"], params: episodeParams },
  }, async (request) => {
    const ref = parseEpisode(request.params as Record<string, string>);
    const dir = dirOf(ref);
    return { specDriven: existsSync(join(dir, "episode-spec.json")), ...takesOf(dir, ref), sources: sourcesOf(libraryRoot, dir, ref) };
  });
}
````

````diff
diff --git a/studio/gateway/src/routes/index.ts b/studio/gateway/src/routes/index.ts
index 8a4e478..6825300 100644
--- a/studio/gateway/src/routes/index.ts
+++ b/studio/gateway/src/routes/index.ts
@@ -7,6 +7,7 @@ import { ErrorCode, GatewayError } from "../errors/index.js";
 import { canonicalizeRoots } from "../lib/roots.js";
 import { registerWorkspaceRoutes } from "./workspace.js";
 import { registerProductionRoutes } from "./production.js";
+import { registerSeriesEpisodeRoutes } from "./series-episode.js";
 import type { PiRpcHealth } from "../rpc/health.js";
 import type { AdapterBridge } from "../rpc/adapter-bridge.js";
 import type { PiProcessManager } from "../rpc/process-manager.js";
@@ -126,6 +127,7 @@ export function registerRoutes(
 
   // ── Production orchestration ─────────────────────────────────────────────
   registerProductionRoutes(app, runtime, workspace, { libraryRoot, operatorKey });
+  registerSeriesEpisodeRoutes(app, { libraryRoot, operatorKey });
 
   // ── Pi agent lifecycle ───────────────────────────────────────────────────
   if (piHealth) {
diff --git a/studio/runtime/src/index.ts b/studio/runtime/src/index.ts
index c6f41f9..a02558b 100644
--- a/studio/runtime/src/index.ts
+++ b/studio/runtime/src/index.ts
@@ -293,3 +293,8 @@ export type {
 
 // Package version (kept in sync with package.json by convention)
 export const VERSION = "0.1.0";
+
+// The operator's review of a layout sheet (avg-3th.2): the CLI's and the web
+// studio's (avg-goz) one way to sign it.
+export { reviewSheet, sheetReviewStatus } from "./sheet-review.js";
+export type { SheetOutcome, SheetReviewStatus } from "./sheet-review.js";
````

- [ ] **Step 4: Run it, and see it pass.**
  - Run `npm run build --workspace @studio/runtime`.
  - `cd studio/gateway && npx vitest run`: all pass, including the 7 new tests.
  - `npx tsc -p studio/gateway --noEmit` at the root.

- [ ] **Step 5: Commit.**

```bash
git add studio/gateway/src/routes/series-episode.ts studio/gateway/test/series-episode-routes.test.ts studio/gateway/src/routes/index.ts studio/runtime/src/index.ts
git commit -m "Gateway: a series episode's layout sheet, its operator review, its narration takes (avg-goz)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: The web tabs

**Files:**
- Create:
  - `studio/web/src/lib/sheet-review.ts`;
  - `studio/web/src/lib/narration-takes.ts`;
  - `studio/web/src/lib/episode-media.ts`;
  - `studio/web/src/components/storyboard/SheetReview.svelte`;
  - `studio/web/src/components/storyboard/StoryboardTab.svelte`;
  - `studio/web/src/components/narration/TakesPanel.svelte`;
  - `studio/web/src/components/narration/NarrationTab.svelte`;
  - `studio/web/test/unit/series-episode.test.ts`.
- Modify:
  - `studio/web/src/components/shell/ProductionCanvas.svelte`;
  - `docs/running.md`.

**Interfaces:**
- Consumes: Task 1's routes and their answers.
- Produces: `wordAt`, `inOrder`, `sheetStatusLine`, `formatSheetTime`, `nextStill`, `parseEpisodeKey`, `episodeApi` and `episodeMediaUrl`.

- [ ] **Step 1: Write the failing test.**

Create `studio/web/test/unit/series-episode.test.ts`:

````ts
import { describe, expect, test } from "vitest";
import { formatSheetTime, nextStill, parseEpisodeKey, sheetStatusLine, type LayoutSheetAnswer } from "../../src/lib/sheet-review";
import { inOrder, wordAt, type TakeView } from "../../src/lib/narration-takes";

/**
 * The Storyboard and Narration tabs of a spec-driven episode (avg-goz): which
 * word is being said, where the sheet stands, how its stills are labelled.
 */

const sheet: NonNullable<LayoutSheetAnswer["sheet"]> = {
  createdAt: "2026-10-08T18:24:18.796Z", scale: 0.25, columns: 6, rows: 12, rules: "dentro-i-versi-long@1.2.0",
  grid: { path: "artifacts/layout-sheet/sheet.jpg", hash: "sha256:aa" }, frames: [],
};
const answer = (over: Partial<LayoutSheetAnswer>): LayoutSheetAnswer => ({ specDriven: true, sheet, timelineChanged: false, review: { state: "unreviewed", message: "" }, ...over });

describe("wordAt", () => {
  const words = [{ text: "Un", start: 0, end: 0.24 }, { text: "lampo", start: 0.3, end: 0.7 }, { text: "nel", start: 0.7, end: 0.9 }];
  test("the word being said, its start included and its end not", () => {
    expect(wordAt(words, 0)).toBe(0);
    expect(wordAt(words, 0.5)).toBe(1);
    expect(wordAt(words, 0.7)).toBe(2);
  });
  test("none between words, before the first or after the last, or without words", () => {
    expect(wordAt(words, 0.27)).toBe(-1);
    expect(wordAt(words, -1)).toBe(-1);
    expect(wordAt(words, 5)).toBe(-1);
    expect(wordAt(null, 0.5)).toBe(-1);
  });
});

describe("inOrder", () => {
  const take = (id: string): TakeView => ({ id, text: id, voice: null, durationSeconds: 1, audio: null, words: null });
  test("the units' order with their pauses, then the takes no unit names", () => {
    const rows = inOrder([{ id: "lesson", sequence: [{ take: "b" }, { take: "a", pauseBefore: 1 }] }], [take("a"), take("b"), take("c")]);
    expect(rows.map((r) => [r.unit, r.take.id, r.pauseBefore])).toEqual([["lesson", "b", null], ["lesson", "a", 1], [null, "c", null]]);
  });
});

describe("sheetStatusLine", () => {
  test("no sheet, a moved timeline: nothing to review", () => {
    expect(sheetStatusLine(answer({ sheet: null }))).toMatchObject({ tone: "muted", reviewable: false });
    expect(sheetStatusLine(answer({ timelineChanged: true }))).toMatchObject({ tone: "warn", reviewable: false });
  });
  test("unreviewed, approved and verified, rejected with its note", () => {
    expect(sheetStatusLine(answer({}))).toMatchObject({ tone: "muted", text: "Not reviewed yet.", reviewable: true });
    expect(sheetStatusLine(answer({ review: { state: "approved", at: "2026-10-08T18:28:04.981Z", verified: true, message: "" } })).text)
      .toBe("Approved at 2026-10-08T18:28:04.981Z (verified).");
    expect(sheetStatusLine(answer({ review: { state: "rejected", note: "the hand covers the gloss", message: "" } })))
      .toMatchObject({ tone: "bad", text: "Rejected: the hand covers the gloss" });
  });
});

describe("the stills", () => {
  test("labelled mm:ss.ff at 30 fps", () => {
    expect(formatSheetTime(0)).toBe("00:00.00");
    expect(formatSheetTime(146.5)).toBe("02:26.15");
    expect(formatSheetTime(577.3)).toBe("09:37.09");
  });
  test("stepped through with wrap-around", () => {
    expect(nextStill(66, 67, 1)).toBe(0);
    expect(nextStill(0, 67, -1)).toBe(66);
    expect(nextStill(3, 0, 1)).toBe(0);
  });
  test("the library's selection names an episode", () => {
    expect(parseEpisodeKey("dentro-i-versi/long/il-lampo")).toEqual({ channel: "dentro-i-versi", series: "long", episode: "il-lampo" });
    expect(parseEpisodeKey("dentro-i-versi/long")).toBeNull();
  });
});
````

- [ ] **Step 2: Run it, and see it fail.** `cd studio/web && bun x vitest run test/unit/series-episode.test.ts`. Expect the modules not to be found.

- [ ] **Step 3: Implement the helpers.**

Create `studio/web/src/lib/sheet-review.ts`:

````ts
// The layout sheet of a spec-driven episode, as the Storyboard tab shows it
// (avg-goz): what the gateway answers, and the pure bits the panel needs.

export interface EpisodeRef {
  channel: string;
  series: string;
  episode: string;
}

export interface SheetStill {
  index: number;
  frame: number;
  seconds: number;
  label: string;
  /** Relative to the episode. */
  path: string;
}

export interface SheetReviewState {
  state: string;
  verified?: boolean | null;
  at?: string | null;
  note?: string | null;
  message: string;
}

export interface LayoutSheetAnswer {
  specDriven: boolean;
  sheet: {
    createdAt: string | null;
    scale: number | null;
    columns: number | null;
    rows: number | null;
    grid: { path: string; hash: string };
    rules: string | null;
    frames: SheetStill[];
  } | null;
  timelineChanged: boolean;
  review: SheetReviewState;
}

export const episodeApi = (ref: EpisodeRef) =>
  `/api/channels/${encodeURIComponent(ref.channel)}/series/${encodeURIComponent(ref.series)}/episodes/${encodeURIComponent(ref.episode)}`;

/** "channel/series/episode" as the library selects it, or null. */
export function parseEpisodeKey(key: string | null | undefined): EpisodeRef | null {
  const parts = (key ?? "").split("/");
  return parts.length === 3 && parts.every((p) => p !== "") ? { channel: parts[0]!, series: parts[1]!, episode: parts[2]! } : null;
}

/** mm:ss.ff at 30 fps, as the sheet labels its stills. */
export function formatSheetTime(seconds: number, fps = 30): string {
  const whole = Math.max(0, seconds);
  const m = Math.floor(whole / 60);
  const s = Math.floor(whole % 60);
  const f = Math.round((whole - Math.floor(whole)) * fps) % fps;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(f).padStart(2, "0")}`;
}

/** The still `step` away from `i`, wrapping around the `n` stills. */
export function nextStill(i: number, n: number, step: number): number {
  if (n <= 0) return 0;
  return (((i + step) % n) + n) % n;
}

/** One line saying where the sheet stands, and whether the person can review it. */
export function sheetStatusLine(answer: LayoutSheetAnswer): { tone: "muted" | "warn" | "ok" | "bad"; text: string; reviewable: boolean } {
  if (!answer.sheet) return { tone: "muted", text: "No sheet yet: Pi makes it (pva_layout_sheet).", reviewable: false };
  if (answer.timelineChanged) return { tone: "warn", text: "The timeline changed since this sheet: make it again before reviewing.", reviewable: false };
  const { review } = answer;
  if (review.state === "approved") {
    return { tone: "ok", text: `Approved${review.at ? ` at ${review.at}` : ""}${review.verified ? " (verified)" : review.verified === false ? " (signature does not verify)" : ""}.`, reviewable: true };
  }
  if (review.state === "rejected") return { tone: "bad", text: `Rejected${review.note ? `: ${review.note}` : "."}`, reviewable: true };
  if (review.state === "unreviewed") return { tone: "muted", text: "Not reviewed yet.", reviewable: true };
  return { tone: "warn", text: review.message, reviewable: true };
}
````

Create `studio/web/src/lib/narration-takes.ts`:

````ts
// A spec-driven episode's narration takes, as the Narration tab plays them
// (avg-goz): what the gateway answers, and which word is being said.

import type { EpisodeRef } from "./sheet-review";

export interface TakeWord {
  text: string;
  start: number;
  end: number;
}

export interface TakeView {
  id: string;
  text: string;
  spokenText?: string;
  language?: string;
  role?: string;
  voice: { provider?: string; voiceId?: string; direction?: string; model?: string } | null;
  durationSeconds: number | null;
  audio: (EpisodeRef & { path: string }) | null;
  words: TakeWord[] | null;
}

export interface TakeUnit {
  id: string;
  sequence: { take: string; pauseBefore?: number }[];
}

export interface NarrationTakesAnswer {
  specDriven: boolean;
  units: TakeUnit[];
  takes: TakeView[];
  sources: { pin: string; episode: EpisodeRef; units: TakeUnit[]; takes: TakeView[] }[];
}

/** The index of the word being said at `t` seconds, or −1 before, between or after the words. */
export function wordAt(words: TakeWord[] | null, t: number): number {
  if (!words) return -1;
  let lo = 0;
  let hi = words.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const w = words[mid]!;
    if (t < w.start) hi = mid - 1;
    else if (t >= w.end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/** The takes in the order their units say them, with the pause before each; takes no unit names come last. */
export function inOrder(units: TakeUnit[], takes: TakeView[]): { unit: string | null; take: TakeView; pauseBefore: number | null }[] {
  const byId = new Map(takes.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const rows: { unit: string | null; take: TakeView; pauseBefore: number | null }[] = [];
  for (const unit of units) {
    for (const entry of unit.sequence) {
      const take = byId.get(entry.take);
      if (!take) continue;
      seen.add(take.id);
      rows.push({ unit: unit.id, take, pauseBefore: entry.pauseBefore ?? null });
    }
  }
  for (const take of takes) if (!seen.has(take.id)) rows.push({ unit: null, take, pauseBefore: null });
  return rows;
}
````

Create `studio/web/src/lib/episode-media.ts`:

````ts
// An episode file as an object URL (avg-goz): fetched through the gateway's
// file route with the bearer header and wrapped in a blob, as files-store
// does, so the token never goes into a URL. Callers revoke what they get.

import { getGatewayClient } from "$lib/gateway.svelte.ts";
import { episodeApi, type EpisodeRef } from "$lib/sheet-review";

export async function episodeMediaUrl(ref: EpisodeRef, path: string): Promise<string | null> {
  const client = getGatewayClient();
  try {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    const res = await fetch(`${client.baseUrl}${episodeApi(ref)}/file/${encoded}`, {
      headers: { authorization: `Bearer ${client.token ?? ""}` },
    });
    if (!res.ok) return null;
    return URL.createObjectURL(await res.blob());
  } catch {
    return null;
  }
}
````

- [ ] **Step 4: The components, and the canvas uses the tabs.**

Create `studio/web/src/components/storyboard/SheetReview.svelte`:

````
<script lang="ts">
  /**
   * The Storyboard of a spec-driven episode (avg-goz): its layout sheet, still
   * by still, and the operator's review of it — the same signed review as
   * `vpr sheet approve|reject`, made by the gateway with the operator key
   * this browser holds. Without that key the review stays with the operator.
   */
  import { onDestroy } from "svelte";
  import { getGatewayClient, hasOperatorKey } from "$lib/gateway.svelte.ts";
  import { episodeMediaUrl } from "$lib/episode-media";
  import {
    episodeApi, formatSheetTime, nextStill, sheetStatusLine,
    type EpisodeRef, type LayoutSheetAnswer,
  } from "$lib/sheet-review";

  let { ref, answer, onReviewed }: { ref: EpisodeRef; answer: LayoutSheetAnswer; onReviewed: () => void } = $props();

  const operator = hasOperatorKey();
  let urls = $state<Record<string, string>>({});
  let open = $state<number | null>(null);
  let rejecting = $state(false);
  let note = $state("");
  let busy = $state(false);
  let error = $state<string | null>(null);

  const status = $derived(sheetStatusLine(answer));
  const frames = $derived(answer.sheet?.frames ?? []);
  const shown = $derived(open === null ? undefined : frames[open]);

  // The stills, fetched with the bearer header; revoked when they change or the panel goes.
  $effect(() => {
    const list = frames;
    const made: string[] = [];
    let live = true;
    for (const still of list) {
      void episodeMediaUrl(ref, still.path).then((url) => {
        if (!url) return;
        if (!live) return URL.revokeObjectURL(url);
        made.push(url);
        urls = { ...urls, [still.path]: url };
      });
    }
    return () => {
      live = false;
      for (const url of made) URL.revokeObjectURL(url);
      urls = {};
    };
  });
  onDestroy(() => {
    for (const url of Object.values(urls)) URL.revokeObjectURL(url);
  });

  async function review(decision: "approved" | "rejected") {
    if (!answer.sheet) return;
    busy = true;
    error = null;
    try {
      await getGatewayClient().fetchJSON(`${episodeApi(ref)}/layout-sheet/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, sheetHash: answer.sheet.grid.hash, ...(decision === "rejected" ? { note } : {}) }),
      });
      rejecting = false;
      note = "";
      onReviewed();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  function keys(event: KeyboardEvent) {
    if (open === null) return;
    if (event.key === "Escape") open = null;
    else if (event.key === "ArrowRight") open = nextStill(open, frames.length, 1);
    else if (event.key === "ArrowLeft") open = nextStill(open, frames.length, -1);
  }
</script>

<svelte:window onkeydown={keys} />

<section class="sheet-review" aria-label="Layout sheet">
  <header class="sr-header">
    <h3 class="sr-title">Layout sheet</h3>
    {#if answer.sheet}
      <span class="sr-meta">
        {frames.length} stills · {answer.sheet.rules ?? "—"}{answer.sheet.createdAt ? ` · made ${answer.sheet.createdAt}` : ""}
      </span>
    {/if}
  </header>

  <div class="sr-status" data-tone={status.tone} role="status">
    <span class="sr-status-mark" aria-hidden="true">{status.tone === "ok" ? "✓" : status.tone === "bad" ? "✕" : status.tone === "warn" ? "!" : "·"}</span>
    <span>{status.text}</span>
  </div>

  {#if answer.sheet && status.reviewable}
    <div class="sr-actions">
      {#if operator}
        <p class="sr-consequence">
          Approving lets the render start from this exact sheet; making the sheet again, or a changed timeline, clears it.
        </p>
        {#if rejecting}
          <label class="sr-note">
            <span>What is wrong (it goes to Pi and the journal)</span>
            <textarea bind:value={note} rows="2" placeholder="the guide's hand covers the gloss at 04:43"></textarea>
          </label>
          <div class="sr-buttons">
            <button class="sr-button sr-reject" disabled={busy || !note.trim()} onclick={() => review("rejected")}>Reject with this note</button>
            <button class="sr-button" disabled={busy} onclick={() => { rejecting = false; note = ""; }}>Cancel</button>
          </div>
        {:else}
          <div class="sr-buttons">
            <button class="sr-button sr-approve" disabled={busy} onclick={() => review("approved")}>{busy ? "Signing…" : "Approve sheet"}</button>
            <button class="sr-button" disabled={busy} onclick={() => (rejecting = true)}>Reject…</button>
          </div>
        {/if}
      {:else}
        <p class="sr-consequence">Sign in as operator in the header to review. Pi can make and read the sheet, never approve it.</p>
      {/if}
      {#if error}<p class="sr-error" role="alert">{error}</p>{/if}
    </div>
  {/if}

  {#if frames.length}
    <ol class="sr-grid" style:--sr-columns={answer.sheet?.columns ?? 6}>
      {#each frames as still (still.path)}
        <li class="sr-still">
          <button class="sr-thumb" onclick={() => (open = still.index)} aria-label={`Still ${still.index}, ${formatSheetTime(still.seconds)}, ${still.label}`}>
            {#if urls[still.path]}
              <img src={urls[still.path]} alt="" loading="lazy" />
            {:else}
              <span class="sr-placeholder" aria-hidden="true"></span>
            {/if}
          </button>
          <span class="sr-caption"><span class="sr-num">#{String(still.index).padStart(2, "0")}</span> <span class="sr-time">{formatSheetTime(still.seconds)}</span> {still.label}</span>
        </li>
      {/each}
    </ol>
  {/if}

  {#if shown}
    {@const still = shown}
    <div class="sr-lightbox" role="dialog" aria-modal="true" aria-label={`Still ${still.index}`}>
      <button class="sr-backdrop" aria-label="Close" onclick={() => (open = null)}></button>
      <figure class="sr-figure">
        {#if urls[still.path]}<img src={urls[still.path]} alt={still.label} />{/if}
        <figcaption>
          <button class="sr-button" onclick={() => (open = nextStill(open ?? 0, frames.length, -1))} aria-label="Previous still">←</button>
          <span class="sr-num">#{String(still.index).padStart(2, "0")}</span>
          <span class="sr-time">{formatSheetTime(still.seconds)}</span>
          <span>{still.label}</span>
          <button class="sr-button" onclick={() => (open = nextStill(open ?? 0, frames.length, 1))} aria-label="Next still">→</button>
          <button class="sr-button" onclick={() => (open = null)} aria-label="Close">Esc</button>
        </figcaption>
      </figure>
    </div>
  {/if}
</section>

<style>
  .sheet-review { display: flex; flex-direction: column; gap: var(--vs-space-3); padding: var(--vs-space-4); overflow: auto; height: 100%; }
  .sr-header { display: flex; align-items: baseline; gap: var(--vs-space-3); }
  .sr-title { margin: 0; font-size: var(--vs-text-md); font-weight: var(--vs-font-weight-semibold); color: var(--vs-text-primary); }
  .sr-meta { font-size: var(--vs-text-xs); color: var(--vs-text-tertiary); font-family: var(--vs-font-mono); }
  .sr-status { display: flex; gap: var(--vs-space-2); align-items: center; padding: var(--vs-space-2) var(--vs-space-3); border-radius: var(--vs-radius-sm); font-size: var(--vs-text-sm); color: var(--vs-text-secondary); background: var(--vs-bg-inset); }
  .sr-status[data-tone="ok"] { color: var(--vs-state-current); background: var(--vs-state-current-bg); }
  .sr-status[data-tone="bad"] { color: var(--vs-state-blocked); background: var(--vs-state-blocked-bg); }
  .sr-status[data-tone="warn"] { color: var(--vs-state-stale); background: var(--vs-state-stale-bg); }
  .sr-status-mark { font-weight: var(--vs-font-weight-semibold); }
  .sr-actions { display: flex; flex-direction: column; gap: var(--vs-space-2); }
  .sr-consequence { margin: 0; font-size: var(--vs-text-sm); color: var(--vs-text-secondary); max-width: 70ch; }
  .sr-buttons { display: flex; gap: var(--vs-space-2); }
  .sr-button { font: inherit; font-size: var(--vs-text-sm); padding: var(--vs-space-1) var(--vs-space-3); border: 1px solid var(--vs-border); border-radius: var(--vs-radius-sm); background: var(--vs-bg-raised); color: var(--vs-text-primary); cursor: pointer; }
  .sr-button:hover:not(:disabled) { background: var(--vs-bg-hover); }
  .sr-button:focus-visible, .sr-thumb:focus-visible { outline: 2px solid var(--vs-border-focus); outline-offset: 1px; }
  .sr-button:disabled { color: var(--vs-text-disabled); cursor: default; }
  .sr-approve { background: var(--vs-accent-strong); border-color: var(--vs-accent-strong); color: var(--vs-accent-text); }
  .sr-approve:hover:not(:disabled) { background: var(--vs-accent-strong-hover); }
  .sr-reject { border-color: var(--vs-danger); color: var(--vs-danger); }
  .sr-note { display: flex; flex-direction: column; gap: var(--vs-space-1); font-size: var(--vs-text-sm); color: var(--vs-text-secondary); max-width: 70ch; }
  .sr-note textarea { font: inherit; padding: var(--vs-space-2); border: 1px solid var(--vs-border); border-radius: var(--vs-radius-sm); background: var(--vs-bg-surface); color: var(--vs-text-primary); }
  .sr-error { margin: 0; color: var(--vs-danger); font-size: var(--vs-text-sm); }
  .sr-grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: var(--vs-space-3); }
  .sr-still { display: flex; flex-direction: column; gap: var(--vs-space-1); min-width: 0; }
  .sr-thumb { padding: 0; border: 1px solid var(--vs-border-subtle); border-radius: var(--vs-radius-sm); background: var(--vs-bg-inset); cursor: zoom-in; aspect-ratio: 16 / 9; overflow: hidden; }
  .sr-thumb img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .sr-placeholder { display: block; width: 100%; height: 100%; }
  .sr-caption { font-size: var(--vs-text-xs); color: var(--vs-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sr-num, .sr-time { font-family: var(--vs-font-mono); color: var(--vs-text-tertiary); }
  .sr-lightbox { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; }
  .sr-backdrop { position: absolute; inset: 0; border: 0; background: color-mix(in srgb, var(--vs-bg-canvas) 85%, transparent); cursor: zoom-out; }
  .sr-figure { position: relative; margin: 0; max-width: min(92vw, 1600px); display: flex; flex-direction: column; gap: var(--vs-space-2); background: var(--vs-bg-panel); padding: var(--vs-space-3); border-radius: var(--vs-radius-md); box-shadow: var(--vs-shadow-modal); }
  .sr-figure img { width: 100%; height: auto; max-height: 80vh; object-fit: contain; image-rendering: auto; }
  .sr-figure figcaption { display: flex; gap: var(--vs-space-3); align-items: center; font-size: var(--vs-text-sm); color: var(--vs-text-secondary); }
  @media (prefers-reduced-motion: no-preference) {
    .sr-button, .sr-thumb { transition: background var(--vs-duration-fast) var(--vs-ease-standard); }
  }
</style>
````

Create `studio/web/src/components/storyboard/StoryboardTab.svelte`:

````
<script lang="ts">
  /**
   * The Storyboard tab (avg-goz): a spec-driven episode's layout sheet and
   * its review; any other episode's scenes, as before.
   */
  import { library } from "$lib/library-store.svelte.ts";
  import { getGatewayClient } from "$lib/gateway.svelte.ts";
  import { episodeApi, parseEpisodeKey, type LayoutSheetAnswer } from "$lib/sheet-review";
  import Storyboard from "./Storyboard.svelte";
  import SheetReview from "./SheetReview.svelte";

  const ref = $derived(parseEpisodeKey(library.selectedEpisode));
  let answer = $state<LayoutSheetAnswer | null>(null);
  let error = $state<string | null>(null);
  let reloads = $state(0);

  $effect(() => {
    const at = ref;
    void reloads;
    answer = null;
    error = null;
    if (!at) return;
    let live = true;
    getGatewayClient().fetchJSON<LayoutSheetAnswer>(`${episodeApi(at)}/layout-sheet`)
      .then((a) => { if (live) answer = a; })
      .catch((err) => { if (live) error = err instanceof Error ? err.message : String(err); });
    return () => { live = false; };
  });
</script>

{#if ref && answer?.specDriven}
  <SheetReview {ref} {answer} onReviewed={() => (reloads += 1)} />
{:else if error}
  <p class="tab-note" role="alert">{error}</p>
{:else if !ref || answer}
  <Storyboard />
{:else}
  <p class="tab-note" role="status">Loading…</p>
{/if}

<style>
  .tab-note { padding: var(--vs-space-4); color: var(--vs-text-secondary); font-size: var(--vs-text-sm); }
</style>
````

Create `studio/web/src/components/narration/TakesPanel.svelte`:

````
<script lang="ts">
  /**
   * The Narration of a spec-driven episode (avg-goz): its registered takes,
   * unit by unit with the pause before each, each with its voice, its text and
   * whether it is aligned — and played, its words lit as they are said. The
   * pinned source's takes follow, read-only. Nothing here synthesizes or
   * registers a take: that stays Pi's.
   */
  import { onDestroy } from "svelte";
  import { episodeMediaUrl } from "$lib/episode-media";
  import { inOrder, wordAt, type NarrationTakesAnswer, type TakeView } from "$lib/narration-takes";

  let { answer }: { answer: NarrationTakesAnswer } = $props();

  let playing = $state<string | null>(null);
  let current = $state(-1);
  let loading = $state<string | null>(null);
  let error = $state<string | null>(null);
  let audio: HTMLAudioElement | null = null;
  let url: string | null = null;

  const keyOf = (take: TakeView) => `${take.audio?.series ?? ""}/${take.audio?.episode ?? ""}/${take.id}`;
  const own = $derived(inOrder(answer.units, answer.takes));
  const totalSeconds = $derived(own.reduce((sum, row) => sum + (row.take.durationSeconds ?? 0) + (row.pauseBefore ?? 0), 0));

  function stop() {
    audio?.pause();
    audio = null;
    if (url) URL.revokeObjectURL(url);
    url = null;
    playing = null;
    current = -1;
  }

  async function toggle(take: TakeView) {
    const key = keyOf(take);
    if (playing === key) return stop();
    stop();
    if (!take.audio) return;
    error = null;
    loading = key;
    const made = await episodeMediaUrl(take.audio, take.audio.path);
    loading = null;
    if (!made) {
      error = `${take.id}: its audio could not be read (${take.audio.path})`;
      return;
    }
    url = made;
    audio = new Audio(made);
    playing = key;
    audio.ontimeupdate = () => (current = wordAt(take.words, audio?.currentTime ?? 0));
    audio.onended = () => stop();
    void audio.play();
  }

  const seconds = (s: number | null) => (s === null ? "—" : `${s.toFixed(2)} s`);
  onDestroy(stop);
</script>

{#snippet takeRow(take: TakeView, pauseBefore: number | null, readOnly: boolean)}
  {@const key = keyOf(take)}
  <li class="tp-take" data-playing={playing === key}>
    {#if pauseBefore}<span class="tp-pause">pause {pauseBefore} s</span>{/if}
    <div class="tp-head">
      <button class="tp-play" disabled={!take.audio || loading === key} onclick={() => toggle(take)}
        aria-label={playing === key ? `Stop ${take.id}` : `Play ${take.id}`}>
        {loading === key ? "…" : playing === key ? "■" : "▶"}
      </button>
      <span class="tp-id">{take.id}</span>
      <span class="tp-duration">{seconds(take.durationSeconds)}</span>
      <span class="tp-voice" title={take.voice?.direction ?? ""}>{take.voice?.provider ?? "—"}{take.voice?.voiceId ? ` · ${take.voice.voiceId}` : ""}</span>
      <span class="tp-badge" data-aligned={take.words !== null}>{take.words !== null ? `aligned · ${take.words.length} words` : "not aligned"}</span>
      {#if readOnly}<span class="tp-badge">pinned · read-only</span>{/if}
    </div>
    <p class="tp-text" lang={take.language ?? null}>
      {#if take.words && playing === key}
        {#each take.words as word, i (i)}<span class="tp-word" data-current={i === current}>{word.text}</span>{" "}{/each}
      {:else}
        {take.text}
      {/if}
    </p>
    {#if take.spokenText && take.spokenText !== take.text}
      <p class="tp-spoken"><span>said as</span> {take.spokenText}</p>
    {/if}
  </li>
{/snippet}

<section class="takes-panel" aria-label="Narration takes">
  <header class="tp-header">
    <h4 class="tp-title">Narration takes</h4>
    <span class="tp-summary">{answer.takes.length} takes · {Math.floor(totalSeconds / 60)}:{String(Math.round(totalSeconds % 60)).padStart(2, "0")} with pauses</span>
  </header>
  {#if error}<p class="tp-error" role="alert">{error}</p>{/if}

  {#if !answer.takes.length}
    <p class="tp-note">No registered takes yet: Pi makes them (pva_synthesize_speech, then pva_register_take and pva_align_take).</p>
  {:else}
    <ol class="tp-list">
      {#each own as row (row.take.id)}
        {@render takeRow(row.take, row.pauseBefore, false)}
      {/each}
    </ol>
  {/if}

  {#each answer.sources as source (source.pin)}
    <h5 class="tp-source">From {source.pin} <span>({source.episode.series}/{source.episode.episode})</span></h5>
    <ol class="tp-list">
      {#each inOrder(source.units, source.takes) as row (row.take.id)}
        {@render takeRow(row.take, row.pauseBefore, true)}
      {/each}
    </ol>
  {/each}
</section>

<style>
  .takes-panel { display: flex; flex-direction: column; gap: var(--vs-space-3); padding: var(--vs-space-4); overflow: auto; height: 100%; }
  .tp-header { display: flex; align-items: baseline; gap: var(--vs-space-3); }
  .tp-title { margin: 0; font-size: var(--vs-text-md); font-weight: var(--vs-font-weight-semibold); color: var(--vs-text-primary); }
  .tp-summary, .tp-duration, .tp-pause { font-family: var(--vs-font-mono); font-size: var(--vs-text-xs); color: var(--vs-text-tertiary); }
  .tp-note { margin: 0; color: var(--vs-text-secondary); font-size: var(--vs-text-sm); }
  .tp-error { margin: 0; color: var(--vs-danger); font-size: var(--vs-text-sm); }
  .tp-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .tp-take { display: flex; flex-direction: column; gap: var(--vs-space-1); padding: var(--vs-space-2) 0; border-bottom: 1px solid var(--vs-border-subtle); }
  .tp-take[data-playing="true"] { background: var(--vs-bg-selected); }
  .tp-head { display: flex; align-items: center; gap: var(--vs-space-3); flex-wrap: wrap; }
  .tp-play { font: inherit; width: 2rem; height: 1.75rem; border: 1px solid var(--vs-border); border-radius: var(--vs-radius-sm); background: var(--vs-bg-raised); color: var(--vs-text-primary); cursor: pointer; }
  .tp-play:disabled { color: var(--vs-text-disabled); cursor: default; }
  .tp-play:focus-visible { outline: 2px solid var(--vs-border-focus); outline-offset: 1px; }
  .tp-id { font-family: var(--vs-font-mono); font-size: var(--vs-text-sm); color: var(--vs-text-primary); font-weight: var(--vs-font-weight-medium); }
  .tp-voice { font-size: var(--vs-text-xs); color: var(--vs-text-secondary); }
  .tp-badge { font-size: var(--vs-text-xs); color: var(--vs-text-tertiary); border: 1px solid var(--vs-border-subtle); border-radius: var(--vs-radius-sm); padding: 0 var(--vs-space-1); }
  .tp-badge[data-aligned="false"] { color: var(--vs-state-stale); border-color: var(--vs-state-stale); }
  .tp-text { margin: 0; font-size: var(--vs-text-sm); color: var(--vs-text-secondary); max-width: 80ch; line-height: var(--vs-leading-normal); }
  .tp-word[data-current="true"] { color: var(--vs-text-primary); background: var(--vs-accent-subtle); border-radius: 2px; }
  .tp-spoken { margin: 0; font-size: var(--vs-text-xs); color: var(--vs-text-tertiary); max-width: 80ch; }
  .tp-spoken span { font-family: var(--vs-font-mono); }
  .tp-source { margin: var(--vs-space-3) 0 0; font-size: var(--vs-text-sm); font-weight: var(--vs-font-weight-semibold); color: var(--vs-text-primary); }
  .tp-source span { font-family: var(--vs-font-mono); font-weight: var(--vs-font-weight-normal); color: var(--vs-text-tertiary); }
</style>
````

Create `studio/web/src/components/narration/NarrationTab.svelte`:

````
<script lang="ts">
  /**
   * The Narration tab (avg-goz): a spec-driven episode's registered takes;
   * any other episode's narration segments, as before.
   */
  import { library } from "$lib/library-store.svelte.ts";
  import { getGatewayClient } from "$lib/gateway.svelte.ts";
  import { episodeApi, parseEpisodeKey } from "$lib/sheet-review";
  import type { NarrationTakesAnswer } from "$lib/narration-takes";
  import NarrationPanel from "./NarrationPanel.svelte";
  import TakesPanel from "./TakesPanel.svelte";

  const ref = $derived(parseEpisodeKey(library.selectedEpisode));
  let answer = $state<NarrationTakesAnswer | null>(null);
  let error = $state<string | null>(null);

  $effect(() => {
    const at = ref;
    answer = null;
    error = null;
    if (!at) return;
    let live = true;
    getGatewayClient().fetchJSON<NarrationTakesAnswer>(`${episodeApi(at)}/narration-takes`)
      .then((a) => { if (live) answer = a; })
      .catch((err) => { if (live) error = err instanceof Error ? err.message : String(err); });
    return () => { live = false; };
  });
</script>

{#if answer?.specDriven}
  <TakesPanel {answer} />
{:else if error}
  <p class="tab-note" role="alert">{error}</p>
{:else if !ref || answer}
  <NarrationPanel />
{:else}
  <p class="tab-note" role="status">Loading…</p>
{/if}

<style>
  .tab-note { padding: var(--vs-space-4); color: var(--vs-text-secondary); font-size: var(--vs-text-sm); }
</style>
````

````diff
diff --git a/docs/running.md b/docs/running.md
index a17c176..98b0a1e 100644
--- a/docs/running.md
+++ b/docs/running.md
@@ -363,7 +363,10 @@ approved: making the sheet again clears the review, and an edit that changes
 what the sheet would show makes it stale. `approve` and `reject` sign with the
 operator key exactly the sheet on disk (`artifacts/layout-sheet/review.json`);
 a rejection needs a note. `status` exits 0 only for an approval. Pi only makes
-and reads the sheet.
+and reads the sheet. The web studio does the same from an episode's
+**Storyboard** tab (avg-goz): the stills, their state, and Approve / Reject
+when the browser holds the operator key; its **Narration** tab plays the
+registered takes, their words lit as they are said.
 
 ```bash
 node studio/runtime/dist/src/cli.js sheet approve my-channel/my-series/ep001 --library "$PWD/library"
diff --git a/studio/web/src/components/shell/ProductionCanvas.svelte b/studio/web/src/components/shell/ProductionCanvas.svelte
index f14e1e6..ea1c7cb 100644
--- a/studio/web/src/components/shell/ProductionCanvas.svelte
+++ b/studio/web/src/components/shell/ProductionCanvas.svelte
@@ -22,8 +22,8 @@
   import FileViewer from "../workspace/FileViewer.svelte";
   import StageRail from "../episode/StageRail.svelte";
   import StageDetail from "../episode/StageDetail.svelte";
-  import Storyboard from "../storyboard/Storyboard.svelte";
-  import NarrationPanel from "../narration/NarrationPanel.svelte";
+  import StoryboardTab from "../storyboard/StoryboardTab.svelte";
+  import NarrationTab from "../narration/NarrationTab.svelte";
   import RenderViewer from "../render/RenderViewer.svelte";
   import AgentBar from "../agent/AgentBar.svelte";
 
@@ -138,9 +138,9 @@
           <p class="pc-note">No episode loaded.</p>
         {/if}
       {:else if studio.view === "storyboard"}
-        <Storyboard />
+        <StoryboardTab />
       {:else if studio.view === "narration"}
-        <NarrationPanel />
+        <NarrationTab />
       {:else if studio.view === "render"}
         <RenderViewer />
       {/if}
````

- [ ] **Step 5: Run the checks, and see them pass.** From `studio/web`, run the four web checks in the Global Constraints, which give 186 tests. Then at the root, `npm run check`.

- [ ] **Step 6: Commit.**

```bash
git add studio/web/src/lib/sheet-review.ts studio/web/src/lib/narration-takes.ts studio/web/src/lib/episode-media.ts studio/web/src/components/storyboard/SheetReview.svelte studio/web/src/components/storyboard/StoryboardTab.svelte studio/web/src/components/narration/TakesPanel.svelte studio/web/src/components/narration/NarrationTab.svelte studio/web/test/unit/series-episode.test.ts studio/web/src/components/shell/ProductionCanvas.svelte docs/running.md
git commit -m "Web: a spec-driven episode's Storyboard reviews its layout sheet, its Narration plays its takes (avg-goz)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
