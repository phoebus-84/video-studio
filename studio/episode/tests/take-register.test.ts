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
