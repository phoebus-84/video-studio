import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { alignWords, compareTake, normalizeToken, textWords, verifyTake, type Transcript } from "../src/take-verify.js";

/**
 * Take verification (avg-8hs.3). The real case: San Martino's recital, made
 * by Qwen, skips the fourth line; the aligner still placed it, in 80 ms words.
 * The fixture is that take's text, its WordTiming and Whisper's transcript.
 */

const fixture = JSON.parse(readFileSync(join(__dirname, "fixtures/take-verify/san-martino-recita.json"), "utf-8"));
const heard = (text: string, step = 0.4): Transcript => ({
  text, model: "test", words: text.split(/\s+/).filter(Boolean).map((w, i) => ({ text: w, start: i * step, end: i * step + step * 0.8 })),
});

describe("comparing a take with its text", () => {
  it("finds San Martino's missing line twice: not heard, and squeezed by the alignment", () => {
    const report = compareTake({ text: fixture.text, heard: fixture.heard, durationSeconds: fixture.durationSeconds, timing: fixture.timing });
    expect(report.words.missing).toContainEqual({ line: 4, words: "urla e biancheggia il mar;", wholeLine: true });
    expect(report.squeezed[0]).toMatchObject({ line: 4, words: "urla e biancheggia il mar;", start: 8.8, heard: false });
    // Line 6's opening words are crowded too, but heard: there the timing is wrong, not the take.
    expect(report.squeezed[1]).toMatchObject({ line: 6, words: "ma per le vie", heard: true });
    // Line 6's first words are short too, but on their own line; two short words alone are ordinary.
    expect(report.squeezed.every((s) => s.words.split(" ").length >= 3)).toBe(true);
    expect(report.concerns[0]).toBe("line 4 is not heard at all: «urla e biancheggia il mar;»");
    // Elisions and spellings are not reported as missing: only line 4 is.
    expect(report.words.missing.filter((m) => m.wholeLine).map((m) => m.line)).toEqual([4]);
    expect(report.words.matched / report.words.expected).toBeGreaterThan(0.75);
  });

  it("measures every pause at a verse end and a stanza end", () => {
    const report = compareTake({ text: fixture.text, heard: fixture.heard, durationSeconds: fixture.durationSeconds, timing: fixture.timing });
    expect(report.pauses!.stanza.count).toBe(3);
    expect(report.pauses!.verse.count).toBe(12);
    expect(report.pauses!.all[0]).toMatchObject({ after: "colli", line: 1, kind: "verse" });
    expect(report.edges!.leadSeconds).toBe(0.16);
  });

  it("hears elisions, joined words and accents as the same words", () => {
    expect(normalizeToken("gl'irti")).toBe("glirti");
    expect(normalizeToken("Giosuè,")).toBe("giosue");
    const ops = alignWords(["va", "laspro", "odor", "de", "i", "vini"], ["fa", "laspro", "odor", "dei", "vini"]);
    expect(ops.map((o) => o.op)).toEqual(["sub", "match", "match", "match", "match"]);
    const clean = compareTake({ text: "San Martino.\nGiosuè Carducci.", heard: heard("San Martino, Giosuè Carducci"), durationSeconds: 3 });
    expect([clean.words.missing, clean.words.extra, clean.words.substituted]).toEqual([[], [], []]);
  });

  it("reports words heard that the text does not have, with their time", () => {
    const report = compareTake({ text: "la nebbia sale", heard: heard("la nebbia nebbia sale piano"), durationSeconds: 3 });
    expect(report.words.extra.map((e) => e.words)).toEqual(["nebbia", "piano"]);
    expect(report.concerns).toContain("heard but not in the text, at 1.60 s: «piano»");
  });

  it("counts stanzas from blank lines, not from the first line", () => {
    const words = textWords("\nuno due\n\n\ntre\nquattro");
    expect(words.map((w) => [w.word, w.line, w.stanza, w.lastOfLine])).toEqual([["uno", 2, 0, false], ["due", 2, 0, true], ["tre", 5, 1, true], ["quattro", 6, 1, true]]);
  });

  it("says what it could not measure without a timing", () => {
    const report = compareTake({ text: "la nebbia", heard: heard("la nebbia"), durationSeconds: 1 });
    expect([report.pauses, report.edges]).toEqual([null, null]);
    expect(report.concerns).toEqual(["no timing yet: align the take to measure its pauses"]);
  });
});

describe("verifyTake", () => {
  let ws: string;
  beforeEach(() => { ws = mkdtempSync(join(tmpdir(), "take-verify-")); });
  afterEach(() => rmSync(ws, { recursive: true, force: true }));
  const sha = (b: Buffer | string) => `sha256:${createHash("sha256").update(b).digest("hex")}`;

  function workspace() {
    const audio = Buffer.from("RIFF fake audio");
    mkdirSync(join(ws, "assets/takes"), { recursive: true });
    mkdirSync(join(ws, "artifacts/narration"), { recursive: true });
    writeFileSync(join(ws, "assets/takes/titolo.wav"), audio);
    writeFileSync(join(ws, "artifacts/narration/takes.json"), JSON.stringify({ takes: [{ id: "titolo", text: "Il lampo.", language: "it", audio: { path: "assets/takes/titolo.wav", hash: sha(audio), durationSeconds: 1.2 } }] }));
  }

  it("writes the report beside the take's artifacts, naming the audio it heard", async () => {
    workspace();
    const asked: string[] = [];
    const got = await verifyTake(ws, "titolo", { transcribe: async (path, language) => { asked.push(`${path}|${language}`); return heard("Il lampo"); }, now: () => new Date("2026-10-09T18:00:00Z") });
    expect(got.path).toBe("artifacts/takes/titolo.verification.json");
    expect(asked).toEqual([`${join(ws, "assets/takes/titolo.wav")}|it`]);
    const written = JSON.parse(readFileSync(join(ws, got.path), "utf-8"));
    expect(written).toMatchObject({ kind: "TakeVerification", take: { id: "titolo", audio: { path: "assets/takes/titolo.wav" } }, words: { expected: 2, matched: 2 }, createdAt: "2026-10-09T18:00:00.000Z" });
  });

  it("refuses a take that is not there, and audio that is not the take's", async () => {
    workspace();
    const t = { transcribe: async () => heard("x") };
    await expect(verifyTake(ws, "recita", t)).rejects.toMatchObject({ code: "no-such-take" });
    writeFileSync(join(ws, "assets/takes/titolo.wav"), "another take");
    await expect(verifyTake(ws, "titolo", t)).rejects.toMatchObject({ code: "audio-changed" });
  });
});
