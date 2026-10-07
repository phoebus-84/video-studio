import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateWordTiming } from "@studio/contracts/src/word-timing.mjs";
import { alignTake } from "../src/take-align.js";
import { AlignError } from "../src/speech-align.js";
import { sha256, specEpisode } from "../src/testing.js";

/**
 * alignTake (avg-8hs.2) on a poetry-short episode whose takes are real audio
 * (ffmpeg: a tone, a 0.6 s pause, a tone). The voice worker is a local fake
 * answering POST /align; ElevenLabs is a local fake of its API.
 */

const REF = { channel: "sample", series: "poetry", episode: "morning" };
let root: string;
let worker: Server;
let workerUrl: string;
let workerAnswers: ((body: any) => { status: number; body: unknown })[];
const workerCalls: any[] = [];
const dir = () => join(root, REF.channel, "series", REF.series, "episodes", REF.episode);
const at = (relative: string) => join(dir(), relative);
const takes = () => JSON.parse(readFileSync(at("artifacts/narration/takes.json"), "utf-8"));

/** A take: tone, 0.6 s of silence, tone — `seconds` long in all. */
function audio(path: string, _take: string, seconds: number): void {
  const half = ((seconds - 0.6) / 2).toFixed(3);
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `sine=frequency=300:duration=${half}`,
    "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono:d=0.6",
    "-f", "lavfi", "-i", `sine=frequency=300:duration=${half}`,
    "-filter_complex", "[0:a]aresample=24000[a];[2:a]aresample=24000[c];[a][1:a][c]concat=n=3:v=0:a=1", "-ac", "1", path]);
}

/** The worker's answer: the text's words, spread evenly over `seconds`, punctuation dropped as Qwen does. */
const evenly = (seconds: number) => (body: any) => {
  const tokens = String(body.text).split(/\s+/).map((t) => t.replace(/[.,;:!?]/g, ""));
  const step = seconds / tokens.length;
  return { status: 200, body: { words: tokens.map((text, i) => ({ text, start: i * step, end: (i + 1) * step })), model: "mlx-community/Qwen3-ForcedAligner-0.6B-8bit", language: "English" } };
};

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "take-align-"));
  specEpisode(dir(), REF, { audio });
  workerAnswers = [];
  workerCalls.length = 0;
  worker = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw);
      workerCalls.push({ path: req.url, ...body });
      const answer = (workerAnswers.shift() ?? evenly(2.6))(body);
      res.writeHead(answer.status, { "content-type": "application/json" });
      res.end(JSON.stringify(answer.body));
    });
  });
  await new Promise<void>((resolve) => worker.listen(0, "127.0.0.1", resolve));
  workerUrl = `http://127.0.0.1:${(worker.address() as { port: number }).port}`;
});
afterEach(async () => {
  worker.closeAllConnections();
  await new Promise<void>((resolve) => worker.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
});

describe("alignTake with the local aligner", () => {
  it("writes the take's WordTiming and points takes.json at it, changing nothing else", async () => {
    const before = takes();
    const result = await alignTake(dir(), { take: "light", language: "en", workerUrl });
    expect(workerCalls).toEqual([{ path: "/align", audio_path: at("assets/takes/light.wav"), text: "Light falls across the quiet room.", language: "en" }]);
    expect(result.path).toBe("artifacts/timing/light.json");
    const timing = JSON.parse(readFileSync(at(result.path), "utf-8"));
    expect(timing).toEqual(result.timing);
    expect(validateWordTiming(timing, { audioHash: before.takes[0].audio.hash })).toEqual([]);
    expect(timing.words.map((w: { text: string }) => w.text)).toEqual(["Light", "falls", "across", "the", "quiet", "room."]);
    expect(timing.alignment).toMatchObject({ provider: "qwen-local", model: "mlx-community/Qwen3-ForcedAligner-0.6B-8bit", method: "forced" });
    expect(timing.language).toBe("en");
    expect(timing.speech).toHaveLength(2);
    // No word runs into the 0.6 s pause in the middle.
    const [pauseStart, pauseEnd] = [timing.speech[0][1], timing.speech[1][0]];
    for (const w of timing.words) expect(w.end <= pauseStart + 0.001 || w.start >= pauseEnd - 0.001).toBe(true);
    expect(result.pauses).toHaveLength(1);
    expect(result.pauses[0]).toBeGreaterThan(0.5);

    const after = takes();
    expect(after.takes[0].timing).toEqual({ path: "artifacts/timing/light.json", hash: sha256(readFileSync(at(result.path))) });
    expect({ ...after, takes: after.takes.slice(1) }).toEqual({ ...before, takes: before.takes.slice(1) });
    expect({ ...after.takes[0], timing: null }).toEqual({ ...before.takes[0], timing: null });
  });

  it("says which words it could not place", async () => {
    workerAnswers.push(() => ({ status: 200, body: { words: [
      { text: "Light", start: 0, end: 0.3 }, { text: "falls", start: 0.3, end: 0.6 }, { text: "across", start: 0.6, end: 0.9 },
      { text: "the", start: 0.9, end: 1 }, { text: "quiet", start: 1.6, end: 2 }, { text: "room", start: 2, end: 2.5 },
    ], model: "m", language: "English" } }));
    // One of six would be over the limit: a text with an extra word nobody said.
    const take = takes();
    take.takes[0].text = "Light falls across the very quiet room and the bright window.";
    writeFileSync(at("artifacts/narration/takes.json"), JSON.stringify(take, null, 2));
    await expect(alignTake(dir(), { take: "light", language: "en", workerUrl })).rejects.toMatchObject({ code: "alignment-mismatch" });
  });

  it("refuses what it cannot align, writing nothing", async () => {
    const before = readFileSync(at("artifacts/narration/takes.json"), "utf-8");
    const code = (p: Promise<unknown>) => p.then(() => "none", (e) => (e instanceof AlignError ? e.code : String(e)));
    expect(await code(alignTake(dir(), { take: "nobody", language: "en", workerUrl }))).toBe("no-such-take");
    expect(await code(alignTake(dir(), { take: "light", workerUrl }))).toBe("no-language");
    workerAnswers.push(() => ({ status: 422, body: { error: "HTTP error", detail: [{ msg: "the audio lasts 301.0 s", type: "too-long" }] } }));
    expect(await code(alignTake(dir(), { take: "light", language: "en", workerUrl }))).toBe("too-long");
    expect(await code(alignTake(dir(), { take: "light", language: "en", workerUrl: "http://127.0.0.1:9" }))).toBe("worker-unreachable");
    writeFileSync(at("assets/takes/light.wav"), "edited by hand");
    expect(await code(alignTake(dir(), { take: "light", language: "en", workerUrl }))).toBe("audio-changed");
    expect(readFileSync(at("artifacts/narration/takes.json"), "utf-8")).toBe(before);
  });
});

describe("alignTake with ElevenLabs", () => {
  let api: Server;
  let baseUrl: string;
  let apiCalls = 0;
  beforeEach(async () => {
    apiCalls = 0;
    api = createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        apiCalls++;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ words: ["Light", "falls", "across", "the", "quiet", "room."].map((text, i) => ({ text, start: i * 0.4, end: i * 0.4 + 0.35, loss: 0.1 })), loss: 0.1 }));
      });
    });
    await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(api.address() as { port: number }).port}`;
  });
  afterEach(async () => {
    api.closeAllConnections();
    await new Promise<void>((resolve) => api.close(() => resolve()));
  });

  it("aligns through the caller's spend function, at the take's minutes", async () => {
    const paid: number[] = [];
    const result = await alignTake(dir(), {
      take: "light", language: "en", provider: "elevenlabs",
      elevenlabs: { apiKey: "sk_test", baseUrl, pay: async (minutes, call) => { paid.push(minutes); return call(); } },
    });
    expect(paid).toEqual([2.6 / 60]);
    expect(apiCalls).toBe(1);
    expect(result.timing.alignment).toMatchObject({ provider: "elevenlabs", model: "forced-alignment", method: "forced" });
    expect(workerCalls).toEqual([]);
  });

  it("sends nothing without a key, or when the spend function refuses", async () => {
    await expect(alignTake(dir(), { take: "light", language: "en", provider: "elevenlabs" })).rejects.toMatchObject({ code: "no-key" });
    const refuse = async () => { throw new AlignError("budget", "the budget cannot hold $0.0003"); };
    await expect(alignTake(dir(), { take: "light", language: "en", provider: "elevenlabs", elevenlabs: { apiKey: "sk_test", baseUrl, pay: refuse } }))
      .rejects.toMatchObject({ code: "budget" });
    expect(apiCalls).toBe(0);
  });
});
