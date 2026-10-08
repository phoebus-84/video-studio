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
